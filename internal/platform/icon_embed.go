package platform

import _ "embed"

// TrayIconData 托盘图标（PNG 资源），随二进制分发。
//
//go:embed assets/icon.png
var TrayIconData []byte
