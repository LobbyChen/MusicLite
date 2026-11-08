// 设置页确认对话框（自定义 UI，带 Promise 封装）
import { confirmModal, confirmTitleEl, confirmMessageEl, confirmCancelBtn, confirmOkBtn } from './dom.js';

export function showConfirm(message, opts = {}) {
    return new Promise(resolve => {
        if (!confirmModal) {
            resolve(window.confirm(message));
            return;
        }
        confirmTitleEl.textContent = opts.title || '确认操作';
        confirmMessageEl.textContent = message;
        const okText = opts.okText || '确定';
        const cancelText = opts.cancelText || '取消';
        confirmOkBtn.textContent = okText;
        confirmCancelBtn.textContent = cancelText;
        confirmOkBtn.className = 'btn ' + (opts.danger ? 'btn-danger' : 'btn-primary');

        const cleanup = (result) => {
            confirmModal.classList.add('closing');
            confirmModal.classList.remove('active');
            confirmOkBtn.removeEventListener('click', onOk);
            confirmCancelBtn.removeEventListener('click', onCancel);
            confirmModal.removeEventListener('click', onBackdrop);
            document.removeEventListener('keydown', onKey);
            setTimeout(() => confirmModal.classList.remove('closing'), 200);
            resolve(result);
        };
        const onOk = () => cleanup(true);
        const onCancel = () => cleanup(false);
        const onBackdrop = (e) => { if (e.target === confirmModal) cleanup(false); };
        const onKey = (e) => {
            if (e.key === 'Escape') cleanup(false);
            if (e.key === 'Enter') cleanup(true);
        };
        confirmOkBtn.addEventListener('click', onOk);
        confirmCancelBtn.addEventListener('click', onCancel);
        confirmModal.addEventListener('click', onBackdrop);
        document.addEventListener('keydown', onKey);
        confirmModal.classList.add('active');
    });
}
