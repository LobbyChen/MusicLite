package main

import (
	"MusicLite/internal/format"
	"MusicLite/internal/storage"
	"context"
	"os"
	"sync"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type currentMsc struct {
	data format.MscData
	lock sync.Mutex
}

func fileExists(filename string) bool {
	info, err := os.Stat(filename)
	if os.IsNotExist(err) {
		return false
	}
	return !info.IsDir()
}

// App struct
type App struct {
	ctx      context.Context
	database *storage.Database
	current  currentMsc
}

// NewApp creates a new App application struct
func NewApp(sqlite3FilePath string) (*App, error) {
	// check db path
	if !fileExists(sqlite3FilePath) {
		// if file not exist , create it (initlize)
		file, err := os.Create(sqlite3FilePath)
		if err != nil || file == nil {
			return nil, err
		}
		file.Close()
	}
	db := storage.CreateDataBaseObj()
	_, err := db.OpenConnect(sqlite3FilePath)
	if err != nil {
		return nil, err
	}
	return &App{
		database: db,
	}, nil
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

func (a *App) OpenFileDialog() string {
	file, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "选择一个音乐文件",
		Filters: []runtime.FileFilter{
			{
				DisplayName: "Music File (*.mp3,*.ogg,*.flac)",
				Pattern:     "*.mp3;*.ogg;*.flac",
			},
		},
	})
	if err != nil {
		return ""
	}
	return file
}
