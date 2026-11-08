package app

import "encoding/base64"

// encodeCoverBase64 将封面编码为 data URI，供托盘菜单等无 HTTP 场景使用。
func encodeCoverBase64(data []byte, mime string) string {
	if len(data) == 0 {
		return ""
	}
	if mime == "" {
		mime = "image/jpeg"
	}
	return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data)
}
