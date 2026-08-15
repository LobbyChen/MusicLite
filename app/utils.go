package app

import (
	"fmt"
	"math/rand"
	"os"
	"time"
)

var noFileErr = fmt.Errorf("Not Avaliable File")

// 全局变量，只初始化一次
var rng = rand.New(rand.NewSource(time.Now().UnixNano()))

func random(min, max int) int {
	rng.Seed(time.Now().UnixNano())
	return rng.Intn(max-min) + min
}

// 判断文件是否存在
func fileExists(filename string) bool {
	info, err := os.Stat(filename)
	if os.IsNotExist(err) {
		return false
	}
	return !info.IsDir()
}
func GetFileInArgs() string {
	fmt.Printf("加载了%d个参数\n", len(os.Args))
	if len(os.Args) <= 1 {
		return ""
	}
	fn := os.Args[1]
	if fileExists(fn) {
		fmt.Println("文件存在")
		return fn
	}
	fmt.Println("文件不存在")
	return ""
}
