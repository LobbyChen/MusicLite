import { LoadSettings } from '../../wailsjs/go/main/App.js';
import { initI18n, setLanguage, applyTranslations } from './i18n.js';

const FONT_FALLBACK = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
const DEFAULT_ACCENT = '#1db954';

// ============ 颜色工具：hex <-> HSL ============
function hexToHsl(hex) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const r = parseInt(hex.substr(0, 2), 16) / 255;
    const g = parseInt(hex.substr(2, 2), 16) / 255;
    const b = parseInt(hex.substr(4, 2), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) { h = s = 0; }
    else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return [h * 360, s * 100, l * 100];
}

function hslToHex(h, s, l) {
    h /= 360; s /= 100; l /= 100;
    let r, g, b;
    if (s === 0) { r = g = b = l; }
    else {
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1/6) return p + (q - p) * 6 * t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1/3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1/3);
    }
    const toHex = x => Math.round(x * 255).toString(16).padStart(2, '0');
    return '#' + toHex(r) + toHex(g) + toHex(b);
}

// 应用歌词行切换动画：在 body 上设置 .lyric-anim-<mode> class
function applyLyricAnimation(mode) {
    const validModes = ['fade', 'slide-up', 'slide-left', 'zoom', 'bounce', 'flip', 'rotate', 'none'];
    const m = validModes.includes(mode) ? mode : 'fade';
    // 移除旧的动画 class（用静态数组遍历，避免遍历时修改集合）
    const toRemove = [];
    document.body.classList.forEach(c => {
        if (c.startsWith('lyric-anim-')) toRemove.push(c);
    });
    toRemove.forEach(c => document.body.classList.remove(c));
    // 所有模式都添加对应 class（包括 fade）
    document.body.classList.add('lyric-anim-' + m);
    // 持久化到 localStorage，供页面加载时同步读取
    try { localStorage.setItem('musicLite.lyricAnimation', m); } catch (e) {}
}

// 根据主题色 + 主题模式，算出全套配套 CSS 变量
function computePalette(accentHex, theme) {
    const [h, s, l] = hexToHsl(accentHex);
    const sat = Math.min(s, 80); // 限制饱和度，避免过艳
    if (theme === 'light') {
        // 浅色基调 + 主题色调
        return {
            '--bg-color':       hslToHex(h, sat * 0.25, 96),
            '--card-bg':        hslToHex(h, sat * 0.18, 99),
            '--hover-color':    hslToHex(h, sat * 0.28, 93),
            '--border-color':   hslToHex(h, sat * 0.30, 88),
            '--text-primary':   hslToHex(h, sat * 0.45, 12),
            '--text-secondary': hslToHex(h, sat * 0.35, 38),
            '--accent-color':   accentHex,
            '--accent-hover':   hslToHex(h, sat, Math.max(l - 12, 10)),
            '--accent-glow':    hslToHex(h, sat, Math.min(l + 18, 90)) + '55',
        };
    }
    // dark / accent：深色基调 + 主题色调
    return {
        '--bg-color':       hslToHex(h, sat * 0.40, 6),
        '--card-bg':        hslToHex(h, sat * 0.35, 11),
        '--hover-color':    hslToHex(h, sat * 0.40, 16),
        '--border-color':   hslToHex(h, sat * 0.40, 19),
        '--text-primary':   hslToHex(h, sat * 0.15, 96),
        '--text-secondary': hslToHex(h, sat * 0.20, 68),
        '--accent-color':   accentHex,
        '--accent-hover':   hslToHex(h, sat, Math.max(l - 12, 10)),
        '--accent-glow':    hslToHex(h, sat, Math.min(l + 18, 90)) + '55',
    };
}

