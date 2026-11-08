// 曲目编辑弹窗：标题/艺术家/专辑/歌词/封面，支持拖放导入
import { audioManager } from '../../core/audio-manager.js';
import { applyMarquee } from '../../ui/marquee.js';
import { showToast } from '../../ui/toast.js';
import { UpdateTrack, UpdateTrackCover, PickImageFile, PickLyricsFile, ReadFileForEdit } from '../../core/bindings.js';
import { t } from '../../core/i18n.js';
import { DEFAULT_COVER_HTML, bustCoverUrl, bustCoverCache, setCover } from './cover.js';
import { state } from './state.js';

let currentEditTrack = null;
let editCoverData = null; // 暂存封面上传的 Array<number>，保存时一起提交
let editCoverMIME = null;
let editCoverCleared = false;
// 保存后刷新列表的回调，由 index.js 注入，避免与列表模块循环依赖
let refreshListFn = async () => {};

export function initEditModal({ refreshList } = {}) {
    if (refreshList) refreshListFn = refreshList;
}

export function isEditModalActive() {
    const el = document.getElementById('modal-edit');
    return el && el.classList.contains('active');
}

// base64 字符串转 Array<number>（供 UpdateTrackCover 使用）
function base64ToArray(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return Array.from(bytes);
}

export function openEditModal(track) {
    currentEditTrack = track;
    editCoverData = null;
    editCoverMIME = null;
    editCoverCleared = false;

    document.getElementById("edit-title").value = track.name || '';
    document.getElementById("edit-artist").value = track.artist || '';
    document.getElementById("edit-album").value = track.album || '';
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

    // 保存/取消按钮由 bindEditModalEvents 统一处理

    const modal = document.getElementById("modal-edit");
    modal.classList.add("active");
}

// 拖放到编辑弹窗：自动根据后缀名识别封面或歌词
export async function handleEditDrop(paths) {
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

export function closeEditModal() {
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

export async function saveEditModal() {
    if (!currentEditTrack) return;
    const title = document.getElementById("edit-title").value.trim();
    const artist = document.getElementById("edit-artist").value.trim();
    const album = document.getElementById("edit-album").value.trim();
    const lyrics = document.getElementById("edit-lyrics").value;

    if (!title) {
        showToast(t('libraries.titleRequired'), 'warning');
        return;
    }

    try {
        // 1. 先保存标题/艺术家/专辑/歌词
        await UpdateTrack(currentEditTrack.id, title, artist, album, lyrics);

        // 保存前记录当前编辑的曲目 ID（closeEditModal 会清空 currentEditTrack）
        const editedId = currentEditTrack.id;
        const wasCoverCleared = editCoverCleared;

        // 2. 如果封面有变更，单独提交
        if (editCoverCleared) {
            try {
                await UpdateTrackCover(currentEditTrack.id, [], '');
                bustCoverCache();
            } catch (e) { }
        } else if (editCoverData && editCoverData.length > 0) {
            await UpdateTrackCover(currentEditTrack.id, editCoverData, editCoverMIME);
            bustCoverCache();
        }

        closeEditModal();
        showToast(t('libraries.saved'), 'success');
        await refreshListFn();

        // 如果编辑的是当前播放曲目，同步更新迷你播放器与播放器视图
        const playingTrack = audioManager?.currentTrack;
        if (playingTrack && Number(playingTrack.id) === Number(editedId)) {
            // 从刷新后的列表取最新数据：新上传/清除封面的 cover URL 状态以数据库为准
            const fresh = state.allTracks.find(tr => Number(tr.id) === Number(editedId));
            if (fresh) {
                Object.assign(playingTrack, fresh);
            } else {
                playingTrack.name = title;
                playingTrack.artist = artist;
                playingTrack.album = album;
                playingTrack.lyrics = lyrics;
                if (wasCoverCleared) playingTrack.cover = '';
            }
            localStorage.setItem('currentTrack', JSON.stringify(playingTrack));
            document.title = playingTrack.name || 'MusicLite';
            const miniCover = document.getElementById('mini-cover');
            const miniTitle = document.getElementById('mini-title');
            const miniArtist = document.getElementById('mini-artist');
            if (miniCover) setCover(miniCover, playingTrack.cover);
            if (miniTitle) { miniTitle.textContent = playingTrack.name || t('common.unknown'); applyMarquee(miniTitle); }
            if (miniArtist) miniArtist.textContent = playingTrack.artist || '--';
            // trackupdated：仅刷新播放器元信息/封面/歌词，不触发后端重新加载与播放状态重置
            audioManager.emit('trackupdated', playingTrack);
        }
    } catch (err) {
        console.error("保存失败:", err);
        showToast(t('libraries.saveFailed', err?.message || String(err)), 'error');
    }
}

// 弹窗关闭/保存按钮与 backdrop 点击
export function bindEditModalEvents() {
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
