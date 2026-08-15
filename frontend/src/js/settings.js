import { LoadSettings, SaveSettings, GetInstalledFonts, ExportSettings, ImportSettings, ResetSettings, OpenAppDataFolder, SetApplicationVolume, GetApplicationVolume, SetSystemMasterVolume, GetSystemMasterVolume, SetAsDefaultPlayer, IsDefaultPlayer, PlayerSetSmartEQEnabled, PlayerSetSmartEQIntensity, HotkeyApply, HotkeyGetActionList } from '@bindings/MusicLite/app/musicservice.js';
import { initI18n, t, setLanguage, applyTranslations, getAvailableLanguages } from './i18n.js';
import { Window } from '@wailsio/runtime';

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
document.getElementById('minimizeBtn')?.addEventListener('click', () => Window.Minimise());
// 关闭按钮：隐藏到托盘而非退出（后台播放）
document.getElementById('closeBtn')?.addEventListener('click', () => Window.Hide());

// DOM Elements
const backBtn = document.getElementById('backBtn');
const themeButtons = document.querySelectorAll('.theme-btn');
const playerFontSelect = document.getElementById('player-font');
const lyricsFontSelect = document.getElementById('lyrics-font');
const playerFontPreview = document.getElementById('player-font-preview');
const lyricsFontPreview = document.getElementById('lyrics-font-preview');
const languageSelect = document.getElementById('language-select');
const titlebarTextInput = document.getElementById('titlebar-text');
const exportBtn = document.getElementById('export-settings-btn');
const importBtn = document.getElementById('import-settings-btn');
const resetBtn = document.getElementById('reset-settings-btn');
const changelogBtn = document.getElementById('changelog-btn');
const openDataFolderBtn = document.getElementById('open-data-folder-btn');
const changelogModal = document.getElementById('changelogModal');
const changelogClose = document.getElementById('changelogClose');
const changelogBody = document.getElementById('changelogBody');
const volumeSlider = document.getElementById('volume-slider');
const volumeValue = document.getElementById('volume-value');
const volumeModeBtns = document.querySelectorAll('.anim-level-btn[data-vol-mode]');
const maxLyricLinesSlider = document.getElementById('max-lyric-lines');
const maxLyricLinesValue = document.getElementById('max-lyric-lines-value');
const setDefaultPlayerBtn = document.getElementById('set-default-player-btn');
const defaultPlayerStatus = document.getElementById('default-player-status');
const lyricAnimationSelect = document.getElementById('lyric-animation-select');
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
const animLevelBtns = document.querySelectorAll('.anim-level-btn[data-level]');
const smartEQModeBtns = document.querySelectorAll('.anim-level-btn[data-smarteq-mode]');
const smartEQIntensitySlider = document.getElementById('smarteq-intensity');
const smartEQIntensityValue = document.getElementById('smarteq-intensity-value');
const newUIModeBtns = document.querySelectorAll('.anim-level-btn[data-newui-mode]');

// ============ 全局快捷键 ============
const HOTKEY_ACTIONS = [
    { action: 'playpause', field: 'hotkey_playpause', label: 'settings.hotkeyPlayPause', default: 'Ctrl+Shift+P' },
    { action: 'next',      field: 'hotkey_next',      label: 'settings.hotkeyNext',      default: 'Ctrl+Shift+Right' },
    { action: 'prev',      field: 'hotkey_prev',      label: 'settings.hotkeyPrev',      default: 'Ctrl+Shift+Left' },
];
const hotkeyListEl = document.getElementById('hotkey-list');
let hotkeyListeningAction = null; // 当前正在监听按键的动作名

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
            confirmModal.classList.add('closing');
            confirmModal.classList.remove('active');
            confirmOkBtn.removeEventListener('click', onOk);
            confirmCancelBtn.removeEventListener('click', onCancel);
            confirmModal.removeEventListener('click', onBackdrop);
            document.removeEventListener('keydown', onKey);
            setTimeout(() => confirmModal.classList.remove('closing'), 200);
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

// ============ 更新记录弹窗 ============
let changelogCache = null;

// 加载 changelog.json（构建时由 scripts/gen-changelog.js 生成）
async function loadChangelog() {
    if (changelogCache) return changelogCache;
    try {
        // Vite 原生支持 import JSON
        const mod = await import('/src/assets/changelog.json');
        changelogCache = mod.default || mod;
    } catch (e) {
        console.warn('加载更新记录失败:', e);
        changelogCache = [];
    }
    return changelogCache;
}

