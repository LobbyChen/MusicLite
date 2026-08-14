//go:build cgo && !purego

package rawcalc

/*
#cgo windows LDFLAGS: -lfftw3 -lm
#cgo !windows LDFLAGS: -lfftw3 -lm
#include <fftw3.h>
#include <stdlib.h>
*/
import "C"

import (
	"math"
	"unsafe"
)

// FourierAnalysis 通过 FFTW (CGO) 执行快速傅里叶变换。
// 跨平台编译时的本机依赖：
//   - Windows：需要 libfftw3-3.dll 或等效导入库参与链接（随仓库提供）
//   - macOS：  brew install fftw
//   - Linux：  apt-get install libfftw3-dev (Debian/Ubuntu) 或 dnf install fftw-devel (Fedora)
//
// 若无法安装 FFTW，可在构建时加 -tags purego 使用纯 Go FFT 兜底（见 fft_purego.go）。
func FourierAnalysis(input []float64, sampleRate float64) map[float64]float64 {
	n := len(input)
	if n == 0 {
		return make(map[float64]float64)
	}

	in := (*C.double)(C.malloc(C.size_t(n) * C.sizeof_double))
	out := (*C.fftw_complex)(C.malloc(C.size_t(n) * C.sizeof_fftw_complex))
	if in == nil || out == nil {
		panic("Failed to allocate memory for FFTW")
	}
	defer C.free(unsafe.Pointer(in))
	defer C.free(unsafe.Pointer(out))

	for i, v := range input {
		*(*C.double)(unsafe.Pointer(uintptr(unsafe.Pointer(in)) + uintptr(i)*C.sizeof_double)) = C.double(v)
	}

	plan := C.fftw_plan_dft_r2c_1d(C.int(n), in, out, C.FFTW_ESTIMATE)
	C.fftw_execute(plan)
	C.fftw_destroy_plan(plan)

	result := make(map[float64]float64)
	halfN := n/2 + 1
	for i := 0; i < halfN; i++ {
		ptr := (*[2]C.double)(unsafe.Pointer(uintptr(unsafe.Pointer(out)) + uintptr(i)*C.sizeof_fftw_complex))
		re := float64(ptr[0])
		im := float64(ptr[1])
		amplitude := math.Sqrt(re*re + im*im)
		if i == 0 || i == n/2 {
			amplitude /= float64(n)
		} else {
			amplitude /= float64(n) / 2.0
		}
		frequency := float64(i) * sampleRate / float64(n)
		result[frequency] = amplitude
	}
	return result
}
