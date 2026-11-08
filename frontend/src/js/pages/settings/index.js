// 设置页入口：组装各子模块并负责加载/保存设置
import { mountTitlebar } from '../../ui/titlebar.js';
import { showToast } from '../../ui/toast.js';
import {
    LoadSettings, GetApplicationVolume, GetSystemMasterVolume,
    IsDefaultPlayer, SaveSettings, HotkeyApply,
} from '../../core/bindings.js';
import { initI18n, t, setLanguage, applyTranslations } from '../../core/i18n.js';
import { Window } from '@wailsio/runtime';
import * as dom from './dom.js';
import { state, hideSaveBar, revertNewUIPreview } from './state.js';
import { applyTheme, applyAccentToUI, applyDesignerControlsToUI, setAnimationLevel, applySettingsLayoutMode, applyWinUI3Layout, removeWinUI3Layout, normalizeColor, highlightPreset, showOrHideAccentItem, bindAppearanceEvents } from './appearance.js';
import { FONT_FALLBACK, populateFontSelects, normalizeFontOptionValue, bindFontEvents } from './fonts.js';
import { populateLanguageSelect, bindLanguageEvents } from './language.js';
import { updateDefaultPlayerStatus, bindPlaybackEvents } from './playback.js';
import { renderHotkeyList } from './hotkeys.js';
import { applyUpdateProxyModeUI, restoreDownloadState, loadThreadCountSetting, bindUpdateEvents } from './updates.js';
import { bindActionEvents } from './actions.js';
import { initMiniPlayer } from './mini-player.js';
import { showConfirm } from './confirm.js';

mountTitlebar();

// ============ 标题栏窗口控制 ============
document.getElementById('minimizeBtn')?.addEventListener('click', () => Window.Minimise());
// 关闭按钮：隐藏到托盘而非退出（后台播放）
document.getElementById('closeBtn')?.addEventListener('click', () => Window.Hide());

// ============ 初始化 ============
async function initSettingsPage() {
    // 阻止触摸板双指缩放及键盘缩放快捷键
    window.addEventListener('wheel', (e) => {
        if (e.ctrlKey) { e.preventDefault(); }
    }, { passive: false });
    window.addEventListener('keydown', (e) => {
        if (e.ctrlKey && ['=', '+', '-', '0'].includes(e.key)) {
            e.preventDefault();
        }
    });

    // 先初始化 i18n（从后端加载翻译数据），再生成语言选择器
    await initI18n();
    populateLanguageSelect();
    await populateFontSelects();
    await loadSettings();
    applyTheme();
    applyAccentToUI();
    setupEventListeners();
    initMiniPlayer();
    renderHotkeyList();
    // 恢复持久化的下载状态（重进设置页不丢失进度条）
    restoreDownloadState();
    // 加载下载线程数到滑块
    loadThreadCountSetting();
    // 为设置区块添加逐级入场延迟
    document.querySelectorAll('.settings-section').forEach((sec, i) => {
        sec.style.setProperty('--sec-i', i);
    });
    // 从历史缓存（bfcache）恢复时，重新读取后端设置，避免显示旧值
    window.addEventListener('pageshow', (e) => {
        if (e.persisted) loadSettings();
    });
}

// 安全启动：ES 模块执行时 DOMContentLoaded 可能已触发，需双重检查
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSettingsPage);
} else {
    initSettingsPage();
}

// Load settings from backend
async function loadSettings() {
    try {
        state.currentSettings = await LoadSettings();
        applySettingsToUI(state.currentSettings);
        // 根据 volume_mode 从对应音量源读取
        try {
            const mode = state.currentSettings.volume_mode || 'synth';
            const sysVol = mode === 'master'
                ? await GetSystemMasterVolume()
                : await GetApplicationVolume();
            dom.volumeSlider.value = sysVol;
            dom.volumeValue.textContent = sysVol + '%';
            state.currentSettings.volume = sysVol;
        } catch (e) {
            // 读取系统音量失败，使用 settings 中的值兜底
        }
        // 检查默认播放器状态
        const isDefault = await IsDefaultPlayer();
        updateDefaultPlayerStatus(isDefault);
    } catch (err) {
        console.error('Failed to load settings:', err);
        state.currentSettings = {
            theme: 'dark',
            player_font: 'system-ui',
            lyrics_font: "'Consolas', 'Monaco', monospace",
            ui_scale: 135,
            lyrics_scale: 135,
            last_track_id: 0,
            last_position: 0,
            volume: 70,
            volume_mode: 'synth',
            accent_color: '#1DB954',
            animation_level: 2,
            max_lyric_lines: 1
        };
        applySettingsToUI(state.currentSettings);
    }
}

