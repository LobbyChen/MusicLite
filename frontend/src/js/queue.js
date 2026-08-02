// queue.js — 播放队列面板逻辑（模块化）
// 与后端 PlayQueue（queue.go，线程安全 + Fisher-Yates 洗牌）实时联动。
// 面板在 player-overlay 内，支持点击空白处或按 ESC 关闭，拖拽手柄排序。
import {
    QueueGetStatus, QueueRemoveAt, QueueClear, QueueShuffle,
    QueueMove, QueueJumpTo
} from '../../wailsjs/go/main/App.js';
import { t } from './i18n.js';

const NP_BARS_HTML = '<span class="np-bars" aria-hidden="true"><i></i><i></i><i></i></span>';
const MUSIC_ICON_SVG = '<svg viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>';
const DRAG_ICON_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M11 18c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2zm-2-8c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6 4c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>';
const REMOVE_ICON_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';

let panelEl = null;
let listEl = null;
let openBtn = null;
let shuffleBtn = null;
let clearBtn = null;
let badgeEl = null;
let isOpen = false;
let initialized = false;
let lastStatus = null;        // 最近一次的队列快照
let dragFromIndex = -1;       // 拖拽起始下标

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : text;
    return div.innerHTML;
}

// 渲染队列项封面（img 或默认图标）
function renderCover(coverUrl) {
    if (coverUrl) {
        return `<img src="${coverUrl}" alt="" />`;
    }
    return `<div class="card-icon">${MUSIC_ICON_SVG}</div>`;
}

// 渲染整个队列列表
function renderList(status) {
    lastStatus = status;
    if (!listEl) return;
    const items = (status && status.items) || [];
    // 注意：不能用 `|| -1`，因为 currentIndex===0（第一首）会被当成 falsy
    const curIdx = (status && typeof status.currentIndex === 'number') ? status.currentIndex : -1;

    // 更新角标
    if (badgeEl) {
        const n = items.length;
        badgeEl.textContent = String(n);
        badgeEl.style.display = n > 0 ? '' : 'none';
    }

    if (items.length === 0) {
        listEl.innerHTML = `<div class="queue-empty">${t('player.queueEmpty')}</div>`;
        return;
    }

    let html = '';
    for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const track = it.track || {};
        const isCurrent = (i === curIdx);
        const cover = track.cover || '';
        html += `
            <div class="queue-item${isCurrent ? ' is-current' : ''}" data-index="${i}" draggable="true">
                <span class="queue-item-drag" title="${t('player.queueDragHint')}">${DRAG_ICON_SVG}</span>
                <div class="queue-item-cover">${renderCover(cover)}</div>
                <div class="queue-item-info">
                    <div class="queue-item-title">${escapeHtml(track.name || t('common.unknown'))}</div>
                    <div class="queue-item-artist">${escapeHtml(track.artist || t('common.unknownArtist'))}</div>
                </div>
                ${isCurrent ? NP_BARS_HTML : ''}
                <button class="queue-item-remove" title="${t('common.delete')}">${REMOVE_ICON_SVG}</button>
            </div>
        `;
    }
    listEl.innerHTML = html;

    // 滚动到当前项
    if (curIdx >= 0) {
        const curEl = listEl.querySelector(`.queue-item[data-index="${curIdx}"]`);
        if (curEl) curEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    bindItemEvents();
    restartNpBars(listEl);
}

// ========== JS 驱动 np-bars 动画（替代 CSS 选择器，避免首次打开/重载时不触发） ==========
function restartNpBars(scopeEl) {
    if (!scopeEl) return;
    // 先清除所有 np-bars 元素上的旧动画（避免累积）
    scopeEl.querySelectorAll('.np-bars').forEach(barEl => {
        barEl.querySelectorAll('i').forEach((iEl, k) => {
            // 取消旧动画
            try { iEl.getAnimations().forEach(a => a.cancel()); } catch (_) {}
        });
        // 非当前项直接返回（已在 CSS 中 display:none）
        const item = barEl.closest('.queue-item');
        if (!item || !item.classList.contains('is-current')) return;
        // 用 Web Animations API 显式启动 3 根竖条的缩放动画
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
                        delay: k * 200,        // 每根偏移 0.2s
                        iterations: Infinity,
                        easing: 'ease-in-out'
                    }
                );
            } catch (_) {}
        });
    });
}