// 类型 → CSS class 映射
const SECTION_TYPE_CLASS = {
    '添加': 'type-add',
    '修改': 'type-modify',
    '修复': 'type-fix',
};

// 渲染单条更新记录
function renderChangelogItem(entry) {
    const item = document.createElement('div');
    item.className = 'changelog-item';

    // 头部：版本号 + 日期
    const header = document.createElement('div');
    header.className = 'changelog-item-header';
    const ver = document.createElement('div');
    ver.className = 'changelog-version';
    ver.textContent = entry.version || '';
    const date = document.createElement('div');
    date.className = 'changelog-date';
    date.textContent = entry.date || '';
    header.appendChild(ver);
    header.appendChild(date);
    item.appendChild(header);

    // 各分段
    if (Array.isArray(entry.sections)) {
        for (const section of entry.sections) {
            // 跳过空段或"无"
            const items = (section.items || []).filter(s => s && s !== '无');
            if (items.length === 0) continue;

            const sectionEl = document.createElement('div');
            sectionEl.className = 'changelog-section';

            const title = document.createElement('span');
            title.className = 'changelog-section-title ' + (SECTION_TYPE_CLASS[section.type] || 'type-other');
            title.textContent = section.type || '';
            sectionEl.appendChild(title);

            const ul = document.createElement('ul');
            ul.className = 'changelog-items';
            for (const it of items) {
                const li = document.createElement('li');
                li.textContent = it;
                ul.appendChild(li);
            }
            sectionEl.appendChild(ul);
            item.appendChild(sectionEl);
        }
    }

    return item;
}

function renderChangelog(entries) {
    if (!changelogBody) return;
    changelogBody.innerHTML = '';
    if (!entries || entries.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'changelog-empty';
        empty.textContent = t('settings.changelogEmpty');
        changelogBody.appendChild(empty);
        return;
    }
    const frag = document.createDocumentFragment();
    for (const entry of entries) {
        frag.appendChild(renderChangelogItem(entry));
    }
    changelogBody.appendChild(frag);
}

function openChangelogModal() {
    if (!changelogModal) return;
    changelogModal.classList.add('active');
    loadChangelog().then(renderChangelog);
}

function closeChangelogModal() {
    if (!changelogModal) return;
    changelogModal.classList.add('closing');
    changelogModal.classList.remove('active');
    setTimeout(() => changelogModal.classList.remove('closing'), 200);
}

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
    // 为设置区块添加逐级入场延迟
    document.querySelectorAll('.settings-section').forEach((sec, i) => {
        sec.style.setProperty('--sec-i', i);
    });
}

// 安全启动：ES 模块执行时 DOMContentLoaded 可能已触发，需双重检查
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSettingsPage);
} else {
    initSettingsPage();
}

