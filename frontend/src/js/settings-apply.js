import { LoadSettings } from '../../wailsjs/go/main/App.js';

const FONT_FALLBACK = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

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
                volume: 70
            };
        }
        return this.cached;
    },

    // 立即应用主题和字体（在 DOMContentLoaded 中调用）
    async apply() {
        const s = await this.load();

        // 主题
        document.body.setAttribute('data-theme', s.theme || 'dark');

        // 播放器字体（应用到 body）
        if (s.player_font) {
            document.body.style.fontFamily = `${s.player_font}, ${FONT_FALLBACK}`;
        }

        // 歌词字体（添加到 :root CSS 变量）
        if (s.lyrics_font) {
            document.documentElement.style.setProperty('--lyrics-font', s.lyrics_font);
        }

        return s;
    },

    // 重新应用（设置保存后调用）
    reapply() {
        if (this.cached) {
            document.body.setAttribute('data-theme', this.cached.theme || 'dark');
            if (this.cached.player_font) {
                document.body.style.fontFamily = `${this.cached.player_font}, ${FONT_FALLBACK}`;
            }
            if (this.cached.lyrics_font) {
                document.documentElement.style.setProperty('--lyrics-font', this.cached.lyrics_font);
            }
        }
    }
};

window.MusicLiteSettings = SettingsManager;

// 页面加载时自动应用
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => SettingsManager.apply());
} else {
    SettingsManager.apply();
}