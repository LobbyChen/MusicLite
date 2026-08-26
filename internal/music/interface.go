// internal\music\interface.go
package music

/*
	在线音乐api接口文件

	CopyRight 2026 LobbyChen
	for MusicLite ; Cuckoo branch
*/

type SearchMetaData struct {
	Title string
}

type MusicMetaData struct {
	Title  string
	Artist string
	Album  string
	Lyrics string
}

type MusicApi interface {
	// 控制部分
	Init() error
	// 元数据部分
	GetMetaData(SearchMetaData) ([]MusicMetaData, error)
	// 数据部分
}
