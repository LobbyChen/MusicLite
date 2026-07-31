import { LoadSettings, SaveSettings, GetInstalledFonts, ExportSettings, ImportSettings, ResetSettings } from '../../wailsjs/go/main/App.js';
import { t, setLanguage, applyTranslations, getAvailableLanguages } from './i18n.js';

// ============ 长歌名滚动显示：检测溢出后用 Web Animations API 驱动滚动 ============
function applyMarquee(el) {
    if (!el) return;
    const text = el.textContent || '';
    let span = el.querySelector('.scroll-text');
    if (!span || span.dataset.text !== text) {
        el.textContent = '';
        span = document.createElement('span');
        span.className = 'scroll-text';
        span.textContent = text;
        span.dataset.text = text;
        el.appendChild(span);
    }
    span.getAnimations().forEach(a => a.cancel());
    el.classList.remove('marquee');
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            const overflow = span.scrollWidth - el.clientWidth;
            if (overflow > 4) {
                el.classList.add('marquee');
                const duration = Math.max(6000, Math.min(20000, overflow * 60));
                span.animate(
                    [
                        { transform: 'translateX(0)' },
                        { transform: `translateX(-${overflow}px)` }
                    ],
                    {
                        duration: duration,
                        iterations: Infinity,
                        direction: 'alternate',
                        easing: 'ease-in-out'
                    }
                );
            }
        });
    });
}

// ============ 标题栏窗口控制 ============
document.getElementById('minimizeBtn')?.addEventListener('click', () => window.runtime?.WindowMinimise());
// 关闭按钮：隐藏到托盘而非退出（后台播放）
document.getElementById('closeBtn')?.addEventListener('click', () => window.runtime?.WindowHide());

// DOM Elements
const backBtn = document.getElementById('backBtn');
const themeButtons = document.querySelectorAll('.theme-btn');
const playerFontSelect = document.getElementById('player-font');
const lyricsFontSelect = document.getElementById('lyrics-font');
const playerFontPreview = document.getElementById('player-font-preview');
const lyricsFontPreview = document.getElementById('lyrics-font-preview');
const languageSelect = document.getElementById('language-select');
const exportBtn = document.getElementById('export-settings-btn');
const importBtn = document.getElementById('import-settings-btn');
const resetBtn = document.getElementById('reset-settings-btn');
const volumeSlider = document.getElementById('volume-slider');
const volumeValue = document.getElementById('volume-value');
const uiScaleSlider = document.getElementById('ui-scale');
const uiScaleValue = document.getElementById('ui-scale-value');
const lyricsScaleSlider = document.getElementById('lyrics-scale');
const lyricsScaleValue = document.getElementById('lyrics-scale-value');
const saveBar = document.getElementById('saveBar');
const saveBtn = document.getElementById('saveBtn');
const accentColorItem = document.getElementById('accent-color-item');
const accentColorInput = document.getElementById('accent-color');
const accentColorText = document.getElementById('accent-color-text');
const presetColors = document.querySelectorAll('.preset-color');

// 确认对话框 / Toast 元素（settings.html 里有）
const confirmModal = document.getElementById('confirmModal');
const confirmTitleEl = document.getElementById('confirmTitle');
const confirmMessageEl = document.getElementById('confirmMessage');
const confirmCancelBtn = document.getElementById('confirmCancel');
const confirmOkBtn = document.getElementById('confirmOk');
const toastContainer = document.getElementById('toastContainer');

let currentSettings = null;
let hasChanges = false;
let confirmCallback = null;

// ============ Toast / Confirm 自定义 UI ============
function showToast(message, type = 'info', duration = 2500) {
    if (!toastContainer) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const icon = {
        success: '<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>',
        error: '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>',
        warning: '<svg viewBox="0 0 24 24"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>',
        info: '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>'
    }[type] || '';
    toast.innerHTML = `<span class="toast-icon">${icon}</span><span class="toast-msg">${message}</span>`;
    toast.addEventListener('click', () => dismissToast(toast));
    toastContainer.appendChild(toast);
    if (duration > 0) {
        setTimeout(() => dismissToast(toast), duration);
    }
}