// Apply settings to UI controls
function applySettingsToUI(s) {
    // Theme
    dom.themeButtons.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.theme === s.theme);
    });
    showOrHideAccentItem(s.theme);

    // Accent color
    const accent = s.accent_color || s.AccentColor || '#1DB954';
    dom.accentColorInput.value = normalizeColor(accent);
    dom.accentColorText.value = accent;
    highlightPreset(accent);

    // 自定义主题色明暗基调
    const customMode = s.custom_theme_mode === 'light' ? 'light' : 'dark';
    dom.customThemeModeBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.customThemeMode === customMode);
    });

    // Fonts
    const pf = normalizeFontOptionValue(s.player_font || 'system-ui', dom.playerFontSelect);
    const lf = normalizeFontOptionValue(s.lyrics_font || "'Consolas', 'Monaco', monospace", dom.lyricsFontSelect);
    dom.playerFontSelect.value = pf;
    dom.lyricsFontSelect.value = lf;
    // 同步字体预览
    if (dom.playerFontPreview) dom.playerFontPreview.style.fontFamily = pf + FONT_FALLBACK;
    if (dom.lyricsFontPreview) dom.lyricsFontPreview.style.fontFamily = lf;

    // Volume
    dom.volumeSlider.value = s.volume || 70;
    dom.volumeValue.textContent = (s.volume ?? 70) + '%';

    // Volume mode
    const volMode = s.volume_mode || 'synth';
    dom.volumeModeBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.volMode === volMode);
    });
    // 同步 audioManager 的音量模式：导入设置/跨页恢复后，音量滑块写入目标才不会错
    if (window.audioManager && window.audioManager.getVolumeMode() !== volMode) {
        window.audioManager.setVolumeMode(volMode);
    }

    // Lyric animation
    if (dom.lyricAnimationSelect) {
        dom.lyricAnimationSelect.value = s.lyric_animation || 'fade';
    }

    // Max lyric lines
    const maxLines = (typeof s.max_lyric_lines === 'number' && s.max_lyric_lines >= 1 && s.max_lyric_lines <= 10)
        ? s.max_lyric_lines : 1;
    if (dom.maxLyricLinesSlider) {
        dom.maxLyricLinesSlider.value = maxLines;
        dom.maxLyricLinesValue.textContent = maxLines;
    }

    // Language
    const lang = s.language || 'zh-CN';
    if (dom.languageSelect) dom.languageSelect.value = lang;
    setLanguage(lang);
    applyTranslations();

    // 标题栏文字
    if (dom.titlebarTextInput) dom.titlebarTextInput.value = s.titlebar_text || '';

    // 翻译更新策略（i18n 自动动作，可与弹窗中"下次自动"一致地调整）
    if (dom.i18nAutoActionSelect) dom.i18nAutoActionSelect.value = s.i18n_auto_action || '';
    if (dom.i18nAutoCleanCheckbox) dom.i18nAutoCleanCheckbox.checked = !!s.i18n_auto_clean_obsolete;

    // Scale
    const uiScale = (s.ui_scale && s.ui_scale >= 20 && s.ui_scale <= 500) ? s.ui_scale : 135;
    const lyricsScale = (s.lyrics_scale && s.lyrics_scale >= 20 && s.lyrics_scale <= 500) ? s.lyrics_scale : 135;
    dom.uiScaleSlider.value = uiScale;
    dom.uiScaleValue.textContent = uiScale + '%';
    dom.lyricsScaleSlider.value = lyricsScale;
    dom.lyricsScaleValue.textContent = lyricsScale + '%';

    // 界面动画级别（默认 2 = 增强；旧文件 enable_animations:false → 0）
    const lvl = typeof s.animation_level === 'number' ? s.animation_level : (s.enable_animations === false ? 0 : 2);
    setAnimationLevel(lvl);

    // 新风格 UI 开关
    const newUIOn = s.new_ui_enabled || false;
    dom.newUIModeBtns.forEach(btn => {
        btn.classList.toggle('active', (btn.dataset.newuiMode === 'on') === newUIOn);
    });
    if (window.MusicLiteSettings) window.MusicLiteSettings.applyNewUI(newUIOn);

    // 设计令牌 / 背景控件同步（原设计器并入外观区）
    applyDesignerControlsToUI(s);

    // 单向模式开关（默认关闭：旧设置文件缺失该字段时后端返回 false）
    const onlyOn = s.only_mode !== undefined ? !!s.only_mode : false;
    dom.onlyModeBtns.forEach(btn => {
        btn.classList.toggle('active', (btn.dataset.onlymodeMode === 'on') === onlyOn);
    });

    // 更新下载来源代理
    const proxyMode = s.update_proxy_mode || 'official';
    dom.updateProxyBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.updateProxy === proxyMode);
    });
    applyUpdateProxyModeUI(proxyMode, s);
    if (dom.ghProxyURLInput) dom.ghProxyURLInput.value = s.gh_proxy_url || 'https://v6.gh-proxy.org/';

    // 设置界面布局：新UI开启时强制使用 WinUI3 NavigationView；否则强制 tabs 选项卡布局
    if (newUIOn) {
        applyWinUI3Layout();
    } else {
        removeWinUI3Layout();
        applySettingsLayoutMode('tabs');
    }
}

