package main

// ============ Windows 系统音量合成器控制 ============
//
// 通过 Windows Core Audio API 的 ISimpleAudioVolume 接口
// 控制当前进程在系统音量合成器中的音量（而非 HTML5 audio.volume）。
//
// 由于 Go 的 syscall 无法正确传递 float 参数给 COM 方法，
// 这里用 CGO 在 C 层完成全部 COM 调用，Go 只传入整数音量值。
//
// C 代码手动定义 COM 接口 vtable，不依赖 mmdeviceapi.h / audiopolicy.h，
// 只需要 windows.h 和 objbase.h（MinGW-w64 自带）。

/*
#cgo LDFLAGS: -lole32

#include <windows.h>
#include <objbase.h>

// 所需的 GUID（手动定义，避免依赖 SDK 头文件）
static const GUID CLSID_MMDeviceEnumerator_v = {0xBCDE0395, 0xE52F, 0x467C, {0x8E, 0x3D, 0xC4, 0x57, 0x92, 0x91, 0x69, 0x2E}};
static const GUID IID_IMMDeviceEnumerator_v  = {0xA95664D2, 0x9614, 0x4F35, {0xA7, 0x46, 0xDE, 0x8D, 0xB6, 0x36, 0x17, 0xE6}};
static const GUID IID_IAudioSessionManager_v  = {0xF4B1A599, 0x7266, 0x4319, {0xA8, 0xCA, 0xE7, 0x0A, 0xCB, 0x11, 0xE8, 0xCD}};

// vtable 访问宏：obj 是 COM 对象指针，idx 是方法索引
// COM 对象第一个成员是 vtable 指针，vtable 是函数指针数组
#define VTBL(obj, idx) ((void**)*(void**)(obj))[(idx)]

// 通用 Release 调用（vtable[2] = Release）
static void COM_Release(void* obj) {
    if (obj) {
        typedef ULONG (__stdcall *ReleaseFn)(void*);
        ((ReleaseFn)VTBL(obj, 2))(obj);
    }
}

// SetAppVolume: 设置当前进程的系统音量合成器音量 (0-100)
static int SetAppVolume(int volume) {
    if (volume < 0) volume = 0;
    if (volume > 100) volume = 100;
    float level = (float)volume / 100.0f;

    void* pEnum = NULL;
    void* pDevice = NULL;
    void* pSession = NULL;
    void* pVolume = NULL;
    HRESULT hr;

    hr = CoCreateInstance(&CLSID_MMDeviceEnumerator_v, NULL, CLSCTX_ALL,
                          &IID_IMMDeviceEnumerator_v, &pEnum);
    if (FAILED(hr)) return (int)hr;

    // IMMDeviceEnumerator::GetDefaultAudioEndpoint(eRender=0, eConsole=0, &pDevice)
    // vtable: [0]QI [1]AddRef [2]Release [3]EnumAudioEndpoints [4]GetDefaultAudioEndpoint
    {
        typedef HRESULT (__stdcall *Fn)(void*, int, int, void**);
        hr = ((Fn)VTBL(pEnum, 4))(pEnum, 0, 0, &pDevice);
    }
    if (FAILED(hr)) { COM_Release(pEnum); return (int)hr; }

    // IMMDevice::Activate(IID_IAudioSessionManager, CLSCTX_ALL, NULL, &pSession)
    // vtable: [0]QI [1]AddRef [2]Release [3]Activate
    {
        typedef HRESULT (__stdcall *Fn)(void*, const GUID*, int, void*, void**);
        hr = ((Fn)VTBL(pDevice, 3))(pDevice, &IID_IAudioSessionManager_v, CLSCTX_ALL, NULL, &pSession);
    }
    if (FAILED(hr)) { COM_Release(pDevice); COM_Release(pEnum); return (int)hr; }

    // IAudioSessionManager::GetSimpleAudioVolume(NULL, 0, &pVolume)
    // vtable: [0]QI [1]AddRef [2]Release [3]GetAudioSessionControl [4]GetSimpleAudioVolume
    {
        typedef HRESULT (__stdcall *Fn)(void*, const GUID*, int, void**);
        hr = ((Fn)VTBL(pSession, 4))(pSession, NULL, 0, &pVolume);
    }
    if (FAILED(hr)) { COM_Release(pSession); COM_Release(pDevice); COM_Release(pEnum); return (int)hr; }

    // ISimpleAudioVolume::SetMasterVolume(level, NULL)
    // vtable: [0]QI [1]AddRef [2]Release [3]SetMasterVolume
    {
        typedef HRESULT (__stdcall *Fn)(void*, float, const GUID*);
        hr = ((Fn)VTBL(pVolume, 3))(pVolume, level, NULL);
    }

    COM_Release(pVolume);
    COM_Release(pSession);
    COM_Release(pDevice);
    COM_Release(pEnum);
    return (int)hr;
}

// GetAppVolume: 获取当前进程的系统音量合成器音量 (0-100)
static int GetAppVolume(int* outVolume) {
    void* pEnum = NULL;
    void* pDevice = NULL;
    void* pSession = NULL;
    void* pVolume = NULL;
    HRESULT hr;

    hr = CoCreateInstance(&CLSID_MMDeviceEnumerator_v, NULL, CLSCTX_ALL,
                          &IID_IMMDeviceEnumerator_v, &pEnum);
    if (FAILED(hr)) return (int)hr;

    {
        typedef HRESULT (__stdcall *Fn)(void*, int, int, void**);
        hr = ((Fn)VTBL(pEnum, 4))(pEnum, 0, 0, &pDevice);
    }
    if (FAILED(hr)) { COM_Release(pEnum); return (int)hr; }

    {
        typedef HRESULT (__stdcall *Fn)(void*, const GUID*, int, void*, void**);
        hr = ((Fn)VTBL(pDevice, 3))(pDevice, &IID_IAudioSessionManager_v, CLSCTX_ALL, NULL, &pSession);
    }
    if (FAILED(hr)) { COM_Release(pDevice); COM_Release(pEnum); return (int)hr; }

    {
        typedef HRESULT (__stdcall *Fn)(void*, const GUID*, int, void**);
        hr = ((Fn)VTBL(pSession, 4))(pSession, NULL, 0, &pVolume);
    }
    if (FAILED(hr)) { COM_Release(pSession); COM_Release(pDevice); COM_Release(pEnum); return (int)hr; }

    // ISimpleAudioVolume::GetMasterVolume(&level)
    // vtable: [0]QI [1]AddRef [2]Release [3]SetMasterVolume [4]GetMasterVolume
    {
        float level = 0.0f;
        typedef HRESULT (__stdcall *Fn)(void*, float*);
        hr = ((Fn)VTBL(pVolume, 4))(pVolume, &level);
        if (SUCCEEDED(hr)) {
            int v = (int)(level * 100.0f + 0.5f);
            if (v < 0) v = 0;
            if (v > 100) v = 100;
            *outVolume = v;
        }
    }

    COM_Release(pVolume);
    COM_Release(pSession);
    COM_Release(pDevice);
    COM_Release(pEnum);
    return (int)hr;
}
*/
import "C"

import "fmt"

// SetApplicationVolume 设置当前进程在 Windows 系统音量合成器中的音量 (0-100)
func (a *App) SetApplicationVolume(volume int) error {
	hr := C.SetAppVolume(C.int(volume))
	if hr != 0 {
		return fmt.Errorf("设置系统音量失败: 0x%08X", uint32(hr))
	}
	return nil
}

// GetApplicationVolume 获取当前进程在 Windows 系统音量合成器中的音量 (0-100)
func (a *App) GetApplicationVolume() (int, error) {
	var volume C.int
	hr := C.GetAppVolume(&volume)
	if hr != 0 {
		return 0, fmt.Errorf("获取系统音量失败: 0x%08X", uint32(hr))
	}
	return int(volume), nil
}
