// tray-menu.js —— 前端自绘托盘菜单逻辑（运行于独立 traypopup 窗口）
import { ShowMainWindow, HideTrayMenu, OpenSettingsWindow, TogglePlayPause, QuitApp, GetTrayState } from '@bindings/MusicLite/app/musicservice.js';
import { applyTranslations, t } from '../js/i18n.js';

// 占位符 SVG（无封面时显示）—— 1×1 透明像素 Data URL 会导致样式异常，改用音符图标 SVG
const PLACEHOLDER_COVER = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48">
        <defs>
            <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style="stop-color:#2a2b2f"/>
                <stop offset="100%" style="stop-color:#1a1b1e"/>
            </linearGradient>
        </defs>
        <rect width="48" height="48" rx="6" fill="url(#g)"/>
        <path d="M32 14v16.1c-.9-.7-2-1.1-3.2-1.1-3.5 0-6.3 2.8-6.3 6.3s2.8 6.3 6.3 6.3 6.3-2.8 6.3-6.3V20h6v-6h-9.4z" fill="rgba(255,255,255,0.35)"/>
    </svg>`
);

// ---- 状态：播放图标切换 / 当前歌曲 ----
const playIcon = document.querySelector('.icon-play');
const pauseIcon = document.querySelector('.icon-pause');
const trackNameEl = document.getElementById('trayTrackName');
const artistNameEl = document.getElementById('trayArtistName');
const coverEl = document.getElementById('trayCover');

async function refreshTrayState() {
    try {
        const st = await GetTrayState();
        // 图标
        if (playIcon && pauseIcon) {
            if (st && st.isPlaying) {
                playIcon.style.display = 'none';
                pauseIcon.style.display = '';
            } else {
                playIcon.style.display = '';
                pauseIcon.style.display = 'none';
            }
        }
        // 封面
        if (coverEl) {
            if (st && st.coverBase64) {
                coverEl.src = st.coverBase64;
            } else {
                coverEl.src = PLACEHOLDER_COVER;
            }
        }
        // 曲名 / 歌手
        const hasTrack = st && (st.trackName || st.artistName);
        if (trackNameEl) {
            if (hasTrack) {
                trackNameEl.textContent = st.trackName || t('tray.unknownTrack') || '未知曲目';
            } else {
                trackNameEl.textContent = t('tray.noTrack') || '未在播放';
            }
        }
        if (artistNameEl) {
            artistNameEl.textContent = (st && st.artistName) || '\u00A0';
        }
    } catch (e) {
        console.warn('[tray-menu] GetTrayState failed', e);
    }
}

// ---- 按钮：播放 / 暂停 ----
document.getElementById('playPauseBtn')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    try { await TogglePlayPause(); } catch (_) {}
    setTimeout(refreshTrayState, 120);
});

// ---- 按钮：打开主窗口 ----
document.getElementById('showMainBtn')?.addEventListener('click', async () => {
    try {
        await ShowMainWindow();
        await HideTrayMenu();
    } catch (_) {}
});

// ---- 按钮：打开设置（由 Go 端创建 settings 窗口）----
document.getElementById('openSettingsBtn')?.addEventListener('click', async () => {
    try {
        await OpenSettingsWindow();
        await HideTrayMenu();
    } catch (_) {}
});

// ---- 按钮：退出 ----
document.getElementById('quitBtn')?.addEventListener('click', async () => {
    try { await QuitApp(); } catch (_) {}
});

// ---- 点击空白：关闭菜单（保持体验一致）----
document.addEventListener('pointerdown', (e) => {
    const wrap = document.getElementById('trayMenuWrap');
    if (wrap && !wrap.contains(e.target)) {
        HideTrayMenu().catch(() => {});
    }
});

// ---- ESC 快捷键关闭菜单 ----
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        HideTrayMenu().catch(() => {});
    }
});

// ---- 监听后端状态变化：轮询 GetTrayState（不依赖 Events.On） ----
// 托盘菜单窗口生命周期短（仅在右键时显示），轮询比事件订阅更可靠
setInterval(refreshTrayState, 1000);

// ---- 失焦自动关闭（由 Go 端 OnWindowEvent(WindowFocusLost) 也会兜底，这里保险）----
window.addEventListener('blur', () => {
    // 延迟几十毫秒：避免在菜单项点击过程中因窗口短暂失焦提前关闭
    setTimeout(() => {
        if (document.hasFocus && !document.hasFocus()) {
            HideTrayMenu().catch(() => {});
        }
    }, 120);
});

// ---- 初始化：应用设置主题+翻译（等待 settings-apply.js 完成 DOM 注入后再 refreshTrayState）----
function boot() {
    applyTranslations();
    refreshTrayState();
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}
// settings-apply 会在 window 上暴露 SettingsAppliedPromise（见 settings-apply.js 末尾监听 loadSettings 完成）
if (typeof window !== 'undefined') {
    const applied = window.SettingsAppliedPromise;
    if (applied && typeof applied.then === 'function') {
        applied.then(() => { applyTranslations(); refreshTrayState(); });
    } else {
        // settings-apply.js 内部 DOMContentLoaded 后会调用 LoadSettings；兜底再刷一次
        setTimeout(() => { applyTranslations(); refreshTrayState(); }, 250);
    }
}
