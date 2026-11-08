// 设置管理器：加载后端设置并一次性应用到页面（主题/字体/背景/Aero/WinUI3/i18n）
import { LoadSettings } from '../bindings.js';
import { initI18n, setLanguage, applyTranslations } from '../i18n.js';
import { DEFAULT_ACCENT, applyAccentColor } from './theme.js';
import { applyLyricAnimation, applyDesignTokens, applyAnimationLevel, applySettingsLayout, applyNewUI } from './design-tokens.js';
import { applyBackground, applyWindowAlpha, applyAeroBlur, applyPlayerBgBlur, injectBgCSSOnce } from './background.js';
import { AutoContrast } from './auto-contrast.js';
import { checkAndPromptI18nUpdate } from './i18n-update.js';

const FONT_FALLBACK = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

export const SettingsManager = {
    cached: null,

    async load() {
        if (this.cached) return this.cached;
        try {
            this.cached = await LoadSettings();
            this.loadedFromBackend = true;
        } catch (e) {
            console.warn('Settings load failed, using defaults', e);
            this.loadedFromBackend = false;
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

        // 新旧主题页面已拆分：若后端设置与当前页面变体不一致，先同步 localStorage 再路由
        try {
            if (this.loadedFromBackend) {
                const body = document.body;
                const page = body && body.getAttribute('data-page');
                const isTray = body && body.classList.contains('tray-menu-body');
                if (page === 'libraries' || page === 'settings' || isTray) {
                    const wantsNew = !!s.new_ui_enabled;
                    // 以 URL 判定页面变体，避免同页初始化时 applyNewUI 抢先改写 data-* 导致误判
                    const isNewPage = /-new\.html$/i.test(location.pathname);
                    if (wantsNew !== isNewPage) {
                        localStorage.setItem('musicLite.newUIEnabled', wantsNew ? '1' : '0');
                        window.location.replace('/#/' + (isTray ? 'tray' : page));
                        return s;
                    }
                }
            }
        } catch (e) { /* localStorage/路由不可用时继续正常应用 */ }

        // 先初始化 i18n（从后端加载翻译数据），再设置语言
        await initI18n();
        const lang = s.language || 'zh-CN';
        setLanguage(lang);

        // 主题（html 根也同步写 data-theme：让背景注入的 CSS 选择器能正确命中主题差异化半透明规则）
        // 自定义主题按用户选择映射到 light/dark，保证 Aero/浅色规则正确命中
        const effectiveTheme = s.theme === 'custom'
            ? (s.custom_theme_mode === 'light' ? 'light' : 'dark')
            : (s.theme || 'dark');
        document.body.setAttribute('data-theme', effectiveTheme);
        document.documentElement.setAttribute('data-theme', effectiveTheme);

        // 自定义主题色 + 全套配套色
        applyAccentColor(s.accent_color || s.AccentColor || DEFAULT_ACCENT, s.theme || 'dark', s.custom_theme_mode);

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
        // 播放器封面背景模糊（新/旧 UI 共用 .player-bg-layer）
        applyPlayerBgBlur(s.player_bg_blur);

        // 页面切换/启动：按当前背景亮度自动决定文字与图标深浅
        AutoContrast.applyPage();

        // i18n 新键检查：检测到内嵌翻译有更新时提示用户确认覆盖。
        // 放在 apply() 末尾：i18n 已初始化 + UI 已渲染，
        // 翻译查找能命中中文/英文本地文案，弹窗才能本地化显示。
        try {
            await checkAndPromptI18nUpdate();
        } catch (e) {
            console.warn('[i18n] 更新检查失败：', e);
        }

        return s;
    },

    // 重新应用（设置保存后调用）
    async reapply() {
        if (this.cached) {
            const effectiveTheme = this.cached.theme === 'custom'
                ? (this.cached.custom_theme_mode === 'light' ? 'light' : 'dark')
                : (this.cached.theme || 'dark');
            document.body.setAttribute('data-theme', effectiveTheme);
            document.documentElement.setAttribute('data-theme', effectiveTheme);
            applyAccentColor(this.cached.accent_color || this.cached.AccentColor || DEFAULT_ACCENT, this.cached.theme || 'dark', this.cached.custom_theme_mode);
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
            // 播放器封面背景模糊（新/旧 UI 共用 .player-bg-layer）
            applyPlayerBgBlur(this.cached.player_bg_blur);

            // 设置变更后重新检测背景亮度
            AutoContrast.applyPage();
        }
    },

    // 暴露给外部调用：仅更新主题色（设置页颜色选择器实时预览用）
    applyAccentColor(color, theme, customMode) {
        applyAccentColor(color, theme, customMode);
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
    },
    applyPlayerBgBlur(blurPx) {
        applyPlayerBgBlur(blurPx);
    }
};
