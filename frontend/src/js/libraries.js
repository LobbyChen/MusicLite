import { ImportFiles, GetAllTracks, UpdateTrack, UpdateTrackCover, DeleteTrack } from '../../wailsjs/go/main/App.js';

// ============ 标题栏窗口控制 ============
document.getElementById('minimizeBtn')?.addEventListener('click', () => window.runtime?.WindowMinimise());
document.getElementById('closeBtn')?.addEventListener('click', () => window.runtime?.Quit());

// DOM Elements
const fileBtn = document.getElementById("openFileBtn");
const mediaContainer = document.getElementById('media-container');
const emptyOverlay = document.getElementById("empty-state");

// 阻止浏览器默认拖放行为（防止拖入文件时在窗口打开）
document.addEventListener("dragover", (e) => { e.preventDefault(); });
document.addEventListener("drop", (e) => { e.preventDefault(); });

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

function showConfirm({ title = '确认操作', message = '确定要执行此操作吗？', okText = '确定', cancelText = '取消', danger = true } = {}) {
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
            modal.classList.remove('active');
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
            showToast(`成功导入 ${count} 首曲目`, 'success');
            await refreshList();
            // 延迟一下让用户看到 toast，再刷新页面
            setTimeout(() => location.reload(), 600);
        } else {
            showToast('未选择任何文件', 'info');
        }
    } catch (err) {
        console.error("导入失败:", err);
        showToast("导入失败: " + err, 'error');
    }
});

// ============ 列表渲染 ============
async function refreshList() {
    try {
        const tracks = await GetAllTracks();
        renderTracks(tracks);
    } catch (err) {
        console.error("加载列表失败:", err);
        renderTracks([]);
    }
}

function renderTracks(tracks) {
    mediaContainer.innerHTML = '';

    if (!tracks || tracks.length === 0) {
        emptyOverlay.classList.add('display');
        mediaContainer.style.display = 'none';
        return;
    }

    emptyOverlay.classList.remove('display');
    mediaContainer.style.display = 'grid';

    for (let i = 0; i < tracks.length; i++) {
        const track = tracks[i];
        const card = document.createElement('div');
        card.className = 'media-card';
        card.dataset.id = track.id;
        // 逐个卡片入场动画延迟（最多 0.6s）
        card.style.animationDelay = `${Math.min(i * 0.04, 0.6)}s`;

        const coverHTML = track.cover
            ? `<img src="${track.cover}" class="card-cover" alt="${track.name}" />`
            : `<div class="card-icon">
                   <svg viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
               </div>`;

        card.innerHTML = `
            ${coverHTML}
            <div class="card-title">${escapeHtml(track.name)}</div>
            <div class="card-meta">${escapeHtml(track.artist || '未知艺术家')}</div>
            <div class="card-actions">
                <button class="card-btn edit-btn" title="编辑信息">
                    <svg viewBox="0 0 24 24" width="16" height="16"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
                </button>
                <button class="card-btn delete-btn" title="删除">
                    <svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                </button>
            </div>
        `;

        // 点击卡片主体 → 跳转播放器
        card.addEventListener("click", (e) => {
            if (e.target.closest('.card-actions')) return; // 点击按钮不跳转
            window.location.href = "/src/html/player.html?id=" + track.id;
        });

        // 编辑按钮
        const editBtn = card.querySelector('.edit-btn');
        editBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            openEditModal(track);
        });

        // 删除按钮
        const deleteBtn = card.querySelector('.delete-btn');
        deleteBtn.addEventListener("click", async (e) => {
            e.stopPropagation();
            const ok = await showConfirm({
                title: '删除曲目',
                message: `确定要删除 "${track.name}" 吗？此操作无法撤销。`,
                okText: '删除',
                cancelText: '取消'
            });
            if (ok) doDelete(track.id);
        });

        // 右键菜单
        card.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            showContextMenu(e, track);
        });

        mediaContainer.appendChild(card);
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
        showToast('已删除曲目', 'success');
        await refreshList();
    } catch (err) {
        console.error("删除失败:", err);
        showToast("删除失败: " + err, 'error');
    }
}

// ============ 右键菜单 ============
let contextMenuEl = null;

