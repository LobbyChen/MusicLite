// 视觉设计令牌与界面状态：歌词动画、圆角/模糊/阴影、动画级别、设置页布局、新 UI 开关
export function applyLyricAnimation(mode) {
    const validModes = ['fade', 'slide-up', 'slide-left', 'zoom', 'bounce', 'spring', 'flip', 'rotate', 'none'];
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
export function applyDesignTokens(radius, blur, animMult, shadow, glow, textGlow) {
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
export function applyAnimationLevel(level) {
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

// 应用设置界面布局：强制 tabs 选项卡（已移除 scroll / columns 布局选择）—— 仅设置页生效
export function applySettingsLayout() {
    const m = 'tabs';
    if (document.body) {
        // 只有设置页才应用布局模式，其他页面不设置 data-settings-layout
        if (document.body.getAttribute('data-page') === 'settings') {
            document.body.setAttribute('data-settings-layout', m);
        }
    }
    try { localStorage.setItem('musicLite.settingsLayout', m); } catch (e) {}
}

// 应用新风格 UI 开关
export function applyNewUI(enabled) {
    if (document.body) {
        document.body.setAttribute('data-new-ui', enabled ? 'true' : 'false');
    }
    try { localStorage.setItem('musicLite.newUIEnabled', enabled ? '1' : '0'); } catch (e) {}
}