// ============ 迷你播放器（设置页也能控制播放） ============
function initMiniPlayer() {
    const miniPlayer = document.getElementById('mini-player');
    const miniPlayerLeft = miniPlayer?.querySelector('.mini-player-left');
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

    // 单一可信源：根据 audio.paused 同步按钮图标（永远以 audio 实际状态为准）
    const syncPlayIcon = () => {
        if (!miniPlayIcon || !miniPauseIcon) return;
        if (window.audioManager.isPlaying()) {
            miniPlayIcon.style.display = 'none';
            miniPauseIcon.style.display = 'block';
        } else {
            miniPlayIcon.style.display = 'block';
            miniPauseIcon.style.display = 'none';
        }
    };

    const applyTrackUI = (track) => {
        if (!track || !track.src) return;
        showMiniPlayer();
        miniTitle.textContent = track.name || t('common.unknown');
        applyMarquee(miniTitle);
        miniArtist.textContent = track.artist || '--';
        setMiniCover(miniCover, track.cover);
    };

    // 播放/暂停
    miniPlayBtn.addEventListener('click', () => {
        window.audioManager.toggle();
    });

    // 返回音乐库
    miniExpand.addEventListener('click', () => {
        window.location.href = '/src/html/libraries.html';
    });

    // 点击 cover + 标题区域：跳转到库页面并打开播放器
    if (miniPlayerLeft) {
        miniPlayerLeft.addEventListener('click', () => {
            const track = window.audioManager?.currentTrack;
            if (track && track.id) {
                localStorage.setItem('openPlayerOnLoad', String(track.id));
            }
            window.location.href = '/src/html/libraries.html';
        });
    }

    // 先绑定事件，再 restore()，避免事件早到但还没被绑定
    window.audioManager.on('play', () => syncPlayIcon());
    window.audioManager.on('pause', () => syncPlayIcon());
    window.audioManager.on('trackloaded', (track) => {
        applyTrackUI(track);
        // trackloaded 后同步一次图标（此时 play/pause 可能已经被 restore 驱动过）
        syncPlayIcon();
    });

    // 从 localStorage 恢复当前曲目（必须在 on() 绑定完成之后调用）
    window.audioManager.restore();
    const currentTrack = window.audioManager.currentTrack;
    if (currentTrack && currentTrack.src) {
        applyTrackUI(currentTrack);
    }
    // restore() 可能是异步 play，先同步一次当前真实状态
    syncPlayIcon();
    // 兜底：restore().play() 可能在稍后触发，再等 200ms 拉一次
    setTimeout(syncPlayIcon, 200);
    setTimeout(syncPlayIcon, 800);
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
        // 根据 volume_mode 从对应音量源读取
        try {
            const mode = currentSettings.volume_mode || 'synth';
            const sysVol = mode === 'master'
                ? await GetSystemMasterVolume()
                : await GetApplicationVolume();
            volumeSlider.value = sysVol;
            volumeValue.textContent = sysVol + '%';
            currentSettings.volume = sysVol;
        } catch (e) {
            // 读取系统音量失败，使用 settings 中的值兜底
        }
        // 检查默认播放器状态
        try {
            const isDefault = await IsDefaultPlayer();
            updateDefaultPlayerStatus(isDefault);
        } catch (e) {
            // 忽略
        }
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
            volume_mode: 'synth',
            accent_color: '#1DB954',
            animation_level: 2,
            max_lyric_lines: 1,
            smart_eq_enabled: false,
            smart_eq_intensity: 0.7
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

    // Volume mode
    const volMode = s.volume_mode || 'synth';
    volumeModeBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.volMode === volMode);
    });

    // Lyric animation
    if (lyricAnimationSelect) {
        lyricAnimationSelect.value = s.lyric_animation || 'fade';
    }

    // Max lyric lines
    const maxLines = (typeof s.max_lyric_lines === 'number' && s.max_lyric_lines >= 1 && s.max_lyric_lines <= 10)
        ? s.max_lyric_lines : 1;
    if (maxLyricLinesSlider) {
        maxLyricLinesSlider.value = maxLines;
        maxLyricLinesValue.textContent = maxLines;
    }

    // SmartEQ 启用/旁路
    const smartEQOn = s.smart_eq_enabled || false;
    smartEQModeBtns.forEach(btn => {
        btn.classList.toggle('active', (btn.dataset.smarteqMode === 'on') === smartEQOn);
    });
    // SmartEQ 补偿强度（后端存 0-1，UI 显示 0-100%）
    const smartEQIntensityVal = (typeof s.smart_eq_intensity === 'number') ? Math.round(s.smart_eq_intensity * 100) : 70;
    if (smartEQIntensitySlider) {
        smartEQIntensitySlider.value = smartEQIntensityVal;
        smartEQIntensityValue.textContent = smartEQIntensityVal + '%';
    }

    // Language
    const lang = s.language || 'zh-CN';
    if (languageSelect) languageSelect.value = lang;
    setLanguage(lang);
    applyTranslations();

    // 标题栏文字
    if (titlebarTextInput) titlebarTextInput.value = s.titlebar_text || '';

    // Scale
    const uiScale = (s.ui_scale && s.ui_scale >= 20 && s.ui_scale <= 500) ? s.ui_scale : 135;
    const lyricsScale = (s.lyrics_scale && s.lyrics_scale >= 20 && s.lyrics_scale <= 500) ? s.lyrics_scale : 135;
    uiScaleSlider.value = uiScale;
    uiScaleValue.textContent = uiScale + '%';
    lyricsScaleSlider.value = lyricsScale;
    lyricsScaleValue.textContent = lyricsScale + '%';

    // 界面动画级别（默认 2 = 增强；旧文件 enable_animations:false → 0）
    const lvl = typeof s.animation_level === 'number' ? s.animation_level : (s.enable_animations === false ? 0 : 2);
    setAnimationLevel(lvl);

    // 新风格 UI 开关
    const newUIOn = s.new_ui_enabled || false;
    newUIModeBtns.forEach(btn => {
        btn.classList.toggle('active', (btn.dataset.newuiMode === 'on') === newUIOn);
    });
    if (window.MusicLiteSettings) window.MusicLiteSettings.applyNewUI(newUIOn);

    // 设置界面布局模式（新UI开启时强制使用 WinUI3 NavigationView 布局）
    if (newUIOn) {
        applyWinUI3Layout();
    } else {
        removeWinUI3Layout();
        applySettingsLayoutMode(s.settings_layout || 'scroll');
    }
}

