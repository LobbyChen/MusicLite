package main

import _ "embed"

// trayIconData 托盘图标数据，编译时从 icon.ico 嵌入
//
//go:embed frontend/src/assets/icon.ico
var trayIconData []byte
