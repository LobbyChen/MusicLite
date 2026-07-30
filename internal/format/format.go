package format

type PlayerPraiser interface {
	NewMsc(MscData) bool
	Queue() []MscData
}

type NormalMscFormat string

const (
	Mp3  NormalMscFormat = "mp3"
	Wav  NormalMscFormat = "wav"
	Flac NormalMscFormat = "flac"
	Ogg  NormalMscFormat = "ogg"
	APE  NormalMscFormat = "ape"
)

const coversizeBytesLim uint = 1024 * 512 // 500KB

type base64img string

type MscData struct {
	Name     string          `json:"name"`   // 曲名
	Author   string          `json:"artist"` // 作曲家
	Format   NormalMscFormat // 格式 , 无需前端处理
	AudioURI string          `json:"src"`
	CoverURI string          `json:"cover"`  // 封面图像URI
	Lyrics   string          `json:"lyrics"` // 歌词
}
