// 全页面背景层、Aero 透明与模糊：注入公共 CSS 并按设置重建背景层
import { BG_CSS } from './background-css.js';

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
export function injectBgCSSOnce() {
    if (_bgCssInjected) return;
    _bgCssInjected = true;

    const style = document.createElement('style');
    style.id = 'ml-bg-css';
    style.setAttribute('type', 'text/css');
    style.textContent = BG_CSS;
    (document.head || document.documentElement).appendChild(style);
}

// 应用整窗透明度（Aero）：范围 0.01 - 1.0
// 核心重构：不再使用 html { opacity }，而是通过 rgba 背景色透明度 + backdrop-filter 实现 Aero
// 参数含义：val=1 完全不透明；val 越小越能透出桌面（但前景文字保持清晰）
export function applyWindowAlpha(val) {
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
        root.style.removeProperty('--aero-w3-canvas-alpha');
        root.style.removeProperty('--aero-w3-card-alpha');
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
        root.style.setProperty('--aero-modal-alpha', modalA.toFixed(3));
        root.style.setProperty('--aero-border-alpha', borderA.toFixed(3));
        try { localStorage.setItem('musicLite.windowAlpha', String(v)); } catch (e) {}
    }
}

// 应用 Aero 透明模式模糊量（独立于 design_blur，仅影响 Aero 模式下的 backdrop-filter）
// 参数：blurPx (0-40)，0=完全关闭模糊（降低 GPU 占用）
export function applyAeroBlur(blurPx) {
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

// 应用播放器封面背景模糊量（px，0-30）。
// 作用于新/旧 UI 共用的 .player-bg-layer，通过 CSS 变量 --player-bg-blur 驱动，
// 由 CSS filter: blur(var(--player-bg-blur)) 在两侧 UI 消费。
export function applyPlayerBgBlur(blurPx) {
    const root = document.documentElement;
    const v = isFinite(blurPx) ? Math.max(0, Math.min(30, blurPx)) : 20;
    root.style.setProperty('--player-bg-blur', v + 'px');
    // 持久化到 localStorage，供首屏快速恢复（避免闪到默认值）
    try { localStorage.setItem('musicLite.playerBgBlur', String(v)); } catch (e) {}
}

// 应用全页面背景（图片或视频）
// 思路：独立全屏层 <img>/<video> + 遮罩层；仅切换 html 根节点 data-attribute 让 CSS 统一生效，避免 inline 残留
export function applyBackground(opts) {
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
    // 毛玻璃关闭开关
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
