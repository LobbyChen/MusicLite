//go:build !cgo || purego

package rawcalc

import (
	"math"
	"math/cmplx"
)

// FourierAnalysis 纯 Go 兜底实现：Cooley-Tukey Radix-2 复数 FFT
// 当编译环境没有 CGO，或者显式加 `-tags purego` 时使用。
//
// 输入实数信号，先零填充到下一个 2 的幂长度，再做 DFT（R2C），
// 输出与 fft_fftw.go 相同的 map[频率Hz]振幅（按同样的归一化方式）。
func FourierAnalysis(input []float64, sampleRate float64) map[float64]float64 {
	n := len(input)
	if n == 0 {
		return make(map[float64]float64)
	}

	// 零填充到 2 的幂
	n2 := nextPow2(n)
	signal := make([]complex128, n2)
	for i, v := range input {
		signal[i] = complex(v, 0)
	}
	fftInPlace(signal)

	// 频谱结果：只取前 n2/2 + 1 点（实信号频谱对称）
	result := make(map[float64]float64)
	halfN := n2/2 + 1
	for i := 0; i < halfN; i++ {
		c := signal[i]
		amplitude := cmplx.Abs(c)
		// 与 FFTW 版本保持相同归一化：
		// DC / Nyquist 除以 N；其他除以 N/2
		if i == 0 || i == n2/2 {
			amplitude /= float64(n2)
		} else {
			amplitude /= float64(n2) / 2.0
		}
		frequency := float64(i) * sampleRate / float64(n2)
		result[frequency] = amplitude
	}
	return result
}

// nextPow2 返回 ≥ n 的最小 2 的幂；n=0 时返回 1
func nextPow2(n int) int {
	if n <= 1 {
		return 1
	}
	p := 1
	for p < n {
		p <<= 1
	}
	return p
}

// fftInPlace Cooley-Tukey Radix-2 DIT FFT，就地修改 x，len(x) 必须是 2 的幂
func fftInPlace(x []complex128) {
	n := len(x)
	if n == 1 {
		return
	}

	// 位反转重排 (Bit-reversal permutation)
	j := 0
	for i := 1; i < n; i++ {
		bit := n >> 1
		for ; j&bit != 0; bit >>= 1 {
			j &^= bit
		}
		j |= bit
		if i < j {
			x[i], x[j] = x[j], x[i]
		}
	}

	// 蝴蝶运算
	for size := 2; size <= n; size <<= 1 {
		half := size >> 1
		// W = exp(-2πi/size) 的基元
		wstep := cmplx.Exp(complex(0, -2*math.Pi/float64(size)))
		for start := 0; start < n; start += size {
			w := complex(1, 0)
			for k := 0; k < half; k++ {
				t := w * x[start+k+half]
				u := x[start+k]
				x[start+k] = u + t
				x[start+k+half] = u - t
				w *= wstep
			}
		}
	}
}