// Setup event listeners
function setupEventListeners() {
    // Back button
    dom.backBtn.addEventListener('click', async () => {
        if (state.hasChanges) {
            const ok = await showConfirm(t('settings.discardConfirm'), {
                title: t('settings.discardTitle'), okText: t('settings.discardBtn'), cancelText: t('settings.stayBtn'), danger: true
            });
            if (ok) window.history.back();
        } else {
            window.history.back();
        }
    });

    bindAppearanceEvents();
    bindFontEvents();
    bindLanguageEvents();
    bindPlaybackEvents();
    bindUpdateEvents();
    bindActionEvents({ applySettingsToUI, renderHotkeyList });

    // Save button
    dom.saveBtn.addEventListener('click', saveSettings);
}

// 保存设置并立即应用当前页面的视觉变更
async function saveSettings() {
    try {
        await SaveSettings(state.currentSettings);
        state.hasChanges = false;
        hideSaveBar();

        // 立即应用当前页面的设置
        applyTheme();
        if (state.currentSettings.player_font) {
            document.documentElement.style.setProperty('--player-font', state.currentSettings.player_font);
            document.body.style.fontFamily = state.currentSettings.player_font + FONT_FALLBACK;
        }
        if (state.currentSettings.lyrics_font) {
            document.documentElement.style.setProperty('--lyrics-font', state.currentSettings.lyrics_font);
        }
        const uiScale = (state.currentSettings.ui_scale && state.currentSettings.ui_scale >= 20 && state.currentSettings.ui_scale <= 500) ? state.currentSettings.ui_scale : 135;
        const lyricsScale = (state.currentSettings.lyrics_scale && state.currentSettings.lyrics_scale >= 20 && state.currentSettings.lyrics_scale <= 500) ? state.currentSettings.lyrics_scale : 135;
        const baseSize = 14 * uiScale / 100;
        const lyricsSize = 16 * lyricsScale / 100;
        document.documentElement.style.setProperty('--base-font-size', baseSize + 'px');
        document.body.style.setProperty('--base-font-size', baseSize + 'px');
        document.documentElement.style.setProperty('--lyrics-font-size', lyricsSize + 'px');
        document.body.style.setProperty('--lyrics-font-size', lyricsSize + 'px');
        // 直接设置 <html> font-size，让 rem 单位跟随缩放
        document.documentElement.style.fontSize = baseSize + 'px';
        // 应用主题色 + 全套配套色
        applyAccentToUI();

        // 同步缓存（让 settings-apply.js 读取到）
        if (window.MusicLiteSettings) {
            window.MusicLiteSettings.cached = { ...state.currentSettings };
        }

        // 通知其他页面（libraries、player）应用新设置
        localStorage.setItem('settingsUpdated', Date.now().toString());
        localStorage.setItem('cachedSettings', JSON.stringify(state.currentSettings));
        // 应用语言变更
        if (state.currentSettings.language) {
            setLanguage(state.currentSettings.language);
            applyTranslations();
        }
        // 应用标题栏文字（有自定义则覆盖，否则保留翻译值）
        if (state.currentSettings.titlebar_text && state.currentSettings.titlebar_text.trim()) {
            const custom = state.currentSettings.titlebar_text.trim();
            document.querySelectorAll('.titlebar-title').forEach(el => { el.textContent = custom; });
        }
        // 同步全局快捷键配置到后端 HotkeyManager
        try { await HotkeyApply(); } catch (_) { }

        // 新旧主题页面已拆分：保存后如果启用的主题与当前页面不一致，路由到对应页面
        // 注意：applyNewUI() 已改写 body[data-new-ui]，必须用 URL 判断当前页面变体
        const desiredNew = !!state.currentSettings.new_ui_enabled;
        const isNewPage = /-new\.html$/i.test(location.pathname);
        if (desiredNew !== isNewPage) {
            // 用 replace 避免把当前设置页留在历史记录中，否则从新页面返回需要按两次
            window.location.replace('/#/settings');
            return;
        }

        showToast(t('libraries.saved'), 'success');
    } catch (err) {
        console.error('Failed to save settings:', err);
        showToast(t('libraries.saveFailed', err?.message || err), 'error');
    }
}