// 应用主题色：根据主题模式算出全套配套色，写到 <html> 和 <body> inline style
function applyAccentColor(color, theme) {
    const c = (color || '').trim() || DEFAULT_ACCENT;
    const t = theme || 'dark';
    const palette = computePalette(c, t);
    const root = document.documentElement;
    const body = document.body;
    for (const [k, v] of Object.entries(palette)) {
        root.style.setProperty(k, v);
        if (body) body.style.setProperty(k, v);
    }
    // 主题色变化后，如果当前有封面，需要重新评估播放器对比度
    // （因为 --text-primary/--text-secondary 可能变了，但 player-overlay 上的覆盖还在）
    PlayerContrast.reapply();
    // 同时调整设置页 save-bar 的文字对比度（save-bar 背景是 accent-color）
    adjustSaveBarContrast(c);
}

// 设置页 save-bar 背景是 accent-color，当主题色偏亮时白字看不清
// 根据主题色亮度决定 save-bar 文字/按钮颜色
function adjustSaveBarContrast(accentHex) {
    const saveBar = document.querySelector('.save-bar');
    if (!saveBar) return;
    // 简单亮度估算：解析 hex → RGB → Rec.601 灰度
    let hex = (accentHex || '').trim().replace(/^#/, '');
    // 展开 3 位短 hex (#abc → #aabbcc)
    if (hex.length === 3) {
        hex = hex.split('').map(c => c + c).join('');
    }
    let brightness = 0.5;
    if (/^[0-9a-f]{6}$/i.test(hex)) {
        const r = parseInt(hex.slice(0, 2), 16) / 255;
        const g = parseInt(hex.slice(2, 4), 16) / 255;
        const b = parseInt(hex.slice(4, 6), 16) / 255;
        brightness = 0.299 * r + 0.587 * g + 0.114 * b;
    }
    if (brightness > 0.6) {
        // 主题色偏亮 → save-bar 用深色文字和深色按钮
        saveBar.style.setProperty('--save-fg', '#1a1a1a');
        saveBar.style.setProperty('--save-btn-bg', '#1a1a1a');
        saveBar.style.setProperty('--save-btn-fg', '#' + hex);
    } else {
        // 主题色偏暗 → save-bar 用白色文字和白色按钮（原样式）
        saveBar.style.setProperty('--save-fg', '#ffffff');
        saveBar.style.setProperty('--save-btn-bg', '#ffffff');
        saveBar.style.setProperty('--save-btn-fg', '#' + hex);
    }
}

// ============ 播放器对比度自动调整 ============
// 封面作为 player-overlay 的模糊背景（opacity 0.75），当封面亮度与文字颜色对比度过低时，
// 在 #player-overlay 上覆盖 --text-primary / --text-secondary，只影响播放器子树。
const PlayerContrast = {
    lastCoverUrl: null,
    lastBrightness: 0.5, // 0=纯黑 1=纯白

    // 分析图片平均亮度（0-1），失败返回 0.5
    analyzeBrightness(url) {
        return new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                try {
                    const size = 32;
                    const canvas = document.createElement('canvas');
                    canvas.width = size;
                    canvas.height = size;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, size, size);
                    const data = ctx.getImageData(0, 0, size, size).data;
                    let total = 0;
                    const count = data.length / 4;
                    for (let i = 0; i < data.length; i += 4) {
                        // 感知亮度公式（Rec. 601）
                        total += (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
                    }
                    resolve(total / count);
                } catch (e) {
                    // canvas 被跨域污染，无法读取像素，返回中性值
                    resolve(0.5);
                }
            };
            img.onerror = () => resolve(0.5);
            img.src = url;
        });
    },

    // 根据亮度（0-1）调整 #player-overlay 上的文字颜色覆盖
    apply(brightness) {
        this.lastBrightness = brightness;
        const overlay = document.getElementById('player-overlay');
        if (!overlay) return;
        if (brightness > 0.6) {
            // 封面偏亮 → 用深色文字保证对比度
            overlay.style.setProperty('--text-primary', '#1a1a1a');
            overlay.style.setProperty('--text-secondary', '#555555');
            // 播放按钮：背景用浅色（与文字反相），图标用深色保证可见
            overlay.style.setProperty('--player-btn-bg', '#ffffff');
            overlay.style.setProperty('--player-btn-bg-hover', '#e0e0e0');
            overlay.style.setProperty('--player-btn-fg', '#1a1a1a');
        } else if (brightness < 0.4) {
            // 封面偏暗 → 用浅色文字
            overlay.style.setProperty('--text-primary', '#ffffff');
            overlay.style.setProperty('--text-secondary', '#c0c0c0');
            // 播放按钮：背景用深色（与文字反相），图标用浅色保证可见
            overlay.style.setProperty('--player-btn-bg', '#1a1a1a');
            overlay.style.setProperty('--player-btn-bg-hover', '#333333');
            overlay.style.setProperty('--player-btn-fg', '#ffffff');
        } else {
            // 中间区间：清除覆盖，回退到主题色
            overlay.style.removeProperty('--text-primary');
            overlay.style.removeProperty('--text-secondary');
            // 播放按钮回退：背景=text-primary，图标=bg-color（默认主题对比已足够）
            overlay.style.removeProperty('--player-btn-bg');
            overlay.style.removeProperty('--player-btn-bg-hover');
            overlay.style.removeProperty('--player-btn-fg');
        }
    },

    // 供 player.js 在 loadTrack 时调用：根据封面 URL 异步调整
    async adjustFromCover(url) {
        this.lastCoverUrl = url;
        if (!url) {
            // 无封面：清除覆盖，回到主题色
            this.apply(0.5);
            return;
        }
        const brightness = await this.analyzeBrightness(url);
        // 封面加载是异步的，若期间又切了歌，以最新的为准
        if (this.lastCoverUrl !== url) return;
        this.apply(brightness);
    },

    // 主题色变化后重新评估（用上次测得的亮度，避免重新读图）
    reapply() {
        if (this.lastCoverUrl) this.apply(this.lastBrightness);
    },
};

