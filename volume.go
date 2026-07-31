package main

// ============ Windows 系统音量合成器控制（按进程树匹配音频会话）============
//
// MusicLite 自身不发声，音频由 Wails 启动的 WebView2 子进程输出。
// WebView2 有多个子进程（Manager/Page/GPU/Network/Storage/Audio/CrashPad），
// 其中只有 Audio Service 进程持有音频会话。该进程懒启动（播放时才创建），
// 因此不能在启动时缓存 PID。
//
// 策略：每次 Set/Get 调用时，枚举系统所有音频会话，对每个会话取其 PID，
// 用 CreateToolhelp32Snapshot 检查该 PID 是否为本进程的子孙进程。
// 这样不论音频服务何时启动、叫什么名字，都能正确命中。
//
// CGO 在 C 层完成全部 COM + 进程树调用，Go 只传入本进程 PID 和整数音量值。
//
// 各接口 vtable 索引（IUnknown 前三位固定为 QI/AddRef/Release）：
//   IAudioSessionManager2:     [5]GetSessionEnumerator
//   IAudioSessionEnumerator:   [3]GetCount [4]GetSession
//   IAudioSessionControl2:     [14]GetProcessId
//   ISimpleAudioVolume:        [3]SetMasterVolume [4]GetMasterVolume

/*
#cgo LDFLAGS: -lole32

#include <windows.h>
#include <objbase.h>
#include <tlhelp32.h>

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

// IsDescendantOf: 检查 targetPid 是否是 ancestorPid 的子孙进程（沿父进程链向上走）
static int IsDescendantOf(DWORD targetPid, DWORD ancestorPid) {
    if (targetPid == 0 || targetPid == ancestorPid) return 0;

    HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snap == INVALID_HANDLE_VALUE) return 0;

    // 构建 PID → ParentPID 映射（容量足够覆盖系统中所有进程）
    int cap = 4096, count = 0;
    DWORD* pids  = (DWORD*)malloc(cap * sizeof(DWORD));
    DWORD* ppids = (DWORD*)malloc(cap * sizeof(DWORD));
    if (!pids || !ppids) { free(pids); free(ppids); CloseHandle(snap); return 0; }

    PROCESSENTRY32W pe;
    pe.dwSize = sizeof(pe);
    if (Process32FirstW(snap, &pe)) {
        do {
            if (count >= cap) break;
            pids[count]  = pe.th32ProcessID;
            ppids[count] = pe.th32ParentProcessID;
            count++;
        } while (Process32NextW(snap, &pe));
    }
    CloseHandle(snap);

    // 从 targetPid 沿父进程链向上走
    DWORD cur = targetPid;
    int result = 0;
    for (int step = 0; step < 128; step++) {
        int idx = -1;
        for (int j = 0; j < count; j++) {
            if (pids[j] == cur) { idx = j; break; }
        }
        if (idx < 0) break;
        DWORD pp = ppids[idx];
        if (pp == ancestorPid) { result = 1; break; }
        if (pp == 0 || pp == cur) break;
        cur = pp;
    }

    free(pids); free(ppids);
    return result;
}

// SetAppVolumeByTree: 枚举音频会话，对 PID 属于 parentPid 子孙的会话设置音量
// 返回 0=成功，其他=HRESULT 错误码
static int SetAppVolumeByTree(DWORD parentPid, int volume) {
    if (volume < 0) volume = 0;
    if (volume > 100) volume = 100;
    float level = (float)volume / 100.0f;

    void* pEnum = NULL;
    void* pDevice = NULL;
    void* pSessionMgr = NULL;
    void* pSessionEnum = NULL;
    HRESULT hr;
    int applied = 0;

    hr = CoCreateInstance(&CLSID_MMDeviceEnumerator_v, NULL, CLSCTX_ALL,
                          &IID_IMMDeviceEnumerator_v, &pEnum);
    if (FAILED(hr)) return (int)hr;

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

    int sessionCount = 0;
    {
        typedef HRESULT (__stdcall *Fn)(void*, int*);
        hr = ((Fn)VTBL(pSessionEnum, 3))(pSessionEnum, &sessionCount);
    }
    if (FAILED(hr)) goto cleanup_enum2;

    for (int i = 0; i < sessionCount; i++) {
        void* pSession = NULL;
        typedef HRESULT (__stdcall *GetSessionFn)(void*, int, void**);
        hr = ((GetSessionFn)VTBL(pSessionEnum, 4))(pSessionEnum, i, &pSession);
        if (FAILED(hr) || !pSession) continue;

        // QI IAudioSessionControl2 拿 PID
        void* pCtrl2 = NULL;
        {
            typedef HRESULT (__stdcall *Fn)(void*, const GUID*, void**);
            hr = ((Fn)VTBL(pSession, 0))(pSession, &IID_IAudioSessionControl2_v, &pCtrl2);
        }
        if (SUCCEEDED(hr) && pCtrl2) {
            DWORD pid = 0;
            typedef HRESULT (__stdcall *GetPidFn)(void*, DWORD*);
            hr = ((GetPidFn)VTBL(pCtrl2, 14))(pCtrl2, &pid);
            COM_Release(pCtrl2);
            if (SUCCEEDED(hr) && IsDescendantOf(pid, parentPid)) {
                // QI ISimpleAudioVolume 并 SetMasterVolume
                void* pVol = NULL;
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
    }

cleanup_enum2:
    COM_Release(pSessionEnum);
cleanup_mgr:
    COM_Release(pSessionMgr);
cleanup_device:
    COM_Release(pDevice);
cleanup_enum:
    COM_Release(pEnum);

    if (applied) return 0;
    if (FAILED(hr)) return (int)hr;
    return (int)0x80004005; // E_FAIL：未匹配到任何会话
}

// GetAppVolumeByTree: 枚举音频会话，取第一个 PID 属于 parentPid 子孙的会话音量
static int GetAppVolumeByTree(DWORD parentPid, int* outVolume) {
    void* pEnum = NULL;
    void* pDevice = NULL;
    void* pSessionMgr = NULL;
    void* pSessionEnum = NULL;
    HRESULT hr;
    int got = 0;

    hr = CoCreateInstance(&CLSID_MMDeviceEnumerator_v, NULL, CLSCTX_ALL,
                          &IID_IMMDeviceEnumerator_v, &pEnum);
    if (FAILED(hr)) return (int)hr;

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

    int sessionCount = 0;
    {
        typedef HRESULT (__stdcall *Fn)(void*, int*);
        hr = ((Fn)VTBL(pSessionEnum, 3))(pSessionEnum, &sessionCount);
    }
    if (FAILED(hr)) goto cleanup_enum2;

    for (int i = 0; i < sessionCount && !got; i++) {
        void* pSession = NULL;
        typedef HRESULT (__stdcall *GetSessionFn)(void*, int, void**);
        hr = ((GetSessionFn)VTBL(pSessionEnum, 4))(pSessionEnum, i, &pSession);
        if (FAILED(hr) || !pSession) continue;

        void* pCtrl2 = NULL;
        {
            typedef HRESULT (__stdcall *Fn)(void*, const GUID*, void**);
            hr = ((Fn)VTBL(pSession, 0))(pSession, &IID_IAudioSessionControl2_v, &pCtrl2);
        }
        if (SUCCEEDED(hr) && pCtrl2) {
            DWORD pid = 0;
            typedef HRESULT (__stdcall *GetPidFn)(void*, DWORD*);
            hr = ((GetPidFn)VTBL(pCtrl2, 14))(pCtrl2, &pid);
            COM_Release(pCtrl2);
            if (SUCCEEDED(hr) && IsDescendantOf(pid, parentPid)) {
                void* pVol = NULL;
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

    if (got) return 0;
    if (FAILED(hr)) return (int)hr;
    return (int)0x80004005;
}
*/
import "C"

