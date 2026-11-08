// settings-apply.js — 设置应用入口
// 具体能力已拆分到 ./settings/*：
//   theme / design-tokens / background / player-contrast / manager / winui3 / i18n-update
// 本文件只负责：
//   1. 暴露 window.MusicLiteSettings 兼容全局
//   2. DOMContentLoaded 后应用后端设置
//   3. 首屏前用 localStorage 同步关键视觉状态，避免闪烁
//   4. WinUI3 页面布局的启动钩子
import { SettingsManager } from './settings/manager.js';
import { PlayerContrast } from './settings/player-contrast.js';
import { applyDesignTokens, applySettingsLayout, applyNewUI } from './settings/design-tokens.js';
import { applyWindowAlpha, applyPlayerBgBlur, injectBgCSSOnce } from './settings/background.js';
import { applyWinUI3PageLayout } from './settings/winui3.js';

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

// 同步应用播放器封面背景模糊（在 DOMContentLoaded 之前应用，避免播放器背景闪到无模糊默认值）
(function syncApplyPlayerBgBlur() {
    try {
        const v = localStorage.getItem('musicLite.playerBgBlur');
        if (v !== null) applyPlayerBgBlur(parseInt(v, 10));
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

// 在 DOMContentLoaded 时调用 WinUI3 页面布局
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyWinUI3PageLayout);
} else {
    applyWinUI3PageLayout();
}
