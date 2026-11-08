package metadata

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

// MscData 是后端与前端共享的曲目视图模型。
type MscData struct {
	ID         int64           `json:"id"`
	Name       string          `json:"name"`
	Author     string          `json:"artist"`
	Album      string          `json:"album"`
	Format     NormalMscFormat `json:"format"`
	AudioURI   string          `json:"src"`
	CoverURI   string          `json:"cover"`
	Lyrics     string          `json:"lyrics"`
	ImportedAt int64           `json:"importedAt"`
}
