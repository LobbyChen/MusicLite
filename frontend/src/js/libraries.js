import { ImportFiles, GetAllTracks, UpdateTrack, UpdateTrackCover, DeleteTrack , GetFileInArgs, ImportFilesFromPaths, GetTotalListenTime, PickImageFile, PickLyricsFile, ReadFileForEdit, PackShare, GetNextTracks, GetPrevTracks, GetRandomTrack, QueueAddTrack, QueueAddAll, QueueClear, QueueGetStatus, QueueRemoveAt, QueueShuffle, QueueMove, QueueJumpTo } from '@bindings/MusicLite/app/musicservice.js';
import { openPlayer } from './player.js';
import { initI18n, t } from './i18n.js';
import { Window } from '@wailsio/runtime';

// ============ 长歌名滚动显示：检测溢出后用 Web Animations API 驱动滚动 ============
// 用法：applyMarquee(el) —— el 是承载歌名的容器（如 .mini-title）
// 用 Web Animations API（element.animate）而非 CSS @keyframes + var()，
// 因为后者在 WebView2 早期版本对 keyframes 内 var() 解析不可靠。
function applyMarquee(el) {
    if (!el) return;
    const text = el.textContent || '';
    let span = el.querySelector('.scroll-text');
    // 文本变化时重新包裹 span
    if (!span || span.dataset.text !== text) {
        el.textContent = '';
        span = document.createElement('span');
        span.className = 'scroll-text';
        span.textContent = text;
        span.dataset.text = text;
        el.appendChild(span);
    }
    // 清除上一次的动画（若有）
    span.getAnimations().forEach(a => a.cancel());
    el.classList.remove('marquee');
    // 双 rAF：确保 display:none→flex 切换后布局完成再测量
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            const overflow = span.scrollWidth - el.clientWidth;
            if (overflow > 4) {
                el.classList.add('marquee');
                // 滚动时长随文本长度增长，6~20s
                const duration = Math.max(6000, Math.min(20000, overflow * 60));
                span.animate(
                    [
                        { transform: 'translateX(0)' },
                        { transform: `translateX(-${overflow}px)` }
                    ],
                    {
                        duration: duration,
                        iterations: Infinity,
                        direction: 'alternate',
                        easing: 'ease-in-out'
                    }
                );
            }
        });
    });
}
window.applyMarquee = applyMarquee;

// ============ 标题栏窗口控制 ============
document.getElementById('minimizeBtn')?.addEventListener('click', () => Window.Minimise());
document.getElementById('closeBtn')?.addEventListener('click', () => Window.Hide());

// DOM Elements
const fileBtn = document.getElementById("openFileBtn");
const mediaContainer = document.getElementById('media-container');
const emptyOverlay = document.getElementById("empty-state");
const dropOverlay = document.getElementById('drop-overlay');


// 全局变量
// 当前track
var currentTrack;
// 音乐库缓存与视图状态
let allTracks = [];       // 后端返回的全部曲目（未过滤、未排序）
let currentQuery = '';    // 当前搜索关键词
let currentSort = 'recent'; // 当前排序方式：recent | title | artist

// 正在播放的动态条指示器（纯 CSS 动画，无 emoji）
const NP_BARS_HTML = '<span class="np-bars" aria-hidden="true"><i></i><i></i><i></i></span>';
// ============ 拖放导入 ============
// 用计数器区分真正离开窗口（dragenter/leave 会成对触发且嵌套）
let dragDepth = 0;
// 编辑弹窗内的拖放计数器（独立于全局）
let editDragDepth = 0;

function isEditModalActive() {
    const el = document.getElementById('modal-edit');
    return el && el.classList.contains('active');
}

document.addEventListener("dragenter", (e) => {
    e.preventDefault();
    if (!e.dataTransfer || !e.dataTransfer.types.includes('Files')) return;
    // 编辑弹窗打开时，拖放走弹窗逻辑，不显示全局遮罩
    if (isEditModalActive()) {
        editDragDepth++;
        document.getElementById('modal-edit').classList.add('drag-active');
        return;
    }
    dragDepth++;
    dropOverlay?.classList.add('active');
});

document.addEventListener("dragover", (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
});

document.addEventListener("dragleave", (e) => {
    e.preventDefault();
    if (isEditModalActive()) {
        editDragDepth = Math.max(0, editDragDepth - 1);
        if (editDragDepth === 0) {
            document.getElementById('modal-edit').classList.remove('drag-active');
        }
        return;
    }
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dropOverlay?.classList.remove('active');
});

document.addEventListener("drop", (e) => {
    // 只负责隐藏遮罩和阻止默认行为，真实路径由 Wails OnFileDrop 提供
    e.preventDefault();
    if (isEditModalActive()) {
        editDragDepth = 0;
        document.getElementById('modal-edit').classList.remove('drag-active');
        return;
    }
    dragDepth = 0;
    dropOverlay?.classList.remove('active');
});

// Wails v3 原生文件拖放：覆盖 window._wails.handlePlatformFileDrop 获取完整路径
// v3 API 签名: HandlePlatformFileDrop(filenames, x, y) — 与旧版 OnFileDrop(x,y,paths) 参数顺序相反
// useDropTarget=false: 让 Wails 不拦截 drop target，由前端自己处理 UI
function _registerFileDropV3(callback) {
    const install = () => {
        if (window._wails) {
            window._wails.handlePlatformFileDrop = (filenames, x, y) => {
                callback(x, y, Array.isArray(filenames) ? filenames : []);
            };
            return true;
        }
        return false;
    };
    if (!install()) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', install, { once: true });
        }
        // 兜底：一帧后重试（@wailsio/runtime 可能还没初始化 window._wails）
        setTimeout(install, 0);
        setTimeout(install, 50);
    }
}

_registerFileDropV3(async (_x, _y, paths) => {
    if (!paths || paths.length === 0) return;
    // 编辑弹窗打开时，拖放走封面/歌词导入
    if (isEditModalActive()) {
        await handleEditDrop(paths);
        return;
    }
    await doImportPaths(paths);
});

async function doImportPaths(paths) {
    try {
        const count = await ImportFilesFromPaths(paths);
        if (count > 0) {
            showToast(t('libraries.importSuccessAlt', count), 'success');
            await refreshList();
        } else {
            showToast(t('libraries.importNoneAlt'), 'warning');
        }
    } catch (err) {
        console.error('拖放导入失败:', err);
        showToast(t('libraries.importFailed', err), 'error');
    }
}

// ============ Toast 通知 ============
const TOAST_ICONS = {
    success: '<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>',
    error:   '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z"/></svg>',
    warning: '<svg viewBox="0 0 24 24"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>',
    info:    '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>'
};

