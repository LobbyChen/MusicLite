// 听歌时长格式化与统计弹窗
import { t } from '../../core/i18n.js';

// 按需引入单位：<60s 只显示秒，>60s 引入分，>3600s 引入小时，>24h 引入天
export function formatListenTime(totalSeconds) {
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

// 听歌统计弹窗（复用确认对话框样式）
export function showStatsModal(message) {
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