// 同步四级动画选择器 UI 与 body data-anim 属性
function setAnimationLevel(level) {
    const clamped = Math.max(0, Math.min(3, level | 0));
    // 选中高亮按钮（只处理有 data-level 属性的动画级别按钮，避免误操作音量模式等其他 .anim-level-btn）
    animLevelBtns.forEach(btn => {
        if (btn.dataset.level === undefined) return;
        const active = parseInt(btn.dataset.level, 10) === clamped;
        btn.classList.toggle('active', active);
    });
    document.body.setAttribute('data-anim', clamped.toString());
    // 兼容旧逻辑：level 0 时添加 .no-anim（让原 no-anim 规则也生效）
    document.body.classList.toggle('no-anim', clamped === 0);
    // 持久化到 localStorage，供 settings-apply.js 启动时同步读取（避免首屏闪烁）
    try { localStorage.setItem('musicLite.animationsLevel', clamped.toString()); } catch (e) {}
    return clamped;
}

// ============ 设置界面布局模式：scroll / columns / tabs ============
function applySettingsLayoutMode(mode) {
    const valid = ['scroll', 'columns', 'tabs'];
    const m = valid.includes(mode) ? mode : 'scroll';
    document.body.setAttribute('data-settings-layout', m);
    if (window.MusicLiteSettings) window.MusicLiteSettings.applySettingsLayout(m);
    // 生成或移除选项卡栏
    const existingTabs = document.querySelector('.settings-tabs');
    if (m === 'tabs') {
        if (!existingTabs) {
            generateTabBar();
        }
        // 默认激活第一个选项卡
        const firstTab = document.querySelector('.settings-tab');
        if (firstTab) switchTab(firstTab.dataset.tabTarget);
    } else {
        if (existingTabs) existingTabs.remove();
        // 恢复所有 section 可见
        document.querySelectorAll('.settings-section').forEach(sec => sec.classList.remove('active'));
    }
}

// 生成选项卡栏（tabs 模式）
function generateTabBar() {
    const main = document.querySelector('main');
    if (!main) return;
    const sections = main.querySelectorAll('.settings-section[data-section-id]');
    if (sections.length === 0) return;

    const tabBar = document.createElement('div');
    tabBar.className = 'settings-tabs';

    sections.forEach(sec => {
        const id = sec.dataset.sectionId;
        const h2 = sec.querySelector('h2');
        const label = h2 ? h2.textContent : id;
        const tab = document.createElement('button');
        tab.className = 'settings-tab';
        tab.dataset.tabTarget = id;
        tab.textContent = label;
        tab.addEventListener('click', () => switchTab(id));
        tabBar.appendChild(tab);
    });

    // 插入到 main 之前
    main.parentNode.insertBefore(tabBar, main);
}

// 切换选项卡
function switchTab(sectionId) {
    document.querySelectorAll('.settings-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tabTarget === sectionId);
    });
    document.querySelectorAll('.settings-section').forEach(sec => {
        sec.classList.toggle('active', sec.dataset.sectionId === sectionId);
    });
}

