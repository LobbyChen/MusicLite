// 音乐库主页播放队列侧栏：渲染、拖拽排序、洗牌/清空、加入队列
import { audioManager } from '../../core/audio-manager.js';
import { escapeHtml } from '../../ui/dom.js';
import { showToast } from '../../ui/toast.js';
import { t } from '../../core/i18n.js';
import {
    QueueGetStatus, QueueRemoveAt, QueueJumpTo, QueueMove,
    QueueAddTrack, QueueShuffle, QueueClear,
} from '../../core/bindings.js';

const NP_BARS_HTML_Q = '<span class="np-bars" aria-hidden="true"><i></i><i></i><i></i></span>';
const MUSIC_ICON_SVG_Q = '<svg viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>';
const DRAG_ICON_SVG_Q = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M11 18c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2zm-2-8c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6 4c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>';
const REMOVE_ICON_SVG_Q = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';

let libQueueSidebar = null;
let libQueueList = null;
let libQueueBadge = null;
let libQueueOpen = false;
let libQueueDragFromIndex = -1;

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
                    <div class="queue-item-title">${escapeHtml(track.name || t('common.unknown'))}</div>
                    <div class="queue-item-artist">${escapeHtml(track.artist || t('common.unknownArtist'))}</div>
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
            } catch (_) { }
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
export async function refreshLibQueue() {
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
            try { iEl.getAnimations().forEach(a => a.cancel()); } catch (_) { }
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
            } catch (_) { }
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
                        if (wasCurrent && audioManager) {
                            audioManager.clearTrack();
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
            } catch (_) { }
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
                try { e.dataTransfer.dropEffect = 'move'; } catch (_) { }
                if (libQueueDragFromIndex === idx) return;
                libQueueList.querySelectorAll('.queue-item.drag-over').forEach(n => n.classList.remove('drag-over'));
                el.classList.add('drag-over');
            } else {
                try { e.dataTransfer.dropEffect = 'copy'; } catch (_) { }
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
                    } catch (_) { }
                }).catch(err => console.warn('QueueMove failed:', err));
            } else {
                const trackId = e.dataTransfer.getData('application/x-track-id') || e.dataTransfer.getData('text/plain');
                const id = Number(trackId);
                if (id > 0) {
                    QueueAddTrack(id).then(() => refreshLibQueue()).catch(err => console.warn('QueueAddTrack failed:', err));
                }
            }
        });

        // 触屏拖动排序：通过左侧拖拽手柄接管触摸手势
        const dragHandle = el.querySelector('.queue-item-drag');
        if (dragHandle) {
            let touchFrom = -1;
            dragHandle.addEventListener('touchstart', (e) => {
                if (e.touches.length !== 1) return;
                touchFrom = idx;
                el.classList.add('dragging');
                e.preventDefault();
            }, { passive: false });
            dragHandle.addEventListener('touchmove', (e) => {
                e.preventDefault();
                libQueueList.querySelectorAll('.queue-item.drag-over').forEach(n => n.classList.remove('drag-over'));
                const touch = e.touches[0];
                const targetEl = touch && document.elementFromPoint(touch.clientX, touch.clientY);
                const targetItem = targetEl && targetEl.closest('.queue-item');
                if (targetItem && targetItem !== el) targetItem.classList.add('drag-over');
            }, { passive: false });
            dragHandle.addEventListener('touchend', (e) => {
                el.classList.remove('dragging');
                libQueueList.querySelectorAll('.queue-item.drag-over').forEach(n => n.classList.remove('drag-over'));
                const touch = e.changedTouches[0];
                if (!touch || touchFrom < 0) return;
                const targetEl = document.elementFromPoint(touch.clientX, touch.clientY);
                const targetItem = targetEl && targetEl.closest('.queue-item');
                const targetIdx = targetItem ? parseInt(targetItem.dataset.index, 10) : NaN;
                if (!isNaN(targetIdx)) {
                    // 与桌面拖拽一致：按手指在目标项上/下半区决定插入位置，
                    // 并按"先移除 from 再插入"的语义修正目标下标
                    const rect = targetItem.getBoundingClientRect();
                    let to = (touch.clientY - rect.top) < (rect.height / 2) ? targetIdx : targetIdx + 1;
                    if (touchFrom < to) to -= 1;
                    if (to !== touchFrom) {
                        QueueMove(touchFrom, to).then(() => {
                            refreshLibQueue();
                            try {
                                if (window.QueuePanel && typeof window.QueuePanel.refresh === 'function') {
                                    window.QueuePanel.refresh();
                                }
                            } catch (_) { }
                        }).catch(err => console.warn('QueueMove (touch) failed:', err));
                    }
                }
                touchFrom = -1;
            });
            dragHandle.addEventListener('touchcancel', () => {
                el.classList.remove('dragging');
                libQueueList.querySelectorAll('.queue-item.drag-over').forEach(n => n.classList.remove('drag-over'));
                touchFrom = -1;
            });
        }
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
export function makeTrackDraggable(el, track) {
    if (!el) return;
    el.setAttribute('draggable', 'true');
    el.addEventListener('dragstart', (e) => {
        el.classList.add('dragging-queue');
        try {
            // 使用 copyMove 以兼容 dropEffect=copy 和 move 的目标区域
            e.dataTransfer.effectAllowed = 'copyMove';
            e.dataTransfer.setData('application/x-track-id', String(track.id));
            e.dataTransfer.setData('text/plain', String(track.id));
        } catch (_) { }
    });
    el.addEventListener('dragend', () => {
        el.classList.remove('dragging-queue');
    });
}

export function initLibQueueSidebar() {
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
            try { e.dataTransfer.dropEffect = 'move'; } catch (_) { }
        } else {
            // 外部拖入：dropEffect = copy
            try { e.dataTransfer.dropEffect = 'copy'; } catch (_) { }
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
        // 外部拖入：媒体卡片 → 入队
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

// 暴露到全局，供 WinUI3 侧栏切换时刷新队列
try { window.refreshLibQueue = refreshLibQueue; } catch (_) { }

// 加入队列（供列表/右键菜单复用）
export async function doAddToQueue(track) {
    try {
        await QueueAddTrack(Number(track.id));
        showToast(t('libraries.addedToQueue', track.name), 'success');
        refreshLibQueue();
    } catch (err) {
        console.error('加入队列失败:', err);
        showToast(t('libraries.addToQueueFailed'), 'error');
    }
}
