// 曲目右键菜单：动作由调用方注入，避免与列表模块循环依赖
import { t } from '../../core/i18n.js';

let contextMenuEl = null;

// handlers: { play(track), addToQueue(track), edit(track), delete(track) }
export function showContextMenu(e, track, handlers = {}) {
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
        <div class="context-item" data-action="share" style="--ctx-i:2">
            ${t('libraries.packShare')}
        </div>
        <div class="context-divider"></div>
        <div class="context-item" data-action="edit" style="--ctx-i:3">
            ${t('libraries.editInfo')}
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
            switch (action) {
                case 'play': handlers.play?.(track); break;
                case 'addToQueue': handlers.addToQueue?.(track); break;
                case 'share': handlers.share?.(track); break;
                case 'edit': handlers.edit?.(track); break;
                case 'delete': handlers.delete?.(track); break;
            }
        });
    });
}

export function hideContextMenu() {
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