// ============ WinUI3 NavigationView 布局（新UI专属） ============
// WinUI3 图标（简洁线条 SVG，24x24，currentColor）
const WINUI3_ICONS = {
  appearance: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18V3z" fill="currentColor" stroke="none"/></svg>',

  font: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V5h10v2"/><path d="M9 5v14"/><path d="M6 19h6"/><path d="M14.5 19l3.5-10 3.5 10"/><path d="M15.75 15.5h4.5"/></svg>',

  playback: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg>',

  hotkeys: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="14" rx="3"/><line x1="6" y1="10" x2="8" y2="10"/><line x1="11" y1="10" x2="13" y2="10"/><line x1="16" y1="10" x2="18" y2="10"/><line x1="6" y1="14" x2="18" y2="14"/></svg>',

  language: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><line x1="3" y1="12" x2="21" y2="12"/><path d="M4.5 7.5h15"/><path d="M4.5 16.5h15"/></svg>',

  about: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="17"/><circle cx="12" cy="7.5" r="0.75" fill="currentColor" stroke="none"/></svg>',

  more: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="12" r="1.75" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.75" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.75" fill="currentColor" stroke="none"/></svg>'
};
// 生成 WinUI3 NavigationView 左侧导航栏
function applyWinUI3Layout() {
    document.body.setAttribute('data-settings-layout', 'winui3');

    // 移除可能存在的选项卡栏和旧导航栏
    document.querySelector('.settings-tabs')?.remove();
    document.querySelector('.winui3-nav')?.remove();

    const main = document.querySelector('main');
    if (!main) return;
    const sections = main.querySelectorAll('.settings-section[data-section-id]');
    if (sections.length === 0) return;

    // 创建导航栏
    const nav = document.createElement('nav');
    nav.className = 'winui3-nav';

    // 导航头部（含返回键）
    const navHeader = document.createElement('div');
    navHeader.className = 'winui3-nav-header';
    // 尝试复用原 header 中的返回键
    const origBackBtn = document.querySelector('header .btn-back');
    if (origBackBtn) {
        const backClone = origBackBtn.cloneNode(true);
        backClone.className = 'winui3-nav-back btn-back';
        backClone.id = 'winui3BackBtn';
        // 重新绑定返回事件（cloneNode 不复制事件监听器）
        backClone.addEventListener('click', async () => {
            if (typeof hasChanges !== 'undefined' && hasChanges) {
                const ok = await showConfirm(t('settings.discardConfirm'), {
                    title: t('settings.discardTitle'), okText: t('settings.discardBtn'), cancelText: t('settings.stayBtn'), danger: true
                });
                if (ok) window.history.back();
            } else {
                window.history.back();
            }
        });
        navHeader.appendChild(backClone);
    }
    const navTitle = document.createElement('span');
    navTitle.className = 'winui3-nav-title';
    navTitle.textContent = '设置';
    navHeader.appendChild(navTitle);
    nav.appendChild(navHeader);

    // 导航项
    const navList = document.createElement('div');
    navList.className = 'winui3-nav-list';
    sections.forEach(sec => {
        const id = sec.dataset.sectionId;
        const h2 = sec.querySelector('h2');
        const label = h2 ? h2.textContent : id;
        const icon = WINUI3_ICONS[id] || WINUI3_ICONS.more;

        const item = document.createElement('button');
        item.className = 'winui3-nav-item';
        item.dataset.navTarget = id;
        item.innerHTML = '<span class="winui3-nav-icon">' + icon + '</span><span class="winui3-nav-label">' + label + '</span>';
        item.addEventListener('click', () => switchWinUI3Nav(id));
        navList.appendChild(item);
    });
    nav.appendChild(navList);

    // 插入导航栏到 main 之前
    main.parentNode.insertBefore(nav, main);

    // 隐藏所有 section，只显示第一个
    sections.forEach(sec => sec.classList.remove('active'));
    const firstSection = sections[0];
    if (firstSection) {
        firstSection.classList.add('active');
        const firstNav = nav.querySelector('.winui3-nav-item');
        if (firstNav) firstNav.classList.add('active');
    }
}

// 移除 WinUI3 导航栏，恢复原布局
function removeWinUI3Layout() {
    const nav = document.querySelector('.winui3-nav');
    if (nav) nav.remove();
    // 恢复所有 section 可见
    document.querySelectorAll('.settings-section').forEach(sec => sec.classList.remove('active'));
}

