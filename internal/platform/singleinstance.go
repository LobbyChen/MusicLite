package platform

import (
	"net"
	"os"
	"time"
)

const singleInstanceAddr = "127.0.0.1:47831"

func notifyOldInstanceToQuit() bool {
	conn, err := net.DialTimeout("tcp", singleInstanceAddr, 500*time.Millisecond)
	if err != nil {
		return false
	}
	defer conn.Close()
	_, _ = conn.Write([]byte("quit"))
	return true
}

func startSingleInstanceServer() {
	go func() {
		listener, err := net.Listen("tcp", singleInstanceAddr)
		if err != nil {
			return
		}
		defer listener.Close()
		for {
			conn, err := listener.Accept()
			if err != nil {
				continue
			}
			buf := make([]byte, 16)
			n, _ := conn.Read(buf)
			conn.Close()
			if string(buf[:n]) == "quit" {
				os.Exit(0)
			}
		}
	}()
}

// EnsureSingleInstance 保证同一时间只有一个实例运行。
func EnsureSingleInstance() {
	if notifyOldInstanceToQuit() {
		for i := 0; i < 30; i++ {
			time.Sleep(100 * time.Millisecond)
			if l, err := net.Listen("tcp", singleInstanceAddr); err == nil {
				l.Close()
				time.Sleep(200 * time.Millisecond)
				break
			}
		}
	}
	startSingleInstanceServer()
}