function showToast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span class="toast-icon">${TOAST_ICONS[type] || TOAST_ICONS.info}</span><span class="toast-text"></span>`;
    toast.querySelector('.toast-text').textContent = message;
    container.appendChild(toast);

    const remove = () => {
        toast.classList.add('toast-out');
        toast.addEventListener('animationend', () => toast.remove(), { once: true });
    };
    const timer = setTimeout(remove, duration);
    toast.addEventListener('click', () => { clearTimeout(timer); remove(); });
}

// ============ 确认对话框（替代原生 confirm） ============
let confirmResolver = null;
const confirmModal = () => document.getElementById('modal-confirm');

function showConfirm({ title = '确认操作', message = '确定要执行此操作吗？', okText = t('common.ok'), cancelText = t('common.cancel'), danger = true } = {}) {
    return new Promise((resolve) => {
        const modal = confirmModal();
        document.getElementById('confirm-title').textContent = title;
        document.getElementById('confirm-message').textContent = message;
        const okBtn = document.getElementById('confirm-ok');
        const cancelBtn = document.getElementById('confirm-cancel');
        okBtn.textContent = okText;
        cancelBtn.textContent = cancelText;
        okBtn.className = danger ? 'btn btn-danger' : 'btn btn-primary';

        // 清理旧的监听器
        const newOk = okBtn.cloneNode(true);
        const newCancel = cancelBtn.cloneNode(true);
        okBtn.replaceWith(newOk);
        cancelBtn.replaceWith(newCancel);

        const close = (result) => {
            modal.classList.add('closing');
            modal.classList.remove('active');
            setTimeout(() => modal.classList.remove('closing'), 200);
            confirmResolver = null;
            resolve(result);
        };

        newOk.addEventListener('click', () => close(true));
        newCancel.addEventListener('click', () => close(false));

        // 点击 backdrop 视为取消
        const onBackdrop = (e) => {
            if (e.target === modal) {
                modal.removeEventListener('click', onBackdrop);
                close(false);
            }
        };
        modal.addEventListener('click', onBackdrop);

        confirmResolver = close;
        modal.classList.add('active');
    });
}

// ============ 导入 ============
fileBtn.addEventListener("click", async () => {
    try {
        const count = await ImportFiles();
        if (count > 0) {
            showToast(t('libraries.importSuccess', count), 'success');
            await refreshList();
            // 延迟一下让用户看到 toast，再刷新页面
            setTimeout(() => location.reload(), 600);
        } else {
            showToast(t('libraries.importNone'), 'info');
        }
    } catch (err) {
        console.error("导入失败:", err);
        showToast(t('libraries.importFailed', err), 'error');
    }
});

// ============ 列表渲染 ============
// 获取当前的列表显示模式（card / list）
async function getListMode() {
    try {
        const cached = localStorage.getItem('cachedSettings');
        if (cached) {
            const s = JSON.parse(cached);
            if (s.list_mode === 'card' || s.list_mode === 'list') return s.list_mode;
        }
    } catch (e) {}
    try {
        const { LoadSettings } = await import('@bindings/MusicLite/app/musicservice.js');
        const s = await LoadSettings();
        return (s.list_mode === 'card' || s.list_mode === 'list') ? s.list_mode : 'card';
    } catch (e) {
        return 'card';
    }
}

// 同步读取列表模式（仅从缓存，未命中返回 'card'）
function getListModeSync() {
    try {
        const cached = localStorage.getItem('cachedSettings');
        if (cached) {
            const s = JSON.parse(cached);
            if (s.list_mode === 'card' || s.list_mode === 'list') return s.list_mode;
        }
    } catch (e) {}
    return 'card';
}

// 获取当前排序方式：优先缓存，未命中读后端设置
async function getSortMode() {
    try {
        const cached = localStorage.getItem('cachedSettings');
        if (cached) {
            const s = JSON.parse(cached);
            if (s.sort_mode === 'recent' || s.sort_mode === 'title' || s.sort_mode === 'artist') {
                return s.sort_mode;
            }
        }
    } catch (e) {}
    try {
        const { LoadSettings } = await import('@bindings/MusicLite/app/musicservice.js');
        const s = await LoadSettings();
        return (s.sort_mode === 'recent' || s.sort_mode === 'title' || s.sort_mode === 'artist') ? s.sort_mode : 'recent';
    } catch (e) {
        return 'recent';
    }
}

// 同步主页开关 UI 与容器 class 到指定模式（不写设置）
function applyListMode(mode) {
    const isList = mode === 'list';
    mediaContainer.classList.toggle('media-list', isList);
    mediaContainer.classList.toggle('media-grid', !isList);
    const toggle = document.getElementById('view-toggle');
    if (toggle) {
        toggle.setAttribute('data-mode', isList ? 'list' : 'card');
        toggle.setAttribute('aria-checked', isList ? 'true' : 'false');
    }
}

// 同步排序控件高亮到指定模式
function applySortMode(mode) {
    currentSort = mode;
    const control = document.getElementById('sortControl');
    if (!control) return;
    control.querySelectorAll('.sort-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.sort === mode);
    });
}

// 切换并持久化列表模式：保存到后端 + cachedSettings + 即时重渲染
async function setListMode(mode) {
    if (mode !== 'card' && mode !== 'list') return;
    applyListMode(mode);
    // 写 localStorage 缓存（renderLibrary 会读这个）
    try {
        const cached = localStorage.getItem('cachedSettings');
        const obj = cached ? JSON.parse(cached) : {};
        obj.list_mode = mode;
        localStorage.setItem('cachedSettings', JSON.stringify(obj));
    } catch (e) {}
    // 异步保存到后端（不阻塞 UI）
    try {
        const { LoadSettings, SaveSettings } = await import('@bindings/MusicLite/app/musicservice.js');
        const s = await LoadSettings();
        s.list_mode = mode;
        await SaveSettings(s);
        // 通知其他页面（设置页如果还保留模式选择器，会同步状态）
        localStorage.setItem('settingsUpdated', Date.now().toString());
    } catch (e) {
        console.warn('保存 list_mode 失败:', e);
    }
    // 重渲染列表（结构切换）
    await renderLibrary();
}

// 切换并持久化排序方式
async function setSortMode(mode) {
    if (mode !== 'recent' && mode !== 'title' && mode !== 'artist') return;
    applySortMode(mode);
    try {
        const cached = localStorage.getItem('cachedSettings');
        const obj = cached ? JSON.parse(cached) : {};
        obj.sort_mode = mode;
        localStorage.setItem('cachedSettings', JSON.stringify(obj));
    } catch (e) {}
    try {
        const { LoadSettings, SaveSettings } = await import('@bindings/MusicLite/app/musicservice.js');
        const s = await LoadSettings();
        s.sort_mode = mode;
        await SaveSettings(s);
        localStorage.setItem('settingsUpdated', Date.now().toString());
    } catch (e) {
        console.warn('保存 sort_mode 失败:', e);
    }
    await renderLibrary();
}

async function refreshList() {
    try {
        const tracks = await GetAllTracks();
        allTracks = tracks || [];
    } catch (err) {
        console.error("加载列表失败:", err);
        allTracks = [];
    }
    await renderLibrary();
}

// 按当前关键词与排序方式过滤、排序
function applyFilterAndSort(tracks) {
    const q = currentQuery.trim().toLowerCase();
    let list = tracks;
    if (q) {
        list = list.filter(tr => {
            const name = (tr.name || '').toLowerCase();
            const artist = (tr.artist || '').toLowerCase();
            return name.includes(q) || artist.includes(q);
        });
    }
    const sorted = list.slice();
    const opts = { sensitivity: 'base', numeric: true };
    switch (currentSort) {
        case 'title':
            sorted.sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, opts));
            break;
        case 'artist':
            sorted.sort((a, b) => {
                const c = (a.artist || '').localeCompare(b.artist || '', undefined, opts);
                return c !== 0 ? c : (a.name || '').localeCompare(b.name || '', undefined, opts);
            });
            break;
        case 'recent':
        default:
            // 后端已按 imported_at DESC 返回；按时间戳降序兜底，保证视图稳定
            sorted.sort((a, b) => (b.importedAt || 0) - (a.importedAt || 0));
            break;
    }
    return sorted;
}

// 渲染整个音乐库视图：过滤 + 排序 + 列表 + 空态 + 正在播放指示
async function renderLibrary() {
    const mode = await getListMode();
    applyListMode(mode);
    const list = applyFilterAndSort(allTracks);
    renderTracksList(list, mode);
    updateLibraryEmptyStates(list);
    applyNowPlayingIndicator();
}

// 更新空库 / 无搜索结果两种空态的显隐
function updateLibraryEmptyStates(list) {
    const hasTracks = allTracks.length > 0;
    const hasResults = list.length > 0;
    emptyOverlay.classList.toggle('display', !hasTracks);
    const noResults = document.getElementById('no-results');
    if (noResults) noResults.style.display = (!hasResults && hasTracks) ? 'flex' : 'none';
    mediaContainer.style.display = hasResults ? ((getListModeSync() === 'list') ? 'flex' : 'grid') : 'none';
}

// 给列表项绑定点击/编辑/删除/右键（与卡片共用）
function _bindTrackItemListeners(el, track, actionSelector) {
    el.addEventListener("click", async (e) => {
        if (e.target.closest(actionSelector)) return;

        const cur = window.audioManager && window.audioManager.currentTrack;
        const isCurrent = cur && track.id !== undefined && track.id === cur.id;
        if (!isCurrent) {
            window.audioManager.loadTrack(track);
            window.audioManager.play();
            currentTrack = track;
        }
        await openPlayer(track.id);
    });

    const editBtn = el.querySelector('.edit-btn');
    if (editBtn) editBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openEditModal(track);
    });

    const addQueueBtn = el.querySelector('.add-queue-btn');
    if (addQueueBtn) addQueueBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        doAddToQueue(track);
    });

    const deleteBtn = el.querySelector('.delete-btn');
    if (deleteBtn) deleteBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const ok = await showConfirm({
            title: t('libraries.deleteTitle'),
            message: t('libraries.deleteConfirm', track.name),
            okText: t('common.delete'),
            cancelText: t('common.cancel')
        });
        if (ok) doDelete(track.id);
    });

    el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        showContextMenu(e, track);
    });
}

// 标记当前正在播放的曲目，并同步播放/暂停态用于控制动态条动画
function applyNowPlayingIndicator() {
    const cur = window.audioManager && window.audioManager.currentTrack;
    const curId = cur ? cur.id : null;
    const isPlaying = !!(window.audioManager && window.audioManager.isPlaying());
    mediaContainer.classList.toggle('audio-playing', isPlaying);
    mediaContainer.querySelectorAll('.media-card, .media-list-item').forEach(el => {
        el.classList.toggle('is-playing', curId != null && Number(el.dataset.id) === curId);
    });
}

// 渲染曲目列表（已过滤 + 已排序）
function renderTracksList(tracks, mode) {
    mediaContainer.innerHTML = '';

    if (!tracks || tracks.length === 0) {
        return;
    }

    const MUSIC_ICON_SVG = '<svg viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>';
    const QUEUE_BTN_SVG = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="3" rx="1"/><rect x="3" y="13" width="18" height="3" rx="1"/></svg>`;
    const EDIT_BTN_SVG = `<svg viewBox="0 0 24 24" width="16" height="16"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>`;
    const DELETE_BTN_SVG = `<svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>`;
    const QUEUE_TITLE = t('libraries.addToQueue');
    const EDIT_TITLE = t('libraries.editInfo');
    const DELETE_TITLE = t('common.delete');
    const UNKNOWN_ARTIST = t('common.unknownArtist');

    if (mode === 'list') {
        // ===== 列表模式 =====
        for (let i = 0; i < tracks.length; i++) {
            const track = tracks[i];
            const item = document.createElement('div');
            item.className = 'media-list-item';
            item.dataset.id = track.id;
            item.style.animationDelay = `${Math.min(i * 0.012, 0.2)}s`;

            const coverHTML = track.cover
                ? `<div class="list-item-cover"><img src="${bustCoverUrl(track.cover)}" alt="${track.name}" /></div>`
                : `<div class="list-item-cover">${MUSIC_ICON_SVG}</div>`;

            item.innerHTML = `
                ${coverHTML}
                <div class="list-item-info">
                    <div class="list-item-title">${NP_BARS_HTML}${escapeHtml(track.name)}</div>
                    <div class="list-item-artist">${escapeHtml(track.artist || UNKNOWN_ARTIST)}</div>
                </div>
                <div class="list-item-actions">
                    <button class="card-btn add-queue-btn" title="${QUEUE_TITLE}">${QUEUE_BTN_SVG}</button>
                    <button class="card-btn edit-btn" title="${EDIT_TITLE}">${EDIT_BTN_SVG}</button>
                    <button class="card-btn delete-btn" title="${DELETE_TITLE}">${DELETE_BTN_SVG}</button>
                </div>
            `;
            _bindTrackItemListeners(item, track, '.list-item-actions');
            makeTrackDraggable(item, track);
            mediaContainer.appendChild(item);
        }
    } else {
        // ===== 卡片模式（默认） =====
        for (let i = 0; i < tracks.length; i++) {
            const track = tracks[i];
            const card = document.createElement('div');
            card.className = 'media-card';
            card.dataset.id = track.id;
            card.style.animationDelay = `${Math.min(i * 0.04, 0.6)}s`;

            const coverHTML = track.cover
                ? `<img src="${bustCoverUrl(track.cover)}" class="card-cover" alt="${track.name}" />`
                : `<div class="card-icon">${MUSIC_ICON_SVG}</div>`;

            card.innerHTML = `
                ${NP_BARS_HTML}
                ${coverHTML}
                <div class="card-title">${escapeHtml(track.name)}</div>
                <div class="card-meta">${escapeHtml(track.artist || UNKNOWN_ARTIST)}</div>
                <div class="card-actions">
                    <button class="card-btn add-queue-btn" title="${QUEUE_TITLE}">${QUEUE_BTN_SVG}</button>
                    <button class="card-btn edit-btn" title="${EDIT_TITLE}">${EDIT_BTN_SVG}</button>
                    <button class="card-btn delete-btn" title="${DELETE_TITLE}">${DELETE_BTN_SVG}</button>
                </div>
            `;
            _bindTrackItemListeners(card, track, '.card-actions');
            makeTrackDraggable(card, track);
            mediaContainer.appendChild(card);
        }
    }
}