// 切换 WinUI3 导航项
function switchWinUI3Nav(sectionId) {
    document.querySelectorAll('.winui3-nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.navTarget === sectionId);
    });
    document.querySelectorAll('.settings-section').forEach(sec => {
        sec.classList.toggle('active', sec.dataset.sectionId === sectionId);
    });
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
    // 只有"主题色"(custom)模式才显示取色盘，深色/浅色/墨绿使用固定配色
    accentColorItem.style.display = (theme === 'custom') ? 'block' : 'none';
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
            // 切换主题时显示/隐藏取色盘（仅 custom 主题显示，dark/light/accent 使用固定配色）
            showOrHideAccentItem(currentSettings.theme);
            // 主题切换后重新计算配套色（applyAccentToUI 内部会根据新 theme 选择固定配色或动态计算）
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

    // 界面动画级别选择器
    animLevelBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const lvl = parseInt(btn.dataset.level, 10) || 0;
            currentSettings.animation_level = lvl;
            setAnimationLevel(lvl);
            markChanged();
        });
    });

    // 新风格 UI 开关
    newUIModeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const on = btn.dataset.newuiMode === 'on';
            currentSettings.new_ui_enabled = on;
            newUIModeBtns.forEach(b => b.classList.toggle('active', b === btn));
            if (window.MusicLiteSettings) window.MusicLiteSettings.applyNewUI(on);
            // 新UI 开启时切换为 WinUI3 NavigationView 布局；关闭时恢复原布局模式
            if (on) {
                applyWinUI3Layout();
            } else {
                removeWinUI3Layout();
                applySettingsLayoutMode(currentSettings.settings_layout || 'scroll');
            }
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

    // Volume slider — 按 volume_mode 路由到合成器/系统主音量
    volumeSlider.addEventListener('input', () => {
        const vol = parseInt(volumeSlider.value, 10);
        volumeValue.textContent = vol + '%';
        currentSettings.volume = vol;
        // 通过 audioManager 统一路由（它会按 _volumeMode 选择 SetApplicationVolume 或 SetSystemMasterVolume）
        // 同时更新 audioManager._volume 缓存，让播放器页滑块保持一致
        if (window.audioManager && typeof window.audioManager.setVolume === 'function') {
            window.audioManager.setVolume(vol);
        } else {
            // audioManager 尚未初始化时的兜底（理论上不会发生）
            const mode = currentSettings.volume_mode || 'synth';
            if (mode === 'master') {
                SetSystemMasterVolume(vol).catch(() => {});
            } else {
                SetApplicationVolume(vol).catch(() => {});
            }
        }
        markChanged();
    });

    // Volume mode buttons
    volumeModeBtns.forEach(btn => {
        btn.addEventListener('click', async () => {
            const mode = btn.dataset.volMode;
            currentSettings.volume_mode = mode;
            volumeModeBtns.forEach(b => b.classList.toggle('active', b === btn));
            try { localStorage.setItem('musicLite.volumeMode', mode); } catch (e) {}
            // 通知 audioManager 切换模式（它会从对应音源读取真实音量并更新缓存）
            if (window.audioManager && typeof window.audioManager.setVolumeMode === 'function') {
                await window.audioManager.setVolumeMode(mode);
            }
            // 切换后读取对应音量值更新滑块
            try {
                const vol = mode === 'master'
                    ? await GetSystemMasterVolume()
                    : await GetApplicationVolume();
                volumeSlider.value = vol;
                volumeValue.textContent = vol + '%';
                currentSettings.volume = vol;
            } catch (e) {
                // 读取失败，保持原值
            }
            markChanged();
        });
    });

    // Max lyric lines slider
    if (maxLyricLinesSlider) {
        maxLyricLinesSlider.addEventListener('input', () => {
            const v = parseInt(maxLyricLinesSlider.value, 10);
            maxLyricLinesValue.textContent = v;
            currentSettings.max_lyric_lines = v;
            try { localStorage.setItem('musicLite.maxLyricLines', v.toString()); } catch (e) {}
            markChanged();
        });
    }

    // SmartEQ 启用/旁路按钮
    smartEQModeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const enabled = btn.dataset.smarteqMode === 'on';
            currentSettings.smart_eq_enabled = enabled;
            smartEQModeBtns.forEach(b => b.classList.toggle('active', b === btn));
            // 实时应用到后端播放器
            PlayerSetSmartEQEnabled(enabled).catch(() => {});
            markChanged();
        });
    });

    // SmartEQ 补偿强度滑块
    if (smartEQIntensitySlider) {
        smartEQIntensitySlider.addEventListener('input', () => {
            const v = parseInt(smartEQIntensitySlider.value, 10);
            smartEQIntensityValue.textContent = v + '%';
            currentSettings.smart_eq_intensity = v / 100;
            // 实时应用到后端播放器
            PlayerSetSmartEQIntensity(v / 100).catch(() => {});
            markChanged();
        });
    }

    // Set as default player
    if (setDefaultPlayerBtn) {
        setDefaultPlayerBtn.addEventListener('click', async () => {
            try {
                await SetAsDefaultPlayer();
                updateDefaultPlayerStatus(true);
            } catch (e) {
                console.error('Set as default player failed:', e);
            }
        });
    }

    // Lyric animation select
    if (lyricAnimationSelect) {
        lyricAnimationSelect.addEventListener('change', () => {
            currentSettings.lyric_animation = lyricAnimationSelect.value;
            // 实时预览：直接操作 body class
            const validModes = ['fade', 'slide-up', 'slide-left', 'zoom', 'bounce', 'flip', 'rotate', 'none'];
            const m = validModes.includes(lyricAnimationSelect.value) ? lyricAnimationSelect.value : 'fade';
            document.body.classList.forEach(c => {
                if (c.startsWith('lyric-anim-')) document.body.classList.remove(c);
            });
            document.body.classList.add('lyric-anim-' + m);
            // 持久化到 localStorage，供页面加载时同步读取
            try { localStorage.setItem('musicLite.lyricAnimation', m); } catch (e) {}
            markChanged();
        });
    }

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

    // 标题栏文字
    if (titlebarTextInput) {
        titlebarTextInput.addEventListener('input', () => {
            currentSettings.titlebar_text = titlebarTextInput.value;
            // 实时预览：有自定义文字则覆盖，否则恢复翻译（data-i18n）
            const custom = titlebarTextInput.value.trim();
            if (custom) {
                document.querySelectorAll('.titlebar-title').forEach(el => { el.textContent = custom; });
            } else {
                // 无自定义：先重新 applyTranslations 以翻译 data-i18n 元素
                applyTranslations();
            }
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
                hideSaveBar();
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
                renderHotkeyList();
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
                    renderHotkeyList();
                    // 立即保存
                    await SaveSettings(defaults);
                    hasChanges = false;
                    hideSaveBar();
                    // 通知其他页面
                    localStorage.setItem('settingsUpdated', Date.now().toString());
                    showToast(t('settings.resetSuccess'), 'success');
                } catch (err) {
                    console.error('Reset failed:', err);
                    showToast(t('settings.resetFailed', err), 'error');
                }
            });
        }

        // Changelog button（更新记录）
        if (changelogBtn) {
            changelogBtn.addEventListener('click', openChangelogModal);
        }
        // 打开程序数据文件夹（%APPDATA%/MusicLite）
        if (openDataFolderBtn) {
            openDataFolderBtn.addEventListener('click', async () => {
                try {
                    await OpenAppDataFolder();
                } catch (e) {
                    showToast(t('settings.openDataFolderFailed'), 'error');
                }
            });
        }
        if (changelogClose) {
            changelogClose.addEventListener('click', closeChangelogModal);
        }
        if (changelogModal) {
            // 点击背景关闭
            changelogModal.addEventListener('click', (e) => {
                if (e.target === changelogModal) closeChangelogModal();
            });
        }
        // Esc 关闭
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && changelogModal && changelogModal.classList.contains('active')) {
                closeChangelogModal();
            }
        });
    }
}

