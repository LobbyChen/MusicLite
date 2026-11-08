// 音乐库列表：视图模式、排序、过滤、渲染、播放/删除等曲目操作
import { audioManager } from '../../core/audio-manager.js';
import { escapeHtml } from '../../ui/dom.js';
import { showToast } from '../../ui/toast.js';
import {
    GetAllTracks, DeleteTrack, LoadSettings, SaveSettings,
    QueueClear, QueueAddAll, QueueGetStatus, QueueRemoveAt, PackShare,
} from '../../core/bindings.js';
import { t } from '../../core/i18n.js';
import { openPlayer } from './player.js';
import { state, NP_BARS_HTML } from './state.js';
import { mediaContainer, emptyOverlay } from './dom.js';
import { bustCoverUrl } from './cover.js';
import { showConfirm } from './confirm.js';
import { showContextMenu } from './context-menu.js';
import { openEditModal } from './edit-modal.js';
import { doAddToQueue, makeTrackDraggable, refreshLibQueue } from './lib-queue.js';

// ============ 列表渲染 ============
// 获取当前的列表显示模式（card / list）
export async function getListMode() {
    try {
        const cached = localStorage.getItem('cachedSettings');
        if (cached) {
            const s = JSON.parse(cached);
            if (s.list_mode === 'card' || s.list_mode === 'list') return s.list_mode;
        }
    } catch (e) { }
    try {
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
    } catch (e) { }
    return 'card';
}

// 获取当前排序方式：优先缓存，未命中读后端设置
export async function getSortMode() {
    try {
        const cached = localStorage.getItem('cachedSettings');
        if (cached) {
            const s = JSON.parse(cached);
            if (s.sort_mode === 'recent' || s.sort_mode === 'title' || s.sort_mode === 'artist' || s.sort_mode === 'album') {
                return s.sort_mode;
            }
        }
    } catch (e) { }
    try {
        const s = await LoadSettings();
        return (s.sort_mode === 'recent' || s.sort_mode === 'title' || s.sort_mode === 'artist' || s.sort_mode === 'album') ? s.sort_mode : 'recent';
    } catch (e) {
        return 'recent';
    }
}

// 同步主页开关 UI 与容器 class 到指定模式（不写设置）
export function applyListMode(mode) {
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
export function applySortMode(mode) {
    state.currentSort = mode;
    const control = document.getElementById('sortControl');
    if (!control) return;
    control.querySelectorAll('.sort-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.sort === mode);
    });
}

// 切换并持久化列表模式：保存到后端 + cachedSettings + 即时重渲染
export async function setListMode(mode) {
    if (mode !== 'card' && mode !== 'list') return;
    applyListMode(mode);
    // 写 localStorage 缓存（renderLibrary 会读这个）
    try {
        const cached = localStorage.getItem('cachedSettings');
        const obj = cached ? JSON.parse(cached) : {};
        obj.list_mode = mode;
        localStorage.setItem('cachedSettings', JSON.stringify(obj));
    } catch (e) { }
    // 异步保存到后端（不阻塞 UI）
    try {
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
export async function setSortMode(mode) {
    if (mode !== 'recent' && mode !== 'title' && mode !== 'artist' && mode !== 'album') return;
    applySortMode(mode);
    try {
        const cached = localStorage.getItem('cachedSettings');
        const obj = cached ? JSON.parse(cached) : {};
        obj.sort_mode = mode;
        localStorage.setItem('cachedSettings', JSON.stringify(obj));
    } catch (e) { }
    try {
        const s = await LoadSettings();
        s.sort_mode = mode;
        await SaveSettings(s);
        localStorage.setItem('settingsUpdated', Date.now().toString());
    } catch (e) {
        console.warn('保存 sort_mode 失败:', e);
    }
    await renderLibrary();
}

export async function refreshList() {
    try {
        const tracks = await GetAllTracks();
        state.allTracks = tracks || [];
    } catch (err) {
        console.error("加载列表失败:", err);
        state.allTracks = [];
    }
    await renderLibrary();
}

// 按当前关键词与排序方式过滤、排序
export function applyFilterAndSort(tracks) {
    const q = state.currentQuery.trim().toLowerCase();
    let list = tracks;
    if (q) {
        list = list.filter(tr => {
            const name = (tr.name || '').toLowerCase();
            const artist = (tr.artist || '').toLowerCase();
            const album = (tr.album || '').toLowerCase();
            return name.includes(q) || artist.includes(q) || album.includes(q);
        });
    }
    const sorted = list.slice();
    const opts = { sensitivity: 'base', numeric: true };
    switch (state.currentSort) {
        case 'title':
            sorted.sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, opts));
            break;
        case 'artist':
            sorted.sort((a, b) => {
                const c = (a.artist || '').localeCompare(b.artist || '', undefined, opts);
                return c !== 0 ? c : (a.name || '').localeCompare(b.name || '', undefined, opts);
            });
            break;
        case 'album':
            sorted.sort((a, b) => {
                const c = (a.album || '').localeCompare(b.album || '', undefined, opts);
                if (c !== 0) return c;
                const d = (a.artist || '').localeCompare(b.artist || '', undefined, opts);
                return d !== 0 ? d : (a.name || '').localeCompare(b.name || '', undefined, opts);
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
export async function renderLibrary() {
    const mode = await getListMode();
    applyListMode(mode);
    const list = applyFilterAndSort(state.allTracks);
    renderTracksList(list, mode);
    updateLibraryEmptyStates(list);
    applyNowPlayingIndicator();
}

// 更新空库 / 无搜索结果两种空态的显隐
function updateLibraryEmptyStates(list) {
    const hasTracks = state.allTracks.length > 0;
    const hasResults = list.length > 0;
    emptyOverlay.classList.toggle('display', !hasTracks);
    const noResults = document.getElementById('no-results');
    if (noResults) noResults.style.display = (!hasResults && hasTracks) ? 'flex' : 'none';
    mediaContainer.style.display = hasResults ? ((getListModeSync() === 'list') ? 'flex' : 'grid') : 'none';
}

// 播放指定曲目并打开播放器
export function playTrack(track) {
    audioManager.loadTrack(track);
    audioManager.play();
    state.currentTrack = track;
    openPlayer(track.id);
}

// 确认后删除曲目
function promptDelete(track) {
    showConfirm({
        title: t('libraries.deleteTitle'),
        message: t('libraries.deleteConfirm', track.name),
        okText: t('common.delete'),
        cancelText: t('common.cancel')
    }).then((ok) => {
        if (ok) doDelete(track.id);
    });
}

// 打包分享：写入封面/歌词标签并复制到剪贴板
async function doPackShare(track) {
    try {
        await PackShare(track.id);
        showToast(t('libraries.shareSuccess'), 'success');
    } catch (err) {
        console.error('打包分享失败:', err);
        showToast(t('libraries.shareFailed', err), 'error');
    }
}

// 给列表项绑定点击/编辑/删除/右键（与卡片共用）
function _bindTrackItemListeners(el, track, actionSelector) {
    let longPressFired = false;
    el.addEventListener("click", async (e) => {
        if (longPressFired) { longPressFired = false; return; }
        if (e.target.closest(actionSelector)) return;

        const cur = audioManager && audioManager.currentTrack;
        const isCurrent = cur && track.id !== undefined && track.id === cur.id;
        if (!isCurrent) {
            audioManager.loadTrack(track);
            audioManager.play();
            state.currentTrack = track;
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
    if (deleteBtn) deleteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        promptDelete(track);
    });

    const ctxHandlers = {
        play: playTrack,
        addToQueue: doAddToQueue,
        share: doPackShare,
        edit: openEditModal,
        delete: promptDelete,
    };

    el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        showContextMenu(e, track, ctxHandlers);
    });

    // 触屏长按 → 打开右键菜单；轻点仍走播放逻辑
    let lpTimer = null;
    const clearLp = () => {
        if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
    };
    el.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) return;
        const touch = e.touches[0];
        lpTimer = setTimeout(() => {
            lpTimer = null;
            longPressFired = true;
            showContextMenu({ clientX: touch.clientX, clientY: touch.clientY }, track, ctxHandlers);
        }, 520);
    }, { passive: true });
    el.addEventListener('touchend', () => {
        clearLp();
        // 长按菜单已打开：兜底重置标记，避免没有合成 click 时吞掉下一次正常点击
        if (longPressFired) {
            setTimeout(() => { longPressFired = false; }, 400);
        }
    }, { passive: true });
    el.addEventListener('touchmove', clearLp, { passive: true });
    el.addEventListener('touchcancel', () => {
        clearLp();
        longPressFired = false;
    }, { passive: true });
}

