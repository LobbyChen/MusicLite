// 外观设置：主题色、动画级别、设计令牌、背景、设置页布局与 WinUI3 导航
import { t } from '../../core/i18n.js';
import * as dom from './dom.js';
import { state, markChanged, revertNewUIPreview } from './state.js';
import { showConfirm } from './confirm.js';

// 同步四级动画选择器 UI 与 body data-anim 属性
export function setAnimationLevel(level) {
    const clamped = Math.max(0, Math.min(3, level | 0));
    // 选中高亮按钮（只处理有 data-level 属性的动画级别按钮，避免误操作音量模式等其他 .anim-level-btn）
    dom.animLevelBtns.forEach(btn => {
        if (btn.dataset.level === undefined) return;
        const active = parseInt(btn.dataset.level, 10) === clamped;
        btn.classList.toggle('active', active);
    });
    document.body.setAttribute('data-anim', clamped.toString());
    // 兼容旧逻辑：level 0 时添加 .no-anim（让原 no-anim 规则也生效）
    document.body.classList.toggle('no-anim', clamped === 0);
    // 持久化到 localStorage，供 settings-apply.js 启动时同步读取（避免首屏闪烁）
    try { localStorage.setItem('musicLite.animationsLevel', clamped.toString()); } catch (e) { }
    return clamped;
}