// ============ 全局快捷键：UI 渲染与按键捕获 ============
function renderHotkeyList() {
    if (!hotkeyListEl) return;
    const frag = document.createDocumentFragment();
    for (const { action, label, default: defaultKey } of HOTKEY_ACTIONS) {
        const cfg = currentSettings?.[HOTKEY_ACTIONS.find(h => h.action === action).field] || { enabled: false, keys: '' };
        const item = document.createElement('div');
        item.className = 'hotkey-item';
        item.dataset.action = action;
        item.innerHTML = `
            <span class="hotkey-label" data-i18n="${label}">${t(label)}</span>
            <div class="hotkey-toggle${cfg.enabled ? ' active' : ''}" data-action="${action}"></div>
            <button class="hotkey-key-btn${cfg.keys ? '' : ' empty'}" data-action="${action}">
                ${cfg.keys || t('settings.hotkeyNotSet')}
            </button>
            <button class="hotkey-clear-btn" data-action="${action}">${t('settings.hotkeyClear')}</button>
        `;
        frag.appendChild(item);
    }
    hotkeyListEl.innerHTML = '';
    hotkeyListEl.appendChild(frag);
    bindHotkeyEvents();
}

function bindHotkeyEvents() {
    // 开关
    hotkeyListEl.querySelectorAll('.hotkey-toggle').forEach(toggle => {
        toggle.addEventListener('click', () => {
            const action = toggle.dataset.action;
            const field = HOTKEY_ACTIONS.find(h => h.action === action).field;
            const cfg = currentSettings[field] || { enabled: false, keys: '' };
            const newEnabled = !cfg.enabled;
            currentSettings[field] = { ...cfg, enabled: newEnabled };
            toggle.classList.toggle('active', newEnabled);
            markChanged();
        });
    });
    // 按键捕获按钮
    hotkeyListEl.querySelectorAll('.hotkey-key-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            // 取消之前的监听
            if (hotkeyListeningAction) {
                const prevBtn = hotkeyListEl.querySelector(`.hotkey-key-btn[data-action="${hotkeyListeningAction}"]`);
                if (prevBtn) {
                    prevBtn.classList.remove('listening');
                    const prevField = HOTKEY_ACTIONS.find(h => h.action === hotkeyListeningAction).field;
                    const prevCfg = currentSettings[prevField] || { enabled: false, keys: '' };
                    prevBtn.textContent = prevCfg.keys || t('settings.hotkeyNotSet');
                    prevBtn.classList.toggle('empty', !prevCfg.keys);
                }
            }
            hotkeyListeningAction = btn.dataset.action;
            btn.classList.add('listening');
            btn.textContent = t('settings.hotkeyListening');
            btn.classList.remove('empty');
        });
    });
    // 清除按钮
    hotkeyListEl.querySelectorAll('.hotkey-clear-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.dataset.action;
            const field = HOTKEY_ACTIONS.find(h => h.action === action).field;
            const cfg = currentSettings[field] || { enabled: false, keys: '' };
            currentSettings[field] = { ...cfg, keys: '' };
            const keyBtn = hotkeyListEl.querySelector(`.hotkey-key-btn[data-action="${action}"]`);
            if (keyBtn) {
                keyBtn.textContent = t('settings.hotkeyNotSet');
                keyBtn.classList.add('empty');
            }
            markChanged();
        });
    });
}

