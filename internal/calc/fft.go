package rawcalc

/*
#cgo LDFLAGS: -lfftw3 -lm
#include <fftw3.h>
#include <stdlib.h>
*/
import "C"

import (
	"math"
	"unsafe"
)

// FourierAnalysis 执行快速傅里叶变换
// input: 输入的实数信号数组
// sampleRate: 采样率 (Hz)，用于计算实际频率
// 返回: map[float64]float64，键为频率(Hz)，值为振幅
func FourierAnalysis(input []float64, sampleRate float64) map[float64]float64 {
	n := len(input)
	if n == 0 {
		return make(map[float64]float64)
	}

	// 分配内存
	// in: 输入实数数组
	// out: 输出复数数组 (fftw_complex 是 double[2])
	in := (*C.double)(C.malloc(C.size_t(n) * C.sizeof_double))
	out := (*C.fftw_complex)(C.malloc(C.size_t(n) * C.sizeof_fftw_complex))

	// 检查内存分配是否成功
	if in == nil || out == nil {
		panic("Failed to allocate memory")
	}
	defer C.free(unsafe.Pointer(in))
	defer C.free(unsafe.Pointer(out))

	// 将 Go slice 复制到 C 数组
	for i, v := range input {
		*(*C.double)(unsafe.Pointer(uintptr(unsafe.Pointer(in)) + uintptr(i)*C.sizeof_double)) = C.double(v)
	}

	// 创建 FFTW 计划
	// FFTW_R2HC: Real to Half-Complex 格式，或者使用 FFTW_DFT 进行标准复数变换
	// 这里为了通用性和简单理解，我们使用标准的 DFT (FFTWF_ESTIMATE 用于快速规划)
	plan := C.fftw_plan_dft_r2c_1d(
		C.int(n),
		in,
		out,
		C.FFTW_ESTIMATE,
	)

	// 执行 FFT
	C.fftw_execute(plan)

	// 销毁计划
	C.fftw_destroy_plan(plan)

	// 处理结果
	result := make(map[float64]float64)

	// FFT 输出是复数数组，长度为 n
	// 对于实数输入，频谱是对称的。我们只需要前 n/2 + 1 个点
	// 索引 0: DC 分量 (0 Hz)
	// 索引 k: 频率 k * Fs / N
	// 索引 n/2: Nyquist 频率 (Fs/2)

	halfN := n/2 + 1

	for i := 0; i < halfN; i++ {
		// 获取复数的实部和虚部
		// fftw_complex 是 double[2], [0] 是实部, [1] 是虚部
		ptr := (*[2]C.double)(unsafe.Pointer(uintptr(unsafe.Pointer(out)) + uintptr(i)*C.sizeof_fftw_complex))

		re := float64(ptr[0])
		im := float64(ptr[1])

		// 计算振幅
		amplitude := math.Sqrt(re*re + im*im)

		// 归一化振幅
		// 对于 DC 和 Nyquist 频率，除以 N
		// 对于其他频率，除以 N/2 (因为能量分布在正负频率上，我们只取了一半)
		if i == 0 || i == n/2 {
			amplitude /= float64(n)
		} else {
			amplitude /= float64(n) / 2.0
		}

		// 计算频率
		frequency := float64(i) * sampleRate / float64(n)

		result[frequency] = amplitude
	}

	return result
}
