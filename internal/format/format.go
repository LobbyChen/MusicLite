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
	ID         int64           `json:"id"`         // 曲目ID
	Name       string          `json:"name"`       // 曲名
	Author     string          `json:"artist"`     // 艺术家/作曲家
	Album      string          `json:"album"`      // 专辑
	Format     NormalMscFormat `json:"format"`     // 格式
	AudioURI   string          `json:"src"`        // 音频URI (/audio/<id>)
	CoverURI   string          `json:"cover"`      // 封面URI (/cover/<id>)
	Lyrics     string          `json:"lyrics"`     // 歌词
	ImportedAt int64           `json:"importedAt"` // 入库时间戳（Unix 秒），供前端排序用
}
