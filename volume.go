package main

// ============ Windows 音量合成器控制（按 PID 直接匹配音频会话）============
//
// 播放迁移到 Go 后端后，音频由本 Go 进程直接输出，Windows 音量合成器中
// 对应的音频会话 PID 就是本进程自身。因此用 os.Getpid() 拿到 PID，
// 枚举所有音频会话，通过 IAudioSessionControl2::GetProcessId 直接比较 PID
// 即可命中，无需进程树匹配。
//
// CGO 在 C 层完成全部 COM 调用，Go 只传入 PID 和整数音量值。
// 每个 C 函数内部用 CoInitializeEx 初始化 COM（cgo 线程需独立初始化），
// 返回 S_OK 时配对 CoUninitialize。
//
// 各接口 vtable 索引（IUnknown 前三位固定为 QI/AddRef/Release）：
//   IAudioSessionManager2:     [5]GetSessionEnumerator
//   IAudioSessionEnumerator:   [3]GetCount [4]GetSession
//   IAudioSessionControl2:     [14]GetProcessId
//   ISimpleAudioVolume:        [3]SetMasterVolume [4]GetMasterVolume
//   IMMDeviceEnumerator:       [4]GetDefaultAudioEndpoint
//   IMMDevice:                 [3]Activate

/*
#cgo LDFLAGS: -lole32

#include <windows.h>
#include <objbase.h>

// GUID（对照 audiopolicy.idl / audioclient.h 核实）
static const GUID CLSID_MMDeviceEnumerator_v   = {0xBCDE0395, 0xE52F, 0x467C, {0x8E, 0x3D, 0xC4, 0x57, 0x92, 0x91, 0x69, 0x2E}};
static const GUID IID_IMMDeviceEnumerator_v    = {0xA95664D2, 0x9614, 0x4F35, {0xA7, 0x46, 0xDE, 0x8D, 0xB6, 0x36, 0x17, 0xE6}};
static const GUID IID_IAudioSessionManager2_v  = {0x77AA99A0, 0x1BD6, 0x484F, {0x8B, 0xC7, 0x2C, 0x65, 0x4C, 0x9A, 0x9B, 0x6F}};
static const GUID IID_IAudioSessionEnumerator_v= {0xE2F5BB11, 0x0570, 0x40CA, {0xAC, 0xDD, 0x3A, 0xA0, 0x12, 0x77, 0xDE, 0xE8}};
static const GUID IID_IAudioSessionControl2_v  = {0xBFB7FF88, 0x7239, 0x4FC9, {0x8F, 0xA2, 0x07, 0xC9, 0x50, 0xBE, 0x9C, 0x6D}};
static const GUID IID_ISimpleAudioVolume_v     = {0x87CE5498, 0x68D6, 0x44E5, {0x92, 0x15, 0x6D, 0xA4, 0x7E, 0xF8, 0x83, 0xD8}};

#define VTBL(obj, idx) ((void**)*(void**)(obj))[(idx)]

static void COM_Release(void* obj) {
    if (obj) {
        typedef ULONG (__stdcall *ReleaseFn)(void*);
        ((ReleaseFn)VTBL(obj, 2))(obj);
    }
}

// SetAppVolumeByPid: 枚举音频会话，对 PID 等于 pid 的会话设置音量
// 返回 0=成功，其他=HRESULT 错误码
static int SetAppVolumeByPid(DWORD pid, int volume) {
    if (volume < 0) volume = 0;
    if (volume > 100) volume = 100;
    float level = (float)volume / 100.0f;

    // cgo 线程需独立初始化 COM；S_OK 时配对 CoUninitialize
    // S_FALSE=已初始化，RPC_E_CHANGED_MODE=已用不同模型初始化，这两种情况不调用 CoUninitialize
    HRESULT hrInit = CoInitializeEx(NULL, COINIT_MULTITHREADED);

    void* pEnum = NULL;
    void* pDevice = NULL;
    void* pSessionMgr = NULL;
    void* pSessionEnum = NULL;
    HRESULT hr;
    int applied = 0;
    int sessionCount = 0;
    int i;

    hr = CoCreateInstance(&CLSID_MMDeviceEnumerator_v, NULL, CLSCTX_ALL,
                          &IID_IMMDeviceEnumerator_v, &pEnum);
    if (FAILED(hr)) goto done;

    {
        typedef HRESULT (__stdcall *Fn)(void*, int, int, void**);
        hr = ((Fn)VTBL(pEnum, 4))(pEnum, 0, 0, &pDevice);
    }
    if (FAILED(hr)) goto cleanup_enum;

    {
        typedef HRESULT (__stdcall *Fn)(void*, const GUID*, int, void*, void**);
        hr = ((Fn)VTBL(pDevice, 3))(pDevice, &IID_IAudioSessionManager2_v, CLSCTX_ALL, NULL, &pSessionMgr);
    }
    if (FAILED(hr)) goto cleanup_device;

    {
        typedef HRESULT (__stdcall *Fn)(void*, void**);
        hr = ((Fn)VTBL(pSessionMgr, 5))(pSessionMgr, &pSessionEnum);
    }
    if (FAILED(hr)) goto cleanup_mgr;

    {
        typedef HRESULT (__stdcall *Fn)(void*, int*);
        hr = ((Fn)VTBL(pSessionEnum, 3))(pSessionEnum, &sessionCount);
    }
    if (FAILED(hr)) goto cleanup_enum2;

    for (i = 0; i < sessionCount; i++) {
        void* pSession = NULL;
        void* pCtrl2 = NULL;
        void* pVol = NULL;
        typedef HRESULT (__stdcall *GetSessionFn)(void*, int, void**);
        hr = ((GetSessionFn)VTBL(pSessionEnum, 4))(pSessionEnum, i, &pSession);
        if (FAILED(hr) || !pSession) continue;

        // QI IAudioSessionControl2 拿 PID
        {
            typedef HRESULT (__stdcall *Fn)(void*, const GUID*, void**);
            hr = ((Fn)VTBL(pSession, 0))(pSession, &IID_IAudioSessionControl2_v, &pCtrl2);
        }
        if (SUCCEEDED(hr) && pCtrl2) {
            DWORD sessPid = 0;
            typedef HRESULT (__stdcall *GetPidFn)(void*, DWORD*);
            hr = ((GetPidFn)VTBL(pCtrl2, 14))(pCtrl2, &sessPid);
            COM_Release(pCtrl2);
            // 直接 PID 比较：音频由本 Go 进程输出，会话 PID == 传入 pid
            if (SUCCEEDED(hr) && sessPid == pid) {
                // QI ISimpleAudioVolume 并 SetMasterVolume
                typedef HRESULT (__stdcall *QIFn)(void*, const GUID*, void**);
                hr = ((QIFn)VTBL(pSession, 0))(pSession, &IID_ISimpleAudioVolume_v, &pVol);
                if (SUCCEEDED(hr) && pVol) {
                    typedef HRESULT (__stdcall *SetVolFn)(void*, float, const GUID*);
                    HRESULT hr2 = ((SetVolFn)VTBL(pVol, 3))(pVol, level, NULL);
                    if (SUCCEEDED(hr2)) applied = 1;
                    COM_Release(pVol);
                }
            }
        }
        COM_Release(pSession);
        if (applied) break;
    }

cleanup_enum2:
    COM_Release(pSessionEnum);
cleanup_mgr:
    COM_Release(pSessionMgr);
cleanup_device:
    COM_Release(pDevice);
cleanup_enum:
    COM_Release(pEnum);

done:
    if (hrInit == S_OK) CoUninitialize();

    if (applied) return 0;
    if (FAILED(hr)) return (int)hr;
    return (int)0x80004005; // E_FAIL：未匹配到任何会话
}

// GetAppVolumeByPid: 枚举音频会话，取第一个 PID 等于 pid 的会话音量
// 返回 0=成功，其他=HRESULT 错误码
static int GetAppVolumeByPid(DWORD pid, int* outVolume) {
    HRESULT hrInit = CoInitializeEx(NULL, COINIT_MULTITHREADED);

    void* pEnum = NULL;
    void* pDevice = NULL;
    void* pSessionMgr = NULL;
    void* pSessionEnum = NULL;
    HRESULT hr;
    int got = 0;
    int sessionCount = 0;
    int i;

    hr = CoCreateInstance(&CLSID_MMDeviceEnumerator_v, NULL, CLSCTX_ALL,
                          &IID_IMMDeviceEnumerator_v, &pEnum);
    if (FAILED(hr)) goto done;

    {
        typedef HRESULT (__stdcall *Fn)(void*, int, int, void**);
        hr = ((Fn)VTBL(pEnum, 4))(pEnum, 0, 0, &pDevice);
    }
    if (FAILED(hr)) goto cleanup_enum;

    {
        typedef HRESULT (__stdcall *Fn)(void*, const GUID*, int, void*, void**);
        hr = ((Fn)VTBL(pDevice, 3))(pDevice, &IID_IAudioSessionManager2_v, CLSCTX_ALL, NULL, &pSessionMgr);
    }
    if (FAILED(hr)) goto cleanup_device;

    {
        typedef HRESULT (__stdcall *Fn)(void*, void**);
        hr = ((Fn)VTBL(pSessionMgr, 5))(pSessionMgr, &pSessionEnum);
    }
    if (FAILED(hr)) goto cleanup_mgr;

    {
        typedef HRESULT (__stdcall *Fn)(void*, int*);
        hr = ((Fn)VTBL(pSessionEnum, 3))(pSessionEnum, &sessionCount);
    }
    if (FAILED(hr)) goto cleanup_enum2;

    for (i = 0; i < sessionCount && !got; i++) {
        void* pSession = NULL;
        void* pCtrl2 = NULL;
        void* pVol = NULL;
        typedef HRESULT (__stdcall *GetSessionFn)(void*, int, void**);
        hr = ((GetSessionFn)VTBL(pSessionEnum, 4))(pSessionEnum, i, &pSession);
        if (FAILED(hr) || !pSession) continue;

        {
            typedef HRESULT (__stdcall *Fn)(void*, const GUID*, void**);
            hr = ((Fn)VTBL(pSession, 0))(pSession, &IID_IAudioSessionControl2_v, &pCtrl2);
        }
        if (SUCCEEDED(hr) && pCtrl2) {
            DWORD sessPid = 0;
            typedef HRESULT (__stdcall *GetPidFn)(void*, DWORD*);
            hr = ((GetPidFn)VTBL(pCtrl2, 14))(pCtrl2, &sessPid);
            COM_Release(pCtrl2);
            if (SUCCEEDED(hr) && sessPid == pid) {
                typedef HRESULT (__stdcall *QIFn)(void*, const GUID*, void**);
                hr = ((QIFn)VTBL(pSession, 0))(pSession, &IID_ISimpleAudioVolume_v, &pVol);
                if (SUCCEEDED(hr) && pVol) {
                    float level = 0.0f;
                    typedef HRESULT (__stdcall *GetVolFn)(void*, float*);
                    HRESULT hr2 = ((GetVolFn)VTBL(pVol, 4))(pVol, &level);
                    if (SUCCEEDED(hr2)) {
                        int v = (int)(level * 100.0f + 0.5f);
                        if (v < 0) v = 0;
                        if (v > 100) v = 100;
                        *outVolume = v;
                        got = 1;
                    }
                    COM_Release(pVol);
                }
            }
        }
        COM_Release(pSession);
    }

cleanup_enum2:
    COM_Release(pSessionEnum);
cleanup_mgr:
    COM_Release(pSessionMgr);
cleanup_device:
    COM_Release(pDevice);
cleanup_enum:
    COM_Release(pEnum);

done:
    if (hrInit == S_OK) CoUninitialize();

    if (got) return 0;
    if (FAILED(hr)) return (int)hr;
    return (int)0x80004005;
}

*/
import "C"