function dismissToast(toast) {
    if (!toast || toast.classList.contains('toast-out')) return;
    toast.classList.add('toast-out');
    setTimeout(() => toast.remove(), 260);
}

function showConfirm(message, opts = {}) {
    return new Promise(resolve => {
        if (!confirmModal) {
            resolve(window.confirm(message));
            return;
        }
        confirmTitleEl.textContent = opts.title || '确认操作';
        confirmMessageEl.textContent = message;
        const okText = opts.okText || '确定';
        const cancelText = opts.cancelText || '取消';
        confirmOkBtn.textContent = okText;
        confirmCancelBtn.textContent = cancelText;
        confirmOkBtn.className = 'btn ' + (opts.danger ? 'btn-danger' : 'btn-primary');

        const cleanup = (result) => {
            confirmModal.classList.remove('active');
            confirmOkBtn.removeEventListener('click', onOk);
            confirmCancelBtn.removeEventListener('click', onCancel);
            confirmModal.removeEventListener('click', onBackdrop);
            document.removeEventListener('keydown', onKey);
            resolve(result);
        };
        const onOk = () => cleanup(true);
        const onCancel = () => cleanup(false);
        const onBackdrop = (e) => { if (e.target === confirmModal) cleanup(false); };
        const onKey = (e) => {
            if (e.key === 'Escape') cleanup(false);
            if (e.key === 'Enter') cleanup(true);
        };
        confirmOkBtn.addEventListener('click', onOk);
        confirmCancelBtn.addEventListener('click', onCancel);
        confirmModal.addEventListener('click', onBackdrop);
        document.addEventListener('keydown', onKey);
        confirmModal.classList.add('active');
    });
}

// ============ 字体填充：从后端获取系统字体列表 ============
const FONT_FALLBACK = ", -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

async function populateFontSelects() {
    let fonts = [];
    try {
        fonts = await GetInstalledFonts();
    } catch (e) {
        console.warn('获取系统字体失败，使用默认列表', e);
    }
    if (!Array.isArray(fonts) || fonts.length === 0) {
        fonts = ['Microsoft YaHei', 'PingFang SC', 'Segoe UI', 'SimHei', 'SimSun', 'KaiTi', 'FangSong', 'Consolas', 'Monaco', 'Courier New'];
    }
    // 去重 & 排序
    fonts = Array.from(new Set(fonts)).sort((a, b) => a.localeCompare(b, 'zh'));

    // 播放器字体
    buildFontOptions(playerFontSelect, fonts, {
        preset: [
            { value: 'system-ui', label: '系统默认' },
            { value: 'sans-serif', label: '无衬线体' },
            { value: 'serif', label: '衬线体' }
        ],
        fontFamily: (v) => (v === 'system-ui' || v === 'sans-serif' || v === 'serif') ? v : `'${v}'${FONT_FALLBACK}`
    });
    // 歌词字体
    buildFontOptions(lyricsFontSelect, fonts, {
        preset: [
            { value: "'Consolas', 'Monaco', monospace", label: '等宽字体（推荐）' },
            { value: 'system-ui', label: '系统默认' },
            { value: 'sans-serif', label: '无衬线体' },
            { value: 'serif', label: '衬线体' }
        ],
        fontFamily: (v) => {
            if (v.startsWith("'Consolas'")) return v;
            if (v === 'system-ui' || v === 'sans-serif' || v === 'serif') return v;
            return `'${v}', monospace`;
        }
    });
}

function buildFontOptions(selectEl, fonts, { preset, fontFamily }) {
    const frag = document.createDocumentFragment();
    for (const p of preset) {
        const opt = document.createElement('option');
        opt.value = p.value;
        opt.textContent = p.label;
        opt.style.fontFamily = fontFamily(p.value);
        frag.appendChild(opt);
    }
    const divider = document.createElement('optgroup');
    divider.label = '—— 系统字体 ——';
    for (const name of fonts) {
        const opt = document.createElement('option');
        opt.value = `'${name}'`;
        opt.textContent = name;
        opt.style.fontFamily = fontFamily(`'${name}'`);
        divider.appendChild(opt);
    }
    frag.appendChild(divider);
    selectEl.innerHTML = '';
    selectEl.appendChild(frag);
}

