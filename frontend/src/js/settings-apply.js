import { LoadSettings } from '@bindings/MusicLite/app/musicservice.js';
import { initI18n, setLanguage, applyTranslations } from './i18n.js';

const FONT_FALLBACK = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
const DEFAULT_ACCENT = '#1db954';

// 三种内置主题的固定配色（不随自定义主题色变化）
const THEME_PALETTES = {
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

// 应用视觉设计令牌（圆角 / 毛玻璃模糊 / 动画速度 / 阴影 / 辉光 / 字体晕影）
// 写到 <html> 和 <body> inline style，覆盖 :root 上的默认值，让设计器实时生效。
// 同时派生 sm/lg 圆角，保持比例协调。
function applyDesignTokens(radius, blur, animMult, shadow, glow, textGlow) {
    const r = Math.max(0, Math.min(28, Number(radius) || 10));
    const b = Math.max(0, Math.min(40, Number(blur) || 16));
    const m = Math.max(0.3, Math.min(2.5, Number(animMult) || 1));
    const sh = Math.max(0, Math.min(1, Number(shadow) || 0));
    const gl = Math.max(0, Math.min(1, Number(glow) || 0));
    const tg = Math.max(0, Math.min(1, Number(textGlow) || 0));
    // 阴影：强度 0-1 → rgba 透明度 0-1，并派生 strong 变体
    const shadowStr = `0 8px 32px rgba(0, 0, 0, ${sh.toFixed(3)})`;
    const shadowStrongStr = `0 16px 48px rgba(0, 0, 0, ${Math.min(sh * 1.3, 1).toFixed(3)})`;
    // 主题色辉光：强度 0-1 → 扩散范围 0-64px
    const glowStr = `0 0 ${(gl * 64).toFixed(0)}px var(--accent-glow, rgba(29, 185, 84, 0.35))`;
    // 字体晕影：强度 0-1 → text-shadow 0-16px（0 时为 none）
    const textGlowStr = tg > 0.001
        ? `0 0 ${(tg * 16).toFixed(0)}px var(--accent-color)`
        : 'none';
    const targets = [document.documentElement, document.body];
    for (const el of targets) {
        if (!el) continue;
        el.style.setProperty('--design-radius', r + 'px');
        el.style.setProperty('--design-radius-sm', (r * 0.6).toFixed(2) + 'px');
        el.style.setProperty('--design-radius-lg', (r * 1.6).toFixed(2) + 'px');
        el.style.setProperty('--design-blur', b + 'px');
        el.style.setProperty('--design-anim-mult', String(m));
        el.style.setProperty('--design-shadow', shadowStr);
        el.style.setProperty('--design-shadow-strong', shadowStrongStr);
        el.style.setProperty('--design-glow', glowStr);
        el.style.setProperty('--design-text-glow', textGlowStr);
    }
    // 持久化到 localStorage，供首屏快速恢复（避免闪到默认值）
    try {
        localStorage.setItem('musicLite.designRadius', String(r));
        localStorage.setItem('musicLite.designBlur', String(b));
        localStorage.setItem('musicLite.designAnimMult', String(m));
        localStorage.setItem('musicLite.designShadow', String(sh));
        localStorage.setItem('musicLite.designGlow', String(gl));
        localStorage.setItem('musicLite.designTextGlow', String(tg));
    } catch (e) {}
}

// 应用界面动画级别（0-3）：设置 body[data-anim] 与兼容的 .no-anim 类
function applyAnimationLevel(level) {
    if (!document.body) return;
    const clamped = Math.max(0, Math.min(3, level | 0));
    document.body.setAttribute('data-anim', clamped.toString());
    // 兼容旧逻辑：级别 0 时加 .no-anim（让原 no-anim 规则也生效）
    document.body.classList.toggle('no-anim', clamped === 0);
    // 持久化到 localStorage，供页面加载时同步读取（避免首屏闪烁）
    try { localStorage.setItem('musicLite.animationsLevel', clamped.toString()); } catch (e) {}
    // 兼容旧 localStorage key（避免旧逻辑读不到）
    try { localStorage.setItem('musicLite.animationsEnabled', clamped === 0 ? '0' : '1'); } catch (e) {}
    return clamped;
}

// 应用设置界面布局模式（scroll / columns / tabs）—— 仅设置页生效
function applySettingsLayout(mode) {
    const valid = ['scroll', 'columns', 'tabs'];
    const m = valid.includes(mode) ? mode : 'scroll';
    if (document.body) {
        // 只有设置页才应用布局模式，其他页面不设置 data-settings-layout
        if (document.body.getAttribute('data-page') === 'settings') {
            document.body.setAttribute('data-settings-layout', m);
        }
    }
    try { localStorage.setItem('musicLite.settingsLayout', m); } catch (e) {}
}

// 应用新风格 UI 开关
function applyNewUI(enabled) {
    if (document.body) {
        document.body.setAttribute('data-new-ui', enabled ? 'true' : 'false');
    }
    try { localStorage.setItem('musicLite.newUIEnabled', enabled ? '1' : '0'); } catch (e) {}
}

// BgFit 内部映射：友好标识 → object-fit 实际属性（UI 不暴露属性名）
const BG_FIT_TO_OBJECT_FIT = {
    cover: 'cover',
    contain: 'contain',
    fill: 'fill',
    none: 'none',
    scaledown: 'scale-down',
};

// 注入背景相关公共 CSS（只注入一次）
let _bgCssInjected = false;
function injectBgCSSOnce() {
    if (_bgCssInjected) return;
    _bgCssInjected = true;
    const css = `
/* ===== MusicLite 全局背景层（img/video）基础样式 ===== */
#ml-bg-layer, #ml-bg-overlay {
    position: fixed;
    inset: 0;
    width: 100vw;
    height: 100vh;
    pointer-events: none;
    overflow: hidden;
}
#ml-bg-layer {
    z-index: -2;
    transform-origin: center center;
    will-change: transform, opacity, filter;
}
#ml-bg-overlay {
    z-index: -1;
}
html, body {
    isolation: isolate;
}
/* ============ 整窗 Aero 透明（核心重构）============
   原方案：html { opacity: x } 让所有元素一起透明 → 文字发虚不可读
   新方案：html[data-aero="true"] 标记后，仅让 body 和各容器的背景色变为半透明，
          透出 WebView2 窗口下的桌面；同时给主要容器加 backdrop-filter 毛玻璃，
          实现真正的 Windows Aero 效果：背景朦胧通透，前景文字清晰锐利。
   --aero-*-alpha 控制各层背景色透明度（0=完全透出桌面, 1=完全不透明），
   由 applyWindowAlpha() 根据 window_alpha 值动态计算。 */
html[data-aero="true"] body {
    background-color: color-mix(in srgb, var(--bg-color, #121212) calc(var(--aero-bg-alpha, 1) * 100%), transparent) !important;
}

/* ========== Aero 增强：玻璃质感内发光边框 ==========
   用 box-shadow inset 模拟玻璃边缘的高光/暗角，让半透明容器不只是"透"，而是"玻璃"。
   深色主题 → 顶边 10% 白高光 + 底边 10% 黑暗角
   浅色主题 → 顶边 35% 白高光 + 底边 15% 黑暗角（浅色更需要边框高光区分边界）*/
html[data-aero="true"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .media-card,
html[data-aero="true"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .media-list-item,
html[data-aero="true"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .settings-section,
html[data-aero="true"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .designer-sidebar,
html[data-aero="true"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .designer-toolbar,
html[data-aero="true"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .search-box,
html[data-aero="true"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .sort-control,
html[data-aero="true"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .view-toggle,
html[data-aero="true"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .tab-panel,
html[data-aero="true"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .save-bar,
html[data-aero="true"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .modal,
html[data-aero="true"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .context-menu,
html[data-aero="true"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .toast,
html[data-aero="true"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .lib-queue-sidebar,
html[data-aero="true"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .eq-panel,
html[data-aero="true"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .queue-panel {
    box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, calc(var(--aero-border-alpha, 0.5) * 0.18)),
        inset 0 -1px 0 rgba(0, 0, 0, calc(var(--aero-border-alpha, 0.5) * 0.22)),
        0 4px 24px rgba(0, 0, 0, calc(var(--aero-border-alpha, 0.5) * 0.22)) !important;
}
html[data-aero="true"][data-theme="light"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .media-card,
html[data-aero="true"][data-theme="light"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .media-list-item,
html[data-aero="true"][data-theme="light"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .settings-section,
html[data-aero="true"][data-theme="light"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .designer-sidebar,
html[data-aero="true"][data-theme="light"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .designer-toolbar,
html[data-aero="true"][data-theme="light"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .search-box,
html[data-aero="true"][data-theme="light"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .sort-control,
html[data-aero="true"][data-theme="light"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .view-toggle,
html[data-aero="true"][data-theme="light"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .tab-panel,
html[data-aero="true"][data-theme="light"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .save-bar,
html[data-aero="true"][data-theme="light"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .modal,
html[data-aero="true"][data-theme="light"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .context-menu,
html[data-aero="true"][data-theme="light"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .toast,
html[data-aero="true"][data-theme="light"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .lib-queue-sidebar,
html[data-aero="true"][data-theme="light"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .eq-panel,
html[data-aero="true"][data-theme="light"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .queue-panel {
    box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, calc(var(--aero-border-alpha, 0.5) * 0.55)),
        inset 0 -1px 0 rgba(0, 0, 0, calc(var(--aero-border-alpha, 0.5) * 0.10)),
        0 4px 20px rgba(0, 0, 0, calc(var(--aero-border-alpha, 0.5) * 0.10)) !important;
}
/* 面板级（main / header / winui3-nav）玻璃边框：高光更柔 */
html[data-aero="true"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .winui3-nav,
html[data-aero="true"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) main,
html[data-aero="true"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .library-sidebar,
html[data-aero="true"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) header,
html[data-aero="true"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .settings-tabs,
html[data-aero="true"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .player-overlay,
html[data-aero="true"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .fullscreen-lyrics {
    box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, calc(var(--aero-border-alpha, 0.5) * 0.10)),
        inset 0 -1px 0 rgba(0, 0, 0, calc(var(--aero-border-alpha, 0.5) * 0.12)) !important;
}
/* 标题栏 + 迷你播放器：玻璃质感更强（作为"系统级"条带）*/
html[data-aero="true"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .titlebar,
html[data-aero="true"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .mini-player {
    box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, calc(var(--aero-border-alpha, 0.5) * 0.22)),
        inset 0 -1px 0 rgba(0, 0, 0, calc(var(--aero-border-alpha, 0.5) * 0.28)),
        0 -2px 18px rgba(0, 0, 0, calc(var(--aero-border-alpha, 0.5) * 0.20)) !important;
}

/* ========== 修复A：关闭毛玻璃时，全局通杀 * 所有元素的 backdrop-filter，一个不漏 ========== */
html[data-glass-disabled="true"],
html[data-glass-disabled="true"] * {
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
}
/* ========== 修复B：关闭毛玻璃时，清除多余 box-shadow / border / outline ========== */
html[data-glass-disabled="true"] .media-card,
html[data-glass-disabled="true"] .media-list-item,
html[data-glass-disabled="true"] .settings-section,
html[data-glass-disabled="true"] .winui3-nav,
html[data-glass-disabled="true"] main,
html[data-glass-disabled="true"] .mini-player,
html[data-glass-disabled="true"] .library-sidebar,
html[data-glass-disabled="true"] .save-bar,
html[data-glass-disabled="true"] .search-box,
html[data-glass-disabled="true"] .tab-panel,
html[data-glass-disabled="true"] .designer-sidebar,
html[data-glass-disabled="true"] .designer-toolbar,
html[data-glass-disabled="true"] .modal,
html[data-glass-disabled="true"] .toast,
html[data-glass-disabled="true"] .context-menu {
    box-shadow: none !important;
    border: none !important;
    outline: none !important;
}

/* ========== 启用毛玻璃：主要容器加 backdrop-filter ==========
   两种场景生效：「有自定义背景图」或「Aero 窗口透明已开启」
   —— 性能优化：仅对小面积容器使用 blur，移除 saturate/brightness 减少GPU开销 ——
   注意：player-overlay / fullscreen-lyrics 不加 backdrop-filter！
   它们是全屏元素，backdrop-filter 会导致 GPU 每帧对全屏纹理做模糊，占用率飙升到 90%。
   它们已有 player-bg-layer（模糊封面背景）提供视觉深度，不需要额外 backdrop-filter。 */
html[data-has-bg="true"]:not([data-glass-disabled="true"]) .media-card,
html[data-has-bg="true"]:not([data-glass-disabled="true"]) .media-list-item,
html[data-has-bg="true"]:not([data-glass-disabled="true"]) .save-bar,
html[data-has-bg="true"]:not([data-glass-disabled="true"]) .modal-dialog,
html[data-has-bg="true"]:not([data-glass-disabled="true"]) .modal-content,
html[data-has-bg="true"]:not([data-glass-disabled="true"]) .context-menu,
html[data-has-bg="true"]:not([data-glass-disabled="true"]) .settings-section,
html[data-has-bg="true"]:not([data-glass-disabled="true"]) .mini-player,
html[data-has-bg="true"]:not([data-glass-disabled="true"]) .toast,
html[data-has-bg="true"]:not([data-glass-disabled="true"]) .designer-sidebar,
html[data-has-bg="true"]:not([data-glass-disabled="true"]) .designer-toolbar,
html[data-has-bg="true"]:not([data-glass-disabled="true"]) .tab-panel,
html[data-has-bg="true"]:not([data-glass-disabled="true"]) .search-box,
html[data-has-bg="true"]:not([data-glass-disabled="true"]) .sort-control,
html[data-has-bg="true"]:not([data-glass-disabled="true"]) .view-toggle,
html[data-has-bg="true"]:not([data-glass-disabled="true"]) main,
html[data-has-bg="true"]:not([data-glass-disabled="true"]) header,
html[data-has-bg="true"]:not([data-glass-disabled="true"]) .winui3-nav,
html[data-has-bg="true"]:not([data-glass-disabled="true"]) .settings-main,
html[data-has-bg="true"]:not([data-glass-disabled="true"]) .library-sidebar,
html[data-has-bg="true"]:not([data-glass-disabled="true"]) .settings-tabs,
/* ↓↓↓ Aero 透明模式下也启用毛玻璃，即使没有自定义背景 ↓↓↓ */
html[data-aero="true"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .media-card,
html[data-aero="true"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .media-list-item,
html[data-aero="true"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .save-bar,
html[data-aero="true"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .modal-dialog,
html[data-aero="true"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .modal-content,
html[data-aero="true"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .context-menu,
html[data-aero="true"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .settings-section,
html[data-aero="true"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .mini-player,
html[data-aero="true"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .toast,
html[data-aero="true"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .designer-sidebar,
html[data-aero="true"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .designer-toolbar,
html[data-aero="true"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .tab-panel,
html[data-aero="true"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .search-box,
html[data-aero="true"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .sort-control,
html[data-aero="true"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .view-toggle,
html[data-aero="true"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) main,
html[data-aero="true"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) header,
html[data-aero="true"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .winui3-nav,
html[data-aero="true"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .settings-main,
html[data-aero="true"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .library-sidebar,
html[data-aero="true"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .settings-tabs,
html[data-aero="true"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .titlebar,
html[data-aero="true"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .modal,
html[data-aero="true"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .lib-queue-sidebar,
html[data-aero="true"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .eq-panel,
html[data-aero="true"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .queue-panel {
    backdrop-filter: blur(var(--design-blur, 16px));
    -webkit-backdrop-filter: blur(var(--design-blur, 16px));
}
/* Aero 模式下：使用独立的 --aero-blur 覆盖 --design-blur */
html[data-aero="true"]:not([data-glass-disabled="true"]) .media-card,
html[data-aero="true"]:not([data-glass-disabled="true"]) .media-list-item,
html[data-aero="true"]:not([data-glass-disabled="true"]) .save-bar,
html[data-aero="true"]:not([data-glass-disabled="true"]) .modal-dialog,
html[data-aero="true"]:not([data-glass-disabled="true"]) .modal-content,
html[data-aero="true"]:not([data-glass-disabled="true"]) .context-menu,
html[data-aero="true"]:not([data-glass-disabled="true"]) .settings-section,
html[data-aero="true"]:not([data-glass-disabled="true"]) .mini-player,
html[data-aero="true"]:not([data-glass-disabled="true"]) .toast,
html[data-aero="true"]:not([data-glass-disabled="true"]) .designer-sidebar,
html[data-aero="true"]:not([data-glass-disabled="true"]) .designer-toolbar,
html[data-aero="true"]:not([data-glass-disabled="true"]) .tab-panel,
html[data-aero="true"]:not([data-glass-disabled="true"]) .search-box,
html[data-aero="true"]:not([data-glass-disabled="true"]) .sort-control,
html[data-aero="true"]:not([data-glass-disabled="true"]) .view-toggle,
html[data-aero="true"]:not([data-glass-disabled="true"]) main,
html[data-aero="true"]:not([data-glass-disabled="true"]) header,
html[data-aero="true"]:not([data-glass-disabled="true"]) .winui3-nav,
html[data-aero="true"]:not([data-glass-disabled="true"]) .settings-main,
html[data-aero="true"]:not([data-glass-disabled="true"]) .library-sidebar,
html[data-aero="true"]:not([data-glass-disabled="true"]) .settings-tabs,
html[data-aero="true"]:not([data-glass-disabled="true"]) .titlebar,
html[data-aero="true"]:not([data-glass-disabled="true"]) .modal,
html[data-aero="true"]:not([data-glass-disabled="true"]) .lib-queue-sidebar,
html[data-aero="true"]:not([data-glass-disabled="true"]) .eq-panel,
html[data-aero="true"]:not([data-glass-disabled="true"]) .queue-panel {
    backdrop-filter: blur(var(--aero-blur, var(--design-blur, 16px)));
    -webkit-backdrop-filter: blur(var(--aero-blur, var(--design-blur, 16px)));
}
/* aero_blur=0 时：完全禁用 backdrop-filter，降低 GPU 占用 */
html[data-aero-blur-disabled="true"] .media-card,
html[data-aero-blur-disabled="true"] .media-list-item,
html[data-aero-blur-disabled="true"] .save-bar,
html[data-aero-blur-disabled="true"] .modal-dialog,
html[data-aero-blur-disabled="true"] .modal-content,
html[data-aero-blur-disabled="true"] .context-menu,
html[data-aero-blur-disabled="true"] .settings-section,
html[data-aero-blur-disabled="true"] .mini-player,
html[data-aero-blur-disabled="true"] .toast,
html[data-aero-blur-disabled="true"] .designer-sidebar,
html[data-aero-blur-disabled="true"] .designer-toolbar,
html[data-aero-blur-disabled="true"] .tab-panel,
html[data-aero-blur-disabled="true"] .search-box,
html[data-aero-blur-disabled="true"] .sort-control,
html[data-aero-blur-disabled="true"] .view-toggle,
html[data-aero-blur-disabled="true"] main,
html[data-aero-blur-disabled="true"] header,
html[data-aero-blur-disabled="true"] .winui3-nav,
html[data-aero-blur-disabled="true"] .settings-main,
html[data-aero-blur-disabled="true"] .library-sidebar,
html[data-aero-blur-disabled="true"] .settings-tabs,
html[data-aero-blur-disabled="true"] .titlebar,
html[data-aero-blur-disabled="true"] .modal,
html[data-aero-blur-disabled="true"] .lib-queue-sidebar,
html[data-aero-blur-disabled="true"] .eq-panel,
html[data-aero-blur-disabled="true"] .queue-panel {
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
}
/* player-overlay / fullscreen-lyrics：强制禁用 backdrop-filter，防止全屏时 GPU 飙升 */
html[data-aero="true"]:not([data-has-bg="true"]) .player-overlay,
html[data-aero="true"]:not([data-has-bg="true"]) .fullscreen-lyrics,
html[data-has-bg="true"] .player-overlay,
html[data-has-bg="true"] .fullscreen-lyrics {
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
}

/* ========== Aero 窗口透明 + 无自定义背景：让所有主要容器底色降为半透明，透出桌面 ==========
   深色主题（默认） */
html[data-aero="true"]:not([data-has-bg="true"]) body {
    background-color: color-mix(in srgb, var(--bg-color, #121212) calc(var(--aero-body-alpha, 0.5) * 100%), transparent) !important;
}
html[data-aero="true"]:not([data-has-bg="true"]) .media-card,
html[data-aero="true"]:not([data-has-bg="true"]) .media-list-item,
html[data-aero="true"]:not([data-has-bg="true"]) .settings-section,
html[data-aero="true"]:not([data-has-bg="true"]) .designer-sidebar,
html[data-aero="true"]:not([data-has-bg="true"]) .designer-toolbar,
html[data-aero="true"]:not([data-has-bg="true"]) .search-box,
html[data-aero="true"]:not([data-has-bg="true"]) .sort-control,
html[data-aero="true"]:not([data-has-bg="true"]) .view-toggle,
html[data-aero="true"]:not([data-has-bg="true"]) .tab-panel,
html[data-aero="true"]:not([data-has-bg="true"]) .save-bar,
html[data-aero="true"]:not([data-has-bg="true"]) .lib-queue-sidebar,
html[data-aero="true"]:not([data-has-bg="true"]) .eq-panel,
html[data-aero="true"]:not([data-has-bg="true"]) .queue-panel {
    background-color: color-mix(in srgb, var(--card-bg, #1e1e1e) calc(var(--aero-card-alpha, 0.65) * 100%), transparent) !important;
    border: 1px solid color-mix(in srgb, var(--border-color, #333) calc(var(--aero-border-alpha, 0.5) * 100%), rgba(255,255,255,0.08)) !important;
}
/* —— 修复 UI 问题 1：modal 弹窗 Aero 半透明 + 毛玻璃（之前遗漏，导致全黑块破坏通透感）—— */
html[data-aero="true"]:not([data-has-bg="true"]) .modal,
html[data-aero="true"]:not([data-has-bg="true"]) .context-menu,
html[data-aero="true"]:not([data-has-bg="true"]) .toast {
    background-color: color-mix(in srgb, var(--card-bg, #1e1e1e) calc(var(--aero-modal-alpha, 0.7) * 100%), transparent) !important;
    border: 1px solid color-mix(in srgb, var(--border-color, #333) calc(var(--aero-border-alpha, 0.5) * 100%), rgba(255,255,255,0.12)) !important;
}
/* —— 修复 UI 问题 2：modal-backdrop 遮罩在 Aero 下也要半透明，不能全黑 —— */
html[data-aero="true"]:not([data-has-bg="true"]) .modal-backdrop.active {
    background-color: color-mix(in srgb, #000000 calc(var(--aero-overlay-alpha, 0.4) * 100%), transparent) !important;
    backdrop-filter: blur(2px) saturate(110%);
    -webkit-backdrop-filter: blur(2px) saturate(110%);
}
/* 浅色主题 */
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .media-card,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .media-list-item,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .settings-section,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .designer-sidebar,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .designer-toolbar,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .search-box,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .sort-control,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .view-toggle,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .tab-panel,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .save-bar,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .lib-queue-sidebar,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .eq-panel,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .queue-panel {
    background-color: color-mix(in srgb, var(--card-bg, #ffffff) calc(var(--aero-card-alpha, 0.7) * 100%), transparent) !important;
    border: 1px solid color-mix(in srgb, var(--border-color, #e0e0e0) calc(var(--aero-border-alpha, 0.5) * 100%), rgba(0,0,0,0.06)) !important;
}
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .modal,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .context-menu,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .toast {
    background-color: color-mix(in srgb, var(--card-bg, #ffffff) calc(var(--aero-modal-alpha, 0.8) * 100%), transparent) !important;
    border: 1px solid color-mix(in srgb, var(--border-color, #e0e0e0) calc(var(--aero-border-alpha, 0.5) * 100%), rgba(0,0,0,0.08)) !important;
}
/* 墨绿(accent)主题 */
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .media-card,
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .media-list-item,
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .settings-section,
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .designer-sidebar,
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .designer-toolbar,
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .search-box,
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .sort-control,
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .view-toggle,
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .tab-panel,
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .save-bar,
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .lib-queue-sidebar,
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .eq-panel,
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .queue-panel {
    background-color: color-mix(in srgb, var(--card-bg, #142814) calc(var(--aero-card-alpha, 0.7) * 100%), transparent) !important;
    border: 1px solid color-mix(in srgb, var(--border-color, #1a3a1a) calc(var(--aero-border-alpha, 0.5) * 100%), rgba(255,255,255,0.05)) !important;
}
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .modal,
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .context-menu,
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .toast {
    background-color: color-mix(in srgb, var(--card-bg, #142814) calc(var(--aero-modal-alpha, 0.75) * 100%), transparent) !important;
    border: 1px solid color-mix(in srgb, var(--border-color, #1a3a1a) calc(var(--aero-border-alpha, 0.5) * 100%), rgba(255,255,255,0.08)) !important;
}

/* WinUI3 侧边栏 / main / library-sidebar —— Aero 透明时半透明化 */
html[data-aero="true"]:not([data-has-bg="true"]) .winui3-nav,
html[data-aero="true"]:not([data-has-bg="true"]) main,
html[data-aero="true"]:not([data-has-bg="true"]) .library-sidebar {
    background-color: color-mix(in srgb, var(--bg-color, #121212) calc(var(--aero-panel-alpha, 0.45) * 100%), transparent) !important;
}
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .winui3-nav,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) main,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .library-sidebar {
    background-color: color-mix(in srgb, var(--bg-color, #fafafa) calc(var(--aero-panel-alpha, 0.5) * 100%), transparent) !important;
}
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .winui3-nav,
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) main,
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .library-sidebar {
    background-color: color-mix(in srgb, var(--bg-color, #0a1f0a) calc(var(--aero-panel-alpha, 0.5) * 100%), transparent) !important;
}

/* header / settings-tabs —— Aero 透明时半透明化（条带类，用 panel-alpha 即可） */
html[data-aero="true"]:not([data-has-bg="true"]) header,
html[data-aero="true"]:not([data-has-bg="true"]) .settings-tabs {
    background-color: color-mix(in srgb, var(--bg-color, #121212) calc(var(--aero-panel-alpha, 0.45) * 100%), transparent) !important;
}
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) header,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .settings-tabs {
    background-color: color-mix(in srgb, var(--bg-color, #fafafa) calc(var(--aero-panel-alpha, 0.5) * 100%), transparent) !important;
}
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) header,
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .settings-tabs {
    background-color: color-mix(in srgb, var(--bg-color, #0a1f0a) calc(var(--aero-panel-alpha, 0.5) * 100%), transparent) !important;
}

/* —— 修复：player-overlay / fullscreen-lyrics 使用 modal 级高不透明度 ——
   它们是全屏覆盖层，之前用 panel-alpha（最低 0.10）导致几乎完全透明，
   桌面壁纸直接透出，歌词/封面/控件根本看不清。
   改用 --aero-modal-alpha（0.50-0.90），确保内容可读性的同时保留通透感。 */
html[data-aero="true"]:not([data-has-bg="true"]) .player-overlay,
html[data-aero="true"]:not([data-has-bg="true"]) .fullscreen-lyrics {
    background-color: color-mix(in srgb, var(--bg-color, #121212) calc(var(--aero-modal-alpha, 0.7) * 100%), transparent) !important;
}
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .player-overlay,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .fullscreen-lyrics {
    background-color: color-mix(in srgb, var(--bg-color, #fafafa) calc(var(--aero-modal-alpha, 0.75) * 100%), transparent) !important;
}
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .player-overlay,
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .fullscreen-lyrics {
    background-color: color-mix(in srgb, var(--bg-color, #0a1f0a) calc(var(--aero-modal-alpha, 0.72) * 100%), transparent) !important;
}

/* player-bg-layer（模糊封面背景层）在 Aero 下保持高不透明度，作为播放器的视觉基底 */
html[data-aero="true"]:not([data-has-bg="true"]) .player-bg-layer {
    opacity: 0.85 !important;
}

/* 迷你播放器 —— Aero 透明时半透明化 */
html[data-aero="true"]:not([data-has-bg="true"]) .mini-player {
    background-color: color-mix(in srgb, var(--card-bg, #1e1e1e) calc(var(--aero-mini-alpha, 0.75) * 100%), transparent) !important;
    border-top: 1px solid color-mix(in srgb, var(--border-color, #333) calc(var(--aero-border-alpha, 0.5) * 100%), rgba(255,255,255,0.10)) !important;
}
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .mini-player {
    background-color: color-mix(in srgb, var(--card-bg, #ffffff) calc(var(--aero-mini-alpha, 0.8) * 100%), transparent) !important;
    border-top: 1px solid color-mix(in srgb, var(--border-color, #e0e0e0) calc(var(--aero-border-alpha, 0.5) * 100%), rgba(0,0,0,0.06)) !important;
}
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .mini-player {
    background-color: color-mix(in srgb, var(--card-bg, #142814) calc(var(--aero-mini-alpha, 0.8) * 100%), transparent) !important;
    border-top: 1px solid color-mix(in srgb, var(--border-color, #1a3a1a) calc(var(--aero-border-alpha, 0.5) * 100%), rgba(255,255,255,0.06)) !important;
}

/* 标题栏 —— Aero 透明时半透明化（保持自绘边框的边界感） */
html[data-aero="true"]:not([data-has-bg="true"]) .titlebar {
    background-color: color-mix(in srgb, var(--card-bg, #1e1e1e) calc(var(--aero-titlebar-alpha, 0.6) * 100%), transparent) !important;
    border-bottom: 1px solid color-mix(in srgb, var(--border-color, #333) calc(var(--aero-border-alpha, 0.5) * 100%), rgba(255,255,255,0.10)) !important;
}
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .titlebar {
    background-color: color-mix(in srgb, var(--card-bg, #ffffff) calc(var(--aero-titlebar-alpha, 0.65) * 100%), transparent) !important;
    border-bottom: 1px solid color-mix(in srgb, var(--border-color, #e0e0e0) calc(var(--aero-border-alpha, 0.5) * 100%), rgba(0,0,0,0.06)) !important;
}
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .titlebar {
    background-color: color-mix(in srgb, var(--card-bg, #142814) calc(var(--aero-titlebar-alpha, 0.6) * 100%), transparent) !important;
    border-bottom: 1px solid color-mix(in srgb, var(--border-color, #1a3a1a) calc(var(--aero-border-alpha, 0.5) * 100%), rgba(255,255,255,0.06)) !important;
}

/* —— 修复 UI 问题 3：Aero 下文字对比度保障（避免通透导致文字与桌面混色不可读）——
   当窗口透明度很低（<0.5，即 data-window-alpha 存在但背景很透）时，
   给正文文字和二级文字加非常淡的轮廓阴影（不是发光，是锐边衬底）。
   注意：不使用 drop-shadow 影响性能，只用 text-shadow 1px 偏移模拟 1px 描边 */
html[data-aero="true"]:not([data-has-bg="true"]) .track-name,
html[data-aero="true"]:not([data-has-bg="true"]) .mini-title,
html[data-aero="true"]:not([data-has-bg="true"]) .card-title,
html[data-aero="true"]:not([data-has-bg="true"]) .list-item-title,
html[data-aero="true"]:not([data-has-bg="true"]) .modal h3,
html[data-aero="true"]:not([data-has-bg="true"]) .modal p,
html[data-aero="true"]:not([data-has-bg="true"]) .toast-message,
html[data-aero="true"]:not([data-has-bg="true"]) h1,
html[data-aero="true"]:not([data-has-bg="true"]) h2 {
    text-shadow:
        0 1px 1px rgba(0, 0, 0, calc((1 - var(--aero-modal-alpha, 0.7)) * 0.35)),
        0 -1px 0 rgba(255, 255, 255, calc((1 - var(--aero-modal-alpha, 0.7)) * 0.04));
}
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .track-name,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .mini-title,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .card-title,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .list-item-title,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .modal h3,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .modal p,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .toast-message,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) h1,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) h2 {
    text-shadow:
        0 1px 1px rgba(255, 255, 255, calc((1 - var(--aero-modal-alpha, 0.7)) * 0.45)),
        0 -1px 0 rgba(0, 0, 0, calc((1 - var(--aero-modal-alpha, 0.7)) * 0.04));
}

/* ========== Aero 增强 4：设计师页面预览面板、设置页区块半透明化 ========== */
html[data-aero="true"]:not([data-has-bg="true"]) .designer-preview-aside,
html[data-aero="true"]:not([data-has-bg="true"]) .designer-preview-card,
html[data-aero="true"]:not([data-has-bg="true"]) .designer-preview-panel,
html[data-aero="true"]:not([data-has-bg="true"]) .designer-anim-demo,
html[data-aero="true"]:not([data-has-bg="true"]) .font-preview,
html[data-aero="true"]:not([data-has-bg="true"]) .hotkey-item {
    background-color: color-mix(in srgb, var(--card-bg, #1e1e1e) calc(var(--aero-card-alpha, 0.7) * 100%), transparent) !important;
    border: 1px solid color-mix(in srgb, var(--border-color, #333) calc(var(--aero-border-alpha, 0.5) * 100%), rgba(255,255,255,0.08)) !important;
}
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .designer-preview-aside,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .designer-preview-card,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .designer-preview-panel,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .designer-anim-demo,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .font-preview,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .hotkey-item {
    background-color: color-mix(in srgb, var(--card-bg, #ffffff) calc(var(--aero-card-alpha, 0.75) * 100%), transparent) !important;
    border: 1px solid color-mix(in srgb, var(--border-color, #e0e0e0) calc(var(--aero-border-alpha, 0.5) * 100%), rgba(0,0,0,0.06)) !important;
}
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .designer-preview-aside,
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .designer-preview-card,
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .designer-preview-panel,
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .designer-anim-demo,
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .font-preview,
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .hotkey-item {
    background-color: color-mix(in srgb, var(--card-bg, #142814) calc(var(--aero-card-alpha, 0.72) * 100%), transparent) !important;
    border: 1px solid color-mix(in srgb, var(--border-color, #1a3a1a) calc(var(--aero-border-alpha, 0.5) * 100%), rgba(255,255,255,0.05)) !important;
}

/* ========== Aero 增强 5：表单输入控件（滑块底色、输入框背景）半透明化 ========== */
html[data-aero="true"]:not([data-has-bg="true"]) .form-input,
html[data-aero="true"]:not([data-has-bg="true"]) .form-textarea,
html[data-aero="true"]:not([data-has-bg="true"]) .text-input,
html[data-aero="true"]:not([data-has-bg="true"]) .font-select,
html[data-aero="true"]:not([data-has-bg="true"]) .color-text {
    background-color: color-mix(in srgb, var(--bg-color, #121212) calc(var(--aero-panel-alpha, 0.5) * 100%), transparent) !important;
    border-color: color-mix(in srgb, var(--border-color, #333) calc(var(--aero-border-alpha, 0.5) * 100%), rgba(255,255,255,0.10)) !important;
}
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .form-input,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .form-textarea,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .text-input,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .font-select,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .color-text {
    background-color: color-mix(in srgb, var(--bg-color, #fafafa) calc(var(--aero-panel-alpha, 0.55) * 100%), transparent) !important;
    border-color: color-mix(in srgb, var(--border-color, #e0e0e0) calc(var(--aero-border-alpha, 0.5) * 100%), rgba(0,0,0,0.06)) !important;
}

/* 滑块轨道底色在 Aero 下也半透明（拇指本身保持实色，确保可交互） */
html[data-aero="true"]:not([data-has-bg="true"]) .setting-slider {
    background-color: color-mix(in srgb, var(--border-color, #333) calc(var(--aero-border-alpha, 0.5) * 100%), transparent) !important;
}

/* ========== Aero 增强 6：保存栏（save-bar）保持高对比度，但边框透出玻璃感 ========== */
html[data-aero="true"]:not([data-has-bg="true"]) .save-bar {
    /* save-bar 用主题色实色底色（强调"需要保存"的状态），仅通过边框柔化玻璃感 */
    border-top: 1px solid color-mix(in srgb, var(--accent-color) calc(var(--aero-border-alpha, 0.5) * 100%), rgba(255,255,255,0.3)) !important;
    box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, calc(var(--aero-border-alpha, 0.5) * 0.25)),
        0 -4px 16px rgba(0, 0, 0, calc(var(--aero-border-alpha, 0.5) * 0.25)) !important;
}

/* ========== Aero 增强 7：WinUI3 导航栏（tabs 栏）在 Aero 下毛玻璃 + 半透明 ========== */
html[data-aero="true"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .settings-tabs,
html[data-aero="true"]:not([data-glass-disabled="true"]):not([data-has-bg="true"]) .winui3-page-nav {
    backdrop-filter: blur(var(--design-blur, 16px)) saturate(145%) brightness(1.05);
    -webkit-backdrop-filter: blur(var(--design-blur, 16px)) saturate(145%) brightness(1.05);
}

/* ========== Aero 增强 8：次要文字与标签也加上淡轮廓，防止通透时消失 ========== */
html[data-aero="true"]:not([data-has-bg="true"]) .text-secondary,
html[data-aero="true"]:not([data-has-bg="true"]) .card-meta,
html[data-aero="true"]:not([data-has-bg="true"]) .card-album,
html[data-aero="true"]:not([data-has-bg="true"]) .mini-artist,
html[data-aero="true"]:not([data-has-bg="true"]) .list-item-artist,
html[data-aero="true"]:not([data-has-bg="true"]) .list-item-album,
html[data-aero="true"]:not([data-has-bg="true"]) .artist-name,
html[data-aero="true"]:not([data-has-bg="true"]) .text-muted,
html[data-aero="true"]:not([data-has-bg="true"]) .setting-item label,
html[data-aero="true"]:not([data-has-bg="true"]) .toggle-desc,
html[data-aero="true"]:not([data-has-bg="true"]) .slider-value,
html[data-aero="true"]:not([data-has-bg="true"]) .settings-section h2,
html[data-aero="true"]:not([data-has-bg="true"]) .titlebar-title {
    text-shadow:
        0 1px 1px rgba(0, 0, 0, calc((1 - var(--aero-modal-alpha, 0.7)) * 0.22));
}
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .text-secondary,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .card-meta,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .card-album,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .mini-artist,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .list-item-artist,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .list-item-album,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .artist-name,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .text-muted,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .setting-item label,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .toggle-desc,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .slider-value,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .settings-section h2,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .titlebar-title {
    text-shadow:
        0 1px 1px rgba(255, 255, 255, calc((1 - var(--aero-modal-alpha, 0.7)) * 0.30));
}

/* ========== Aero 增强 9：修复硬编码的暗色占位背景 ==========
   libraries.css 中 card-cover / card-icon / mini-cover / list-item-cover 等
   默认使用 #282828 硬编码暗色占位背景，在浅色主题 & Aero 下显得突兀。
   统一改为用 color-mix + 主题变量，深浅色与透明度都协调。 */
html[data-aero="true"]:not([data-has-bg="true"]) .card-cover,
html[data-aero="true"]:not([data-has-bg="true"]) .card-icon,
html[data-aero="true"]:not([data-has-bg="true"]) .mini-cover,
html[data-aero="true"]:not([data-has-bg="true"]) .list-item-cover,
html[data-aero="true"]:not([data-has-bg="true"]) .album-art-wrapper {
    background-color: color-mix(in srgb, var(--card-bg, #1e1e1e) calc(var(--aero-card-alpha, 0.7) * 90%), rgba(255,255,255,0.04)) !important;
}
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .card-cover,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .card-icon,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .mini-cover,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .list-item-cover,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .album-art-wrapper {
    background-color: color-mix(in srgb, var(--card-bg, #ffffff) calc(var(--aero-card-alpha, 0.75) * 92%), rgba(0,0,0,0.03)) !important;
}
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .card-cover,
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .card-icon,
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .mini-cover,
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .list-item-cover,
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .album-art-wrapper {
    background-color: color-mix(in srgb, var(--card-bg, #142814) calc(var(--aero-card-alpha, 0.72) * 90%), rgba(255,255,255,0.04)) !important;
}

/* 正在播放指示器的半透明黑底：也换成主题色半透明，Aero 下不再是死黑方块 */
html[data-aero="true"]:not([data-has-bg="true"]) .media-card .np-bars {
    background-color: color-mix(in srgb, #000000 calc(var(--aero-modal-alpha, 0.7) * 70%), transparent) !important;
}

/* ========== Aero 增强 10：theme-selector / anim-level-btn / toggle-switch 等控件背景半透明 ========== */
html[data-aero="true"]:not([data-has-bg="true"]) .theme-btn,
html[data-aero="true"]:not([data-has-bg="true"]) .anim-level-btn,
html[data-aero="true"]:not([data-has-bg="true"]) .toggle-switch,
html[data-aero="true"]:not([data-has-bg="true"]) .view-toggle,
html[data-aero="true"]:not([data-has-bg="true"]) .sort-control {
    background-color: color-mix(in srgb, var(--card-bg, #1e1e1e) calc(var(--aero-card-alpha, 0.7) * 100%), transparent) !important;
    border-color: color-mix(in srgb, var(--border-color, #333) calc(var(--aero-border-alpha, 0.5) * 100%), rgba(255,255,255,0.08)) !important;
}
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .theme-btn,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .anim-level-btn,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .toggle-switch,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .view-toggle,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .sort-control {
    background-color: color-mix(in srgb, var(--card-bg, #ffffff) calc(var(--aero-card-alpha, 0.75) * 100%), transparent) !important;
    border-color: color-mix(in srgb, var(--border-color, #e0e0e0) calc(var(--aero-border-alpha, 0.5) * 100%), rgba(0,0,0,0.06)) !important;
}

/* 非 Aero 模式下也修复浅色主题占位图：#282828 硬编码 → 变量驱动 */
html[data-theme="light"]:not([data-aero="true"]) .card-cover,
html[data-theme="light"]:not([data-aero="true"]) .card-icon,
html[data-theme="light"]:not([data-aero="true"]) .mini-cover,
html[data-theme="light"]:not([data-aero="true"]) .list-item-cover,
html[data-theme="light"]:not([data-aero="true"]) .album-art-wrapper {
    background-color: color-mix(in srgb, var(--card-bg) 92%, #000 8%) !important;
}
html[data-theme="accent"]:not([data-aero="true"]) .card-cover,
html[data-theme="accent"]:not([data-aero="true"]) .card-icon,
html[data-theme="accent"]:not([data-aero="true"]) .mini-cover,
html[data-theme="accent"]:not([data-aero="true"]) .list-item-cover,
html[data-theme="accent"]:not([data-aero="true"]) .album-art-wrapper {
    background-color: color-mix(in srgb, var(--card-bg) 85%, #000 15%) !important;
}

/* 有背景时：body 主背景透明，露出下方背景层 */
html[data-has-bg="true"] body {
    background-color: transparent !important;
}

/* ========== 有自定义背景图：保持原有半透明底色规则（兼容旧逻辑）========== */
html[data-has-bg="true"] .media-card,
html[data-has-bg="true"] .media-list-item,
html[data-has-bg="true"] .settings-section,
html[data-has-bg="true"] .designer-sidebar,
html[data-has-bg="true"] .designer-toolbar,
html[data-has-bg="true"] .search-box,
html[data-has-bg="true"] .sort-control,
html[data-has-bg="true"] .view-toggle,
html[data-has-bg="true"] .tab-panel,
html[data-has-bg="true"] .save-bar {
    background-color: rgba(30, 30, 30, 0.45) !important;
}
html[data-has-bg="true"][data-theme="light"] .media-card,
html[data-has-bg="true"][data-theme="light"] .media-list-item,
html[data-has-bg="true"][data-theme="light"] .settings-section,
html[data-has-bg="true"][data-theme="light"] .designer-sidebar,
html[data-has-bg="true"][data-theme="light"] .designer-toolbar,
html[data-has-bg="true"][data-theme="light"] .search-box,
html[data-has-bg="true"][data-theme="light"] .sort-control,
html[data-has-bg="true"][data-theme="light"] .view-toggle,
html[data-has-bg="true"][data-theme="light"] .tab-panel,
html[data-has-bg="true"][data-theme="light"] .save-bar {
    background-color: rgba(255, 255, 255, 0.45) !important;
}
html[data-has-bg="true"][data-theme="accent"] .media-card,
html[data-has-bg="true"][data-theme="accent"] .media-list-item,
html[data-has-bg="true"][data-theme="accent"] .settings-section,
html[data-has-bg="true"][data-theme="accent"] .designer-sidebar,
html[data-has-bg="true"][data-theme="accent"] .designer-toolbar,
html[data-has-bg="true"][data-theme="accent"] .search-box,
html[data-has-bg="true"][data-theme="accent"] .sort-control,
html[data-has-bg="true"][data-theme="accent"] .view-toggle,
html[data-has-bg="true"][data-theme="accent"] .tab-panel,
html[data-has-bg="true"][data-theme="accent"] .save-bar {
    background-color: rgba(20, 40, 20, 0.55) !important;
}
/* —— 有自定义背景图时也补上 modal/context-menu/toast 的半透明，避免之前的遗漏 —— */
html[data-has-bg="true"] .modal,
html[data-has-bg="true"] .context-menu,
html[data-has-bg="true"] .toast {
    background-color: rgba(30, 30, 30, 0.62) !important;
}
html[data-has-bg="true"][data-theme="light"] .modal,
html[data-has-bg="true"][data-theme="light"] .context-menu,
html[data-has-bg="true"][data-theme="light"] .toast {
    background-color: rgba(255, 255, 255, 0.70) !important;
}
html[data-has-bg="true"][data-theme="accent"] .modal,
html[data-has-bg="true"][data-theme="accent"] .context-menu,
html[data-has-bg="true"][data-theme="accent"] .toast {
    background-color: rgba(20, 40, 20, 0.68) !important;
}
html[data-has-bg="true"] .modal-backdrop.active {
    background-color: rgba(0, 0, 0, 0.45) !important;
}
/* 新 UI 与 新 UI WinUI3：侧边栏与主面板彻底半透明化 */
html[data-has-bg="true"] .winui3-nav,
html[data-has-bg="true"] main,
html[data-has-bg="true"] .library-sidebar {
    background-color: rgba(18, 18, 18, 0.35) !important;
}
html[data-has-bg="true"][data-theme="light"] .winui3-nav,
html[data-has-bg="true"][data-theme="light"] main,
html[data-has-bg="true"][data-theme="light"] .library-sidebar {
    background-color: rgba(250, 250, 250, 0.35) !important;
}
html[data-has-bg="true"][data-theme="accent"] .winui3-nav,
html[data-has-bg="true"][data-theme="accent"] main,
html[data-has-bg="true"][data-theme="accent"] .library-sidebar {
    background-color: rgba(10, 31, 10, 0.35) !important;
}
/* header / tabs 半透明化（条带类，低不透明度即可） */
html[data-has-bg="true"] header,
html[data-has-bg="true"] .settings-tabs {
    background-color: rgba(18, 18, 18, 0.35) !important;
}
html[data-has-bg="true"][data-theme="light"] header,
html[data-has-bg="true"][data-theme="light"] .settings-tabs {
    background-color: rgba(250, 250, 250, 0.35) !important;
}
html[data-has-bg="true"][data-theme="accent"] header,
html[data-has-bg="true"][data-theme="accent"] .settings-tabs {
    background-color: rgba(10, 31, 10, 0.4) !important;
}
/* player-overlay 在有背景图时也需要较高不透明度，否则背景图透出导致看不清内容 */
html[data-has-bg="true"] .player-overlay,
html[data-has-bg="true"] .fullscreen-lyrics {
    background-color: rgba(18, 18, 18, 0.75) !important;
}
html[data-has-bg="true"][data-theme="light"] .player-overlay,
html[data-has-bg="true"][data-theme="light"] .fullscreen-lyrics {
    background-color: rgba(250, 250, 250, 0.78) !important;
}
html[data-has-bg="true"][data-theme="accent"] .player-overlay,
html[data-has-bg="true"][data-theme="accent"] .fullscreen-lyrics {
    background-color: rgba(10, 31, 10, 0.78) !important;
}
/* 迷你播放器：半透明化 */
html[data-has-bg="true"] body[data-page="libraries"][data-new-ui="true"] .mini-player {
    background-color: rgba(20, 20, 20, 0.55) !important;
}
html[data-has-bg="true"][data-theme="light"] body[data-page="libraries"][data-new-ui="true"] .mini-player {
    background-color: rgba(250, 250, 250, 0.6) !important;
}
html[data-has-bg="true"][data-theme="accent"] body[data-page="libraries"][data-new-ui="true"] .mini-player {
    background-color: rgba(10, 31, 10, 0.6) !important;
}
/* 标题栏保持半透明，配合背景 */
html[data-has-bg="true"] .titlebar {
    background-color: rgba(18, 18, 18, 0.35) !important;
}
html[data-has-bg="true"][data-theme="light"] .titlebar {
    background-color: rgba(250, 250, 250, 0.35) !important;
}
html[data-has-bg="true"][data-theme="accent"] .titlebar {
    background-color: rgba(10, 31, 10, 0.35) !important;
}
`;
    const style = document.createElement('style');
    style.id = 'ml-bg-css';
    style.setAttribute('type', 'text/css');
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
}

// 应用整窗透明度（Aero）：范围 0.01 - 1.0
// 核心重构：不再使用 html { opacity }，而是通过 rgba 背景色透明度 + backdrop-filter 实现 Aero
// 参数含义：val=1 完全不透明；val 越小越能透出桌面（但前景文字保持清晰）
function applyWindowAlpha(val) {
    const root = document.documentElement;
    const v = isFinite(val) ? Math.max(0.01, Math.min(1, val)) : 1;
    if (v >= 0.999) {
        // 关闭 Aero：清除所有标记与变量
        root.removeAttribute('data-aero');
        root.removeAttribute('data-window-alpha');
        root.style.removeProperty('--window-alpha');
        root.style.removeProperty('--aero-bg-alpha');
        root.style.removeProperty('--aero-body-alpha');
        root.style.removeProperty('--aero-card-alpha');
        root.style.removeProperty('--aero-panel-alpha');
        root.style.removeProperty('--aero-titlebar-alpha');
        root.style.removeProperty('--aero-mini-alpha');
        root.style.removeProperty('--aero-overlay-alpha');
        root.style.removeProperty('--aero-modal-alpha');
        root.style.removeProperty('--aero-border-alpha');
        try { localStorage.removeItem('musicLite.windowAlpha'); } catch (e) {}
    } else {
        // 开启 Aero：设置 data-aero 标记 + 分层透明度变量
        // 映射曲线：window_alpha 越低 → 各层 alpha 也越低（越通透），但保持层与层之间的视觉层次
        // window_alpha=0.01（滑块最左=1%）时：body 几乎完全透桌面，卡片/面板保持最低可读性不透明度
        // 层与层之间保持：mini-player > titlebar > card > panel > body
        const t = (v - 0.01) / 0.99; // 归一化 0..1（0=最通透 1=完全不透明）
        // 各层不透明度（0=完全透明, 1=完全不透明）
        // 起始值降低至接近 0，使 1% 时几乎完全透出桌面
        const bodyA     = 0.00 + 0.40 * t;    // body 背景：0.00 → 0.40
        const panelA    = 0.02 + 0.48 * t;    // main/header 等大面板：0.02 → 0.50
        const cardA     = 0.04 + 0.66 * t;    // 卡片/容器：0.04 → 0.70
        const titleA    = 0.08 + 0.64 * t;    // 标题栏：0.08 → 0.72
        const miniA     = 0.14 + 0.72 * t;    // 迷你播放器：0.14 → 0.86（需要更明显，因为含控件）
        const overlayA  = 0.05 + 0.55 * t;    // 遮罩层(modal-backdrop等)：0.05 → 0.60
        const modalA    = 0.25 + 0.65 * t;    // 浮层弹窗/Toast：0.25 → 0.90（高对比度保证可读性）
        const borderA   = 0.12 + 0.68 * t;    // 边框不透明度：0.12 → 0.80

        root.setAttribute('data-aero', 'true');
        // 兼容旧属性（部分代码可能还引用 data-window-alpha）
        root.setAttribute('data-window-alpha', 'true');
        root.style.setProperty('--window-alpha', String(v));
        // 新分层透明度变量
        root.style.setProperty('--aero-bg-alpha',      bodyA.toFixed(3));
        root.style.setProperty('--aero-body-alpha',    bodyA.toFixed(3));
        root.style.setProperty('--aero-card-alpha',    cardA.toFixed(3));
        root.style.setProperty('--aero-panel-alpha',   panelA.toFixed(3));
        root.style.setProperty('--aero-titlebar-alpha',titleA.toFixed(3));
        root.style.setProperty('--aero-mini-alpha',    miniA.toFixed(3));
        root.style.setProperty('--aero-overlay-alpha', overlayA.toFixed(3));
        root.style.setProperty('--aero-modal-alpha',   modalA.toFixed(3));
        root.style.setProperty('--aero-border-alpha',  borderA.toFixed(3));
        try { localStorage.setItem('musicLite.windowAlpha', String(v)); } catch (e) {}
    }
}

// 应用 Aero 透明模式模糊量（独立于 design_blur，仅影响 Aero 模式下的 backdrop-filter）
// 参数：blurPx (0-40)，0=完全关闭模糊（降低 GPU 占用）
function applyAeroBlur(blurPx) {
    const root = document.documentElement;
    const v = isFinite(blurPx) ? Math.max(0, Math.min(40, blurPx)) : 16;
    root.style.setProperty('--aero-blur', v + 'px');
    // 当 aero_blur=0 时，标记关闭 Aero 模糊（CSS 中据此禁用 backdrop-filter）
    if (v === 0) {
        root.setAttribute('data-aero-blur-disabled', 'true');
    } else {
        root.removeAttribute('data-aero-blur-disabled');
    }
}

// 应用全页面背景（图片或视频）
// 思路：独立全屏层 <img>/<video> + 遮罩层；仅切换 html 根节点 data-attribute 让 CSS 统一生效，避免 inline 残留
function applyBackground(opts) {
    // 首次调用注入公共 CSS
    injectBgCSSOnce();

    const root = document.documentElement;
    const body = document.body;
    const bgType = (opts && opts.bg_type) || 'none';
    const bgUrl = (opts && opts.bg_url) || '';
    const bgFit = (opts && opts.bg_fit) || 'cover';
    const bgOpacity = Number(opts && opts.bg_opacity);
    const bgOverlay = Number(opts && opts.bg_overlay);
    const bgBlur = Number(opts && opts.bg_blur);
    const bgLoop = !(opts && opts.bg_loop === false);
    const bgMuted = !(opts && opts.bg_muted === false);
    const theme = (opts && opts.theme) || 'dark';
    const glassDisabled = Boolean(opts && opts.bg_glass_disabled);

    const hasBg = bgType !== 'none' && bgUrl && bgUrl.length > 0;
    root.setAttribute('data-has-bg', hasBg ? 'true' : 'false');
    root.setAttribute('data-bg-type', hasBg ? bgType : 'none');
    root.setAttribute('data-bg-fit', hasBg ? bgFit : 'cover');
    // 毛玻璃关闭开关：与 hasBg 独立（避免「没加载背景时切换开关完全无效」）
    root.setAttribute('data-glass-disabled', glassDisabled ? 'true' : 'false');
    try {
        localStorage.setItem('musicLite.bgType', hasBg ? bgType : 'none');
        localStorage.setItem('musicLite.bgFit', hasBg ? bgFit : 'cover');
        localStorage.setItem('musicLite.bgGlassDisabled', glassDisabled ? '1' : '0');
    } catch (e) {}

    // 清理旧层
    const oldLayer = document.getElementById('ml-bg-layer');
    const oldOverlay = document.getElementById('ml-bg-overlay');
    if (oldLayer) oldLayer.remove();
    if (oldOverlay) oldOverlay.remove();

    if (!hasBg || !body) return;

    // === 背景层（img/video）===
    const layer = document.createElement('div');
    layer.id = 'ml-bg-layer';
    layer.setAttribute('aria-hidden', 'true');

    const objectFit = BG_FIT_TO_OBJECT_FIT[bgFit] || 'cover';
    const opacity = isFinite(bgOpacity) ? Math.max(0, Math.min(1, bgOpacity)) : 0.9;
    const blurPx = isFinite(bgBlur) ? Math.max(0, Math.min(30, bgBlur)) : 0;
    layer.style.opacity = String(opacity);
    if (blurPx > 0) {
        layer.style.filter = `blur(${blurPx}px)`;
        // 模糊时放大一点，避免边缘露白
        layer.style.transform = 'scale(1.05)';
    }

    let mediaEl;
    if (bgType === 'image') {
        mediaEl = document.createElement('img');
        mediaEl.alt = '';
        mediaEl.draggable = false;
        mediaEl.src = bgUrl;
        mediaEl.style.objectFit = objectFit;
        mediaEl.onerror = () => {
            console.warn('[bg] 背景图片加载失败:', bgUrl.slice(0, 64));
            layer.remove();
            root.setAttribute('data-has-bg', 'false');
        };
    } else if (bgType === 'video') {
        mediaEl = document.createElement('video');
        mediaEl.src = bgUrl;
        mediaEl.autoplay = true;
        mediaEl.muted = bgMuted;
        mediaEl.loop = bgLoop;
        mediaEl.playsInline = true;
        mediaEl.setAttribute('playsinline', '');
        mediaEl.setAttribute('webkit-playsinline', '');
        mediaEl.preload = 'auto';
        mediaEl.style.objectFit = objectFit;
        mediaEl.onerror = () => {
            console.warn('[bg] 背景视频加载失败:', bgUrl.slice(0, 64));
            layer.remove();
            root.setAttribute('data-has-bg', 'false');
        };
        // 视频需要静音才能自动播放；若用户取消静音但自动播放失败，手动 try play
        if (bgMuted === false) {
            const tryPlay = () => {
                try { const p = mediaEl.play(); if (p && p.catch) p.catch(() => {}); } catch (e) {}
            };
            document.addEventListener('click', tryPlay, { once: true, passive: true });
            document.addEventListener('keydown', tryPlay, { once: true, passive: true });
        }
    }
    if (mediaEl) {
        mediaEl.style.width = '100%';
        mediaEl.style.height = '100%';
        layer.appendChild(mediaEl);
    }

    // === 遮罩层（根据主题加深色/浅色叠层，保持文字可读性）===
    const overlay = document.createElement('div');
    overlay.id = 'ml-bg-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    const overlayOpacity = isFinite(bgOverlay) ? Math.max(0, Math.min(1, bgOverlay)) : 0.2;
    // 深色主题用黑色遮罩；浅色主题用白色遮罩；墨绿(accent) 用深绿
    let overlayRGB = '0, 0, 0';
    if (theme === 'light') overlayRGB = '255, 255, 255';
    else if (theme === 'accent') overlayRGB = '0, 30, 10';
    overlay.style.backgroundColor = `rgba(${overlayRGB}, ${overlayOpacity})`;

    // 插入到 body 的最前面（z-index 最低）
    body.prepend(overlay);
    body.prepend(layer);
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
    const t = theme || 'dark';
    const root = document.documentElement;
    const body = document.body;
    let palette;
    if (t === 'custom') {
        // 自定义主题色：从用户选择的颜色计算全套配套色
        const c = (color || '').trim() || DEFAULT_ACCENT;
        palette = computePalette(c, 'dark'); // custom 统一用深色基调计算
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
// 封面作为 player-overlay 的模糊背景（opacity 0.40 + blur 5px），叠加在 --bg-color 上。
// 策略：
//   亮色背景 (brightness > 0.6) → 强制深色文字/控件
//   深色背景 (brightness < 0.35) → 强制浅色文字/控件
//   中间区间 (0.35 ~ 0.6) → 跟随主题默认色，若主题默认对比度不足则自动兜底
const PlayerContrast = {
    lastCoverUrl: null,
    lastBrightness: 0.5, // 0=纯黑 1=纯白

    // 计算相对对比度（WCAG 简化版），返回 0-21，>=4.5 为合格
    _contrastRatio(l1, l2) {
        const lighter = Math.max(l1, l2);
        const darker = Math.min(l1, l2);
        return (lighter + 0.05) / (darker + 0.05);
    },

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

    // 清除 overlay 上所有 PlayerContrast 注入的样式，让主题色生效
    _clearOverrides(overlay) {
        const props = [
            '--bg-color', '--card-bg',
            '--text-primary', '--text-secondary',
            '--player-btn-bg', '--player-btn-bg-hover', '--player-btn-fg',
            '--overlay-border-color',
            '--overlay-ctrl-btn-bg', '--overlay-ctrl-btn-bg-hover',
            '--overlay-card-bg', '--overlay-card-border',
            '--overlay-slider-thumb-active'
        ];
        props.forEach(p => overlay.style.removeProperty(p));
    },

    // 根据封面的"有效背景亮度"调整 #player-overlay 上的文字与控件颜色
    // effectiveBrightness：封面亮度 × 0.4 + 主题背景亮度 × 0.6（因为 bgLayer opacity=0.4）
    apply(coverBrightness) {
        this.lastBrightness = coverBrightness;
        const overlay = document.getElementById('player-overlay');
        if (!overlay) return;

        // 获取主题背景的实际亮度（读取计算后的 --bg-color）
        const rootStyle = getComputedStyle(document.documentElement);
        let themeBg = rootStyle.getPropertyValue('--bg-color').trim();
        if (!themeBg) themeBg = '#121212';
        let themeBgRgb;
        const m = themeBg.match(/^#([0-9a-f]{6})$/i);
        if (m) {
            themeBgRgb = [parseInt(m[1].slice(0,2),16), parseInt(m[1].slice(2,4),16), parseInt(m[1].slice(4,6),16)];
        } else {
            themeBgRgb = [18, 18, 18];
        }
        const themeBgLum = (0.299 * themeBgRgb[0] + 0.587 * themeBgRgb[1] + 0.114 * themeBgRgb[2]) / 255;

        // 有效背景亮度 = 封面 40% + 主题背景 60%（bgLayer opacity=0.4）
        const effective = coverBrightness * 0.4 + themeBgLum * 0.6;

        // 获取主题默认文字亮度用于检查对比度
        let themeFg = rootStyle.getPropertyValue('--text-primary').trim() || '#ffffff';
        let fgRgb;
        const mf = themeFg.match(/^#([0-9a-f]{6})$/i);
        if (mf) {
            fgRgb = [parseInt(mf[1].slice(0,2),16), parseInt(mf[1].slice(2,4),16), parseInt(mf[1].slice(4,6),16)];
        } else {
            fgRgb = [255, 255, 255];
        }
        const themeFgLum = (0.299 * fgRgb[0] + 0.587 * fgRgb[1] + 0.114 * fgRgb[2]) / 255;
        const defaultContrast = this._contrastRatio(effective, themeFgLum);

        // ========= 决定使用"深色方案"还是"浅色方案"还是"主题跟随" =========
        if (effective > 0.60) {
            // ===== 亮色背景 → 强制深色方案 =====
            // overlay 背景与容器：变浅色，让全屏歌词和主播放器背景一致
            overlay.style.setProperty('--bg-color', '#f5f5f5');
            overlay.style.setProperty('--card-bg', '#ffffff');
            overlay.style.setProperty('--text-primary', '#1a1a1a');
            overlay.style.setProperty('--text-secondary', '#555555');
            overlay.style.setProperty('--overlay-border-color', 'rgba(0, 0, 0, 0.18)');
            // 播放按钮：浅底深字
            overlay.style.setProperty('--player-btn-bg', '#ffffff');
            overlay.style.setProperty('--player-btn-bg-hover', '#e8e8e8');
            overlay.style.setProperty('--player-btn-fg', '#1a1a1a');
            // 其他控制按钮（prev/next/loop 等）：hover 背景用深色半透明
            overlay.style.setProperty('--overlay-ctrl-btn-bg', 'rgba(0, 0, 0, 0.05)');
            overlay.style.setProperty('--overlay-ctrl-btn-bg-hover', 'rgba(0, 0, 0, 0.12)');
            // 歌词卡片：浅色底 + 深色细边
            overlay.style.setProperty('--overlay-card-bg', 'rgba(255, 255, 255, 0.95)');
            overlay.style.setProperty('--overlay-card-border', 'rgba(0, 0, 0, 0.12)');
            // 滑块按下的 thumb：保持 accent
            overlay.style.setProperty('--overlay-slider-thumb-active', 'var(--accent-color)');
        } else if (effective < 0.35) {
            // ===== 深色背景 → 强制浅色方案 =====
            // overlay 背景与容器：变深色
            overlay.style.setProperty('--bg-color', '#0d0d0d');
            overlay.style.setProperty('--card-bg', '#1a1a1a');
            overlay.style.setProperty('--text-primary', '#ffffff');
            overlay.style.setProperty('--text-secondary', '#c0c0c0');
            overlay.style.setProperty('--overlay-border-color', 'rgba(255, 255, 255, 0.14)');
            // 播放按钮：深底浅字
            overlay.style.setProperty('--player-btn-bg', '#1a1a1a');
            overlay.style.setProperty('--player-btn-bg-hover', '#333333');
            overlay.style.setProperty('--player-btn-fg', '#ffffff');
            // 其他控制按钮：hover 背景用浅色半透明
            overlay.style.setProperty('--overlay-ctrl-btn-bg', 'rgba(255, 255, 255, 0.04)');
            overlay.style.setProperty('--overlay-ctrl-btn-bg-hover', 'rgba(255, 255, 255, 0.10)');
            // 歌词卡片：深色底 + 浅色细边
            overlay.style.setProperty('--overlay-card-bg', 'rgba(30, 30, 30, 0.95)');
            overlay.style.setProperty('--overlay-card-border', 'rgba(255, 255, 255, 0.1)');
            // 滑块按下的 thumb：保持 accent
            overlay.style.setProperty('--overlay-slider-thumb-active', 'var(--accent-color)');
        } else {
            // ===== 中间区间：跟随主题，但如果对比度不足则兜底 =====
            if (defaultContrast < 4.5) {
                // 对比度不合格：选择更合适的强制方案
                if (effective > 0.475) {
                    // 偏亮但没到阈值，用深色方案兜底
                    overlay.style.setProperty('--bg-color', '#f5f5f5');
                    overlay.style.setProperty('--card-bg', '#ffffff');
                    overlay.style.setProperty('--text-primary', '#1a1a1a');
                    overlay.style.setProperty('--text-secondary', '#555555');
                    overlay.style.setProperty('--overlay-border-color', 'rgba(0, 0, 0, 0.18)');
                    overlay.style.setProperty('--player-btn-bg', '#ffffff');
                    overlay.style.setProperty('--player-btn-bg-hover', '#e8e8e8');
                    overlay.style.setProperty('--player-btn-fg', '#1a1a1a');
                    overlay.style.setProperty('--overlay-ctrl-btn-bg', 'rgba(0, 0, 0, 0.05)');
                    overlay.style.setProperty('--overlay-ctrl-btn-bg-hover', 'rgba(0, 0, 0, 0.12)');
                    overlay.style.setProperty('--overlay-card-bg', 'rgba(255, 255, 255, 0.95)');
                    overlay.style.setProperty('--overlay-card-border', 'rgba(0, 0, 0, 0.12)');
                } else {
                    // 偏暗但没到阈值，用浅色方案兜底
                    overlay.style.setProperty('--bg-color', '#0d0d0d');
                    overlay.style.setProperty('--card-bg', '#1a1a1a');
                    overlay.style.setProperty('--text-primary', '#ffffff');
                    overlay.style.setProperty('--text-secondary', '#c0c0c0');
                    overlay.style.setProperty('--overlay-border-color', 'rgba(255, 255, 255, 0.14)');
                    overlay.style.setProperty('--player-btn-bg', '#1a1a1a');
                    overlay.style.setProperty('--player-btn-bg-hover', '#333333');
                    overlay.style.setProperty('--player-btn-fg', '#ffffff');
                    overlay.style.setProperty('--overlay-ctrl-btn-bg', 'rgba(255, 255, 255, 0.04)');
                    overlay.style.setProperty('--overlay-ctrl-btn-bg-hover', 'rgba(255, 255, 255, 0.10)');
                    overlay.style.setProperty('--overlay-card-bg', 'rgba(30, 30, 30, 0.95)');
                    overlay.style.setProperty('--overlay-card-border', 'rgba(255, 255, 255, 0.1)');
                }
            } else {
                // 对比度合格：清除所有覆盖，让主题默认值生效
                this._clearOverrides(overlay);
            }
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
        if (this.lastCoverUrl) {
            this.apply(this.lastBrightness);
        } else {
            // 无封面时清除覆盖
            const overlay = document.getElementById('player-overlay');
            if (overlay) this._clearOverrides(overlay);
        }
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

        // 主题（html 根也同步写 data-theme：让背景注入的 CSS 选择器能正确命中主题差异化半透明规则）
        document.body.setAttribute('data-theme', s.theme || 'dark');
        document.documentElement.setAttribute('data-theme', s.theme || 'dark');

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

        // 界面动画级别（默认 2 = 增强；旧文件 enable_animations:false → 0）
        const animLvl = typeof s.animation_level === 'number'
            ? s.animation_level
            : (s.enable_animations === false ? 0 : 2);
        applyAnimationLevel(animLvl);

        // 视觉设计令牌（圆角 / 模糊 / 动画速度 / 阴影 / 辉光 / 字体晕影）
        applyDesignTokens(s.design_radius, s.design_blur, s.design_anim_mult, s.design_shadow, s.design_glow, s.design_text_glow);

        // 设置界面布局模式
        applySettingsLayout(s.settings_layout);
        // 新风格 UI 开关
        applyNewUI(s.new_ui_enabled);

        // 同一时间戳歌词行数（同步到 localStorage，供 player.js 读取）
        const maxLines = (typeof s.max_lyric_lines === 'number' && s.max_lyric_lines >= 1 && s.max_lyric_lines <= 10)
            ? s.max_lyric_lines
            : 1;
        try { localStorage.setItem('musicLite.maxLyricLines', maxLines.toString()); } catch (e) {}

        // 应用 i18n 翻译（在 DOM 和语言都就绪后）
        applyTranslations();

        // 自定义标题栏文字（用户未设置时，保留 data-i18n 翻译后的值）
        if (s.titlebar_text && s.titlebar_text.trim()) {
            const titlebarText = s.titlebar_text.trim();
            document.querySelectorAll('.titlebar-title').forEach(el => { el.textContent = titlebarText; });
        }

        // 背景（图片或视频）
        applyBackground({
            bg_type:    s.bg_type,
            bg_url:     s.bg_url,
            bg_fit:     s.bg_fit,
            bg_opacity: s.bg_opacity,
            bg_overlay: s.bg_overlay,
            bg_blur:    s.bg_blur,
            bg_loop:    s.bg_loop,
            bg_muted:   s.bg_muted,
            bg_glass_disabled: s.bg_glass_disabled,
            theme:      s.theme || 'dark',
        });

        // 整窗 Aero 透明度（无论有没有背景都生效，范围 0.2-1）
        applyWindowAlpha(s.window_alpha);
        // Aero 模糊量（独立于 design_blur）
        applyAeroBlur(s.aero_blur);

        return s;
    },

    // 重新应用（设置保存后调用）
    reapply() {
        if (this.cached) {
            document.body.setAttribute('data-theme', this.cached.theme || 'dark');
            document.documentElement.setAttribute('data-theme', this.cached.theme || 'dark');
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

            // 界面动画级别（兼容旧字段）
            const animLvl = typeof this.cached.animation_level === 'number'
                ? this.cached.animation_level
                : (this.cached.enable_animations === false ? 0 : 2);
            applyAnimationLevel(animLvl);

            // 视觉设计令牌（圆角 / 模糊 / 动画速度 / 阴影 / 辉光 / 字体晕影）
            applyDesignTokens(this.cached.design_radius, this.cached.design_blur, this.cached.design_anim_mult, this.cached.design_shadow, this.cached.design_glow, this.cached.design_text_glow);

            // 设置界面布局模式
            applySettingsLayout(this.cached.settings_layout);
            // 新风格 UI 开关
            applyNewUI(this.cached.new_ui_enabled);

            // 同一时间戳歌词行数（同步到 localStorage）
            const maxLines = (typeof this.cached.max_lyric_lines === 'number' && this.cached.max_lyric_lines >= 1 && this.cached.max_lyric_lines <= 10)
                ? this.cached.max_lyric_lines
                : 1;
            try { localStorage.setItem('musicLite.maxLyricLines', maxLines.toString()); } catch (e) {}

            // 自定义标题栏文字（用户未设置时保留 DOM 上已翻译的值）
            if (this.cached.titlebar_text && this.cached.titlebar_text.trim()) {
                const titlebarText = this.cached.titlebar_text.trim();
                document.querySelectorAll('.titlebar-title').forEach(el => { el.textContent = titlebarText; });
            }

            // 背景（图片或视频）
            applyBackground({
                bg_type:    this.cached.bg_type,
                bg_url:     this.cached.bg_url,
                bg_fit:     this.cached.bg_fit,
                bg_opacity: this.cached.bg_opacity,
                bg_overlay: this.cached.bg_overlay,
                bg_blur:    this.cached.bg_blur,
                bg_loop:    this.cached.bg_loop,
                bg_muted:   this.cached.bg_muted,
                bg_glass_disabled: this.cached.bg_glass_disabled,
                theme:      this.cached.theme || 'dark',
            });

            // 整窗 Aero 透明度
            applyWindowAlpha(this.cached.window_alpha);
            // Aero 模糊量
            applyAeroBlur(this.cached.aero_blur);
        }
    },

    // 暴露给外部调用：仅更新主题色（设置页颜色选择器实时预览用）
    applyAccentColor(color, theme) {
        applyAccentColor(color, theme);
    },

    // 暴露给设计器实时预览：单独应用设计令牌（不读后端）
    applyDesignTokens(radius, blur, animMult, shadow, glow, textGlow) {
        applyDesignTokens(radius, blur, animMult, shadow, glow, textGlow);
    },

    // 暴露给设计器实时预览：单独应用动画级别（不读后端）
    applyAnimationLevel(level) {
        return applyAnimationLevel(level);
    },

    // 暴露给设计器实时预览：设置界面布局模式
    applySettingsLayout(mode) {
        applySettingsLayout(mode);
    },

    // 暴露给设计器实时预览：新风格 UI 开关
    applyNewUI(enabled) {
        applyNewUI(enabled);
    },

    // 暴露给设置页实时预览：背景（图片或视频）
    applyBackground(opts) {
        applyBackground(opts);
    },

    // 暴露给设置页实时预览：整窗 Aero 透明度
    applyWindowAlpha(val) {
        applyWindowAlpha(val);
    },

    // 暴露给设计器实时预览：Aero 模糊量
    applyAeroBlur(blurPx) {
        injectBgCSSOnce();
        applyAeroBlur(blurPx);
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

// 同步应用界面动画级别（在 DOMContentLoaded 之前就应用，避免首屏动画闪烁）
// 从 localStorage 读取上次的设置，等 SettingsManager.apply() 完成后再用实际设置覆盖
(function syncApplyAnimationLevel() {
    const body = document.body;
    if (!body) return;
    try {
        // 优先读取新的 4 档 level，其次回退到旧的 enable/disable 布尔
        const savedLvl = localStorage.getItem('musicLite.animationsLevel');
        let lvl = null;
        if (savedLvl !== null && savedLvl !== '') {
            const n = parseInt(savedLvl, 10);
            if (!isNaN(n)) lvl = Math.max(0, Math.min(3, n));
        }
        if (lvl === null) {
            const savedOld = localStorage.getItem('musicLite.animationsEnabled');
            lvl = (savedOld === '0') ? 0 : 2;
        }
        body.setAttribute('data-anim', lvl.toString());
        body.classList.toggle('no-anim', lvl === 0);
    } catch (e) {}
})();

// 同步应用视觉设计令牌（在 DOMContentLoaded 之前应用，避免圆角/模糊首屏闪烁到默认值）
// 从 localStorage 读取上次的设计器设置，等 SettingsManager.apply() 完成后再用后端设置覆盖
(function syncApplyDesignTokens() {
    try {
        const r = localStorage.getItem('musicLite.designRadius');
        const b = localStorage.getItem('musicLite.designBlur');
        const m = localStorage.getItem('musicLite.designAnimMult');
        const sh = localStorage.getItem('musicLite.designShadow');
        const gl = localStorage.getItem('musicLite.designGlow');
        const tg = localStorage.getItem('musicLite.designTextGlow');
        if (r !== null || b !== null || m !== null || sh !== null || gl !== null || tg !== null) {
            applyDesignTokens(
                r !== null ? parseFloat(r) : 10,
                b !== null ? parseInt(b, 10) : 16,
                m !== null ? parseFloat(m) : 1,
                sh !== null ? parseFloat(sh) : 0.45,
                gl !== null ? parseFloat(gl) : 0.35,
                tg !== null ? parseFloat(tg) : 0
            );
        }
    } catch (e) {}
})();

// 同步应用设置界面布局模式（在 DOMContentLoaded 之前应用，避免首屏闪烁）
(function syncApplySettingsLayout() {
    try {
        const m = localStorage.getItem('musicLite.settingsLayout');
        if (m) applySettingsLayout(m);
    } catch (e) {}
})();

// 同步应用新风格 UI 开关（在 DOMContentLoaded 之前应用，避免首屏闪烁）
(function syncApplyNewUI() {
    try {
        const v = localStorage.getItem('musicLite.newUIEnabled');
        if (v !== null) applyNewUI(v === '1');
    } catch (e) {}
})();

// 同步应用毛玻璃开关（在 DOMContentLoaded 之前应用，避免卡片首屏出现一次毛玻璃边界后再消失）
(function syncApplyGlassDisabled() {
    try {
        const v = localStorage.getItem('musicLite.bgGlassDisabled');
        if (v === null) return;
        const disabled = v === '1';
        injectBgCSSOnce(); // 确保注入了「通杀 backdrop-filter」的规则
        document.documentElement.setAttribute('data-glass-disabled', disabled ? 'true' : 'false');
    } catch (e) {}
})();

// 同步应用整窗 Aero 透明度（在 DOMContentLoaded 之前应用，避免首屏先 100% 然后半透明的闪烁）
(function syncApplyWindowAlpha() {
    try {
        const raw = localStorage.getItem('musicLite.windowAlpha');
        if (raw === null) return;
        const v = parseFloat(raw);
        if (!isFinite(v)) return;
        injectBgCSSOnce();
        applyWindowAlpha(v);
    } catch (e) {}
})();

// ============================================================
// WinUI3 全页面布局：新UI开启时为音乐库和设计器生成左侧导航栏并重组 DOM
// ============================================================

// WinUI3 图标
const W3_ICONS = {
  library: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><line x1="8" y1="7" x2="16" y2="7"/><line x1="8" y1="11" x2="13" y2="11"/></svg>',
  
  queue: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
  
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>',
  
  designer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>',
  
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>',
  
  appearance: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18V3z" fill="currentColor" stroke="none"/></svg>',
  
  shape: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="3"/></svg>',
  
  light: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="M4.93 4.93l1.41 1.41"/><path d="M17.66 17.66l1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="M6.34 17.66l-1.41 1.41"/><path d="M19.07 4.93l-1.41 1.41"/></svg>',
  
  animation: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/><path d="M19 12h3"/><path d="M19 8h2"/><path d="M19 16h2"/></svg>',
  
  layout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="3" y1="9" x2="9" y2="9"/></svg>'
};

// 为音乐库页面生成 WinUI3 左侧导航并重组 DOM
function applyLibrariesWinUI3() {
    if (document.querySelector('.winui3-page-nav')) return;

    const header = document.querySelector('header');
    const main = document.querySelector('main');
    if (!header || !main) return;

    // i18n 获取翻译（支持 fallback + 占位符参数传递）
    // 用法：t(key, 'fallback文本', 'param0', 'param1') 或 t(key, 'fallback', { count: 5 })
    const t = (key, ...args) => {
        try {
            if (window.i18n && typeof window.i18n.t === 'function') {
                const v = window.i18n.t(key, ...args);
                if (v !== undefined && v !== null) return v;
            }
            if (window.I18N && typeof window.I18N.t === 'function') {
                const v = window.I18N.t(key, ...args);
                if (v !== undefined && v !== null) return v;
            }
        } catch (e) {}
        // 兜底：若 args[0] 是字符串（即 fallback），返回它；否则返回原始 key
        if (args.length > 0 && typeof args[0] === 'string') return args[0];
        return key;
    };

    // 创建左侧导航
    const nav = document.createElement('nav');
    nav.className = 'winui3-page-nav';

    // 导航头部（标题）
    const navHeader = document.createElement('div');
    navHeader.className = 'winui3-nav-header';
    navHeader.innerHTML = '<span class="winui3-nav-title">MusicLite</span>';
    nav.appendChild(navHeader);

    // 导航项
    const navList = document.createElement('div');
    navList.className = 'winui3-nav-list';
    const items = [
        { id: 'library',  labelKey: 'libraries.title',       fallback: '音乐库',     icon: W3_ICONS.library,  active: true },
        { id: 'queue',    labelKey: 'player.queue',          fallback: '播放队列',   icon: W3_ICONS.queue },
        { id: 'settings', labelKey: 'common.settings',       fallback: '设置',       icon: W3_ICONS.settings, url: '/src/html/settings.html' },
        { id: 'designer', labelKey: 'common.designer',       fallback: '设计器',     icon: W3_ICONS.designer, url: '/src/html/designer.html' },
    ];

    // 收集 main 内原始的"音乐库"子内容（全部），后续用于切换显示
    const libraryPane = document.createElement('div');
    libraryPane.className = 'w3-pane w3-pane--library';
    while (main.firstChild) libraryPane.appendChild(main.firstChild);

    // 创建"队列"面板：把原 #libQueueSidebar 内部结构迁移成内嵌 section
    const queuePane = document.createElement('div');
    queuePane.className = 'w3-pane w3-pane--queue';
    queuePane.style.display = 'none';

    // 队列头部：标题 + 数量徽章 + 洗牌/清空操作
    const queueHeader = document.createElement('div');
    queueHeader.className = 'w3-queue-header';
    queueHeader.innerHTML = `
        <div class="w3-queue-title-group">
            <h2 class="w3-queue-title" data-i18n="player.queue">${t('player.queue', '播放队列')}</h2>
            <span class="w3-queue-badge" id="w3QueueBadge" style="display:none;">0</span>
        </div>
        <div class="w3-queue-actions">
            <button class="btn w3-queue-action" id="w3QueueShuffleBtn" title="${t('player.queueShuffle', '洗牌')}" data-i18n-title="player.queueShuffle">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>
                <span data-i18n="player.queueShuffle">${t('player.queueShuffle', '洗牌')}</span>
            </button>
            <button class="btn w3-queue-action" id="w3QueueClearBtn" title="${t('player.queueClear', '清空')}" data-i18n-title="player.queueClear">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                <span data-i18n="player.queueClear">${t('player.queueClear', '清空')}</span>
            </button>
        </div>
    `;
    const queueListWrap = document.createElement('div');
    queueListWrap.className = 'w3-queue-dropzone';
    queueListWrap.id = 'libQueueList'; // 保持原有 id，复用现有 renderLibQueueList / bindLibQueueItemEvents
    queueListWrap.innerHTML = `<div class="queue-empty" data-i18n="player.queueEmpty">${t('player.queueEmpty', '队列为空，右键曲目加入队列')}</div>`;
    queuePane.appendChild(queueHeader);
    queuePane.appendChild(queueListWrap);

    main.appendChild(libraryPane);
    main.appendChild(queuePane);

    // 把旧的 sidebar 队列 DOM 内容清掉（只保留空壳，避免影响旧 UI 代码引用，但切换到新布局时隐藏）
    const oldSidebar = document.getElementById('libQueueSidebar');
    const oldOverlay = document.getElementById('libQueueOverlay');
    if (oldSidebar) oldSidebar.style.display = 'none';
    if (oldOverlay) oldOverlay.style.display = 'none';

    // 同步 badge id：保持旧 id 可用
    const newBadge = queueHeader.querySelector('#w3QueueBadge');
    if (newBadge) {
        newBadge.id = 'libQueueBadge'; // 替换 id，复用旧逻辑
    }

    items.forEach(item => {
        const btn = document.createElement('button');
        btn.className = 'winui3-nav-item' + (item.active ? ' active' : '');
        btn.dataset.navPane = item.id;
        const label = t(item.labelKey, item.fallback);
        // 关键：写入 data-i18n，让后续 applyTranslations() 能在 i18n 数据就绪后重新翻译。
        // 本函数在 DOMContentLoaded 阶段同步执行，往往早于后端 i18n 数据加载完成，
        // 此时 t() 只能返回中文 fallback；若不挂 data-i18n，侧边栏会一直停留在中文。
        btn.innerHTML = '<span class="winui3-nav-icon">' + item.icon + '</span><span class="winui3-nav-label" data-i18n="' + item.labelKey + '">' + label + '</span>';
        if (item.url) {
            btn.addEventListener('click', () => { window.location.href = item.url; });
        } else if (item.id === 'library') {
            btn.addEventListener('click', () => {
                libraryPane.style.display = '';
                queuePane.style.display = 'none';
                navList.querySelectorAll('.winui3-nav-item').forEach(n => n.classList.remove('active'));
                btn.classList.add('active');
                document.body.classList.remove('w3-pane-queue');
                document.body.classList.add('w3-pane-library');
            });
        } else if (item.id === 'queue') {
            btn.addEventListener('click', () => {
                libraryPane.style.display = 'none';
                queuePane.style.display = '';
                navList.querySelectorAll('.winui3-nav-item').forEach(n => n.classList.remove('active'));
                btn.classList.add('active');
                document.body.classList.remove('w3-pane-library');
                document.body.classList.add('w3-pane-queue');
                // 队列显示时刷新（若刷新函数可用）
                try { if (typeof window.refreshLibQueue === 'function') window.refreshLibQueue(); } catch (_) {}
                try { if (typeof refreshLibQueue === 'function') refreshLibQueue(); } catch (_) {}
            });
        }
        navList.appendChild(btn);
    });
    nav.appendChild(navList);

    // 创建内容包裹容器
    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'winui3-content-wrapper';

    // 将 header 和 main 移入容器
    header.parentNode.insertBefore(nav, header);
    header.parentNode.insertBefore(contentWrapper, header);
    contentWrapper.appendChild(header);
    contentWrapper.appendChild(main);

    document.body.classList.add('w3-pane-library');

    // 把洗牌/清空按钮绑定到既有行为：沿用旧 id 按钮触发（如果存在）
    const w3Shuffle = document.getElementById('w3QueueShuffleBtn');
    const w3Clear = document.getElementById('w3QueueClearBtn');
    const legacyShuffle = document.getElementById('libQueueShuffleBtn');
    const legacyClear = document.getElementById('libQueueClearBtn');
    if (w3Shuffle && legacyShuffle) {
        w3Shuffle.addEventListener('click', () => legacyShuffle.click());
    }
    if (w3Clear && legacyClear) {
        w3Clear.addEventListener('click', () => legacyClear.click());
    }
}

// 为设计器页面生成 WinUI3 左侧导航并重组 DOM
function applyDesignerWinUI3() {
    if (document.querySelector('.winui3-page-nav')) return;

    const main = document.querySelector('main.designer-main');
    const controls = document.querySelector('.designer-controls');
    if (!main || !controls) return;

    // i18n 获取翻译（支持 fallback + 占位符参数传递）
    // 用法：t(key, 'fallback文本', 'param0', 'param1') 或 t(key, 'fallback', { count: 5 })
    const t = (key, ...args) => {
        try {
            if (window.i18n && typeof window.i18n.t === 'function') {
                const v = window.i18n.t(key, ...args);
                if (v !== undefined && v !== null) return v;
            }
            if (window.I18N && typeof window.I18N.t === 'function') {
                const v = window.I18N.t(key, ...args);
                if (v !== undefined && v !== null) return v;
            }
        } catch (e) {}
        // 兜底：若 args[0] 是字符串（即 fallback），返回它；否则返回原始 key
        if (args.length > 0 && typeof args[0] === 'string') return args[0];
        return key;
    };

    // 创建左侧导航
    const nav = document.createElement('nav');
    nav.className = 'winui3-page-nav';

    // 导航头部（返回键 + 标题）
    const navHeader = document.createElement('div');
    navHeader.className = 'winui3-nav-header';
    const origBackBtn = document.querySelector('header .btn-back');
    if (origBackBtn) {
        const backClone = origBackBtn.cloneNode(true);
        backClone.className = 'winui3-nav-back btn-back';
        backClone.id = 'winui3BackBtn';
        backClone.addEventListener('click', () => { window.history.back(); });
        navHeader.appendChild(backClone);
    }
    const navTitle = document.createElement('span');
    navTitle.className = 'winui3-nav-title';
    navTitle.textContent = t('designer.title', '设计器');
    // 挂 data-i18n，确保 i18n 数据就绪后 applyTranslations() 能重新翻译（与导航项同理）
    navTitle.setAttribute('data-i18n', 'designer.title');
    navHeader.appendChild(navTitle);
    nav.appendChild(navHeader);

    // 导航项（对应每个 section，按 data-section-id 映射 icon 和 i18n key）
    const ICON_MAP = {
        appearance: W3_ICONS.appearance,
        shape:      W3_ICONS.shape,
        light:      W3_ICONS.light,
        animation:  W3_ICONS.animation,
        reset:      W3_ICONS.layout,
        layout:     W3_ICONS.layout,
    };
    const LABEL_KEY = {
        appearance: 'designer.appearance',
        shape:      'designer.shape',
        light:      'designer.light',
        animation:  'designer.animation',
        reset:      'designer.resetSection',
        layout:     'designer.settingsLayout',
    };

    const navList = document.createElement('div');
    navList.className = 'winui3-nav-list';
    const sections = controls.querySelectorAll('.settings-section');
    sections.forEach((sec, i) => {
        const secId = sec.getAttribute('data-section-id') || ('sec' + i);
        const h2 = sec.querySelector('h2');
        const dataI18n = h2 ? h2.getAttribute('data-i18n') : null;
        const labelKey = LABEL_KEY[secId] || dataI18n;
        const fallback = h2 ? h2.textContent : ('Section ' + (i + 1));
        const label = t(labelKey, fallback);
        const icon = ICON_MAP[secId] || W3_ICONS.layout;

        const btn = document.createElement('button');
        btn.className = 'winui3-nav-item' + (i === 0 ? ' active' : '');
        btn.dataset.navSection = secId;
        // 挂 data-i18n，确保 i18n 数据就绪后 applyTranslations() 能重新翻译（导航项在 DOMContentLoaded 阶段构建，可能早于 i18n 加载完成）
        btn.innerHTML = '<span class="winui3-nav-icon">' + icon + '</span><span class="winui3-nav-label" data-i18n="' + labelKey + '">' + label + '</span>';
        btn.addEventListener('click', () => {
            sections.forEach(s => s.style.display = 'none');
            sec.style.display = 'block';
            sec.style.animation = 'sectionFadeIn 0.2s var(--ease-smooth) both';
            navList.querySelectorAll('.winui3-nav-item').forEach(n => n.classList.remove('active'));
            btn.classList.add('active');
        });
        navList.appendChild(btn);
    });
    nav.appendChild(navList);

    // 只显示第一个 section
    sections.forEach((sec, i) => { sec.style.display = i === 0 ? 'block' : 'none'; });

    // 将 header 隐藏（导航栏已含返回键）
    const header = document.querySelector('header');
    if (header) header.style.display = 'none';

    // 插入导航到 main 之前
    main.parentNode.insertBefore(nav, main);
}

// 移除 WinUI3 页面布局
function removeWinUI3PageLayout() {
    // 播放器 overlay：先还原 DOM（搬走的元素回原位 + 移除 w3-* 容器）
    try { restorePlayerWinUI3(); } catch (e) { console.warn('restorePlayerWinUI3 failed:', e); }
    // 音乐库：恢复 DOM
    const libNav = document.querySelector('.winui3-page-nav');
    if (libNav) {
        const wrapper = document.querySelector('.winui3-content-wrapper');
        if (wrapper) {
            const header = wrapper.querySelector('header');
            const main = wrapper.querySelector('main');
            if (header && main) {
                wrapper.parentNode.insertBefore(header, wrapper);
                wrapper.parentNode.insertBefore(main, wrapper);
            }
            wrapper.remove();
        }
        libNav.remove();
    }
    // 设计器：恢复 DOM
    const designerNav = document.querySelector('.winui3-page-nav');
    if (designerNav) {
        const header = document.querySelector('header');
        if (header) header.style.display = '';
        document.querySelectorAll('.designer-controls .settings-section').forEach(sec => { sec.style.display = ''; });
        designerNav.remove();
    }
}

// ============================================================
// WinUI3 Player Overlay Builder (player-overlay 新结构)
// 将既有 #coverImg / #trackName / #backBtn / #playBtn 等 DOM 搬入新的 WinUI3 结构，
// 以保持原有事件监听器不丢失，同时 CSS 控制新旧结构显示切换。
//
// 关键设计决策：
//   - 整体搬迁 lyricsWrapper（而非仅 lyricsContent），保证 player.js 中
//     lyricsWrapperEl.clientHeight 滚动计算在 New UI 下仍有效。
//   - SVG 仅清除 width/height 属性，保留 viewBox，避免图标比例失调。
//   - 滑块继续复用旧 .track-bg / .progress-fill 元素（player.js 通过
//     updateProgressFill 直接操作其 style.width），CSS 不再使用 ::after 伪填充，
//     消除"双重填充条"问题。
//   - 返回按钮置于左上 header 内，符合 WinUI3 NavigationView 返回锚点惯例。
// ============================================================
function applyPlayerWinUI3() {
    const overlay = document.getElementById('player-overlay');
    if (!overlay || overlay.dataset.wui3Player === 'true') return;
    const container = overlay.querySelector(':scope > .player-container');
    if (!container) return;

    // i18n helper：支持 fallback + 占位符参数传递
    const t = (key, ...args) => {
        try {
            if (window.i18n && typeof window.i18n.t === 'function') {
                const v = window.i18n.t(key, ...args);
                if (v !== undefined && v !== null) return v;
            }
            if (window.I18N && typeof window.I18N.t === 'function') {
                const v = window.I18N.t(key, ...args);
                if (v !== undefined && v !== null) return v;
            }
        } catch (e) {}
        // 兜底：若 args[0] 是字符串（即 fallback），返回它；否则返回原始 key
        if (args.length > 0 && typeof args[0] === 'string') return args[0];
        return key;
    };

    // SVG 清理：仅移除 width/height 属性让 CSS 接管尺寸，保留 viewBox 保证缩放比例。
    // 同时将原始 width/height 暂存到 dataset，供 restorePlayerWinUI3 还原。
    const cleanSvg = (el) => {
        if (!el) return;
        const svgs = el.tagName === 'SVG' ? [el] : Array.from(el.querySelectorAll('svg'));
        svgs.forEach(svg => {
            if (svg.dataset.w3OrigW === undefined) {
                svg.dataset.w3OrigW = svg.getAttribute('width') || '';
                svg.dataset.w3OrigH = svg.getAttribute('height') || '';
            }
            svg.removeAttribute('width');
            svg.removeAttribute('height');
            svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        });
    };

    // 取出旧元素（带事件监听器，通过 id 保持 player.js 引用有效）
    const oldCover = document.getElementById('coverImg');
    const oldTrackName = document.getElementById('trackName');
    const oldArtist = document.getElementById('artistName');
    const oldLyricsWrapper = document.getElementById('lyricsWrapper');
    const oldLyricsContent = document.getElementById('lyricsContent');
    const oldLyrPrevBtn = document.getElementById('lyricPrevBtn');
    const oldLyrNextBtn = document.getElementById('lyricNextBtn');
    const oldFSToggleBtn = document.getElementById('expandFullscreenBtn');
    const oldProgress = document.querySelector('.progress-area');
    const oldCurt = document.getElementById('currentTime');
    const oldTota = document.getElementById('totalDuration');
    const oldSeek = document.getElementById('seekSlider');
    const oldSeekFill = document.getElementById('seekProgress');
    const oldSeekBg = oldProgress ? oldProgress.querySelector('.track-bg') : null;
    const oldLoop = document.getElementById('loopBtn');
    const oldPrev = document.getElementById('prevBtn');
    const oldPlay = document.getElementById('playBtn');
    const oldNext = document.getElementById('nextBtn');
    const oldEq = document.getElementById('eqBtn');
    const oldQueue = document.getElementById('queueBtn');
    const oldBack = document.getElementById('backBtn');
    const oldVolCtrl = document.querySelector('.volume-control');
    const oldVolIcon = document.getElementById('volIcon');
    const oldVolSlider = document.getElementById('volSlider');
    const oldVolFill = document.getElementById('volProgress');

    // 预记录所有将搬动元素的原始位置（parent + previousElementSibling），
    // 供 restorePlayerWinUI3 还原。必须在任何 appendChild 之前采集，
    // 否则 previousElementSibling 会随搬动而改变。
    const toMove = [
        oldBack, oldCover, oldTrackName, oldArtist, oldLyricsWrapper,
        oldSeekBg, oldSeekFill, oldSeek, oldCurt, oldTota,
        oldLoop, oldEq, oldQueue, oldPrev, oldPlay, oldNext, oldVolCtrl
    ].filter(Boolean);
    overlay._w3Moves = toMove.map(el => ({
        el, parent: el.parentNode, prev: el.previousElementSibling
    }));

    // ============================================================
    // 0) 顶部 header：左返回 + 右占位（保持 grid 三行结构）
    // ============================================================
    const header = document.createElement('div');
    header.className = 'w3-player-header';
    if (oldBack) {
        oldBack.classList.add('w3-back-btn');
        oldBack.setAttribute('data-i18n-title', 'player.backToLibrary');
        oldBack.title = t('player.backToLibrary', '返回音乐库');
        cleanSvg(oldBack);
        header.appendChild(oldBack);
    }

    // ============================================================
    // 1) Content (中部：左封面+信息 / 右歌词)
    // ============================================================
    const content = document.createElement('div');
    content.className = 'w3-player-content';

    const pcLeft = document.createElement('div');
    pcLeft.className = 'w3-pc-left';
    const coverWrap = document.createElement('div');
    coverWrap.className = 'w3-cover-wrap';
    if (oldCover) {
        oldCover.classList.add('w3-cover');
        coverWrap.appendChild(oldCover);
    }
    pcLeft.appendChild(coverWrap);

    const info = document.createElement('div');
    info.className = 'w3-track-info';
    if (oldTrackName) {
        oldTrackName.classList.add('w3-track-title');
        info.appendChild(oldTrackName);
    }
    if (oldArtist) {
        oldArtist.classList.add('w3-track-artist');
        info.appendChild(oldArtist);
    }
    pcLeft.appendChild(info);

    const pcRight = document.createElement('div');
    pcRight.className = 'w3-pc-right';
    const lyrCard = document.createElement('div');
    lyrCard.className = 'w3-lyrics-card';

    // 歌词工具栏：上一句 / 全屏切换 / 下一句
    const lyrTool = document.createElement('div');
    lyrTool.className = 'w3-lyrics-toolbar';
    const makeLyrBtn = (oldBtn, titleKey, titleFallback) => {
        if (!oldBtn) return null;
        const b = document.createElement('button');
        b.className = 'w3-lyrics-btn';
        b.type = 'button';
        b.title = t(titleKey, titleFallback);
        b.setAttribute('data-i18n-title', titleKey);
        b.innerHTML = oldBtn.innerHTML;
        cleanSvg(b);
        b.addEventListener('click', (e) => { e.stopPropagation(); oldBtn.click(); });
        return b;
    };
    const fsBtn = makeLyrBtn(oldFSToggleBtn, 'player.fullscreenLyrics', '全屏歌词');
    if (fsBtn) lyrTool.appendChild(fsBtn);
    lyrCard.appendChild(lyrTool);

    // 歌词内容：整体搬迁 lyricsWrapper（保留 player.js 的 clientHeight 滚动计算）
    if (oldLyricsWrapper) {
        oldLyricsWrapper.classList.add('w3-lyrics-wrapper');
        lyrCard.appendChild(oldLyricsWrapper);
        // 持续为新生成的 .lyric-line 注入 w3-lyric-line 类
        if (oldLyricsContent) {
            oldLyricsContent.querySelectorAll('.lyric-line').forEach(l => l.classList.add('w3-lyric-line'));
            new MutationObserver(() => {
                oldLyricsContent.querySelectorAll('.lyric-line:not(.w3-lyric-line)').forEach(l => l.classList.add('w3-lyric-line'));
            }).observe(oldLyricsContent, { childList: true });
        }
    }
    pcRight.appendChild(lyrCard);

    content.appendChild(pcLeft);
    content.appendChild(pcRight);

    // ============================================================
    // 2) 紧凑 Playback Controls (底部：进度 + 控件)
    // ============================================================
    const bottom = document.createElement('div');
    bottom.className = 'w3-player-bottom';

    const progRow = document.createElement('div');
    progRow.className = 'w3-progress-row';
    const curt = document.createElement('span');
    curt.className = 'w3-time';
    if (oldCurt) curt.appendChild(oldCurt); else curt.textContent = '0:00';
    const tota = document.createElement('span');
    tota.className = 'w3-time';
    if (oldTota) tota.appendChild(oldTota); else tota.textContent = '0:00';
    const seekSlider = document.createElement('div');
    seekSlider.className = 'w3-slider w3-seek-slider';
    if (oldSeekBg) seekSlider.appendChild(oldSeekBg);
    if (oldSeekFill) seekSlider.appendChild(oldSeekFill);
    if (oldSeek) seekSlider.appendChild(oldSeek);
    progRow.appendChild(curt);
    progRow.appendChild(seekSlider);
    progRow.appendChild(tota);
    bottom.appendChild(progRow);

    const ctrlRow = document.createElement('div');
    ctrlRow.className = 'w3-controls-row';
    const crLeft = document.createElement('div');
    crLeft.className = 'w3-cr-left';
    const crCenter = document.createElement('div');
    crCenter.className = 'w3-cr-center';
    const crRight = document.createElement('div');
    crRight.className = 'w3-cr-right';

    // 按钮搬迁：保留 id 与状态类（active / btn-pause 等），仅追加 w3-ctrl-btn 类。
    // CSS 通过更高优先级选择器覆盖旧 .btn 样式，无需 !important 战争。
    const moveBtn = (oldBtn, extraClass) => {
        if (!oldBtn) return;
        oldBtn.classList.add('w3-ctrl-btn');
        if (extraClass) oldBtn.classList.add(extraClass);
        cleanSvg(oldBtn);
        return oldBtn;
    };

    crLeft.appendChild(moveBtn(oldLoop) || document.createElement('span'));
    crLeft.appendChild(moveBtn(oldEq, 'w3-tool-btn') || document.createElement('span'));
    crLeft.appendChild(moveBtn(oldQueue, 'w3-tool-btn') || document.createElement('span'));

    crCenter.appendChild(moveBtn(oldPrev) || document.createElement('span'));
    crCenter.appendChild(moveBtn(oldPlay, 'w3-play-btn') || document.createElement('span'));
    crCenter.appendChild(moveBtn(oldNext) || document.createElement('span'));

    // 右：音量（整组搬迁，内部 slider 容器加 w3-slider 类）
    if (oldVolCtrl) {
        oldVolCtrl.classList.add('w3-volume');
        const sliderBox = oldVolCtrl.querySelector('.volume-slider-container');
        if (sliderBox) sliderBox.classList.add('w3-slider', 'w3-vol-slider');
        if (oldVolIcon) {
            oldVolIcon.classList.add('w3-volume-icon');
            cleanSvg(oldVolIcon);
        }
        crRight.appendChild(oldVolCtrl);
    }

    ctrlRow.appendChild(crLeft);
    ctrlRow.appendChild(crCenter);
    ctrlRow.appendChild(crRight);
    bottom.appendChild(ctrlRow);

    // ============================================================
    // 组装：header → content → bottom
    // ============================================================
    container.appendChild(header);
    container.appendChild(content);
    container.appendChild(bottom);

    // 隐藏旧结构（info-and-controls 与 album-art-wrapper 已被搬空，但仍保留壳）
    const oldInfo = container.querySelector(':scope > .info-and-controls');
    const oldAlbumWrap = container.querySelector(':scope > .album-art-wrapper');
    if (oldInfo) oldInfo.style.display = 'none';
    if (oldAlbumWrap) oldAlbumWrap.style.display = 'none';

    overlay.dataset.wui3Player = 'true';

    // 重新应用 i18n（新生成的 DOM 带有 data-i18n-title 属性）
    try {
        if (typeof window.applyTranslations === 'function') window.applyTranslations();
        else if (window.i18n && typeof window.i18n.applyTranslations === 'function') window.i18n.applyTranslations();
    } catch (e) {}
}

// ============================================================
// restorePlayerWinUI3：将 applyPlayerWinUI3 搬走的元素还原到原始位置，
// 并移除新创建的 w3-* 容器。用于关闭 New UI 时恢复播放器原始结构。
// 依据 overlay._w3Moves（预记录的 parent + previousElementSibling）按
// 原始顺序逐个插回，保证按钮/滑块等元素回到正确的 DOM 位置。
// ============================================================
function restorePlayerWinUI3() {
    const overlay = document.getElementById('player-overlay');
    if (!overlay || overlay.dataset.wui3Player !== 'true') return;
    const container = overlay.querySelector(':scope > .player-container');
    const moves = overlay._w3Moves;

    // 1) 先把搬走的元素放回原 parent（此时 w3-* 容器仍存在，元素从其中取出）
    if (moves && moves.length) {
        // 按 parent 分组，组内按 previousElementSibling 链还原原始顺序
        const byParent = new Map();
        moves.forEach(m => {
            if (!m.el || !m.parent) return;
            if (!byParent.has(m.parent)) byParent.set(m.parent, []);
            byParent.get(m.parent).push(m);
        });
        byParent.forEach(list => {
            // 用 prev 链推导原始顺序：prev=null 最先，之后按链拼接
            const byPrev = new Map();
            let head = null;
            list.forEach(m => {
                if (m.prev === null) head = m;
                else byPrev.set(m.prev, m);
            });
            const ordered = [];
            let cur = head;
            // 兜底：若链断开（head 为空），退回原数组顺序
            if (!head && list.length) ordered.push(...list);
            let guard = 0;
            while (cur && guard++ < list.length + 1) {
                ordered.push(cur);
                cur = byPrev.get(cur.el) || null;
            }
            ordered.forEach(({ el, parent, prev }) => {
                try {
                    if (prev && prev.parentNode === parent) {
                        parent.insertBefore(el, prev.nextSibling);
                    } else if (prev === null) {
                        parent.insertBefore(el, parent.firstChild);
                    } else {
                        parent.appendChild(el);
                    }
                } catch (e) {
                    try { parent.appendChild(el); } catch (_) {}
                }
            });
        });
    }

    // 2) 移除新创建的 w3-* 容器（此时元素已取出，容器为空壳）
    if (container) {
        container.querySelectorAll(':scope > .w3-player-header, :scope > .w3-player-content, :scope > .w3-player-bottom').forEach(el => el.remove());
    }

    // 3) 显示旧壳
    if (container) {
        const oldInfo = container.querySelector(':scope > .info-and-controls');
        const oldAlbumWrap = container.querySelector(':scope > .album-art-wrapper');
        if (oldInfo) oldInfo.style.display = '';
        if (oldAlbumWrap) oldAlbumWrap.style.display = '';
    }

    // 4) 清理 w3-* 类与 SVG 属性还原
    if (moves && moves.length) {
        moves.forEach(({ el }) => {
            if (!el || !el.classList) return;
            Array.from(el.classList).forEach(c => { if (c.startsWith('w3-')) el.classList.remove(c); });
            el.querySelectorAll('svg').forEach(svg => {
                if (svg.dataset.w3OrigW !== undefined) {
                    const w = svg.dataset.w3OrigW;
                    const h = svg.dataset.w3OrigH;
                    if (w) svg.setAttribute('width', w); else svg.removeAttribute('width');
                    if (h) svg.setAttribute('height', h); else svg.removeAttribute('height');
                    delete svg.dataset.w3OrigW;
                    delete svg.dataset.w3OrigH;
                }
                svg.removeAttribute('preserveAspectRatio');
            });
        });
    }

    delete overlay._w3Moves;
    overlay.dataset.wui3Player = '';
}

// DOMContentLoaded 后应用 WinUI3 页面布局
function applyWinUI3PageLayout() {
    if (document.body.getAttribute('data-new-ui') !== 'true') {
        removeWinUI3PageLayout();
        return;
    }
    const page = document.body.getAttribute('data-page');
    if (page === 'libraries') {
        applyLibrariesWinUI3();
        // Player 结构（在 libraries.html 内）需要在 DOM ready 后重组
        try { applyPlayerWinUI3(); } catch (e) { console.warn('applyPlayerWinUI3 failed:', e); }
    } else if (page === 'designer') {
        applyDesignerWinUI3();
    }
}

// 在 DOMContentLoaded 时调用
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyWinUI3PageLayout);
} else {
    applyWinUI3PageLayout();
}
