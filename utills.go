package main

import (
	"math/rand"
	"time"
)

// 全局变量，只初始化一次
var rng = rand.New(rand.NewSource(time.Now().UnixNano()))

func random(min, max int) int {
	rng.Seed(time.Now().UnixNano())
	return rng.Intn(max-min) + min
}