// ============ 语言选择器填充 ============
function populateLanguageSelect() {
    if (!languageSelect) return;
    const langs = getAvailableLanguages();
    const frag = document.createDocumentFragment();
    for (const { code, nativeName } of langs) {
        const opt = document.createElement('option');
        opt.value = code;
        opt.textContent = nativeName;
        frag.appendChild(opt);
    }
    languageSelect.innerHTML = '';
    languageSelect.appendChild(frag);
}

// ============ 初始化 ============
document.addEventListener('DOMContentLoaded', async () => {
    populateLanguageSelect();
    await populateFontSelects();
    await loadSettings();
    applyTheme();
    applyAccentToUI();
    setupEventListeners();
    initMiniPlayer();
});

// ============ 迷你播放器（设置页也能控制播放） ============
function initMiniPlayer() {
    const miniPlayer = document.getElementById('mini-player');
    const miniCover = document.getElementById('mini-cover');
    const miniTitle = document.getElementById('mini-title');
    const miniArtist = document.getElementById('mini-artist');
    const miniPlayBtn = document.getElementById('mini-play');
    const miniPlayIcon = document.getElementById('mini-play-icon');
    const miniPauseIcon = document.getElementById('mini-pause-icon');
    const miniExpand = document.getElementById('mini-expand');
    if (!miniPlayer || !window.audioManager) return;

    // 显示 mini-player 时，同步在 body 上打标，让 save-bar 上移避免遮挡
    const showMiniPlayer = () => {
        miniPlayer.style.display = 'flex';
        document.body.classList.add('has-mini-player');
    };

    // 从 localStorage 恢复当前曲目
    window.audioManager.restore();
    const currentTrack = window.audioManager.currentTrack;
    if (currentTrack && currentTrack.src) {
        showMiniPlayer();
        miniTitle.textContent = currentTrack.name || '未知';
        applyMarquee(miniTitle);
        miniArtist.textContent = currentTrack.artist || '--';
        setMiniCover(miniCover, currentTrack.cover);
        // 同步播放按钮图标
        if (window.audioManager.isPlaying()) {
            miniPlayIcon.style.display = 'none';
            miniPauseIcon.style.display = 'block';
        } else {
            miniPlayIcon.style.display = 'block';
            miniPauseIcon.style.display = 'none';
        }
    }

    // 播放/暂停
    miniPlayBtn.addEventListener('click', () => {
        window.audioManager.toggle();
    });

    // 返回音乐库
    miniExpand.addEventListener('click', () => {
        window.location.href = '/src/html/libraries.html';
    });

    // 监听播放状态
    window.audioManager.on('play', () => {
        miniPlayIcon.style.display = 'none';
        miniPauseIcon.style.display = 'block';
    });
    window.audioManager.on('pause', () => {
        miniPlayIcon.style.display = 'block';
        miniPauseIcon.style.display = 'none';
    });
    window.audioManager.on('trackloaded', (track) => {
        showMiniPlayer();
        miniTitle.textContent = track.name || '未知';
        applyMarquee(miniTitle);
        miniArtist.textContent = track.artist || '--';
        setMiniCover(miniCover, track.cover);
    });
}

// 设置迷你播放器封面（有则用 img，无则用默认 SVG）
function setMiniCover(container, coverUrl) {
    if (!container) return;
    if (coverUrl) {
        container.innerHTML = `<img src="${coverUrl}" alt="cover" style="width:100%;height:100%;object-fit:cover;border-radius:4px;" />`;
    } else {
        container.innerHTML = `<div class="card-icon"><svg viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"></path></svg></div>`;
    }
}

// Load settings from backend
async function loadSettings() {
    try {
        currentSettings = await LoadSettings();
        applySettingsToUI(currentSettings);
    } catch (err) {
        console.error('Failed to load settings:', err);
        currentSettings = {
            theme: 'dark',
            player_font: 'system-ui',
            lyrics_font: "'Consolas', 'Monaco', monospace",
            ui_scale: 135,
            lyrics_scale: 135,
            last_track_id: 0,
            last_position: 0,
            volume: 70,
            accent_color: '#1DB954'
        };
        applySettingsToUI(currentSettings);
    }
}