import (
	"fmt"
	goruntime "runtime"
)

// SetApplicationVolume 设置 WebView2 音频子进程在 Windows 系统音量合成器中的音量 (0-100)
func (a *App) SetApplicationVolume(volume int) error {
	errCh := make(chan error, 1)
	go func() {
		goruntime.LockOSThread()
		defer goruntime.UnlockOSThread()
		C.CoInitializeEx(nil, C.COINIT_MULTITHREADED)
		defer C.CoUninitialize()

		hr := C.SetAppVolumeByTree(C.DWORD(uint32(getCurrentPID())), C.int(volume))
		if hr != 0 {
			errCh <- fmt.Errorf("设置系统音量失败: 0x%08X", uint32(hr))
		} else {
			errCh <- nil
		}
	}()
	return <-errCh
}

// GetApplicationVolume 获取 WebView2 音频子进程在 Windows 系统音量合成器中的音量 (0-100)
func (a *App) GetApplicationVolume() (int, error) {
	resCh := make(chan struct {
		vol int
		err error
	}, 1)
	go func() {
		goruntime.LockOSThread()
		defer goruntime.UnlockOSThread()
		C.CoInitializeEx(nil, C.COINIT_MULTITHREADED)
		defer C.CoUninitialize()

		var vol C.int
		hr := C.GetAppVolumeByTree(C.DWORD(uint32(getCurrentPID())), &vol)
		var err error
		if hr != 0 {
			err = fmt.Errorf("获取系统音量失败: 0x%08X", uint32(hr))
		}
		resCh <- struct {
			vol int
			err error
		}{int(vol), err}
	}()
	r := <-resCh
	return r.vol, r.err
}

// getCurrentPID 返回当前进程 PID
func getCurrentPID() int {
	return int(C.GetCurrentProcessId())
}
