//go:build darwin

package app

// getPlatformWindowOptions returns platform-specific WebviewWindowOptions for macOS.
// macOS: Use transparent titlebar with hidden title, keeping traffic light buttons.
func getPlatformWindowOptions() map[string]any {
	return map[string]any{
		// Mac titlebar options will be configured via Mac options in v3
		// "TitleBar": application.TitleBar{
		//     TitlebarAppearsTransparent: true,
		//     HideTitle:                  true,
		//     FullSizeContent:            true,
		// },
	}
}