// Apply settings to UI controls
function applySettingsToUI(s) {
    // Theme
    themeButtons.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.theme === s.theme);
    });
    showOrHideAccentItem(s.theme);

    // Accent color
    const accent = s.accent_color || s.AccentColor || '#1DB954';
    accentColorInput.value = normalizeColor(accent);
    accentColorText.value = accent;
    highlightPreset(accent);

    // Fonts
    const pf = normalizeFontOptionValue(s.player_font || 'system-ui', playerFontSelect);
    const lf = normalizeFontOptionValue(s.lyrics_font || "'Consolas', 'Monaco', monospace", lyricsFontSelect);
    playerFontSelect.value = pf;
    lyricsFontSelect.value = lf;
    // 同步字体预览
    if (playerFontPreview) playerFontPreview.style.fontFamily = pf + FONT_FALLBACK;
    if (lyricsFontPreview) lyricsFontPreview.style.fontFamily = lf;

    // Volume
    volumeSlider.value = s.volume || 70;
    volumeValue.textContent = (s.volume ?? 70) + '%';

    // Language
    const lang = s.language || 'zh-CN';
    if (languageSelect) languageSelect.value = lang;
    setLanguage(lang);
    applyTranslations();

    // Scale
    const uiScale = (s.ui_scale && s.ui_scale >= 20 && s.ui_scale <= 500) ? s.ui_scale : 135;
    const lyricsScale = (s.lyrics_scale && s.lyrics_scale >= 20 && s.lyrics_scale <= 500) ? s.lyrics_scale : 135;
    uiScaleSlider.value = uiScale;
    uiScaleValue.textContent = uiScale + '%';
    lyricsScaleSlider.value = lyricsScale;
    lyricsScaleValue.textContent = lyricsScale + '%';
}

// 让设置值匹配 select 的 option value（后端保存的值可能带引号，匹配最佳 option）
function normalizeFontOptionValue(savedValue, selectEl) {
    if (!savedValue) return selectEl.options[0]?.value || '';
    // 完全匹配
    for (const opt of selectEl.options) {
        if (opt.value === savedValue) return savedValue;
    }
    // 去掉引号后匹配
    const clean = savedValue.replace(/^'|'$/g, '').replace(/^"|"$/g, '').trim();
    for (const opt of selectEl.options) {
        const optClean = opt.value.replace(/^'|'$/g, '').replace(/^"|"$/g, '').trim();
        if (optClean === clean) return opt.value;
    }
    // 字体名包含匹配
    for (const opt of selectEl.options) {
        const optClean = opt.value.replace(/^'|'$/g, '').trim();
        if (clean.includes(optClean) || optClean.includes(clean)) return opt.value;
    }
    return selectEl.options[0]?.value || savedValue;
}

function showOrHideAccentItem(theme) {
    if (!accentColorItem) return;
    accentColorItem.style.display = 'block';
    // 实际上所有主题都可以自定义主题色，所以我们不隐藏；但可以根据主题高亮对应位置
}

function applyAccentToUI() {
    const c = currentSettings?.accent_color || currentSettings?.AccentColor || '#1DB954';
    const theme = currentSettings?.theme || 'dark';
    // 调用全局 applyAccentColor，自动算出全套配套色
    if (window.MusicLiteSettings) {
        window.MusicLiteSettings.applyAccentColor(c, theme);
    } else {
        document.documentElement.style.setProperty('--accent-color', normalizeColor(c));
        document.body.style.setProperty('--accent-color', normalizeColor(c));
    }
}

function normalizeColor(c) {
    if (!c) return '#1DB954';
    c = c.trim();
    if (!c.startsWith('#')) c = '#' + c;
    if (c.length === 4) c = '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
    return c.toLowerCase();
}

function highlightPreset(color) {
    const c = normalizeColor(color);
    presetColors.forEach(p => {
        p.classList.toggle('active', normalizeColor(p.dataset.color || '') === c);
    });
}

// Apply theme to body
function applyTheme() {
    document.body.setAttribute('data-theme', currentSettings.theme || 'dark');
}

