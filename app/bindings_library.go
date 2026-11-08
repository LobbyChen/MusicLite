package app

import (
	"MusicLite/internal/library"
	"MusicLite/internal/metadata"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// ImportFiles 打开多选对话框批量导入音频。
func (s *MusicService) ImportFiles() (int, error) {
	strs := s.getBackendStrings()
	files, err := s.app.Dialog.OpenFileWithOptions(&application.OpenFileDialogOptions{
		Title: strs.SelectMusicFile,
		Filters: []application.FileFilter{
			// 名称不依赖外部 i18n 文件，避免旧翻译把标签固定成 3 种格式；
			// 模式由后端共享扩展名清单生成，导入白名单与对话框始终一致。
			{DisplayName: "MusicLite Audio", Pattern: library.SupportedAudioPattern()},
			{DisplayName: "All Files (*.*)", Pattern: "*.*"},
		},
	}).PromptForMultipleSelection()
	if err != nil {
		return 0, err
	}
	return s.library.ImportPaths(files)
}

// ImportFilesFromPaths 按文件路径批量导入（拖放场景）。
func (s *MusicService) ImportFilesFromPaths(paths []string) (int, error) {
	return s.library.ImportPaths(paths)
}

// GetAllTracks 返回全部曲目。
func (s *MusicService) GetAllTracks() ([]metadata.MscData, error) {
	return s.library.GetAllTracks()
}

// GetTrack 返回单首曲目。
func (s *MusicService) GetTrack(id int64) (metadata.MscData, error) {
	return s.library.GetTrack(id)
}

func (s *MusicService) UpdateTrack(id int64, title, artist, album, lyrics string) error {
	return s.library.UpdateTrack(id, title, artist, album, lyrics)
}

func (s *MusicService) UpdateTrackCover(id int64, coverData []byte, coverMIME string) error {
	return s.library.UpdateTrackCover(id, coverData, coverMIME)
}

func (s *MusicService) DeleteTrack(id int64) error {
	return s.library.DeleteTrack(id)
}

// PickImageFile 选择封面图片并返回 base64 + MIME。
func (s *MusicService) PickImageFile() (library.PickedFile, error) {
	strs := s.getBackendStrings()
	path, err := s.app.Dialog.OpenFileWithOptions(&application.OpenFileDialogOptions{
		Title: strs.PickImageFile,
		Filters: []application.FileFilter{
			{DisplayName: strs.ImageFileFilter, Pattern: "*.png;*.jpg;*.jpeg;*.gif;*.bmp;*.webp"},
		},
	}).PromptForSingleSelection()
	if err != nil {
		return library.PickedFile{}, err
	}
	if path == "" {
		return library.PickedFile{}, nil
	}
	return s.library.ReadFileForEdit(path)
}

// PickLyricsFile 选择歌词文件并返回文本内容。
func (s *MusicService) PickLyricsFile() (string, error) {
	strs := s.getBackendStrings()
	path, err := s.app.Dialog.OpenFileWithOptions(&application.OpenFileDialogOptions{
		Title: strs.PickLyricsFile,
		Filters: []application.FileFilter{
			{DisplayName: strs.LyricsFileFilter, Pattern: "*.lrc;*.txt"},
		},
	}).PromptForSingleSelection()
	if err != nil {
		return "", err
	}
	if path == "" {
		return "", nil
	}
	result, err := s.library.ReadFileForEdit(path)
	if err != nil {
		return "", err
	}
	return result.Text, nil
}

// ReadFileForEdit 根据路径读取编辑用文件（拖放场景）。
func (s *MusicService) ReadFileForEdit(path string) (library.PickedFile, error) {
	return s.library.ReadFileForEdit(path)
}
