import { ImportFiles, GetAllTracks, UpdateTrack, UpdateTrackCover, DeleteTrack , GetFileInArgs, ImportFilesFromPaths, GetTotalListenTime, PickImageFile, PickLyricsFile, ReadFileForEdit, PackShare } from '../../wailsjs/go/main/App.js';
import { OnFileDrop } from '../../wailsjs/runtime/runtime.js';
import { openPlayer } from './player.js';
import { initI18n, t } from './i18n.js';

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
document.getElementById('minimizeBtn')?.addEventListener('click', () => window.runtime?.WindowMinimise());
document.getElementById('closeBtn')?.addEventListener('click', () => window.runtime?.WindowHide());

// DOM Elements
const fileBtn = document.getElementById("openFileBtn");
const mediaContainer = document.getElementById('media-container');
const emptyOverlay = document.getElementById("empty-state");
const dropOverlay = document.getElementById('drop-overlay');


// 全局变量
// 当前track
var currentTrack;
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

// Wails 原生文件拖放：提供完整文件路径，绕过 WebView2 安全限制
// useDropTarget=false 让 Wails 不拦截 drop target，由前端自己处理 UI
OnFileDrop(async (_x, _y, paths) => {
    if (!paths || paths.length === 0) return;
    // 编辑弹窗打开时，拖放走封面/歌词导入
    if (isEditModalActive()) {
        await handleEditDrop(paths);
        return;
    }
    await doImportPaths(paths);
}, false);

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
        const { LoadSettings } = await import('../../wailsjs/go/main/App.js');
        const s = await LoadSettings();
        return (s.list_mode === 'card' || s.list_mode === 'list') ? s.list_mode : 'card';
    } catch (e) {
        return 'card';
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

// 切换并持久化模式：保存到后端 + cachedSettings + 即时重渲染
async function setListMode(mode) {
    if (mode !== 'card' && mode !== 'list') return;
    applyListMode(mode);
    // 写 localStorage 缓存（renderTracks 会读这个）
    try {
        const cached = localStorage.getItem('cachedSettings');
        const obj = cached ? JSON.parse(cached) : {};
        obj.list_mode = mode;
        localStorage.setItem('cachedSettings', JSON.stringify(obj));
    } catch (e) {}
    // 异步保存到后端（不阻塞 UI）
    try {
        const { LoadSettings, SaveSettings } = await import('../../wailsjs/go/main/App.js');
        const s = await LoadSettings();
        s.list_mode = mode;
        await SaveSettings(s);
        // 通知其他页面（设置页如果还保留模式选择器，会同步状态）
        localStorage.setItem('settingsUpdated', Date.now().toString());
    } catch (e) {
        console.warn('保存 list_mode 失败:', e);
    }
    // 重渲染列表（结构切换）
    await refreshList();
}

async function refreshList() {
    try {
        const tracks = await GetAllTracks();
        renderTracks(tracks);
    } catch (err) {
        console.error("加载列表失败:", err);
        renderTracks([]);
    }
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

async function renderTracks(tracks) {
    const mode = await getListMode();
    applyListMode(mode);

    mediaContainer.innerHTML = '';

    if (!tracks || tracks.length === 0) {
        emptyOverlay.classList.add('display');
        mediaContainer.style.display = 'none';
        return;
    }

    emptyOverlay.classList.remove('display');
    mediaContainer.style.display = (mode === 'list') ? 'flex' : 'grid';

    const MUSIC_ICON_SVG = '<svg viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>';
    const EDIT_BTN_SVG = `<svg viewBox="0 0 24 24" width="16" height="16"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>`;
    const DELETE_BTN_SVG = `<svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>`;
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
                    <div class="list-item-title">${escapeHtml(track.name)}</div>
                    <div class="list-item-artist">${escapeHtml(track.artist || UNKNOWN_ARTIST)}</div>
                </div>
                <div class="list-item-actions">
                    <button class="card-btn edit-btn" title="${EDIT_TITLE}">${EDIT_BTN_SVG}</button>
                    <button class="card-btn delete-btn" title="${DELETE_TITLE}">${DELETE_BTN_SVG}</button>
                </div>
            `;
            _bindTrackItemListeners(item, track, '.list-item-actions');
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
                ${coverHTML}
                <div class="card-title">${escapeHtml(track.name)}</div>
                <div class="card-meta">${escapeHtml(track.artist || UNKNOWN_ARTIST)}</div>
                <div class="card-actions">
                    <button class="card-btn edit-btn" title="${EDIT_TITLE}">${EDIT_BTN_SVG}</button>
                    <button class="card-btn delete-btn" title="${DELETE_TITLE}">${DELETE_BTN_SVG}</button>
                </div>
            `;
            _bindTrackItemListeners(card, track, '.card-actions');
            mediaContainer.appendChild(card);
        }
    }
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
        <div class="context-item" data-action="edit" style="--ctx-i:0">
            ${t('libraries.editInfo')}
        </div>
        <div class="context-item" data-action="share" style="--ctx-i:1">
            ${t('libraries.packShare')}
        </div>
        <div class="context-divider"></div>
        <div class="context-item danger" data-action="delete" style="--ctx-i:2">
            ${t('common.delete')}
        </div>
    `;

    // 定位到点击位置
    const x = Math.min(e.clientX, window.innerWidth - 160);
    const y = Math.min(e.clientY, window.innerHeight - 180);
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
document.addEventListener("DOMContentLoaded", async function () {
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
    await refreshList();

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
        // 单一可信源：根据 audio.paused 同步按钮图标
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
        window.audioManager.on('play', () => syncPlayIcon());
        window.audioManager.on('pause', () => syncPlayIcon());
        window.audioManager.on('trackloaded', (track) => {
            miniPlayer.style.display = 'flex';
            setCover(miniCover, track.cover);
            miniTitle.textContent = track.name || t('common.unknown');
            applyMarquee(miniTitle);
            miniArtist.textContent = track.artist || t('common.unknownArtist');
            // 同步更新全局当前曲目引用，供卡片点击时判断是否为同一曲目
            currentTrack = track;
            syncPlayIcon();
        });
        // 曲目被清除时（删除检查）隐藏迷你播放器
        window.audioManager.on('trackcleared', () => {
            miniPlayer.style.display = 'none';
        });

        // 应用保存的音量（优先使用 localStorage 中实时调整的音量，其次使用设置中的默认音量）
        try {
            const savedVolume = localStorage.getItem('volume');
            if (savedVolume !== null) {
                let vol = parseFloat(savedVolume);
                if (vol > 1) vol = vol / 100; // 兼容 0~100 范围
                window.audioManager.audio.volume = Math.max(0, Math.min(1, vol));
            } else {
                const { LoadSettings } = await import('../../wailsjs/go/main/App.js');
                const settings = await LoadSettings();
                window.audioManager.audio.volume = (settings.volume || 70) / 100;
            }
        } catch (e) {
            console.warn('Failed to load volume settings:', e);
        }

        // 恢复上次播放状态（必须在 on() 绑定完成后调用）
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
                const { GetTrack } = await import('../../wailsjs/go/main/App.js');
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
});