// Setup event listeners
function setupEventListeners() {
    // Back button
    backBtn.addEventListener('click', async () => {
        if (hasChanges) {
            const ok = await showConfirm(t('settings.discardConfirm'), {
                title: t('settings.discardTitle'), okText: t('settings.discardBtn'), cancelText: t('settings.stayBtn'), danger: true
            });
            if (ok) window.history.back();
        } else {
            window.history.back();
        }
    });

    // Theme buttons
    themeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            themeButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentSettings.theme = btn.dataset.theme;
            applyTheme();
            // 主题切换后重新计算配套色（applyAccentToUI 内部会根据新 theme 算出对应基调）
            applyAccentToUI();
            markChanged();
        });
    });

    // Accent color picker
    accentColorInput.addEventListener('input', () => {
        const v = accentColorInput.value;
        accentColorText.value = v;
        currentSettings.accent_color = v;
        applyAccentToUI();
        highlightPreset(v);
        markChanged();
    });
    accentColorText.addEventListener('input', () => {
        let v = accentColorText.value.trim();
        if (/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(v)) v = '#' + v;
        if (/^#[0-9a-fA-F]{3}$|^#[0-9a-fA-F]{6}$/.test(v)) {
            const norm = normalizeColor(v);
            accentColorInput.value = norm;
            currentSettings.accent_color = norm;
            applyAccentToUI();
            highlightPreset(norm);
            markChanged();
        }
    });
    accentColorText.addEventListener('blur', () => {
        const cur = currentSettings.accent_color || '#1DB954';
        accentColorText.value = cur;
    });
    presetColors.forEach(p => {
        p.addEventListener('click', () => {
            const c = p.dataset.color;
            accentColorInput.value = c;
            accentColorText.value = c;
            currentSettings.accent_color = c;
            applyAccentToUI();
            highlightPreset(c);
            markChanged();
        });
    });

    // Player font
    playerFontSelect.addEventListener('change', () => {
        currentSettings.player_font = playerFontSelect.value;
        // 实时预览：同时设置 <html> 和 <body>
        document.documentElement.style.setProperty('--player-font', playerFontSelect.value);
        document.body.style.fontFamily = playerFontSelect.value + FONT_FALLBACK;
        // 更新字体预览
        if (playerFontPreview) playerFontPreview.style.fontFamily = playerFontSelect.value + FONT_FALLBACK;
        markChanged();
    });

    // Lyrics font
    lyricsFontSelect.addEventListener('change', () => {
        currentSettings.lyrics_font = lyricsFontSelect.value;
        // 实时预览
        document.documentElement.style.setProperty('--lyrics-font', lyricsFontSelect.value);
        // 更新字体预览
        if (lyricsFontPreview) lyricsFontPreview.style.fontFamily = lyricsFontSelect.value;
        markChanged();
    });

    // Volume slider
    volumeSlider.addEventListener('input', () => {
        volumeValue.textContent = volumeSlider.value + '%';
        currentSettings.volume = parseInt(volumeSlider.value, 10);
        markChanged();
    });

    // UI scale slider（界面缩放）
    uiScaleSlider.addEventListener('input', () => {
        const v = parseInt(uiScaleSlider.value, 10);
        uiScaleValue.textContent = v + '%';
        currentSettings.ui_scale = v;
        // 实时预览：基准 14px × 缩放比例
        const px = 14 * v / 100;
        document.documentElement.style.setProperty('--base-font-size', px + 'px');
        document.body.style.setProperty('--base-font-size', px + 'px');
        // 直接设置 <html> font-size，让 rem 单位跟随缩放
        document.documentElement.style.fontSize = px + 'px';
        markChanged();
    });

    // Lyrics scale slider（歌词缩放）
    lyricsScaleSlider.addEventListener('input', () => {
        const v = parseInt(lyricsScaleSlider.value, 10);
        lyricsScaleValue.textContent = v + '%';
        currentSettings.lyrics_scale = v;
        // 实时预览：基准 16px × 缩放比例
        const px = 16 * v / 100;
        document.documentElement.style.setProperty('--lyrics-font-size', px + 'px');
        document.body.style.setProperty('--lyrics-font-size', px + 'px');
        markChanged();
    });

    // Save button
    saveBtn.addEventListener('click', saveSettings);

    // Language selector
    if (languageSelect) {
        languageSelect.addEventListener('change', () => {
            const lang = languageSelect.value;
            currentSettings.language = lang;
            setLanguage(lang);
            applyTranslations();
            markChanged();
        });
    }

    // Export settings button
    if (exportBtn) {
        exportBtn.addEventListener('click', async () => {
            try {
                // 先保存当前设置再导出
                await SaveSettings(currentSettings);
                hasChanges = false;
                saveBar.style.display = 'none';
                const path = await ExportSettings();
                if (path) {
                    showToast(t('settings.exportSuccess', path), 'success');
                }
            } catch (err) {
                console.error('Export failed:', err);
                showToast(t('settings.exportFailed', err), 'error');
            }
        });
    }

    // Import settings button
    if (importBtn) {
        importBtn.addEventListener('click', async () => {
            try {
                const newSettings = await ImportSettings();
                // 应用导入的设置
                currentSettings = newSettings;
                applySettingsToUI(newSettings);
                applyTheme();
                applyAccentToUI();
                // 通知其他页面设置已更新
                localStorage.setItem('settingsUpdated', Date.now().toString());
                showToast(t('settings.importSuccess'), 'success');
            } catch (err) {
                console.error('Import failed:', err);
                showToast(t('settings.importFailed', err), 'error');
            }
        });

        // Reset settings button（重置为默认设置）
        if (resetBtn) {
            resetBtn.addEventListener('click', async () => {
                // 先确认
                const confirmed = await showConfirm(t('settings.resetConfirm'), {
                    title: t('settings.resetSettings'),
                    okText: t('settings.resetSettings'),
                    danger: true,
                });
                if (!confirmed) return;
                try {
                    const defaults = await ResetSettings();
                    currentSettings = defaults;
                    applySettingsToUI(defaults);
                    applyTheme();
                    applyAccentToUI();
                    // 立即保存
                    await SaveSettings(defaults);
                    hasChanges = false;
                    saveBar.style.display = 'none';
                    // 通知其他页面
                    localStorage.setItem('settingsUpdated', Date.now().toString());
                    showToast(t('settings.resetSuccess'), 'success');
                } catch (err) {
                    console.error('Reset failed:', err);
                    showToast(t('settings.resetFailed', err), 'error');
                }
            });
        }
    }
}

