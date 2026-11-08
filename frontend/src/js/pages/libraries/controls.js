// 音乐库页控件：搜索、排序、播放全部、视图切换、设置入口、听歌统计
import { GetTotalListenTime } from '../../core/bindings.js';
import { state } from './state.js';
import { renderLibrary, refreshList, setListMode, setSortMode, playAllFromList } from './library-list.js';
import { formatListenTime, showStatsModal } from './stats.js';

export function initLibraryControls() {
    // 搜索框：输入时防抖过滤，回车即时过滤
    const searchInput = document.getElementById('searchInput');
    const searchClear = document.getElementById('searchClear');
    if (searchInput) {
        let searchTimer = null;
        const runFilter = () => {
            state.currentQuery = searchInput.value || '';
            if (searchClear) searchClear.style.display = state.currentQuery ? 'flex' : 'none';
            renderLibrary();
        };
        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(runFilter, 160);
        });
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { clearTimeout(searchTimer); runFilter(); }
            if (e.key === 'Escape') { searchInput.value = ''; runFilter(); searchInput.blur(); }
        });
    }
    if (searchClear) {
        searchClear.addEventListener('click', () => {
            if (searchInput) { searchInput.value = ''; searchInput.focus(); }
            state.currentQuery = '';
            searchClear.style.display = 'none';
            renderLibrary();
        });
    }

    // 排序控件
    const sortControl = document.getElementById('sortControl');
    if (sortControl) {
        sortControl.addEventListener('click', (e) => {
            const btn = e.target.closest('.sort-btn');
            if (!btn || !btn.dataset.sort) return;
            setSortMode(btn.dataset.sort);
        });
    }

    // 播放全部
    const playAllBtn = document.getElementById('playAllBtn');
    if (playAllBtn) {
        playAllBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            playAllFromList();
        });
    }

    // 监听设置变化（用户在设置页修改后通过 localStorage 通知）
    window.addEventListener('storage', (e) => {
        if (e.key === 'settingsUpdated' && e.newValue) {
            // 新旧主题页面已拆分：主题切换后直接路由到对应页面
            const wantsNew = (() => {
                try { return localStorage.getItem('musicLite.newUIEnabled') === '1'; } catch (_) { return false; }
            })();
            // 以 URL 判定页面变体（body[data-new-ui] 可能已被 applyNewUI 改写）
            const isNewPage = /-new\.html$/i.test(location.pathname);
            if (wantsNew !== isNewPage) {
                // 主题切换后的重路由不应新增历史记录
                window.location.replace('/#/library');
                return;
            }
            // 重新加载设置并应用
            if (window.MusicLiteSettings) {
                window.MusicLiteSettings.cached = null;
                window.MusicLiteSettings.apply();
            }
            // 跨窗口同步音量/播放状态（设置窗口可能修改了音量或音量模式）
            audioManager.restore();
            // 刷新列表（可能 list-mode 变更，需要重渲染卡片/列表结构）
            refreshList();
        }
    });

    // 视图开关：点击切换模式，键盘 Enter/Space 也可触发
    const viewToggle = document.getElementById('view-toggle');
    if (viewToggle) {
        const toggleMode = () => {
            const cur = viewToggle.getAttribute('data-mode') || 'card';
            setListMode(cur === 'card' ? 'list' : 'card');
        };
        viewToggle.addEventListener('click', toggleMode);
        viewToggle.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleMode();
            }
        });
    }

    // 设置按钮
    const settingsBtn = document.getElementById('settingsBtn');
    if (settingsBtn) {
        settingsBtn.addEventListener('click', () => {
            window.location.href = '/#/settings';
        });
    }

    // 听歌统计按钮
    const statsBtn = document.getElementById('statsBtn');
    if (statsBtn) {
        statsBtn.addEventListener('click', async () => {
            try {
                const totalSeconds = await GetTotalListenTime();
                const formattedTime = formatListenTime(totalSeconds);
                await showStatsModal(formattedTime);
            } catch (err) {
                console.error('获取听歌时长失败:', err);
            }
        });
    }
}