// ============ 联网搜索相关功能已移除 ============

// ============ 播放全部 / 迷你播放器上一曲下一曲 ============
// 按"当前播放模式"取下一首/上一首（随机模式走 GetRandomTrack）
async function pickAdjacentTrack(direction) {
    const cur = window.audioManager && window.audioManager.currentTrack;
    if (!cur || cur.id == null) return null;
    try {
        const mode = await window.audioManager.fetchPlayMode();
        if (mode === 'random') {
            return await GetRandomTrack(cur.id);
        }
        return direction < 0 ? await GetPrevTracks(cur.id) : await GetNextTracks(cur.id);
    } catch (e) {
        console.warn('pickAdjacentTrack failed:', e);
        return null;
    }
}

async function miniPrevTrack() {
    const prev = await pickAdjacentTrack(-1);
    if (prev && prev.id) {
        window.audioManager.loadTrack(prev);
        window.audioManager.play();
        currentTrack = prev;
    }
}

async function miniNextTrack() {
    const next = await pickAdjacentTrack(1);
    if (next && next.id) {
        window.audioManager.loadTrack(next);
        window.audioManager.play();
        currentTrack = next;
    }
}

// 播放当前（过滤+排序后）列表：填充队列并播放第一首
async function playAllFromList() {
    const list = applyFilterAndSort(allTracks);
    if (!list.length) {
        showToast(t('libraries.importNone'), 'info');
        return;
    }
    // 用当前可见列表填充播放队列，确保"播放全部"的进曲顺序与列表一致
    try {
        await QueueClear();
        const ids = list.map(tr => Number(tr.id)).filter(id => !isNaN(id) && id > 0);
        await QueueAddAll(ids);
    } catch (e) {
        console.warn('填充队列失败，回退到单曲播放:', e);
    }
    const first = list[0];
    window.audioManager.loadTrack(first);
    window.audioManager.play();
    currentTrack = first;
    await openPlayer(first.id);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============ 删除 ============
async function doDelete(id) {
    try {
        await DeleteTrack(id);
        // 如果删除的是当前播放曲目，停止播放并清理 UI
        const cur = window.audioManager && window.audioManager.currentTrack;
        if (cur && Number(cur.id) === Number(id)) {
            window.audioManager.clearTrack();
            const miniPlayer = document.getElementById('mini-player');
            if (miniPlayer) miniPlayer.style.display = 'none';
        }
        showToast(t('libraries.deleted'), 'success');
        await refreshList();
    } catch (err) {
        console.error("删除失败:", err);
        showToast(t('libraries.deleteFailed', err), 'error');
    }
}

// ============ 右键菜单 ============
let contextMenuEl = null;

function showContextMenu(e, track) {
    hideContextMenu();

    contextMenuEl = document.createElement('div');
    contextMenuEl.className = 'context-menu';
    contextMenuEl.innerHTML = `
        <div class="context-item" data-action="play" style="--ctx-i:0">
            ${t('common.play')}
        </div>
        <div class="context-item" data-action="addToQueue" style="--ctx-i:1">
            ${t('libraries.addToQueue')}
        </div>
        <div class="context-divider"></div>
        <div class="context-item" data-action="edit" style="--ctx-i:2">
            ${t('libraries.editInfo')}
        </div>
        <div class="context-item" data-action="share" style="--ctx-i:3">
            ${t('libraries.packShare')}
        </div>
        <div class="context-divider"></div>
        <div class="context-item danger" data-action="delete" style="--ctx-i:4">
            ${t('common.delete')}
        </div>
    `;

    // 定位到点击位置
    const x = Math.min(e.clientX, window.innerWidth - 160);
    const y = Math.min(e.clientY, window.innerHeight - 220);
    contextMenuEl.style.left = x + 'px';
    contextMenuEl.style.top = y + 'px';

    document.body.appendChild(contextMenuEl);

    contextMenuEl.querySelectorAll('.context-item').forEach(item => {
        item.addEventListener('click', () => {
            const action = item.dataset.action;
            hideContextMenu();
            handleContextAction(action, track);
        });
    });
}

function hideContextMenu() {
    if (contextMenuEl) {
        contextMenuEl.classList.add('closing');
        const el = contextMenuEl;
        contextMenuEl = null;
        setTimeout(() => el.remove(), 150);
    }
}

document.addEventListener("click", (e) => {
    if (!e.target.closest('.context-menu')) {
        hideContextMenu();
    }
});

function handleContextAction(action, track) {
    switch (action) {
        case 'play':
            window.audioManager.loadTrack(track);
            window.audioManager.play();
            currentTrack = track;
            openPlayer(track.id);
            break;
        case 'addToQueue':
            doAddToQueue(track);
            break;
        case 'edit':
            openEditModal(track);
            break;
        case 'share':
            doPackShare(track);
            break;
        case 'delete':
            showConfirm({
                title: t('libraries.deleteTitle'),
                message: t('libraries.deleteConfirm', track.name),
                okText: t('common.delete'),
                cancelText: t('common.cancel')
            }).then((ok) => {
                if (ok) doDelete(track.id);
            });
            break;
    }
}

// ============ 加入队列 ============
async function doAddToQueue(track) {
    try {
        await QueueAddTrack(Number(track.id));
        showToast(t('libraries.addedToQueue', track.name), 'success');
        refreshLibQueue();
    } catch (err) {
        console.error('加入队列失败:', err);
        showToast(t('libraries.addToQueueFailed'), 'error');
    }
}

// ============ 主页播放队列侧栏 ============
const NP_BARS_HTML_Q = '<span class="np-bars" aria-hidden="true"><i></i><i></i><i></i></span>';
const MUSIC_ICON_SVG_Q = '<svg viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>';
const DRAG_ICON_SVG_Q = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M11 18c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2zm-2-8c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6 4c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>';
const REMOVE_ICON_SVG_Q = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';

let libQueueSidebar = null;
let libQueueList = null;
let libQueueBadge = null;
let libQueueOpen = false;
let libQueueDragFromIndex = -1;

function escapeHtmlQ(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : text;
    return div.innerHTML;
}

function renderLibQueueCover(coverUrl) {
    if (coverUrl) return `<img src="${coverUrl}" alt="" />`;
    return `<div class="card-icon">${MUSIC_ICON_SVG_Q}</div>`;
}

function renderLibQueueList(status) {
    if (!libQueueList) return;
    const items = (status && status.items) || [];
    const curIdx = (status && typeof status.currentIndex === 'number') ? status.currentIndex : -1;

    // FLIP 动画 First：记录旧元素位置（用 trackId 作为稳定标识匹配）
    const oldPositions = new Map();
    libQueueList.querySelectorAll('.queue-item').forEach(el => {
        const tid = el.dataset.trackId;
        if (tid) oldPositions.set(tid, el.getBoundingClientRect().top);
    });

    if (libQueueBadge) {
        const n = items.length;
        libQueueBadge.textContent = String(n);
        libQueueBadge.style.display = n > 0 ? '' : 'none';
    }

    if (items.length === 0) {
        libQueueList.innerHTML = `<div class="queue-empty">${t('player.queueEmpty')}</div>`;
        return;
    }

    let html = '';
    for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const track = it.track || {};
        const isCurrent = (i === curIdx);
        const cover = track.cover || '';
        html += `
            <div class="queue-item${isCurrent ? ' is-current' : ''}" data-index="${i}" data-track-id="${track.id || ''}" draggable="true">
                <span class="queue-item-drag" title="${t('player.queueDragHint')}">${DRAG_ICON_SVG_Q}</span>
                <div class="queue-item-cover">${renderLibQueueCover(cover)}</div>
                <div class="queue-item-info">
                    <div class="queue-item-title">${escapeHtmlQ(track.name || t('common.unknown'))}</div>
                    <div class="queue-item-artist">${escapeHtmlQ(track.artist || t('common.unknownArtist'))}</div>
                </div>
                ${isCurrent ? NP_BARS_HTML_Q : ''}
                <button class="queue-item-remove" title="${t('common.delete')}">${REMOVE_ICON_SVG_Q}</button>
            </div>
        `;
    }
    libQueueList.innerHTML = html;

    // FLIP 动画 Last + Invert + Play：对比新旧位置，用 Web Animations API 滑过去
    libQueueList.querySelectorAll('.queue-item').forEach(el => {
        const tid = el.dataset.trackId;
        if (!tid) return;
        const oldTop = oldPositions.get(tid);
        if (oldTop === undefined) return;
        const newTop = el.getBoundingClientRect().top;
        const delta = oldTop - newTop;
        if (Math.abs(delta) > 0.5) {
            try {
                el.animate(
                    [
                        { transform: `translateY(${delta}px)` },
                        { transform: 'translateY(0px)' }
                    ],
                    { duration: 250, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }
                );
            } catch (_) {}
        }
    });

    if (curIdx >= 0) {
        const curEl = libQueueList.querySelector(`.queue-item[data-index="${curIdx}"]`);
        if (curEl) curEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    bindLibQueueItemEvents();
    restartLibNpBars();
}

// 从后端拉取最新队列状态并刷新 UI（被 trackloaded 事件调用，确保正在播放指示器立即更新）
async function refreshLibQueue() {
    if (!libQueueList) return;
    try {
        const status = await QueueGetStatus();
        renderLibQueueList(status);
    } catch (e) {
        console.warn('refreshLibQueue QueueGetStatus failed:', e);
    }
}

// ========== JS 驱动主页队列 np-bars 动画（同 queue.js 逻辑，避免纯 CSS 选择器不可靠） ==========
function restartLibNpBars() {
    if (!libQueueList) return;
    libQueueList.querySelectorAll('.np-bars').forEach(barEl => {
        barEl.querySelectorAll('i').forEach(iEl => {
            try { iEl.getAnimations().forEach(a => a.cancel()); } catch (_) {}
        });
        const item = barEl.closest('.queue-item');
        if (!item || !item.classList.contains('is-current')) return;
        barEl.querySelectorAll('i').forEach((iEl, k) => {
            try {
                iEl.animate(
                    [
                        { transform: 'scaleY(0.4)' },
                        { transform: 'scaleY(1)', offset: 0.5 },
                        { transform: 'scaleY(0.4)' }
                    ],
                    {
                        duration: 1000,
                        delay: k * 200,
                        iterations: Infinity,
                        easing: 'ease-in-out'
                    }
                );
            } catch (_) {}
        });
    });
}

function bindLibQueueItemEvents() {
    if (!libQueueList) return;
    libQueueList.querySelectorAll('.queue-item').forEach(el => {
        const idx = parseInt(el.dataset.index, 10);
        if (isNaN(idx)) return;

        // 点击 → 跳转播放
        el.addEventListener('click', (e) => {
            if (e.target.closest('.queue-item-remove')) return;
            if (e.target.closest('.queue-item-drag')) return;
            e.stopPropagation();
            QueueJumpTo(idx).catch(err => console.warn('QueueJumpTo failed:', err));
        });

        // 删除
        const removeBtn = el.querySelector('.queue-item-remove');
        if (removeBtn) {
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const wasCurrent = el.classList.contains('is-current');
                QueueRemoveAt(idx).then(ok => {
                    if (ok) {
                        // 删除的是当前播放项 → 停止播放并清理 UI
                        if (wasCurrent && window.audioManager) {
                            window.audioManager.clearTrack();
                            const miniPlayer = document.getElementById('mini-player');
                            if (miniPlayer) miniPlayer.style.display = 'none';
                        }
                        refreshLibQueue();
                    }
                }).catch(err => console.warn('QueueRemoveAt failed:', err));
            });
        }

        // 拖拽排序
        el.addEventListener('dragstart', (e) => {
            libQueueDragFromIndex = idx;
            try {
                e.dataTransfer.effectAllowed = 'copyMove';
                e.dataTransfer.setData('application/x-queue-index', String(idx));
                e.dataTransfer.setData('text/plain', String(idx));
            } catch (_) {}
            // 延迟一帧加 .dragging，让浏览器先截好拖拽预览图
            requestAnimationFrame(() => el.classList.add('dragging'));
        });
        el.addEventListener('dragend', () => {
            el.classList.remove('dragging');
            libQueueList.querySelectorAll('.queue-item.drag-over').forEach(n => n.classList.remove('drag-over'));
            libQueueDragFromIndex = -1;
        });
        el.addEventListener('dragenter', (e) => {
            if (e.dataTransfer) e.preventDefault();
        });
        el.addEventListener('dragover', (e) => {
            e.preventDefault();
            const isInternal = libQueueDragFromIndex >= 0;
            if (isInternal) {
                try { e.dataTransfer.dropEffect = 'move'; } catch (_) {}
                if (libQueueDragFromIndex === idx) return;
                libQueueList.querySelectorAll('.queue-item.drag-over').forEach(n => n.classList.remove('drag-over'));
                el.classList.add('drag-over');
            } else {
                try { e.dataTransfer.dropEffect = 'copy'; } catch (_) {}
                el.classList.add('drag-over');
            }
        });
        el.addEventListener('dragleave', (e) => {
            if (!el.contains(e.relatedTarget)) {
                el.classList.remove('drag-over');
            }
        });
        el.addEventListener('drop', (e) => {
            e.preventDefault();
            el.classList.remove('drag-over');
            const isInternal = libQueueDragFromIndex >= 0;
            if (isInternal) {
                const from = libQueueDragFromIndex;
                if (from < 0) return;
                // 计算插入目标：鼠标在悬停项上半→插到 idx 前，下半→插到 idx 后
                const rect = el.getBoundingClientRect();
                const insertBefore = (e.clientY - rect.top) < (rect.height / 2);
                // to 是"移除 from 之后"的目标下标
                let to = insertBefore ? idx : idx + 1;
                if (from < to) to -= 1;  // from 移除后，后面的下标前移 1
                if (from === to) return;
                QueueMove(from, to).then(() => {
                    refreshLibQueue();
                    try {
                        if (window.QueuePanel && typeof window.QueuePanel.refresh === 'function') {
                            window.QueuePanel.refresh();
                        }
                    } catch (_) {}
                }).catch(err => console.warn('QueueMove failed:', err));
            } else {
                const trackId = e.dataTransfer.getData('application/x-track-id') || e.dataTransfer.getData('text/plain');
                const id = Number(trackId);
                if (id > 0) {
                    QueueAddTrack(id).then(() => refreshLibQueue()).catch(err => console.warn('QueueAddTrack failed:', err));
                }
            }
        });
    });
}