// 全局 keydown 监听：当 hotkeyListeningAction 不为 null 时捕获按键组合
document.addEventListener('keydown', (e) => {
    if (!hotkeyListeningAction) return;
    e.preventDefault();
    e.stopPropagation();
    // 修饰键单独按下不触发捕获
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
    // Escape 取消监听
    if (e.key === 'Escape') {
        const btn = hotkeyListEl.querySelector(`.hotkey-key-btn[data-action="${hotkeyListeningAction}"]`);
        if (btn) {
            btn.classList.remove('listening');
            const field = HOTKEY_ACTIONS.find(h => h.action === hotkeyListeningAction).field;
            const cfg = currentSettings[field] || { enabled: false, keys: '' };
            btn.textContent = cfg.keys || t('settings.hotkeyNotSet');
            btn.classList.toggle('empty', !cfg.keys);
        }
        hotkeyListeningAction = null;
        return;
    }
    // 构建组合键字符串
    const parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.shiftKey) parts.push('Shift');
    if (e.altKey) parts.push('Alt');
    if (e.metaKey) parts.push('Win');
    // 标准化键名
    let keyName = e.key;
    if (keyName === ' ') keyName = 'Space';
    if (keyName.length === 1) keyName = keyName.toUpperCase();
    parts.push(keyName);
    const combo = parts.join('+');
    // 写入 currentSettings
    const action = hotkeyListeningAction;
    const field = HOTKEY_ACTIONS.find(h => h.action === action).field;
    const cfg = currentSettings[field] || { enabled: false, keys: '' };
    currentSettings[field] = { ...cfg, keys: combo };
    // 更新 UI
    const btn = hotkeyListEl.querySelector(`.hotkey-key-btn[data-action="${action}"]`);
    if (btn) {
        btn.classList.remove('listening');
        btn.textContent = combo;
        btn.classList.remove('empty');
    }
    // 自动启用开关
    if (!cfg.enabled) {
        currentSettings[field] = { ...currentSettings[field], enabled: true };
        const toggle = hotkeyListEl.querySelector(`.hotkey-toggle[data-action="${action}"]`);
        if (toggle) toggle.classList.add('active');
    }
    hotkeyListeningAction = null;
    markChanged();
});

// Mark settings as changed
// 更新默认播放器状态显示
function updateDefaultPlayerStatus(isDefault) {
    if (!defaultPlayerStatus) return;
    if (isDefault) {
        defaultPlayerStatus.textContent = t('settings.isDefaultPlayer') || '✓ 已设为默认';
        defaultPlayerStatus.style.color = 'var(--accent-color, #1DB954)';
    } else {
        defaultPlayerStatus.textContent = t('settings.notDefaultPlayer') || '未设为默认';
        defaultPlayerStatus.style.color = '';
    }
}

function markChanged() {
    hasChanges = true;
    saveBar.style.display = 'flex';
    // 强制重排以重启动画（display:none→flex 切换后 animation 不会自动重播）
    void saveBar.offsetWidth;
    saveBar.classList.add('visible');
}

function hideSaveBar() {
    saveBar.classList.remove('visible');
    saveBar.style.display = 'none';
}

// Save settings
async function saveSettings() {
    try {
        await SaveSettings(currentSettings);
        hasChanges = false;
        hideSaveBar();

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
        // 应用标题栏文字（有自定义则覆盖，否则保留翻译值）
        if (currentSettings.titlebar_text && currentSettings.titlebar_text.trim()) {
            const custom = currentSettings.titlebar_text.trim();
            document.querySelectorAll('.titlebar-title').forEach(el => { el.textContent = custom; });
        }
        // 同步全局快捷键配置到后端 HotkeyManager
        try { await HotkeyApply(); } catch (_) {}
        showToast(t('libraries.saved'), 'success');
    } catch (err) {
        console.error('Failed to save settings:', err);
        showToast(t('libraries.saveFailed', err?.message || err), 'error');
    }
}
