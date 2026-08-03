package rawcalc

/*
#cgo LDFLAGS: -lfftw3 -lm
#include <stdlib.h>
#include <string.h>
#include <fftw3.h>

// 执行 FFT
void execute_fft(fftw_plan plan, double *in, fftw_complex *out) {
    fftw_execute_dft_r2c(plan, in, out);
}

// 执行 IFFT
void execute_ifft(fftw_plan plan, fftw_complex *in, double *out) {
    fftw_execute_dft_c2r(plan, in, out);
}

// 创建 R2C 计划
fftw_plan create_r2c_plan(int n, double *in, fftw_complex *out, unsigned flags) {
    return fftw_plan_dft_r2c_1d(n, in, out, flags);
}

// 创建 C2R 计划
fftw_plan create_c2r_plan(int n, fftw_complex *in, double *out, unsigned flags) {
    return fftw_plan_dft_c2r_1d(n, in, out, flags);
}

// 释放计划
void destroy_plan(fftw_plan p) {
    fftw_destroy_plan(p);
}
*/
import "C"

import (
	"math"
	"unsafe"
)

// FilterConfig 定义滤波器参数
type FilterConfig struct {
	SampleRate float64 // 采样率 (Hz)
	NotchFreq  float64 // 工频陷波中心频率 (如 50 或 60)
	HighPass   float64 // 高通截止频率 (去除眼电, 如 0.5 或 1.0)
	LowPass    float64 // 低通截止频率 (去除肌电, 如 30.0 或 40.0)
	NotchWidth float64 // 陷波带宽 (Hz), 越窄影响越小，但需要更高精度
}

// DefaultConfig 返回默认配置
func DefaultConfig() FilterConfig {
	return FilterConfig{
		SampleRate: 256.0, // 常见 EEG 采样率
		NotchFreq:  50.0,  // 中国/欧洲工频
		HighPass:   0.5,   // 去除缓慢漂移和大部分眼电
		LowPass:    45.0,  // 保留主要脑电波段 (Delta, Theta, Alpha, Beta)，去除高频肌电
		NotchWidth: 2.0,   // 陷波宽度 ±1Hz
	}
}

// ProcessEEG 处理 EEG 信号
// 输入: 原始 EEG 数据
// 输出: 滤波后的 EEG 数据
func ProcessEEG(input []float64, config FilterConfig) []float64 {
	n := len(input)
	if n == 0 {
		return []float64{}
	}

	// 1. 分配内存
	// FFTW 需要 double 类型的数组
	cIn := (*C.double)(C.malloc(C.size_t(n) * C.sizeof_double))
	defer C.free(unsafe.Pointer(cIn))

	// 复数输出大小为 N/2 + 1
	complexN := n/2 + 1
	cOut := (*C.fftw_complex)(C.malloc(C.size_t(complexN) * C.sizeof_fftw_complex))
	defer C.free(unsafe.Pointer(cOut))

	// IFFT 输出
	cIfftOut := (*C.double)(C.malloc(C.size_t(n) * C.sizeof_double))
	defer C.free(unsafe.Pointer(cIfftOut))

	// 复制数据到 C 内存
	goSliceToCArray(input, cIn, n)

	// 2. 创建 FFT 计划
	// FFTW_MEASURE 会尝试几种算法找到最快的，但第一次调用慢。
	// 对于实时性要求高，可用 FFTW_ESTIMATE
	flags := C.uint(C.FFTW_MEASURE)

	planR2C := C.create_r2c_plan(C.int(n), cIn, cOut, flags)
	defer C.destroy_plan(planR2C)

	planC2R := C.create_c2r_plan(C.int(n), cOut, cIfftOut, flags)
	defer C.destroy_plan(planC2R)

	// 3. 执行 FFT (时域 -> 频域)
	C.execute_fft(planR2C, cIn, cOut)

	// 4. 频域滤波
	applyFilterInFrequencyDomain(cOut, n, config)

	// 5. 执行 IFFT (频域 -> 时域)
	C.execute_ifft(planC2R, cOut, cIfftOut)

	// 6. 归一化并转换回 Go slice
	// FFTW 的 IFFT 结果没有除以 N，需要手动除
	result := make([]float64, n)
	cArrayToGoSlice(cIfftOut, result, n)

	// 归一化
	for i := range result {
		result[i] /= float64(n)
	}

	return result
}

// applyFilterInFrequencyDomain 在频域应用带阻、高通和低通滤波
func applyFilterInFrequencyDomain(cComplex *C.fftw_complex, n int, config FilterConfig) {
	complexN := n/2 + 1

	// 获取指向复数数组的 Go 指针以便操作
	// fftw_complex 是 double[2] (real, imag)
	ptr := unsafe.Pointer(cComplex)
	sizeOfComplex := int(C.sizeof_fftw_complex)

	for i := 0; i < complexN; i++ {
		// 计算当前 bin 对应的频率
		freq := float64(i) * config.SampleRate / float64(n)

		// 获取实部和虚部
		offset := i * sizeOfComplex
		realPtr := (*C.double)(unsafe.Pointer(uintptr(ptr) + uintptr(offset)))
		imagPtr := (*C.double)(unsafe.Pointer(uintptr(ptr) + uintptr(offset) + uintptr(C.sizeof_double)))

		realVal := float64(*realPtr)
		imagVal := float64(*imagPtr)

		// 计算增益因子 (0.0 到 1.0)
		gain := 1.0

		// 1. 工频陷波 (Notch Filter)
		if isNearFrequency(freq, config.NotchFreq, config.NotchWidth) {
			gain = 0.0 // 完全去除，或者可以使用更平滑的窗口函数
		}

		// 2. 高通滤波 (去除眼电/漂移)
		if freq < config.HighPass {
			gain = 0.0
		}

		// 3. 低通滤波 (去除肌电)
		if freq > config.LowPass {
			gain = 0.0
		}

		// 应用增益
		*realPtr = C.double(realVal * gain)
		*imagPtr = C.double(imagVal * gain)
	}
}

// isNearFrequency 判断频率是否在目标频率附近
func isNearFrequency(current, target, width float64) bool {
	return math.Abs(current-target) <= width/2.0
}

// 辅助函数: Go []float64 -> C double*
func goSliceToCArray(src []float64, dst *C.double, n int) {
	srcPtr := (*C.double)(unsafe.Pointer(&src[0]))
	C.memcpy(unsafe.Pointer(dst), unsafe.Pointer(srcPtr), C.size_t(n)*C.sizeof_double)
}

// 辅助函数: C double* -> Go []float64
func cArrayToGoSlice(src *C.double, dst []float64, n int) {
	dstPtr := (*C.double)(unsafe.Pointer(&dst[0]))
	C.memcpy(unsafe.Pointer(dstPtr), unsafe.Pointer(src), C.size_t(n)*C.sizeof_double)
}