import (
	"fmt"
	"log"

	volume "github.com/itchyny/volume-go"
)

// 注：播放已迁移到 Go 后端（player.go），音频由本 Go 进程直接输出。
// synth 模式下，Windows 音量合成器中的音频会话 PID 就是本进程自身，
// 因此 SetApplicationVolume/GetApplicationVolume 用 os.Getpid() 拿到 PID，
// 传给 C 函数 SetAppVolumeByPid/GetAppVolumeByPid 做直接 PID 匹配。
// master 模式走 SetSystemMasterVolume/GetSystemMasterVolume（itchyny/volume-go）。

// setAppVolumeByPid 设置指定进程在 Windows 音量合成器中的音量（0-100）
// 用于 synth 模式：传入 os.Getpid() 命中本进程音频会话
func setAppVolumeByPid(pid int, volume int) error {
	rc := C.SetAppVolumeByPid(C.DWORD(pid), C.int(volume))
	if rc != 0 {
		return fmt.Errorf("SetAppVolumeByPid 失败 HRESULT=0x%08X", uint32(rc))
	}
	return nil
}

// getAppVolumeByPid 读取指定进程在 Windows 音量合成器中的音量（0-100）
// 用于 synth 模式：传入 os.Getpid() 命中本进程音频会话
func getAppVolumeByPid(pid int) (int, error) {
	var out C.int
	rc := C.GetAppVolumeByPid(C.DWORD(pid), &out)
	if rc != 0 {
		return 0, fmt.Errorf("GetAppVolumeByPid 失败 HRESULT=0x%08X", uint32(rc))
	}
	return int(out), nil
}