function openLibQueue() {
    if (!libQueueSidebar) return;
    libQueueSidebar.classList.add('active');
    document.body.classList.add('has-lib-queue');
    libQueueOpen = true;
    refreshLibQueue();
}

function closeLibQueue() {
    if (!libQueueSidebar) return;
    libQueueSidebar.classList.remove('active');
    document.body.classList.remove('has-lib-queue');
    libQueueOpen = false;
}

function toggleLibQueue() {
    if (libQueueOpen) closeLibQueue(); else openLibQueue();
}

// 让媒体卡片/列表项可拖拽到队列（设置 dataTransfer 携带曲目 ID）
function makeTrackDraggable(el, track) {
    if (!el) return;
    el.setAttribute('draggable', 'true');
    el.addEventListener('dragstart', (e) => {
        el.classList.add('dragging-queue');
        try {
            // 使用 copyMove 以兼容 dropEffect=copy 和 move 的目标区域
            e.dataTransfer.effectAllowed = 'copyMove';
            e.dataTransfer.setData('application/x-track-id', String(track.id));
            e.dataTransfer.setData('text/plain', String(track.id));
        } catch (_) {}
    });
    el.addEventListener('dragend', () => {
        el.classList.remove('dragging-queue');
    });
}

function initLibQueueSidebar() {
    libQueueSidebar = document.getElementById('libQueueSidebar');
    libQueueList = document.getElementById('libQueueList');
    libQueueBadge = document.getElementById('libQueueBadge');
    if (!libQueueSidebar || !libQueueList) return;

    // 切换按钮
    const toggleBtn = document.getElementById('libQueueBtn');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleLibQueue();
        });
    }

    // 关闭按钮
    const closeBtn = document.getElementById('libQueueCloseBtn');
    if (closeBtn) {
        closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closeLibQueue(); });
    }

    // 洗牌
    const shuffleBtn = document.getElementById('libQueueShuffleBtn');
    if (shuffleBtn) {
        shuffleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            QueueShuffle().then(refreshLibQueue).catch(err => console.warn('QueueShuffle failed:', err));
        });
    }

    // 清空
    const clearBtn = document.getElementById('libQueueClearBtn');
    if (clearBtn) {
        clearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            QueueClear().then(refreshLibQueue).catch(err => console.warn('QueueClear failed:', err));
        });
    }

    // 整个列表作为拖放目标（外部拖入入队 + 内部排序空区域兜底）
    libQueueList.addEventListener('dragenter', (e) => {
        // dragenter 必须 preventDefault 才能允许 drop（WebView2 必需）
        if (e.dataTransfer) e.preventDefault();
    });
    libQueueList.addEventListener('dragover', (e) => {
        e.preventDefault();
        const isInternal = libQueueDragFromIndex >= 0;
        if (isInternal) {
            // 内部排序：dropEffect = move（与 dragstart effectAllowed='copyMove' 匹配）
            try { e.dataTransfer.dropEffect = 'move'; } catch (_) {}
        } else {
            // 外部拖入：dropEffect = copy
            try { e.dataTransfer.dropEffect = 'copy'; } catch (_) {}
        }
        if (e.target === libQueueList) {
            libQueueList.classList.add('drag-over');
        }
    });
    libQueueList.addEventListener('dragleave', (e) => {
        if (e.target === libQueueList) libQueueList.classList.remove('drag-over');
    });
    libQueueList.addEventListener('drop', async (e) => {
        e.preventDefault();
        libQueueList.classList.remove('drag-over');
        const isInternal = libQueueDragFromIndex >= 0;
        if (isInternal) return; // 队列内排序由 item 自己处理
        // 外部拖入：媒体卡⽚ → 入队
        const trackId = e.dataTransfer.getData('application/x-track-id') || e.dataTransfer.getData('text/plain');
        const id = Number(trackId);
        if (id > 0) {
            try {
                await QueueAddTrack(id);
                refreshLibQueue();
            } catch (err) {
                console.warn('QueueAddTrack (drop) failed:', err);
            }
        }
    });

    // ESC 关闭
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && libQueueOpen) {
            closeLibQueue();
        }
    });

    // 点击空白区域关闭（侧栏内部和切换按钮的点击不触发）
    document.addEventListener('click', (e) => {
        if (!libQueueOpen) return;
        // 点击侧栏内部 → 不关闭
        if (libQueueSidebar.contains(e.target)) return;
        // 点击切换按钮 → 不关闭（由 toggleLibQueue 自行处理）
        const toggleBtn = document.getElementById('libQueueBtn');
        if (toggleBtn && toggleBtn.contains(e.target)) return;
        closeLibQueue();
    });

    // 初始拉取一次
    refreshLibQueue();
}