function showContextMenu(e, track) {
    hideContextMenu();

    contextMenuEl = document.createElement('div');
    contextMenuEl.className = 'context-menu';
    contextMenuEl.innerHTML = `
        <div class="context-item" data-action="edit">
            编辑信息
        </div>
        <div class="context-item" data-action="cover">
            添加/更换封面
        </div>
        <div class="context-item" data-action="lyrics">
            编辑歌词
        </div>
        <div class="context-divider"></div>
        <div class="context-item danger" data-action="delete">
            删除
        </div>
    `;

    // 定位到点击位置
    const x = Math.min(e.clientX, window.innerWidth - 160);
    const y = Math.min(e.clientY, window.innerHeight - 150);
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
        contextMenuEl.remove();
        contextMenuEl = null;
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
        case 'cover':
            openCoverPicker(track);
            break;
        case 'lyrics':
            openLyricsModal(track);
            break;
        case 'delete':
            showConfirm({
                title: '删除曲目',
                message: `确定要删除 "${track.name}" 吗？此操作无法撤销。`,
                okText: '删除',
                cancelText: '取消'
            }).then((ok) => {
                if (ok) doDelete(track.id);
            });
            break;
    }
}

// ============ 编辑模态框 ============
let currentEditTrack = null;

function openEditModal(track) {
    currentEditTrack = track;
    const modal = document.getElementById("modal-edit");
    document.getElementById("edit-title").value = track.name || '';
    document.getElementById("edit-artist").value = track.artist || '';
    document.getElementById("edit-lyrics").value = track.lyrics || '';
    modal.classList.add("active");
}

function closeEditModal() {
    document.getElementById("modal-edit").classList.remove("active");
    currentEditTrack = null;
}

async function saveEditModal() {
    if (!currentEditTrack) return;
    const title = document.getElementById("edit-title").value.trim();
    const artist = document.getElementById("edit-artist").value.trim();
    const lyrics = document.getElementById("edit-lyrics").value;

    if (!title) {
        showToast("标题不能为空", 'warning');
        return;
    }

    try {
        await UpdateTrack(currentEditTrack.id, title, artist, lyrics);
        closeEditModal();
        showToast('已保存', 'success');
        await refreshList();
    } catch (err) {
        console.error("保存失败:", err);
        showToast("保存失败: " + err, 'error');
    }
}

// ============ 封面选择 ============
let currentCoverTrack = null;

function openCoverPicker(track) {
    currentCoverTrack = track;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (file) {
            await handleCoverFile(file);
        }
    };
    input.click();
}

async function handleCoverFile(file) {
    if (!currentCoverTrack) return;

    // 读取文件为 ArrayBuffer
    const arrayBuffer = await file.arrayBuffer();
    const coverData = new Uint8Array(arrayBuffer);
    const coverMIME = file.type || 'image/jpeg';

    // 限制封面大小 500KB
    if (coverData.length > 512 * 1024) {
        showToast("封面图片过大，请选择 500KB 以内的图片", 'warning');
        return;
    }

    try {
        await UpdateTrackCover(currentCoverTrack.id, coverData, coverMIME);
        currentCoverTrack = null;
        showToast('封面已更新', 'success');
        await refreshList();
    } catch (err) {
        console.error("封面更新失败:", err);
        showToast("封面更新失败: " + err, 'error');
    }
}

// ============ 歌词模态框 ============
let currentLyricsTrack = null;

function openLyricsModal(track) {
    currentLyricsTrack = track;
    const modal = document.getElementById("modal-lyrics-edit");
    // 显示该曲目已有的歌词（如果有）
    const lyricsValue = track.lyrics || '';
    // console.log('[DEBUG] openLyricsModal - track.lyrics:', lyricsValue);
    document.getElementById("lyrics-textarea").value = lyricsValue;
    modal.classList.add("active");
}

function closeLyricsModal() {
    document.getElementById("modal-lyrics-edit").classList.remove("active");
    currentLyricsTrack = null;
}

async function saveLyricsModal() {
    if (!currentLyricsTrack) return;
    const lyrics = document.getElementById("lyrics-textarea").value;

    try {
        await UpdateTrack(currentLyricsTrack.id, currentLyricsTrack.name, currentLyricsTrack.artist || '', lyrics);
        closeLyricsModal();
        showToast('歌词已保存', 'success');
        await refreshList();
    } catch (err) {
        console.error("歌词保存失败:", err);
        showToast("歌词保存失败: " + err, 'error');
    }
}

// 歌词文件上传
document.addEventListener("DOMContentLoaded", () => {
    const lyricsFileInput = document.getElementById("lyrics-file-input");
    if (lyricsFileInput) {
        lyricsFileInput.addEventListener("change", (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    document.getElementById("lyrics-textarea").value = ev.target.result;
                };
                reader.readAsText(file);
            }
        });
    }
});

// 默认封面 HTML（用于无 cover 的曲目，统一使用 .card-icon 结构）
const DEFAULT_COVER_HTML = '<div class="card-icon"><svg viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"></path></svg></div>';

