// 主题与配色：内置主题调色板、hex/HSL 工具、主题色应用与保存栏对比度
import { PlayerContrast } from './player-contrast.js';

export const DEFAULT_ACCENT = '#1db954';

// 三种内置主题的固定配色（不随自定义主题色变化）
export const THEME_PALETTES = {
    dark: {
        '--bg-color':       '#121212',
        '--card-bg':        '#1e1e1e',
        '--text-primary':   '#ffffff',
        '--text-secondary': '#b3b3b3',
        '--accent-color':   '#1db954',
        '--accent-hover':   '#1a9e47',
        '--accent-glow':    '#1db95455',
        '--border-color':   '#333333',
        '--hover-color':    '#2a2a2a',
    },
    light: {
        '--bg-color':       '#fafafa',
        '--card-bg':        '#ffffff',
        '--text-primary':   '#121212',
        '--text-secondary': '#666666',
        '--accent-color':   '#1db954',
        '--accent-hover':   '#1a9e47',
        '--accent-glow':    '#1db95455',
        '--border-color':   '#e0e0e0',
        '--hover-color':    '#f5f5f5',
    },
    accent: {
        '--bg-color':       '#0a1f0a',
        '--card-bg':        '#142814',
        '--text-primary':   '#e0ffe0',
        '--text-secondary': '#a0d0a0',
        '--accent-color':   '#2ecc71',
        '--accent-hover':   '#27ae60',
        '--accent-glow':    '#2ecc7155',
        '--border-color':   '#1a3a1a',
        '--hover-color':    '#1a3a1a',
    },
};
// ============ 颜色工具：hex <-> HSL ============
export function hexToHsl(hex) {
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

export function hslToHex(h, s, l) {
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
export function computePalette(accentHex, theme) {
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
// customMode 仅在使用 custom 主题时生效：'dark' | 'light'
export function applyAccentColor(color, theme, customMode) {
    const t = theme || 'dark';
    const root = document.documentElement;
    const body = document.body;
    let palette;
    if (t === 'custom') {
        // 自定义主题色：从用户选择的颜色计算全套配套色，明暗基调由用户选择
        const c = (color || '').trim() || DEFAULT_ACCENT;
        palette = computePalette(c, customMode === 'light' ? 'light' : 'dark');
    } else if (THEME_PALETTES[t]) {
        // 内置主题：使用固定配色
        palette = THEME_PALETTES[t];
    } else {
        // 未知主题：回退到 dark
        palette = THEME_PALETTES.dark;
    }
    for (const [k, v] of Object.entries(palette)) {
        root.style.setProperty(k, v);
        if (body) body.style.setProperty(k, v);
    }
    // 主题色变化后，如果当前有封面，需要重新评估播放器对比度
    // （因为 --text-primary/--text-secondary 可能变了，但 player-overlay 上的覆盖还在）
    PlayerContrast.reapply();
    // 同时调整设置页 save-bar 的文字对比度（save-bar 背景是 accent-color）
    const accentForContrast = palette['--accent-color'] || DEFAULT_ACCENT;
    adjustSaveBarContrast(accentForContrast);
}

// 设置页 save-bar 背景是 accent-color，当主题色偏亮时白字看不清
// 根据主题色亮度决定 save-bar 文字/按钮颜色
export function adjustSaveBarContrast(accentHex) {
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
