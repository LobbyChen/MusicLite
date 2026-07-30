import { LoadSettings } from '../../wailsjs/go/main/App.js';

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
}

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

        // 基准字号 & 歌词字号
        const baseSize = (s.base_font_size && s.base_font_size >= 12 && s.base_font_size <= 22) ? s.base_font_size : 14;
        const lyricsSize = (s.lyrics_font_size && s.lyrics_font_size >= 12 && s.lyrics_font_size <= 40) ? s.lyrics_font_size : 16;
        document.documentElement.style.setProperty('--base-font-size', baseSize + 'px');
        document.body.style.setProperty('--base-font-size', baseSize + 'px');
        document.documentElement.style.setProperty('--lyrics-font-size', lyricsSize + 'px');
        document.body.style.setProperty('--lyrics-font-size', lyricsSize + 'px');

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
            const baseSize = (this.cached.base_font_size && this.cached.base_font_size >= 12 && this.cached.base_font_size <= 22) ? this.cached.base_font_size : 14;
            const lyricsSize = (this.cached.lyrics_font_size && this.cached.lyrics_font_size >= 12 && this.cached.lyrics_font_size <= 40) ? this.cached.lyrics_font_size : 16;
            document.documentElement.style.setProperty('--base-font-size', baseSize + 'px');
            document.body.style.setProperty('--base-font-size', baseSize + 'px');
            document.documentElement.style.setProperty('--lyrics-font-size', lyricsSize + 'px');
            document.body.style.setProperty('--lyrics-font-size', lyricsSize + 'px');
        }
    },

    // 暴露给外部调用：仅更新主题色（设置页颜色选择器实时预览用）
    applyAccentColor(color, theme) {
        applyAccentColor(color, theme);
    }
};

window.MusicLiteSettings = SettingsManager;

// 页面加载时自动应用
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => SettingsManager.apply());
} else {
    SettingsManager.apply();
}
