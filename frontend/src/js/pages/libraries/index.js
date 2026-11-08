// 音乐库页入口：初始化 i18n、列表、队列侧栏、导入、控件与迷你播放器
import { mountTitlebar } from '../../ui/titlebar.js';
import { Window } from '@wailsio/runtime';
import { Exit } from '../../core/bindings.js';
import { initI18n, t } from '../../core/i18n.js';
import { audioManager } from '../../core/audio-manager.js';
import { resumeTutorialIfAny } from '../../core/tutorial.js';
import { openPlayer } from './player.js';
import { state } from './state.js';
import { getListMode, getSortMode, applyListMode, applySortMode, refreshList } from './library-list.js';
import { initLibQueueSidebar, refreshLibQueue } from './lib-queue.js';
import { initImport } from './import.js';
import { initLibraryControls } from './controls.js';
import { bindLibraryMiniPlayer, bindMiniPlayerControls } from './mini-player.js';
import { initEditModal, bindEditModalEvents } from './edit-modal.js';

mountTitlebar();

// ============ 标题栏窗口控制 ============
document.getElementById('minimizeBtn')?.addEventListener('click', () => Window.Minimise());
document.getElementById('closeBtn')?.addEventListener('click', () => {
    if (state.onlyMode && state.defaultFile) {
        Exit(1);
    } else {
        Window.Hide();
    }
});

// ============ 初始化 ============
async function initLibrariesPage() {
    // 阻止触摸板双指缩放（WebView2 将其映射为 ctrl+wheel）及键盘缩放快捷键
    window.addEventListener('wheel', (e) => {
        if (e.ctrlKey) { e.preventDefault(); }
    }, { passive: false });
    window.addEventListener('keydown', (e) => {
        if (e.ctrlKey && ['=', '+', '-', '0'].includes(e.key)) {
            e.preventDefault();
        }
    });

    // 先初始化 i18n（从后端加载翻译数据），确保 t() 能拿到正确文案
    await initI18n();
    // 初始同步开关状态（不重渲染，refreshList 内部会调用 applyListMode）
    const initialMode = await getListMode();
    applyListMode(initialMode);
    // 初始同步排序方式（refreshList 渲染时会用到 currentSort）
    const initialSort = await getSortMode();
    applySortMode(initialSort);

    // 编辑弹窗保存后需要刷新列表，注入回调避免模块循环依赖
    initEditModal({ refreshList });
    await refreshList();

    // 初始化主页播放队列侧栏（切换按钮、拖拽入队、洗牌、清空等）
    initLibQueueSidebar();
    // 导入按钮与拖放
    initImport();
    // 搜索 / 排序 / 播放全部 / 视图切换 / 设置入口 / 听歌统计
    initLibraryControls();
    // 迷你播放器：恢复上次播放并绑定按钮
    await bindLibraryMiniPlayer();
    bindMiniPlayerControls();

    // 从设置页跳转过来时自动打开播放器
    const openPlayerId = localStorage.getItem('openPlayerOnLoad');
    if (openPlayerId) {
        localStorage.removeItem('openPlayerOnLoad');
        openPlayer(Number(openPlayerId));
    }

    // 编辑弹窗关闭 / 保存 / backdrop
    bindEditModalEvents();

    // 从历史缓存（bfcache）恢复时，重新同步设置与后端播放状态
    window.addEventListener('pageshow', (e) => {
        if (!e.persisted) return;
        if (window.MusicLiteSettings) {
            window.MusicLiteSettings.cached = null;
            window.MusicLiteSettings.apply();
        }
        audioManager.restore();
        refreshList();
        refreshLibQueue();
    });

    // 使用教程：从设置页跳转到本页时恢复引导进度
    resumeTutorialIfAny('libraries', t);
}

// 安全启动：ES 模块执行时 DOMContentLoaded 可能已触发，需双重检查
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLibrariesPage);
} else {
    initLibrariesPage();
}
