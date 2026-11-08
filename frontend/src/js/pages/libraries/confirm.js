// 音乐库页确认对话框（替代原生 confirm）
import { t } from '../../core/i18n.js';

let confirmResolver = null;
const confirmModal = () => document.getElementById('modal-confirm');

export function showConfirm({ title = '确认操作', message = '确定要执行此操作吗？', okText = t('common.ok'), cancelText = t('common.cancel'), danger = true } = {}) {
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