// Mark settings as changed
function markChanged() {
    hasChanges = true;
    saveBar.style.display = 'flex';
}

// Save settings
async function saveSettings() {
    try {
        await SaveSettings(currentSettings);
        hasChanges = false;
        saveBar.style.display = 'none';

        // 立即应用当前页面的设置
        document.body.setAttribute('data-theme', currentSettings.theme || 'dark');
        if (currentSettings.player_font) {
            document.documentElement.style.setProperty('--player-font', currentSettings.player_font);
            document.body.style.fontFamily = currentSettings.player_font + FONT_FALLBACK;
        }
        if (currentSettings.lyrics_font) {
            document.documentElement.style.setProperty('--lyrics-font', currentSettings.lyrics_font);
        }
        const uiScale = (currentSettings.ui_scale && currentSettings.ui_scale >= 20 && currentSettings.ui_scale <= 500) ? currentSettings.ui_scale : 135;
        const lyricsScale = (currentSettings.lyrics_scale && currentSettings.lyrics_scale >= 20 && currentSettings.lyrics_scale <= 500) ? currentSettings.lyrics_scale : 135;
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
            window.MusicLiteSettings.cached = { ...currentSettings };
        }

        // 通知其他页面（libraries、player）应用新设置
        localStorage.setItem('settingsUpdated', Date.now().toString());
        localStorage.setItem('cachedSettings', JSON.stringify(currentSettings));
        // 应用语言变更
        if (currentSettings.language) {
            setLanguage(currentSettings.language);
            applyTranslations();
        }
        showToast(t('libraries.saved'), 'success');
    } catch (err) {
        console.error('Failed to save settings:', err);
        showToast(t('libraries.saveFailed', err?.message || err), 'error');
    }
}