// 标记当前正在播放的曲目，并同步播放/暂停态用于控制动态条动画
export function applyNowPlayingIndicator() {
    const cur = audioManager && audioManager.currentTrack;
    const curId = cur ? cur.id : null;
    const isPlaying = !!(audioManager && audioManager.isPlaying());
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
    const ALBUM_LABEL = t('libraries.albumLabel');

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

            const albumLine = track.album ? `<div class="list-item-album">${ALBUM_LABEL}: ${escapeHtml(track.album)}</div>` : '';

            item.innerHTML = `
                ${coverHTML}
                <div class="list-item-info">
                    <div class="list-item-title">${NP_BARS_HTML}${escapeHtml(track.name)}</div>
                    <div class="list-item-artist">${escapeHtml(track.artist || UNKNOWN_ARTIST)}</div>
                    ${albumLine}
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

            const albumLine = track.album ? `<div class="card-album">${ALBUM_LABEL}: ${escapeHtml(track.album)}</div>` : '';

            card.innerHTML = `
                ${NP_BARS_HTML}
                ${coverHTML}
                <div class="card-title">${escapeHtml(track.name)}</div>
                <div class="card-meta">${escapeHtml(track.artist || UNKNOWN_ARTIST)}</div>
                ${albumLine}
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

// ============ 播放全部 ============
// 播放当前（过滤+排序后）列表：填充队列并播放第一首
export async function playAllFromList() {
    const list = applyFilterAndSort(state.allTracks);
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
    audioManager.loadTrack(first);
    audioManager.play();
    state.currentTrack = first;
    await openPlayer(first.id);
}

// ============ 删除 ============
export async function doDelete(id) {
    try {
        await DeleteTrack(id);
        // 如果删除的是当前播放曲目，停止播放并清理 UI
        const cur = audioManager && audioManager.currentTrack;
        if (cur && Number(cur.id) === Number(id)) {
            audioManager.clearTrack();
            const miniPlayer = document.getElementById('mini-player');
            if (miniPlayer) miniPlayer.style.display = 'none';
        }
        // 从播放队列中移除已删除曲目，避免自动切歌到已删除文件导致播放中断
        try {
            const status = await QueueGetStatus();
            const items = status?.items || [];
            for (let i = items.length - 1; i >= 0; i--) {
                if (Number(items[i]?.track?.id) === Number(id)) {
                    await QueueRemoveAt(i);
                }
            }
        } catch (e) {
            console.warn('从队列移除已删除曲目失败:', e);
        }
        showToast(t('libraries.deleted'), 'success');
        await refreshList();
        refreshLibQueue();
        try { window.QueuePanel?.refresh?.(); } catch (e) { }
    } catch (err) {
        console.error("删除失败:", err);
        showToast(t('libraries.deleteFailed', err), 'error');
    }
}