// 设置封面元素内容（img 或 div 容器）
function setCover(el, coverUrl) {
    if (coverUrl) {
        el.innerHTML = `<img src="${coverUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;" />`;
    } else {
        el.innerHTML = DEFAULT_COVER_HTML;
    }
}

// ============ 初始化 ============
document.addEventListener("DOMContentLoaded", async function () {
    await refreshList();

    // 监听设置变化（用户在设置页修改后通过 localStorage 通知）
    window.addEventListener('storage', (e) => {
        if (e.key === 'settingsUpdated' && e.newValue) {
            // 重新加载设置并应用
            if (window.MusicLiteSettings) {
                window.MusicLiteSettings.cached = null;
                window.MusicLiteSettings.apply();
            }
        }
    });

    // 设置按钮
    const settingsBtn = document.getElementById('settingsBtn');
    if (settingsBtn) {
        settingsBtn.addEventListener('click', () => {
            window.location.href = '/src/html/settings.html';
        });
    }

    // 迷你播放器
    const miniPlayer = document.getElementById('mini-player');
    const miniCover = document.getElementById('mini-cover');
    const miniTitle = document.getElementById('mini-title');
    const miniArtist = document.getElementById('mini-artist');
    const miniPlayBtn = document.getElementById('mini-play');
    const miniPlayIcon = document.getElementById('mini-play-icon');
    const miniPauseIcon = document.getElementById('mini-pause-icon');
    const miniExpand = document.getElementById('mini-expand');

    // 使用全局音频管理器
    if (window.audioManager) {
        // 恢复上次播放状态
        window.audioManager.restore();
        const currentTrack = window.audioManager.currentTrack;

        if (currentTrack) {
            miniPlayer.style.display = 'flex';
            setCover(miniCover, currentTrack.cover);
            miniTitle.textContent = currentTrack.name || '未知';
            miniArtist.textContent = currentTrack.artist || '--';
        }

        // 应用保存的音量（优先使用 localStorage 中实时调整的音量，其次使用设置中的默认音量）
        try {
            const savedVolume = localStorage.getItem('volume');
            if (savedVolume !== null) {
                window.audioManager.audio.volume = parseFloat(savedVolume);
            } else {
                // 从设置加载默认音量
                const { LoadSettings } = await import('../../wailsjs/go/main/App.js');
                const settings = await LoadSettings();
                window.audioManager.audio.volume = (settings.volume || 70) / 100;
            }
        } catch (e) {
            console.warn('Failed to load volume settings:', e);
        }

        // 监听播放状态
        window.audioManager.on('play', () => {
            miniPlayIcon.style.display = 'none';
            miniPauseIcon.style.display = 'block';
        });

        window.audioManager.on('pause', () => {
            miniPlayIcon.style.display = 'block';
            miniPauseIcon.style.display = 'none';
        });

        window.audioManager.on('trackloaded', (track) => {
            miniPlayer.style.display = 'flex';
            setCover(miniCover, track.cover);
            miniTitle.textContent = track.name || '未知';
            miniArtist.textContent = track.artist || '--';
        });
    }

    // 迷你播放器播放/暂停
    if (miniPlayBtn) {
        miniPlayBtn.addEventListener('click', () => {
            if (window.audioManager) {
                window.audioManager.toggle();
            }
        });
    }

    // 展开播放器
    if (miniExpand) {
        miniExpand.addEventListener('click', () => {
            const currentTrack = window.audioManager?.currentTrack;
            if (currentTrack) {
                window.location.href = '/src/html/player.html?id=' + currentTrack.id;
            }
        });
    }

    // 模态框关闭按钮
    document.querySelectorAll('.modal-close, .modal-save, .modal-cancel').forEach(btn => {
        btn.addEventListener("click", (e) => {
            const modalEl = e.target.closest('.modal-backdrop');
            if (!modalEl) return;
            const action = btn.dataset.action;
            if (action === 'save') {
                if (modalEl.id === 'modal-edit') saveEditModal();
                else if (modalEl.id === 'modal-lyrics-edit') saveLyricsModal();
            } else {
                // 点击 backdrop 关闭
                if (modalEl.id === 'modal-edit') closeEditModal();
                else if (modalEl.id === 'modal-lyrics-edit') closeLyricsModal();
            }
        });
    });

    // 点击 backdrop 关闭模态框
    document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
        backdrop.addEventListener("click", (e) => {
            if (e.target === backdrop) {
                if (backdrop.id === 'modal-edit') closeEditModal();
                else if (backdrop.id === 'modal-lyrics-edit') closeLyricsModal();
            }
        });
    });
});
