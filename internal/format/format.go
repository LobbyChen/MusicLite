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
	ID       int64           `json:"id"`     // 曲目ID
	Name     string          `json:"name"`   // 曲名
	Author   string          `json:"artist"` // 作曲家
	Format   NormalMscFormat `json:"format"` // 格式
	AudioURI string          `json:"src"`    // 音频URI (/audio/<id>)
	CoverURI string          `json:"cover"`  // 封面URI (/cover/<id>)
	Lyrics   string          `json:"lyrics"` // 歌词
}