// ============ 设置界面布局：强制 tabs 选项卡 ============
export function applySettingsLayoutMode() {
    const m = 'tabs';
    document.body.setAttribute('data-settings-layout', m);
    if (window.MusicLiteSettings) window.MusicLiteSettings.applySettingsLayout(m);
    // 始终生成选项卡栏
    const existingTabs = document.querySelector('.settings-tabs');
    if (!existingTabs) {
        generateTabBar();
    }
    // 默认激活第一个选项卡
    const firstTab = document.querySelector('.settings-tab');
    if (firstTab) switchTab(firstTab.dataset.tabTarget);
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

// ============ 设计令牌 / 背景控件（原设计器并入） ============
export function applyDesignTokensLive() {
    if (!state.currentSettings) return;
    if (window.MusicLiteSettings && window.MusicLiteSettings.applyDesignTokens) {
        window.MusicLiteSettings.applyDesignTokens(
            state.currentSettings.design_radius,
            state.currentSettings.design_blur,
            state.currentSettings.design_anim_mult,
            state.currentSettings.design_shadow,
            state.currentSettings.design_glow,
            state.currentSettings.design_text_glow
        );
    }
}

function setBgUIForType(type) {
    const showSubOptions = type === 'image';
    if (dom.bgFileItem) dom.bgFileItem.style.display = showSubOptions ? '' : 'none';
    if (dom.bgPickImageBtn) dom.bgPickImageBtn.style.display = type === 'image' ? '' : 'none';
    if (dom.bgFitItem) dom.bgFitItem.style.display = showSubOptions ? '' : 'none';
    if (dom.bgOpacityItem) dom.bgOpacityItem.style.display = showSubOptions ? '' : 'none';
    if (dom.bgOverlayItem) dom.bgOverlayItem.style.display = showSubOptions ? '' : 'none';
    if (dom.bgBlurItem) dom.bgBlurItem.style.display = showSubOptions ? '' : 'none';
    if (dom.bgGlassItem) dom.bgGlassItem.style.display = showSubOptions ? '' : 'none';
    if (dom.bgClearFileBtn) dom.bgClearFileBtn.style.display = (state.currentSettings && state.currentSettings.bg_url) ? '' : 'none';
}

function previewBackgroundNow() {
    if (!window.MusicLiteSettings || !state.currentSettings) return;
    window.MusicLiteSettings.applyBackground({
        bg_type: state.currentSettings.bg_type,
        bg_url: state.currentSettings.bg_url,
        bg_fit: state.currentSettings.bg_fit,
        bg_opacity: state.currentSettings.bg_opacity,
        bg_overlay: state.currentSettings.bg_overlay,
        bg_blur: state.currentSettings.bg_blur,
        bg_loop: state.currentSettings.bg_loop,
        bg_muted: state.currentSettings.bg_muted,
        bg_glass_disabled: state.currentSettings.bg_glass_disabled,
        theme: state.currentSettings.theme || 'dark',
    });
}

function previewWindowAlphaNow() {
    if (!window.MusicLiteSettings || !state.currentSettings) return;
    window.MusicLiteSettings.applyWindowAlpha(state.currentSettings.window_alpha);
    if (window.MusicLiteSettings.applyAeroBlur) {
        window.MusicLiteSettings.applyAeroBlur(state.currentSettings.aero_blur);
    }
}

function previewPlayerBgBlurNow() {
    if (!window.MusicLiteSettings || !state.currentSettings) return;
    if (window.MusicLiteSettings.applyPlayerBgBlur) {
        window.MusicLiteSettings.applyPlayerBgBlur(state.currentSettings.player_bg_blur);
    }
}

// 把后端设置同步到设计令牌 / 背景控件
export function applyDesignerControlsToUI(s) {
    if (!s) return;
    if (dom.radiusSlider) {
        dom.radiusSlider.value = s.design_radius ?? 10;
        if (dom.radiusValue) dom.radiusValue.textContent = (s.design_radius ?? 10) + 'px';
    }
    if (dom.blurSlider) {
        dom.blurSlider.value = s.design_blur ?? 16;
        if (dom.blurValue) dom.blurValue.textContent = (s.design_blur ?? 16) + 'px';
    }
    if (dom.shadowSlider) {
        dom.shadowSlider.value = s.design_shadow ?? 0.45;
        if (dom.shadowValue) dom.shadowValue.textContent = Math.round((s.design_shadow ?? 0.45) * 100) + '%';
    }
    if (dom.glowSlider) {
        dom.glowSlider.value = s.design_glow ?? 0.35;
        if (dom.glowValue) dom.glowValue.textContent = Math.round((s.design_glow ?? 0.35) * 100) + '%';
    }
    if (dom.textGlowSlider) {
        dom.textGlowSlider.value = s.design_text_glow ?? 0;
        if (dom.textGlowValue) dom.textGlowValue.textContent = Math.round((s.design_text_glow ?? 0) * 100) + '%';
    }
    if (dom.animSpeedSlider) {
        dom.animSpeedSlider.value = s.design_anim_mult ?? 1;
        if (dom.animSpeedValue) dom.animSpeedValue.textContent = (s.design_anim_mult ?? 1).toFixed(1) + '×';
    }

    // 背景
    const bgType = (s.bg_type === 'image') ? s.bg_type : 'none';
    dom.bgTypeBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.bgType === bgType));
    const bgFit = (['cover', 'contain', 'fill', 'none', 'scaledown'].includes(s.bg_fit)) ? s.bg_fit : 'cover';
    dom.bgFitBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.bgFit === bgFit));
    const bgGlassOff = Boolean(s.bg_glass_disabled);
    dom.bgGlassBtns.forEach(btn => btn.classList.toggle('active', (btn.dataset.bgGlass === 'on') === bgGlassOff));

    const bgOp = typeof s.bg_opacity === 'number' ? Math.max(0, Math.min(1, s.bg_opacity)) : 0.9;
    if (dom.bgOpacitySlider) { dom.bgOpacitySlider.value = Math.round(bgOp * 100); }
    if (dom.bgOpacityValue) { dom.bgOpacityValue.textContent = Math.round(bgOp * 100) + '%'; }

    const bgOv = typeof s.bg_overlay === 'number' ? Math.max(0, Math.min(1, s.bg_overlay)) : 0.2;
    if (dom.bgOverlaySlider) { dom.bgOverlaySlider.value = Math.round(bgOv * 100); }
    if (dom.bgOverlayValue) { dom.bgOverlayValue.textContent = Math.round(bgOv * 100) + '%'; }

    const bgBl = typeof s.bg_blur === 'number' ? Math.max(0, Math.min(30, s.bg_blur)) : 0;
    if (dom.bgBlurSlider) { dom.bgBlurSlider.value = bgBl; }
    if (dom.bgBlurValue) { dom.bgBlurValue.textContent = bgBl + ' px'; }

    const wa = typeof s.window_alpha === 'number' ? Math.max(0.2, Math.min(1, s.window_alpha)) : 1;
    if (dom.windowAlphaSlider) { dom.windowAlphaSlider.value = Math.round(wa * 100); }
    if (dom.windowAlphaValue) { dom.windowAlphaValue.textContent = Math.round(wa * 100) + '%'; }

    const ab = typeof s.aero_blur === 'number' ? Math.max(0, Math.min(40, s.aero_blur)) : 0;
    if (dom.aeroBlurSlider) { dom.aeroBlurSlider.value = ab; }
    if (dom.aeroBlurValue) { dom.aeroBlurValue.textContent = ab + 'px'; }

    const pbb = typeof s.player_bg_blur === 'number' ? Math.max(0, Math.min(30, s.player_bg_blur)) : 20;
    if (dom.playerBgBlurSlider) { dom.playerBgBlurSlider.value = pbb; }
    if (dom.playerBgBlurValue) { dom.playerBgBlurValue.textContent = pbb + 'px'; }

    if (dom.bgFileNameEl) {
        if (s.bg_url) {
            let name = s.bg_url;
            if (name.startsWith('data:')) {
                name = '已加载图片（已保存）';
            } else {
                try { name = name.split(/[\\/]/).pop() || name; } catch (e) {}
            }
            dom.bgFileNameEl.textContent = name;
        } else {
            dom.bgFileNameEl.textContent = '';
        }
    }
    setBgUIForType(bgType);
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
export function applyWinUI3Layout() {
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
            if (state.hasChanges) {
                const ok = await showConfirm(t('settings.discardConfirm'), {
                    title: t('settings.discardTitle'), okText: t('settings.discardBtn'), cancelText: t('settings.stayBtn'), danger: true
                });
                if (ok) {
                    revertNewUIPreview();
                    window.history.back();
                }
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
export function removeWinUI3Layout() {
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

export function showOrHideAccentItem(theme) {
    const isCustom = theme === 'custom';
    if (dom.accentColorItem) {
        // 只有"主题色"(custom)模式才显示取色盘，深色/浅色/墨绿使用固定配色
        dom.accentColorItem.style.display = isCustom ? 'block' : 'none';
    }
    if (dom.customThemeModeItem) {
        dom.customThemeModeItem.style.display = isCustom ? 'block' : 'none';
    }
}

export function applyAccentToUI() {
    const c = state.currentSettings?.accent_color || state.currentSettings?.AccentColor || '#1DB954';
    const theme = state.currentSettings?.theme || 'dark';
    const customMode = state.currentSettings?.custom_theme_mode === 'light' ? 'light' : 'dark';
    // 调用全局 applyAccentColor，自动算出全套配套色
    if (window.MusicLiteSettings) {
        window.MusicLiteSettings.applyAccentColor(c, theme, customMode);
    } else {
        document.documentElement.style.setProperty('--accent-color', normalizeColor(c));
        document.body.style.setProperty('--accent-color', normalizeColor(c));
    }
}

export function normalizeColor(c) {
    if (!c) return '#1DB954';
    c = c.trim();
    if (!c.startsWith('#')) c = '#' + c;
    if (c.length === 4) c = '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
    return c.toLowerCase();
}

export function highlightPreset(color) {
    const c = normalizeColor(color);
    dom.presetColors.forEach(p => {
        p.classList.toggle('active', normalizeColor(p.dataset.color || '') === c);
    });
}

// Apply theme to body
export function applyTheme() {
    const theme = state.currentSettings?.theme || 'dark';
    // 自定义主题按明暗基调映射到 light/dark，保证依赖 data-theme 的 CSS 正确命中
    const effective = theme === 'custom'
        ? (state.currentSettings?.custom_theme_mode === 'light' ? 'light' : 'dark')
        : theme;
    document.body.setAttribute('data-theme', effective);
    document.documentElement.setAttribute('data-theme', effective);
}

// ============ 外观相关事件绑定 ============
export function bindAppearanceEvents() {
    // Theme buttons
    dom.themeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            dom.themeButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.currentSettings.theme = btn.dataset.theme;
            applyTheme();
            // 切换主题时显示/隐藏取色盘（仅 custom 主题显示，dark/light/accent 使用固定配色）
            showOrHideAccentItem(state.currentSettings.theme);
            // 主题切换后重新计算配套色（applyAccentToUI 内部会根据新 theme 选择固定配色或动态计算）
            applyAccentToUI();
            markChanged();
        });
    });

    // Accent color picker
    dom.accentColorInput.addEventListener('input', () => {
        const v = dom.accentColorInput.value;
        dom.accentColorText.value = v;
        state.currentSettings.accent_color = v;
        applyAccentToUI();
        highlightPreset(v);
        markChanged();
    });
    dom.accentColorText.addEventListener('input', () => {
        let v = dom.accentColorText.value.trim();
        if (/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(v)) v = '#' + v;
        if (/^#[0-9a-fA-F]{3}$|^#[0-9a-fA-F]{6}$/.test(v)) {
            const norm = normalizeColor(v);
            dom.accentColorInput.value = norm;
            state.currentSettings.accent_color = norm;
            applyAccentToUI();
            highlightPreset(norm);
            markChanged();
        }
    });
    dom.accentColorText.addEventListener('blur', () => {
        const cur = state.currentSettings.accent_color || '#1DB954';
        dom.accentColorText.value = cur;
    });
    dom.presetColors.forEach(p => {
        p.addEventListener('click', () => {
            const c = p.dataset.color;
            dom.accentColorInput.value = c;
            dom.accentColorText.value = c;
            state.currentSettings.accent_color = c;
            applyAccentToUI();
            highlightPreset(c);
            markChanged();
        });
    });

    // 界面动画级别选择器
    dom.animLevelBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const lvl = parseInt(btn.dataset.level, 10) || 0;
            state.currentSettings.animation_level = lvl;
            setAnimationLevel(lvl);
            markChanged();
        });
    });

    // 自定义主题色明暗基调
    dom.customThemeModeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const mode = btn.dataset.customThemeMode === 'light' ? 'light' : 'dark';
            state.currentSettings.custom_theme_mode = mode;
            dom.customThemeModeBtns.forEach(b => b.classList.toggle('active', b === btn));
            applyTheme();
            applyAccentToUI();
            markChanged();
        });
    });

    // 新风格 UI 开关
    dom.newUIModeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const on = btn.dataset.newuiMode === 'on';
            state.currentSettings.new_ui_enabled = on;
            dom.newUIModeBtns.forEach(b => b.classList.toggle('active', b === btn));
            if (window.MusicLiteSettings) window.MusicLiteSettings.applyNewUI(on);
            // 新UI 开启时切换为 WinUI3 NavigationView 布局；关闭时强制 tabs 选项卡布局
            if (on) {
                applyWinUI3Layout();
            } else {
                removeWinUI3Layout();
                applySettingsLayoutMode();
            }
            markChanged();
        });
    });

    // ============ 设计令牌 / 背景控件（原设计器并入） ============
    // 圆角
    if (dom.radiusSlider) dom.radiusSlider.addEventListener('input', () => {
        const v = parseFloat(dom.radiusSlider.value) || 0;
        state.currentSettings.design_radius = v;
        dom.radiusValue.textContent = v + 'px';
        applyDesignTokensLive();
        markChanged();
    });
    // 模糊
    if (dom.blurSlider) dom.blurSlider.addEventListener('input', () => {
        const v = parseInt(dom.blurSlider.value, 10) || 0;
        state.currentSettings.design_blur = v;
        dom.blurValue.textContent = v + 'px';
        applyDesignTokensLive();
        markChanged();
    });
    // 阴影
    if (dom.shadowSlider) dom.shadowSlider.addEventListener('input', () => {
        const v = parseFloat(dom.shadowSlider.value) || 0;
        state.currentSettings.design_shadow = v;
        dom.shadowValue.textContent = Math.round(v * 100) + '%';
        applyDesignTokensLive();
        markChanged();
    });
    // 辉光
    if (dom.glowSlider) dom.glowSlider.addEventListener('input', () => {
        const v = parseFloat(dom.glowSlider.value) || 0;
        state.currentSettings.design_glow = v;
        dom.glowValue.textContent = Math.round(v * 100) + '%';
        applyDesignTokensLive();
        markChanged();
    });
    // 字体晕影
    if (dom.textGlowSlider) dom.textGlowSlider.addEventListener('input', () => {
        const v = parseFloat(dom.textGlowSlider.value) || 0;
        state.currentSettings.design_text_glow = v;
        dom.textGlowValue.textContent = Math.round(v * 100) + '%';
        applyDesignTokensLive();
        markChanged();
    });
    // 动画速度
    if (dom.animSpeedSlider) dom.animSpeedSlider.addEventListener('input', () => {
        const v = parseFloat(dom.animSpeedSlider.value) || 1;
        state.currentSettings.design_anim_mult = v;
        dom.animSpeedValue.textContent = v.toFixed(1) + '×';
        applyDesignTokensLive();
        markChanged();
    });
    // 背景类型
    dom.bgTypeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            dom.bgTypeBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.currentSettings.bg_type = btn.dataset.bgType;
            setBgUIForType(state.currentSettings.bg_type);
            previewBackgroundNow();
            markChanged();
        });
    });
    // 背景适配方式
    dom.bgFitBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            dom.bgFitBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.currentSettings.bg_fit = btn.dataset.bgFit;
            previewBackgroundNow();
            markChanged();
        });
    });
    // 容器毛玻璃开关
    dom.bgGlassBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            dom.bgGlassBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.currentSettings.bg_glass_disabled = (btn.dataset.bgGlass === 'on');
            previewBackgroundNow();
            markChanged();
        });
    });
    // 选择图片
    if (dom.bgPickImageBtn) dom.bgPickImageBtn.addEventListener('click', () => {
        if (dom.bgFileInputImage) dom.bgFileInputImage.click();
    });
    // 清除背景文件
    if (dom.bgClearFileBtn) dom.bgClearFileBtn.addEventListener('click', () => {
        state.currentSettings.bg_url = '';
        if (dom.bgFileNameEl) dom.bgFileNameEl.textContent = '';
        dom.bgClearFileBtn.style.display = 'none';
        previewBackgroundNow();
        markChanged();
    });
    // 图片文件选择
    if (dom.bgFileInputImage) dom.bgFileInputImage.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            state.currentSettings.bg_url = reader.result;
            if (dom.bgFileNameEl) dom.bgFileNameEl.textContent = '已加载图片（已保存）';
            if (dom.bgClearFileBtn) dom.bgClearFileBtn.style.display = '';
            previewBackgroundNow();
            markChanged();
        };
        reader.readAsDataURL(file);
        dom.bgFileInputImage.value = '';
    });
    // 背景透明度
    if (dom.bgOpacitySlider) dom.bgOpacitySlider.addEventListener('input', () => {
        const v = parseInt(dom.bgOpacitySlider.value, 10) || 0;
        state.currentSettings.bg_opacity = v / 100;
        if (dom.bgOpacityValue) dom.bgOpacityValue.textContent = v + '%';
        previewBackgroundNow();
        markChanged();
    });
    // 前景遮罩
    if (dom.bgOverlaySlider) dom.bgOverlaySlider.addEventListener('input', () => {
        const v = parseInt(dom.bgOverlaySlider.value, 10) || 0;
        state.currentSettings.bg_overlay = v / 100;
        if (dom.bgOverlayValue) dom.bgOverlayValue.textContent = v + '%';
        previewBackgroundNow();
        markChanged();
    });
    // 背景虚化
    if (dom.bgBlurSlider) dom.bgBlurSlider.addEventListener('input', () => {
        const v = parseInt(dom.bgBlurSlider.value, 10) || 0;
        state.currentSettings.bg_blur = v;
        if (dom.bgBlurValue) dom.bgBlurValue.textContent = v + ' px';
        previewBackgroundNow();
        markChanged();
    });
    // 窗口透明度（滑块 1-100% → 实际 0.01-1.0）
    if (dom.windowAlphaSlider) dom.windowAlphaSlider.addEventListener('input', () => {
        const v = Math.max(1, parseInt(dom.windowAlphaSlider.value, 10) || 100);
        state.currentSettings.window_alpha = v / 100;
        if (dom.windowAlphaValue) dom.windowAlphaValue.textContent = v + '%';
        previewWindowAlphaNow();
        markChanged();
    });
    // Aero 模糊
    if (dom.aeroBlurSlider) dom.aeroBlurSlider.addEventListener('input', () => {
        const v = parseInt(dom.aeroBlurSlider.value, 10) || 0;
        state.currentSettings.aero_blur = v;
        if (dom.aeroBlurValue) dom.aeroBlurValue.textContent = v + 'px';
        previewWindowAlphaNow();
        markChanged();
    });
    // 播放器封面背景模糊
    if (dom.playerBgBlurSlider) dom.playerBgBlurSlider.addEventListener('input', () => {
        const v = parseInt(dom.playerBgBlurSlider.value, 10) || 0;
        state.currentSettings.player_bg_blur = v;
        if (dom.playerBgBlurValue) dom.playerBgBlurValue.textContent = v + 'px';
        previewPlayerBgBlurNow();
        markChanged();
    });
}