// ============ 打包分享 ============
async function doPackShare(track) {
    try {
        await PackShare(track.id);
        showToast(t('libraries.shareSuccess'), 'success');
    } catch (err) {
        console.error('打包分享失败:', err);
        showToast(t('libraries.shareFailed', err), 'error');
    }
}

// ============ 编辑模态框 ============
let currentEditTrack = null;
let editCoverData = null; // 暂存封面上传的 Array<number>，保存时一起提交
let editCoverMIME = null;
let editCoverCleared = false;

// base64 字符串转 Array<number>（供 UpdateTrackCover 使用）
function base64ToArray(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return Array.from(bytes);
}

function openEditModal(track) {
    currentEditTrack = track;
    editCoverData = null;
    editCoverMIME = null;
    editCoverCleared = false;

    document.getElementById("edit-title").value = track.name || '';
    document.getElementById("edit-artist").value = track.artist || '';
    document.getElementById("edit-lyrics").value = track.lyrics || '';

    // 封面预览
    const preview = document.getElementById("edit-cover-preview");
    if (track.cover) {
        preview.innerHTML = `<img src="${bustCoverUrl(track.cover)}" alt="cover" />`;
    } else {
        preview.innerHTML = DEFAULT_COVER_HTML;
    }

    // 更换封面：调用后端文件对话框
    document.getElementById("edit-cover-pick").onclick = async () => {
        try {
            const result = await PickImageFile();
            if (!result || !result.data) return; // 用户取消
            editCoverData = base64ToArray(result.data);
            editCoverMIME = result.mime || 'image/jpeg';
            editCoverCleared = false;
            preview.innerHTML = `<img src="data:${editCoverMIME};base64,${result.data}" alt="cover" />`;
        } catch (err) {
            console.error('选择封面失败:', err);
            showToast(t('libraries.coverTooLarge'), 'warning');
        }
    };

    // 清除封面
    document.getElementById("edit-cover-clear").onclick = () => {
        editCoverData = null;
        editCoverMIME = null;
        editCoverCleared = true;
        preview.innerHTML = DEFAULT_COVER_HTML;
    };

    // 从文件导入歌词：调用后端文件对话框
    document.getElementById("edit-lyrics-pick").onclick = async () => {
        try {
            const text = await PickLyricsFile();
            if (!text) return; // 用户取消
            document.getElementById("edit-lyrics").value = text;
        } catch (err) {
            console.error('导入歌词失败:', err);
            showToast(t('libraries.importFailed', err), 'error');
        }
    };

    // 清空歌词
    document.getElementById("edit-lyrics-clear").onclick = () => {
        document.getElementById("edit-lyrics").value = '';
    };

    // 保存/取消按钮由通用模态框事件处理器统一处理（DOMContentLoaded 内绑定）

    const modal = document.getElementById("modal-edit");
    modal.classList.add("active");
}

