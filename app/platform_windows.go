//go:build windows

package app

// getWebviewWindowOptions returns platform-specific WebviewWindowOptions for Windows.
// In v3, platform options are set directly in WebviewWindowOptions.
// Windows-specific: WebView2 user data directory is set to exe directory
// to avoid stale data locks.
func getPlatformWindowOptions() map[string]any {
	return map[string]any{
		// Windows-specific WebviewWindowOptions can be added here
		// e.g. "WebviewUserDataPath": filepath.Join(exeDir(), "webview_data"),
	}
}
