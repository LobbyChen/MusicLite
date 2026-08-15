package app

// ============ 单实例控制 ============
//
// 通过本地 TCP 端口保证同时只有一个实例运行。
// 旧实例启动后会监听 127.0.0.1:<singleInstancePort>；
// 新实例启动时尝试连接该端口，连得上说明已有旧实例运行，
// 于是发送 "quit" 命令，旧实例收到后自行退出。
//
// 这种方式不依赖进程名、不依赖安装路径、不依赖窗口标题，
// 即便用户重命名了 exe 也能正确识别旧实例。
// 端口固定为 47831

import (
	"net"
	"os"
	"time"
)

const singleInstancePort = "127.0.0.1:47831"

// notifyOldInstanceToQuit 尝试连接旧实例并发送退出命令
// 返回 true 表示成功连接并通知了旧实例
func notifyOldInstanceToQuit() bool {
	conn, err := net.DialTimeout("tcp", singleInstancePort, 500*time.Millisecond)
	if err != nil {
		return false
	}
	defer conn.Close()
	_, _ = conn.Write([]byte("quit"))
	return true
}

// startSingleInstanceServer 启动单实例监听服务，接收后续新实例的退出通知
// 收到 "quit" 后立即结束当前进程，让新实例接管
func startSingleInstanceServer() {
	go func() {
		listener, err := net.Listen("tcp", singleInstancePort)
		if err != nil {
			// 端口被占（极少见）则放弃服务，不阻塞启动
			return
		}
		defer listener.Close()
		for {
			conn, err := listener.Accept()
			if err != nil {
				continue
			}
			// 读取命令（小数据量，缓冲 16 字节足够）
			buf := make([]byte, 16)
			n, _ := conn.Read(buf)
			conn.Close()
			cmd := string(buf[:n])
			if cmd == "quit" {
				// 收到新实例的退出通知，立即退出
				os.Exit(0)
			}
		}
	}()
}

// EnsureSingleInstance 确保单实例运行
// 若已有旧实例运行，则通知其退出，再启动自己的监听服务
func EnsureSingleInstance() {
	if notifyOldInstanceToQuit() {
		// 已通知旧实例退出，等待其释放端口
		// 旧实例 os.Exit 后端口会进入 TIME_WAIT，短暂重试即可
		for i := 0; i < 30; i++ {
			time.Sleep(100 * time.Millisecond)
			// 尝试监听一次，成功说明旧实例已退出
			if l, err := net.Listen("tcp", singleInstancePort); err == nil {
				l.Close()
				// 立即关闭后可能仍有 TIME_WAIT，再等一下
				time.Sleep(200 * time.Millisecond)
				break
			}
		}
	}
	// 启动自己的监听服务，准备接收后续新实例的通知
	startSingleInstanceServer()
}