// 拖放到编辑弹窗：自动根据后缀名识别封面或歌词
async function handleEditDrop(paths) {
    if (!currentEditTrack) return;
    const preview = document.getElementById("edit-cover-preview");
    for (const path of paths) {
        try {
            const result = await ReadFileForEdit(path);
            if (result.data) {
                // 图片 → 封面
                editCoverData = base64ToArray(result.data);
                editCoverMIME = result.mime || 'image/jpeg';
                editCoverCleared = false;
                preview.innerHTML = `<img src="data:${editCoverMIME};base64,${result.data}" alt="cover" />`;
            } else if (result.text) {
                // 文本 → 歌词
                document.getElementById("edit-lyrics").value = result.text;
            }
        } catch (err) {
            console.error('拖放导入编辑文件失败:', err);
            showToast(t('libraries.coverTooLarge'), 'warning');
        }
    }
}

function closeEditModal() {
    const modal = document.getElementById("modal-edit");
    modal.classList.add("closing");
    modal.classList.remove("active");
    setTimeout(() => {
        modal.classList.remove("closing");
        modal.style.display = '';
    }, 200);
    currentEditTrack = null;
    editCoverData = null;
    editCoverMIME = null;
    editCoverCleared = false;
}

async function saveEditModal() {
    if (!currentEditTrack) return;
    const title = document.getElementById("edit-title").value.trim();
    const artist = document.getElementById("edit-artist").value.trim();
    const lyrics = document.getElementById("edit-lyrics").value;

    if (!title) {
        showToast(t('libraries.titleRequired'), 'warning');
        return;
    }

    try {
        // 1. 先保存标题/艺术家/歌词
        await UpdateTrack(currentEditTrack.id, title, artist, lyrics);

        // 保存前记录当前编辑的曲目 ID（closeEditModal 会清空 currentEditTrack）
        const editedId = currentEditTrack.id;
        const wasCoverCleared = editCoverCleared;

        // 2. 如果封面有变更，单独提交
        if (editCoverCleared) {
            try {
                await UpdateTrackCover(currentEditTrack.id, [], '');
                _coverBustTs = Date.now();
            } catch (e) {}
        } else if (editCoverData && editCoverData.length > 0) {
            await UpdateTrackCover(currentEditTrack.id, editCoverData, editCoverMIME);
            _coverBustTs = Date.now();
        }

        closeEditModal();
        showToast(t('libraries.saved'), 'success');
        await refreshList();

        // 如果编辑的是当前播放曲目，同步更新迷你播放器
        const playingTrack = window.audioManager?.currentTrack;
        if (playingTrack && playingTrack.id === editedId) {
            playingTrack.name = title;
            playingTrack.artist = artist;
            playingTrack.lyrics = lyrics;
            if (wasCoverCleared) {
                playingTrack.cover = '';
            }
            localStorage.setItem('currentTrack', JSON.stringify(playingTrack));
            const miniCover = document.getElementById('mini-cover');
            const miniTitle = document.getElementById('mini-title');
            const miniArtist = document.getElementById('mini-artist');
            if (miniCover) setCover(miniCover, playingTrack.cover);
            if (miniTitle) { miniTitle.textContent = title || t('common.unknown'); applyMarquee(miniTitle); }
            if (miniArtist) miniArtist.textContent = artist || '--';
            window.audioManager.emit('trackloaded', playingTrack);
        }
    } catch (err) {
        console.error("保存失败:", err);
        showToast(t('libraries.saveFailed', err?.message || String(err)), 'error');
    }
}

