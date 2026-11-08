package main

import (
	"embed"
	"fmt"
	"net/http"
	"strings"

	"MusicLite/app"
	"MusicLite/internal/platform"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	platform.InitLogger()
	platform.EnsureSingleInstance()

	file := platform.GetFileInArgs()

	var svc *app.MusicService

	wailsApp := application.New(application.Options{
		Name:        "MusicLite",
		Description: "MusicLite 离线音乐播放器",
		Icon:        platform.TrayIconData,
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
			Middleware: func(next http.Handler) http.Handler {
				return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if svc != nil &&
						(strings.HasPrefix(r.URL.Path, "/audio/") || strings.HasPrefix(r.URL.Path, "/cover/")) {
						svc.ServeMedia(w, r)
						return
					}
					next.ServeHTTP(w, r)
				})
			},
		},
		Windows: application.WindowsOptions{
			DisableQuitOnLastWindowClosed: true,
		},
		Linux: application.LinuxOptions{
			DisableQuitOnLastWindowClosed: true,
		},
	})

	var err error
	svc, err = app.NewMusicService(wailsApp, platform.DBPath(), file)
	if err != nil {
		panic(err)
	}
	svc.EnsureI18nFile()
	wailsApp.RegisterService(application.NewService(svc))

	mainWindow := wailsApp.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:           "main",
		Title:          "MusicLite",
		Width:          1024,
		Height:         580,
		Frameless:      true,
		EnableFileDrop: true,
		BackgroundType: application.BackgroundTypeTransparent,
		BackgroundColour: application.RGBA{
			Red: 0, Green: 0, Blue: 0, Alpha: 0,
		},
		Windows: application.WindowsWindow{
			NonClientRegionSupport:            true,
			BackdropType:                      application.None,
			DisableFramelessWindowDecorations: true,
		},
	})

	mainWindow.OnWindowEvent(events.Common.WindowClosing, func(event *application.WindowEvent) {
		if svc.IsTrayQuitting() {
			return
		}
		if svc.IsOnlyModeSession() {
			go svc.QuitApp()
			return
		}
		event.Cancel()
		mainWindow.Hide()
	})

	if err := wailsApp.Run(); err != nil {
		panic(fmt.Sprintf("Error: %s", err.Error()))
	}
}
