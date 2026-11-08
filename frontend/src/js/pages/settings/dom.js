// 设置页 DOM 引用：集中查询，供各子模块共享
// 注意：本模块在页面模块加载时执行，settings.html 已解析完成。

// 基础控件
export const backBtn = document.getElementById('backBtn');
export const themeButtons = document.querySelectorAll('.theme-btn');
export const playerFontSelect = document.getElementById('player-font');
export const lyricsFontSelect = document.getElementById('lyrics-font');
export const playerFontPreview = document.getElementById('player-font-preview');
export const lyricsFontPreview = document.getElementById('lyrics-font-preview');
export const languageSelect = document.getElementById('language-select');
export const titlebarTextInput = document.getElementById('titlebar-text');
export const i18nAutoActionSelect = document.getElementById('i18n-auto-action');
export const i18nAutoCleanCheckbox = document.getElementById('i18n-auto-clean');

// 导入 / 导出 / 重置 / 通用操作
export const exportBtn = document.getElementById('export-settings-btn');
export const importBtn = document.getElementById('import-settings-btn');
export const resetBtn = document.getElementById('reset-settings-btn');
export const openDataFolderBtn = document.getElementById('open-data-folder-btn');
export const openGitHubBtn = document.getElementById('open-github-btn');

// 检查更新 / 下载进度
export const checkUpdateBtn = document.getElementById('check-update-btn');
export const updateStatusEl = document.getElementById('update-status');
export const updateActionsEl = document.getElementById('update-actions');
export const performUpdateBtn = document.getElementById('perform-update-btn');
export const openReleasePageBtn = document.getElementById('open-release-page-btn');
export const downloadProgressEl = document.getElementById('update-download-progress');
export const progressBarEl = document.getElementById('update-progress-bar');
export const progressLabelEl = document.getElementById('update-progress-label');
export const progressPercentEl = document.getElementById('update-progress-percent');
export const progressDetailEl = document.getElementById('update-progress-detail');
export const cancelDownloadBtn = document.getElementById('cancel-update-download-btn');
export const pauseResumeBtn = document.getElementById('pause-resume-download-btn');
export const downloadCompleteEl = document.getElementById('update-download-complete');
export const completeTextEl = document.getElementById('update-complete-text');
export const applyDownloadedUpdateBtn = document.getElementById('apply-downloaded-update-btn');
export const threadCountSlider = document.getElementById('update-thread-count-slider');
export const threadCountValue = document.getElementById('update-thread-count-value');
export const saveThreadCountBtn = document.getElementById('save-thread-count-btn');
export const ghproxyThreadHint = document.getElementById('ghproxy-thread-hint');
export const updateProxyBtns = document.querySelectorAll('.anim-level-btn[data-update-proxy]');
export const updateProxyModeDesc = document.getElementById('update-proxy-mode-desc');
export const ghProxyURLWrap = document.getElementById('gh-proxy-url-wrap');
export const ghProxyURLInput = document.getElementById('gh-proxy-url-input');

// 播放 / 音量
export const volumeSlider = document.getElementById('volume-slider');
export const volumeValue = document.getElementById('volume-value');
export const volumeModeBtns = document.querySelectorAll('.anim-level-btn[data-vol-mode]');
export const maxLyricLinesSlider = document.getElementById('max-lyric-lines');
export const maxLyricLinesValue = document.getElementById('max-lyric-lines-value');
export const setDefaultPlayerBtn = document.getElementById('set-default-player-btn');
export const defaultPlayerStatus = document.getElementById('default-player-status');
export const lyricAnimationSelect = document.getElementById('lyric-animation-select');
export const uiScaleSlider = document.getElementById('ui-scale');
export const uiScaleValue = document.getElementById('ui-scale-value');
export const lyricsScaleSlider = document.getElementById('lyrics-scale');
export const lyricsScaleValue = document.getElementById('lyrics-scale-value');

// 保存栏
export const saveBar = document.getElementById('saveBar');
export const saveBtn = document.getElementById('saveBtn');

// 外观 / 主题色
export const accentColorItem = document.getElementById('accent-color-item');
export const accentColorInput = document.getElementById('accent-color');
export const accentColorText = document.getElementById('accent-color-text');
export const customThemeModeItem = document.getElementById('custom-theme-mode-item');
export const customThemeModeBtns = document.querySelectorAll('.anim-level-btn[data-custom-theme-mode]');
export const presetColors = document.querySelectorAll('.preset-color');
export const animLevelBtns = document.querySelectorAll('.anim-level-btn[data-level]');
export const newUIModeBtns = document.querySelectorAll('.anim-level-btn[data-newui-mode]');
export const onlyModeBtns = document.querySelectorAll('.anim-level-btn[data-onlymode-mode]');

// 设计令牌控件（原设计器并入外观区）
export const radiusSlider = document.getElementById('radius-slider');
export const radiusValue = document.getElementById('radius-value');
export const blurSlider = document.getElementById('blur-slider');
export const blurValue = document.getElementById('blur-value');
export const shadowSlider = document.getElementById('shadow-slider');
export const shadowValue = document.getElementById('shadow-value');
export const glowSlider = document.getElementById('glow-slider');
export const glowValue = document.getElementById('glow-value');
export const textGlowSlider = document.getElementById('text-glow-slider');
export const textGlowValue = document.getElementById('text-glow-value');
export const animSpeedSlider = document.getElementById('anim-speed-slider');
export const animSpeedValue = document.getElementById('anim-speed-value');
export const bgTypeBtns = document.querySelectorAll('.anim-level-btn[data-bg-type]');
export const bgFitBtns = document.querySelectorAll('.anim-level-btn[data-bg-fit]');
export const bgGlassBtns = document.querySelectorAll('.anim-level-btn[data-bg-glass]');
export const bgFileItem = document.getElementById('bg-file-item');
export const bgPickImageBtn = document.getElementById('bg-pick-image');
export const bgClearFileBtn = document.getElementById('bg-clear-file');
export const bgFileInputImage = document.getElementById('bg-file-input-image');
export const bgFileNameEl = document.getElementById('bg-file-name');
export const bgFitItem = document.getElementById('bg-fit-item');
export const bgOpacitySlider = document.getElementById('bg-opacity');
export const bgOpacityValue = document.getElementById('bg-opacity-value');
export const bgOpacityItem = document.getElementById('bg-opacity-item');
export const bgOverlaySlider = document.getElementById('bg-overlay');
export const bgOverlayValue = document.getElementById('bg-overlay-value');
export const bgOverlayItem = document.getElementById('bg-overlay-item');
export const bgBlurSlider = document.getElementById('bg-blur');
export const bgBlurValue = document.getElementById('bg-blur-value');
export const bgBlurItem = document.getElementById('bg-blur-item');
export const bgGlassItem = document.getElementById('bg-glass-item');
export const windowAlphaSlider = document.getElementById('window-alpha');
export const windowAlphaValue = document.getElementById('window-alpha-value');
export const aeroBlurSlider = document.getElementById('aero-blur-slider');
export const aeroBlurValue = document.getElementById('aero-blur-value');
export const playerBgBlurSlider = document.getElementById('player-bg-blur-slider');
export const playerBgBlurValue = document.getElementById('player-bg-blur-value');

// 全局快捷键
export const hotkeyListEl = document.getElementById('hotkey-list');

// 确认对话框
export const confirmModal = document.getElementById('confirmModal');
export const confirmTitleEl = document.getElementById('confirmTitle');
export const confirmMessageEl = document.getElementById('confirmMessage');
export const confirmCancelBtn = document.getElementById('confirmCancel');
export const confirmOkBtn = document.getElementById('confirmOk');