// 绑定队列项交互：点击播放 / 删除 / 拖拽排序
function bindItemEvents() {
    if (!listEl) return;
    listEl.querySelectorAll('.queue-item').forEach(el => {
        const idx = parseInt(el.dataset.index, 10);
        if (isNaN(idx)) return;

        // 点击队列项 → 跳转播放
        el.addEventListener('click', (e) => {
            // 点删除按钮不触发跳转
            if (e.target.closest('.queue-item-remove')) return;
            if (e.target.closest('.queue-item-drag')) return;
            e.stopPropagation();
            QueueJumpTo(idx).catch(err => console.warn('QueueJumpTo failed:', err));
        });

        // 删除按钮
        const removeBtn = el.querySelector('.queue-item-remove');
        if (removeBtn) {
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                QueueRemoveAt(idx).then(ok => {
                    if (ok) return refresh();
                }).catch(err => console.warn('QueueRemoveAt failed:', err));
            });
        }

        // 拖拽排序
        el.addEventListener('dragstart', (e) => {
            dragFromIndex = idx;
            el.classList.add('dragging');
            try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(idx)); } catch (_) {}
        });
        el.addEventListener('dragend', () => {
            el.classList.remove('dragging');
            listEl.querySelectorAll('.queue-item.drag-over').forEach(n => n.classList.remove('drag-over'));
            dragFromIndex = -1;
        });
        el.addEventListener('dragover', (e) => {
            e.preventDefault();
            try { e.dataTransfer.dropEffect = 'move'; } catch (_) {}
            if (dragFromIndex < 0 || dragFromIndex === idx) return;
            listEl.querySelectorAll('.queue-item.drag-over').forEach(n => n.classList.remove('drag-over'));
            el.classList.add('drag-over');
        });
        el.addEventListener('dragleave', () => {
            el.classList.remove('drag-over');
        });
        el.addEventListener('drop', (e) => {
            e.preventDefault();
            el.classList.remove('drag-over');
            const from = dragFromIndex;
            if (from < 0 || from === idx) return;
            QueueMove(from, idx).then(ok => {
                if (ok) return refresh();
            }).catch(err => console.warn('QueueMove failed:', err));
        });
    });
}

// 打开/关闭面板
function open() {
    if (!panelEl) return;
    panelEl.classList.add('active');
    if (openBtn) openBtn.classList.add('active');
    isOpen = true;
    refresh();
}
function close() {
    if (!panelEl) return;
    panelEl.classList.remove('active');
    if (openBtn) openBtn.classList.remove('active');
    isOpen = false;
}
function toggle() {
    if (isOpen) close(); else open();
}
function getIsOpen() { return isOpen; }

// 从后端拉取最新队列状态
async function refresh() {
    try {
        const status = await QueueGetStatus();
        renderList(status);
    } catch (e) {
        console.warn('QueueGetStatus failed:', e);
    }
}

// 初始化
async function init() {
    // 防重复绑定：openPlayer 每次切歌都会调用 init()，但 DOM 元素只有一个，
    // 若不拦截会导致 click 事件被绑定多次 → toggle() 被调用多次 → 面板打开后立刻关闭。
    if (initialized) {
        await refresh();
        return;
    }
    panelEl = document.getElementById('queuePanel');
    listEl = document.getElementById('queueList');
    openBtn = document.getElementById('queueBtn');
    shuffleBtn = document.getElementById('queueShuffleBtn');
    clearBtn = document.getElementById('queueClearBtn');
    badgeEl = document.getElementById('queueBadge');
    if (!panelEl || !listEl) return;

    // 洗牌
    if (shuffleBtn) {
        shuffleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            QueueShuffle().then(refresh).catch(err => console.warn('QueueShuffle failed:', err));
        });
    }
    // 清空
    if (clearBtn) {
        clearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            QueueClear().then(refresh).catch(err => console.warn('QueueClear failed:', err));
        });
    }
    // 打开按钮
    if (openBtn) {
        openBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggle();
        });
    }
    // 面板内点击不冒泡（避免触发"点击空白关闭"）
    panelEl.addEventListener('click', (e) => { e.stopPropagation(); });

    // 初始拉取一次
    await refresh();
    initialized = true;
}

export const QueuePanel = { init, open, close, toggle, getIsOpen, refresh };