const SettingsManager = {
    cached: null,

    async load() {
        if (this.cached) return this.cached;
        try {
            this.cached = await LoadSettings();
        } catch (e) {
            console.warn('Settings load failed, using defaults', e);
            this.cached = {
                theme: 'dark',
                player_font: 'system-ui',
                lyrics_font: "'Consolas', 'Monaco', monospace",
                volume: 70,
                accent_color: DEFAULT_ACCENT
            };
        }
        return this.cached;
    },

    // 立即应用主题和字体（在 DOMContentLoaded 中调用）
    async apply() {
        const s = await this.load();

        // 先初始化 i18n（从后端加载翻译数据），再设置语言
        await initI18n();
        const lang = s.language || 'zh-CN';
        setLanguage(lang);

        // 主题
        document.body.setAttribute('data-theme', s.theme || 'dark');

        // 自定义主题色 + 全套配套色
        applyAccentColor(s.accent_color || s.AccentColor || DEFAULT_ACCENT, s.theme || 'dark');

        // 播放器字体（写到 <html> 和 <body>，让所有页面继承）
        const pf = s.player_font || 'system-ui';
        document.documentElement.style.setProperty('--player-font', pf);
        document.body.style.fontFamily = `${pf}, ${FONT_FALLBACK}`;

        // 歌词字体
        if (s.lyrics_font) {
            document.documentElement.style.setProperty('--lyrics-font', s.lyrics_font);
        }

        // 基准字号 & 歌词字号（缩放比例 × 基准值）
        const uiScale = (s.ui_scale && s.ui_scale >= 20 && s.ui_scale <= 500) ? s.ui_scale : 135;
        const lyricsScale = (s.lyrics_scale && s.lyrics_scale >= 20 && s.lyrics_scale <= 500) ? s.lyrics_scale : 135;
        const baseSize = 14 * uiScale / 100;
        const lyricsSize = 16 * lyricsScale / 100;
        // 设置 CSS 变量（供 var(--base-font-size) 使用）
        document.documentElement.style.setProperty('--base-font-size', baseSize + 'px');
        document.body.style.setProperty('--base-font-size', baseSize + 'px');
        document.documentElement.style.setProperty('--lyrics-font-size', lyricsSize + 'px');
        document.body.style.setProperty('--lyrics-font-size', lyricsSize + 'px');
        // 关键：直接设置 <html> 的 font-size，让所有 rem 单位跟随缩放
        document.documentElement.style.fontSize = baseSize + 'px';

        // 全屏歌词切换动画
        applyLyricAnimation(s.lyric_animation);

        // 应用 i18n 翻译（在 DOM 和语言都就绪后）
        applyTranslations();

        return s;
    },

    // 重新应用（设置保存后调用）
    reapply() {
        if (this.cached) {
            document.body.setAttribute('data-theme', this.cached.theme || 'dark');
            applyAccentColor(this.cached.accent_color || this.cached.AccentColor || DEFAULT_ACCENT, this.cached.theme || 'dark');
            const pf = this.cached.player_font || 'system-ui';
            document.documentElement.style.setProperty('--player-font', pf);
            document.body.style.fontFamily = `${pf}, ${FONT_FALLBACK}`;
            if (this.cached.lyrics_font) {
                document.documentElement.style.setProperty('--lyrics-font', this.cached.lyrics_font);
            }
            const uiScale = (this.cached.ui_scale && this.cached.ui_scale >= 20 && this.cached.ui_scale <= 500) ? this.cached.ui_scale : 135;
            const lyricsScale = (this.cached.lyrics_scale && this.cached.lyrics_scale >= 20 && this.cached.lyrics_scale <= 500) ? this.cached.lyrics_scale : 135;
            const baseSize = 14 * uiScale / 100;
            const lyricsSize = 16 * lyricsScale / 100;
            document.documentElement.style.setProperty('--base-font-size', baseSize + 'px');
            document.body.style.setProperty('--base-font-size', baseSize + 'px');
            document.documentElement.style.setProperty('--lyrics-font-size', lyricsSize + 'px');
            document.body.style.setProperty('--lyrics-font-size', lyricsSize + 'px');
            // 关键：直接设置 <html> 的 font-size，让所有 rem 单位跟随缩放
            document.documentElement.style.fontSize = baseSize + 'px';

            // 全屏歌词切换动画
            applyLyricAnimation(this.cached.lyric_animation);
        }
    },

    // 暴露给外部调用：仅更新主题色（设置页颜色选择器实时预览用）
    applyAccentColor(color, theme) {
        applyAccentColor(color, theme);
    }
};

window.MusicLiteSettings = SettingsManager;
// 暴露对比度调整器，供 player.js 在 loadTrack 时调用
window.MusicLiteSettings.PlayerContrast = PlayerContrast;

// 页面加载时自动应用
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => SettingsManager.apply());
} else {
    SettingsManager.apply();
}

// 同步设置歌词动画 body class（在 DOMContentLoaded 之前就应用，避免歌词渲染时 class 缺失）
// 先应用默认 fade，等 SettingsManager.apply() 完成后再用实际设置覆盖
(function syncApplyLyricAnimClass() {
    const body = document.body;
    if (!body) return;
    const toRemove = [];
    body.classList.forEach(c => { if (c.startsWith('lyric-anim-')) toRemove.push(c); });
    toRemove.forEach(c => body.classList.remove(c));
    body.classList.add('lyric-anim-fade');
    // 尝试从 localStorage 读取已保存的动画设置
    try {
        const saved = localStorage.getItem('musicLite.lyricAnimation');
        if (saved && ['fade','slide-up','slide-left','zoom','bounce','flip','rotate','none'].includes(saved)) {
            body.classList.remove('lyric-anim-fade');
            body.classList.add('lyric-anim-' + saved);
        }
    } catch (e) {}
})();
