// 音乐库导入：文件按钮、全局拖放遮罩、Wails v3 原生文件拖放路由
import { ImportFiles, ImportFilesFromPaths } from '../../core/bindings.js';
import { showToast } from '../../ui/toast.js';
import { t } from '../../core/i18n.js';
import { fileBtn, dropOverlay } from './dom.js';
import { refreshList } from './library-list.js';
import { handleEditDrop, isEditModalActive } from './edit-modal.js';

// 用计数器区分真正离开窗口（dragenter/leave 会成对触发且嵌套）
let dragDepth = 0;
// 编辑弹窗内的拖放计数器（独立于全局）
let editDragDepth = 0;

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

export function initImport() {
    // 导入按钮
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

    _registerFileDropV3(async (_x, _y, paths) => {
        if (!paths || paths.length === 0) return;
        // 编辑弹窗打开时，拖放走封面/歌词导入
        if (isEditModalActive()) {
            await handleEditDrop(paths);
            return;
        }
        await doImportPaths(paths);
    });
}