// ============ 右键菜单 ============
const DEFAULT_COVER_HTML = '<div class="card-icon"><svg viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"></path></svg></div>';

// 封面缓存破坏时间戳：每次手动更换封面后更新，避免 /cover/<id> URL 不变导致浏览器一直用旧缓存
let _coverBustTs = 0;

// 给封面 URL 追加缓存破坏参数（?v=ts），确保后端封面更新后立即生效
function bustCoverUrl(url) {
    if (!url) return url;
    if (_coverBustTs <= 0) return url;
    const sep = url.includes('?') ? '&' : '?';
    return url + sep + 'v=' + _coverBustTs;
}

// 设置封面元素内容（img 或 div 容器）
function setCover(el, coverUrl) {
    if (coverUrl) {
        el.innerHTML = `<img src="${bustCoverUrl(coverUrl)}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;" />`;
    } else {
        el.innerHTML = DEFAULT_COVER_HTML;
    }
}

// ============ 听歌时长格式化 ============
// 按需引入单位：<60s 只显示秒，>60s 引入分，>3600s 引入小时，>24h 引入天
function formatListenTime(totalSeconds) {
    if (!totalSeconds || totalSeconds <= 0) {
        return t('libraries.statsEmpty');
    }

    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const parts = [];
    if (days > 0) {
        parts.push(t('libraries.statsDays', { count: days }));
    }
    if (days > 0 || hours > 0) {
        parts.push(t('libraries.statsHours', { count: hours }));
    }
    if (days > 0 || hours > 0 || minutes > 0) {
        parts.push(t('libraries.statsMinutes', { count: minutes }));
    }
    parts.push(t('libraries.statsSeconds', { count: seconds }));

    return parts.join(' ');
}