// SetSystemMasterVolume 设置系统主音量 (0-100)
func (a *App) SetSystemMasterVolume(vol int) error {
	// 钳制范围
	if vol < 0 {
		vol = 0
	}
	if vol > 100 {
		vol = 100
	}

	err := volume.SetVolume(vol)
	if err != nil {
		return fmt.Errorf("设置系统主音量失败: %w", err)
	}

	log.Printf("[Volume] SetSystemMasterVolume(%d) OK", vol)
	return nil
}

// GetSystemMasterVolume 获取系统主音量 (0-100)
func (a *App) GetSystemMasterVolume() (int, error) {
	vol, err := volume.GetVolume()
	if err != nil {
		return 0, fmt.Errorf("获取系统主音量失败: %w", err)
	}

	log.Printf("[Volume] GetSystemMasterVolume vol=%d", vol)
	return vol, nil
}

// MuteSystemMasterVolume 静音系统
func (a *App) MuteSystemMasterVolume() error {
	err := volume.Mute()
	if err != nil {
		return fmt.Errorf("静音失败: %w", err)
	}
	log.Printf("[Volume] MuteSystemMasterVolume OK")
	return nil
}

// UnmuteSystemMasterVolume 取消静音
func (a *App) UnmuteSystemMasterVolume() error {
	err := volume.Unmute()
	if err != nil {
		return fmt.Errorf("取消静音失败: %w", err)
	}
	log.Printf("[Volume] UnmuteSystemMasterVolume OK")
	return nil
}