// ============ 听歌统计弹窗（复用确认对话框样式） ============
function showStatsModal(message) {
    return new Promise(resolve => {
        const modal = document.getElementById('confirmModal');
        const titleEl = document.getElementById('confirmTitle');
        const messageEl = document.getElementById('confirmMessage');
        const cancelBtn = document.getElementById('confirmCancel');
        const okBtn = document.getElementById('confirmOk');

        if (!modal) {
            resolve(window.confirm(message));
            return;
        }

        titleEl.textContent = t('libraries.statsTitle');
        messageEl.textContent = message;
        okBtn.textContent = t('common.close');
        okBtn.className = 'btn btn-primary';
        cancelBtn.style.display = 'none';

        const cleanup = (result) => {
            modal.classList.remove('active');
            okBtn.removeEventListener('click', onOk);
            modal.removeEventListener('click', onBackdrop);
            document.removeEventListener('keydown', onKey);
            cancelBtn.style.display = '';
            resolve(result);
        };
        const onOk = () => cleanup(true);
        const onBackdrop = (e) => { if (e.target === modal) cleanup(false); };
        const onKey = (e) => {
            if (e.key === 'Escape') cleanup(false);
            if (e.key === 'Enter') cleanup(true);
        };
        okBtn.addEventListener('click', onOk);
        modal.addEventListener('click', onBackdrop);
        document.addEventListener('keydown', onKey);
        modal.classList.add('active');
    });
}

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
    await refreshList();

    // 初始化主页播放队列侧栏（切换按钮、拖拽入队、洗牌、清空等）
    initLibQueueSidebar();

    // 搜索框：输入时防抖过滤，回车即时过滤
    const searchInput = document.getElementById('searchInput');
    const searchClear = document.getElementById('searchClear');
    if (searchInput) {
        let searchTimer = null;
        const runFilter = () => {
            currentQuery = searchInput.value || '';
            if (searchClear) searchClear.style.display = currentQuery ? 'flex' : 'none';
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
            currentQuery = '';
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
            // 重新加载设置并应用
            if (window.MusicLiteSettings) {
                window.MusicLiteSettings.cached = null;
                window.MusicLiteSettings.apply();
            }
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
            window.location.href = '/src/html/settings.html';
        });
    }

    // 设计器按钮
    const designerBtn = document.getElementById('designerBtn');
    if (designerBtn) {
        designerBtn.addEventListener('click', () => {
            window.location.href = '/src/html/designer.html';
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

    // 迷你播放器
    const miniPlayer = document.getElementById('mini-player');
    const miniPlayerLeft = document.querySelector('.mini-player-left');
    const miniCover = document.getElementById('mini-cover');
    const miniTitle = document.getElementById('mini-title');
    const miniArtist = document.getElementById('mini-artist');
    const miniPlayBtn = document.getElementById('mini-play');
    const miniPlayIcon = document.getElementById('mini-play-icon');
    const miniPauseIcon = document.getElementById('mini-pause-icon');
    const miniExpand = document.getElementById('mini-expand');

    // 使用全局音频管理器
    if (window.audioManager) {
        // 单一可信源：根据后端播放状态同步按钮图标
        const syncPlayIcon = () => {
            if (!miniPlayIcon || !miniPauseIcon) return;
            if (window.audioManager.isPlaying()) {
                miniPlayIcon.style.display = 'none';
                miniPauseIcon.style.display = 'block';
            } else {
                miniPlayIcon.style.display = 'block';
                miniPauseIcon.style.display = 'none';
            }
        };

        const applyTrackUI = (track) => {
            if (!track || !track.src) return;
            miniPlayer.style.display = 'flex';
            setCover(miniCover, track.cover);
            miniTitle.textContent = track.name || t('common.unknown');
            applyMarquee(miniTitle);
            miniArtist.textContent = track.artist || '--';
        };

        // 先绑定事件，再 restore()，避免事件早到
        window.audioManager.on('play', () => { syncPlayIcon(); applyNowPlayingIndicator(); });
        window.audioManager.on('pause', () => { syncPlayIcon(); applyNowPlayingIndicator(); });
        window.audioManager.on('trackloaded', (track) => {
            miniPlayer.style.display = 'flex';
            setCover(miniCover, track.cover);
            miniTitle.textContent = track.name || t('common.unknown');
            applyMarquee(miniTitle);
            miniArtist.textContent = track.artist || t('common.unknownArtist');
            // 同步更新全局当前曲目引用，供卡片点击时判断是否为同一曲目
            currentTrack = track;
            syncPlayIcon();
            applyNowPlayingIndicator();
            // 同步刷新队列侧栏的 is-current 标记（正在播放指示）
            if (typeof refreshLibQueue === 'function') refreshLibQueue();
        });
        // 曲目被清除时（删除检查）隐藏迷你播放器
        window.audioManager.on('trackcleared', () => {
            miniPlayer.style.display = 'none';
            applyNowPlayingIndicator();
        });

        // 恢复上次播放状态（必须在 on() 绑定完成后调用）
        // restore() 会按 volume_mode 从对应音源（synth/master）读取真实音量并同步缓存
        window.audioManager.restore();
        currentTrack = window.audioManager.currentTrack;
        if (currentTrack) {
            document.title = currentTrack.name || currentTrack.Name || 'MusicLite · 我的音乐库';
        }

        // 恢复上次状态后，继续检查这次启动是否传入参数
        var defaultFile = await GetFileInArgs();
        if (defaultFile && defaultFile.src) {
            // 若有文件
            console.log("有文件");
            console.log(defaultFile);
            // 命令行参数文件已经入库，刷新一下列表显示
            await refreshList();
            window.audioManager.loadTrack(defaultFile);
            window.audioManager.play();
            currentTrack = defaultFile;
            document.title = currentTrack.name || currentTrack.Name || 'MusicLite · 我的音乐库';
        }else{
            console.log("无文件");
        }
        // 删除检查：若恢复的曲目已不存在，清理状态并隐藏迷你播放器
        if (currentTrack) {
            try {
                const { GetTrack } = await import('@bindings/MusicLite/app/musicservice.js');
                await GetTrack(Number(currentTrack.id));
            } catch (err) {
                window.audioManager.clearTrack();
                currentTrack = null;
            }
        }

        if (currentTrack) {
            applyTrackUI(currentTrack);
        }

        // 根据真实状态同步一次按钮（restore 已完成的情况）
        syncPlayIcon();
        // 兜底：如果 play() 在异步触发，再拉 2 次
        setTimeout(syncPlayIcon, 200);
        setTimeout(syncPlayIcon, 800);
    }

    // 迷你播放器播放/暂停
    if (miniPlayBtn) {
        miniPlayBtn.addEventListener('click', () => {
            if (window.audioManager && window.audioManager.currentTrack) {
                window.audioManager.toggle();
            }
        });
    }

    // 迷你播放器上一曲 / 下一曲
    const miniPrevBtn = document.getElementById('mini-prev');
    const miniNextBtn = document.getElementById('mini-next');
    if (miniPrevBtn) {
        miniPrevBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            miniPrevTrack();
        });
    }
    if (miniNextBtn) {
        miniNextBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            miniNextTrack();
        });
    }

    // 展开播放器—— 带删除检查
    if (miniExpand) {
        miniExpand.addEventListener('click', async () => {
            const currentTrack = window.audioManager?.currentTrack;
            if (!currentTrack) return;
            const ok = await openPlayer(currentTrack.id);
            // 若曲目已删除，openPlayer 返回 false 并已清理状态
            if (!ok) {
                miniPlayer.style.display = 'none';
            }
        });
    }

    // 点击 cover + 标题区域也可回到播放器
    if (miniPlayerLeft) {
        miniPlayerLeft.addEventListener('click', async () => {
            const currentTrack = window.audioManager?.currentTrack;
            if (!currentTrack) return;
            const ok = await openPlayer(currentTrack.id);
            if (!ok) {
                miniPlayer.style.display = 'none';
            }
        });
    }

    // 从设置页跳转过来时自动打开播放器
    const openPlayerId = localStorage.getItem('openPlayerOnLoad');
    if (openPlayerId) {
        localStorage.removeItem('openPlayerOnLoad');
        openPlayer(Number(openPlayerId));
    }

    // 模态框关闭按钮
    document.querySelectorAll('.modal-close, .modal-save, .modal-cancel').forEach(btn => {
        btn.addEventListener("click", (e) => {
            const modalEl = e.target.closest('.modal-backdrop');
            if (!modalEl) return;
            const action = btn.dataset.action;
            if (action === 'save') {
                if (modalEl.id === 'modal-edit') saveEditModal();
            } else {
                // 点击 backdrop 关闭
                if (modalEl.id === 'modal-edit') closeEditModal();
            }
        });
    });

    // 点击 backdrop 关闭模态框
    document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
        backdrop.addEventListener("click", (e) => {
            if (e.target === backdrop) {
                if (backdrop.id === 'modal-edit') closeEditModal();
            }
        });
    });
}

// 安全启动：ES 模块执行时 DOMContentLoaded 可能已触发，需双重检查
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLibrariesPage);
} else {
    initLibrariesPage();
}
