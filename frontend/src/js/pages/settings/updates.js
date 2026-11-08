// 检查更新与下载进度：代理模式 UI、进度轮询、线程数设置
import {
    CheckForUpdate, PerformUpdate, StartUpdateDownload, GetUpdateDownloadProgress,
    CancelUpdateDownload, PauseAndResumeUpdateDownload, ApplyDownloadedUpdate,
    SetUpdateThreadCount, QuitApp, LoadSettings,
} from '../../core/bindings.js';
import { t } from '../../core/i18n.js';
import { showToast } from '../../ui/toast.js';
import { formatBytes } from '../../ui/format.js';
import { Events } from '@wailsio/runtime';
import * as dom from './dom.js';
import { state, markChanged } from './state.js';

// 保存最近一次检查得到的 UpdateInfo（供"开始更新"按钮使用）
let lastUpdateInfo = null;

// 后端事件驱动的下载进度订阅（只绑定一次）
let downloadEventsBound = false;
function unwrapEvent(e) {
    if (e && typeof e === 'object' && Object.prototype.hasOwnProperty.call(e, 'data')) {
        return e.data;
    }
    return e;
}
function bindDownloadEvents() {
    if (downloadEventsBound) return;
    downloadEventsBound = true;
    try {
        Events.On('update:downloadProgress', (e) => renderDownloadProgress(unwrapEvent(e)));
        Events.On('update:downloadCompleted', (e) => {
            const ver = unwrapEvent(e);
            renderDownloadProgress({ status: 'completed', progress: 1, latestVer: ver || '' });
        });
        Events.On('update:downloadError', (e) => {
            const msg = unwrapEvent(e);
            renderDownloadProgress({ status: 'error', error: msg || '' });
        });
        Events.On('update:downloadCancelled', () => {
            renderDownloadProgress({ status: 'cancelled' });
        });
    } catch (e) {
        console.warn('[update] 订阅下载事件失败:', e);
    }
}

// ============ 更新下载来源代理 UI 同步 ============
// 根据当前 proxyMode 切换：说明文字 / gh-proxy 地址输入框可见性 / 线程滑块上限与提示
// s 可选：传入 settings 时可避免再次 LoadSettings
export function applyUpdateProxyModeUI(proxyMode, s) {
    const isGhProxy = proxyMode === 'ghproxy';
    // gh-proxy 模式显示 URL 输入框，官方模式隐藏
    if (dom.ghProxyURLWrap) dom.ghProxyURLWrap.style.display = isGhProxy ? '' : 'none';
    // 模式说明文字
    if (dom.updateProxyModeDesc) {
        const key = isGhProxy ? 'settings.ghProxyGhProxyDesc' : 'settings.ghProxyOfficialDesc';
        try {
            dom.updateProxyModeDesc.textContent = t(key, '');
        } catch (_) {
            dom.updateProxyModeDesc.textContent = '';
        }
    }
    // ghproxy 模式下动态限制线程滑块上限为 16，并显示提示
    if (dom.ghproxyThreadHint) dom.ghproxyThreadHint.style.display = isGhProxy ? '' : 'none';
    if (dom.threadCountSlider) {
        dom.threadCountSlider.max = isGhProxy ? '16' : '256';
        const curVal = parseInt(dom.threadCountSlider.value, 10);
        if (isGhProxy && curVal > 16) {
            dom.threadCountSlider.value = '16';
            if (dom.threadCountValue) dom.threadCountValue.textContent = '16';
        }
    }
}

async function handleCheckUpdate() {
    if (!dom.checkUpdateBtn) return;
    // 进入"检查中"状态：保留按钮原文字，叠加旋转动画，并立即给出状态提示
    dom.checkUpdateBtn.disabled = true;
    dom.checkUpdateBtn.classList.add('btn-checking');
    if (dom.updateStatusEl) {
        dom.updateStatusEl.textContent = t('settings.updateChecking', '正在检查更新...');
        dom.updateStatusEl.style.color = '';
    }
    if (dom.updateActionsEl) dom.updateActionsEl.style.display = 'none';

    try {
        const info = await CheckForUpdate();
        lastUpdateInfo = info;

        // 错误优先
        if (info.error) {
            if (dom.updateStatusEl) {
                dom.updateStatusEl.textContent = t('settings.updateCheckFailed', info.error);
                dom.updateStatusEl.style.color = '';
            }
            showToast(t('settings.updateCheckFailed', info.error), 'error');
            return;
        }

        if (info.hasUpdate) {
            // 有新版本：显示版本号 + 显示两个操作按钮
            if (dom.updateStatusEl) {
                dom.updateStatusEl.textContent = t('settings.updateAvailable', info.latestVer);
                dom.updateStatusEl.style.color = 'var(--accent-color, #1DB954)';
            }
            if (dom.updateActionsEl) dom.updateActionsEl.style.display = 'flex';
            showToast(t('settings.updateAvailable', info.latestVer), 'info', 4000);
        } else {
            // 已是最新版本
            if (dom.updateStatusEl) {
                dom.updateStatusEl.textContent = t('settings.upToDate', info.currentVer);
                dom.updateStatusEl.style.color = 'var(--accent-color, #1DB954)';
            }
            if (dom.updateActionsEl) dom.updateActionsEl.style.display = 'none';
            showToast(t('settings.upToDate', info.currentVer), 'success');
        }
    } catch (e) {
        console.error('Check update failed:', e);
        const msg = e?.message || String(e);
        if (dom.updateStatusEl) {
            dom.updateStatusEl.textContent = t('settings.updateCheckFailed', msg);
            dom.updateStatusEl.style.color = '';
        }
        showToast(t('settings.updateCheckFailed', msg), 'error');
    } finally {
        dom.checkUpdateBtn.disabled = false;
        dom.checkUpdateBtn.classList.remove('btn-checking');
    }
}

// 触发更新：Windows 启动多线程下载并显示进度条；其他平台打开浏览器
async function handlePerformUpdate() {
    if (!lastUpdateInfo) {
        showToast(t('settings.updateNoInfo'), 'warning');
        return;
    }
    const info = lastUpdateInfo;

    // Windows 平台：启动多线程下载
    if (info.platform === 'windows') {
        if (!info.downloadURL) {
            showToast(t('settings.updateNoPkg'), 'warning');
            return;
        }

        // 隐藏操作按钮，显示进度条
        if (dom.updateActionsEl) dom.updateActionsEl.style.display = 'none';
        if (dom.downloadCompleteEl) dom.downloadCompleteEl.style.display = 'none';
        if (dom.downloadProgressEl) dom.downloadProgressEl.style.display = '';

        try {
            await StartUpdateDownload(info);
            // 后端会立即推送一次 update:downloadProgress，前端无需轮询
            try {
                const p = await GetUpdateDownloadProgress();
                renderDownloadProgress(p);
            } catch (_) { }
        } catch (e) {
            console.error('Start download failed:', e);
            showToast(t('settings.updateFailed', e?.message || String(e)), 'error');
            // 恢复按钮
            if (dom.updateActionsEl) dom.updateActionsEl.style.display = 'flex';
            if (dom.downloadProgressEl) dom.downloadProgressEl.style.display = 'none';
        }
        return;
    }

    // 非 Windows：调用后端 PerformUpdate（内部调用 openURL 打开 Release 页面）
    try {
        await PerformUpdate(info);
        showToast(t('settings.updateOpenBrowser'), 'info');
    } catch (e) {
        // 兜底：前端直接打开 release URL
        if (info.releaseURL) {
            try { window.open(info.releaseURL, '_blank'); } catch (_) { }
        } else {
            showToast(t('settings.updateFailed', e?.message || String(e)), 'error');
        }
    }
}

// ============ 下载进度渲染（由后端事件驱动，无轮询） ============
function renderDownloadProgress(p) {
    if (!dom.downloadProgressEl) return;
    dom.downloadProgressEl.style.display = '';

    // 进度百分比
    const pct = Math.round((p.progress || 0) * 100);
    if (dom.progressBarEl) dom.progressBarEl.style.width = pct + '%';
    if (dom.progressPercentEl) dom.progressPercentEl.textContent = pct + '%';

    // 标签 + 暂停按钮文案（按后端返回的 status 实时同步，避免按钮点过一次后状态不准）
    const isPaused = p.status === 'paused';
    if (dom.pauseResumeBtn) {
        dom.pauseResumeBtn.dataset.downloadStatus = isPaused ? 'paused' : 'downloading';
        dom.pauseResumeBtn.textContent = isPaused ? t('settings.resumeDownload') : t('settings.pauseDownload');
        // 未开始/已结束的状态不需要暂停按钮
        const useless = (p.status === 'idle' || p.status === 'completed' || p.status === 'cancelled' || p.status === 'error');
        dom.pauseResumeBtn.style.display = useless ? 'none' : '';
    }

    if (dom.progressLabelEl) {
        if (isPaused) {
            dom.progressLabelEl.textContent = t('settings.downloadPausedLabel', p.latestVer || '');
        } else {
            dom.progressLabelEl.textContent = t('settings.downloading', p.latestVer || '');
        }
    }

    // 详情：已下载 / 总大小 + 速度（暂停时不显示速度）
    if (dom.progressDetailEl) {
        const downloadedStr = formatBytes(p.downloaded || 0);
        const totalStr = formatBytes(p.total || 0);
        const speedStr = (!isPaused && p.speed > 0) ? formatBytes(p.speed) + '/s' : '';
        let detail = `${downloadedStr} / ${totalStr}`;
        if (speedStr) detail += ` · ${speedStr}`;
        dom.progressDetailEl.textContent = detail;
    }

    // 状态处理
    if (p.status === 'completed') {
        // 隐藏进度条，显示完成提示
        dom.downloadProgressEl.style.display = 'none';
        if (dom.downloadCompleteEl) {
            dom.downloadCompleteEl.style.display = '';
            if (dom.completeTextEl) {
                dom.completeTextEl.textContent = t('settings.downloadCompleteRestart', p.latestVer || '');
            }
        }
        showToast(t('settings.downloadCompleteToast'), 'success', 5000);
    } else if (p.status === 'cancelled') {
        dom.downloadProgressEl.style.display = 'none';
        if (dom.updateActionsEl) dom.updateActionsEl.style.display = 'flex';
    } else if (p.status === 'error') {
        dom.downloadProgressEl.style.display = 'none';
        if (dom.updateActionsEl) dom.updateActionsEl.style.display = 'flex';
        showToast(t('settings.updateFailed', p.error || ''), 'error');
    }
}

// 启动时恢复持久化的下载状态（重进设置页不丢失进度条）
export async function restoreDownloadState() {
    try {
        const p = await GetUpdateDownloadProgress();
        if (p.status === 'downloading' || p.status === 'paused') {
            // 正在下载或暂停中：显示当前进度，后续由后端事件持续更新
            if (dom.downloadProgressEl) dom.downloadProgressEl.style.display = '';
            if (dom.updateActionsEl) dom.updateActionsEl.style.display = 'none';
            renderDownloadProgress(p);
        } else if (p.status === 'completed') {
            // 下载已完成但尚未应用：显示完成提示
            if (dom.downloadCompleteEl) {
                dom.downloadCompleteEl.style.display = '';
                if (dom.completeTextEl) {
                    dom.completeTextEl.textContent = t('settings.downloadCompleteRestart', p.latestVer || '');
                }
            }
        }
    } catch (e) {
        // 忽略
    }
}

// 从设置加载下载线程数到滑块
export async function loadThreadCountSetting() {
    try {
        const s = await LoadSettings();
        const count = s.update_thread_count || 4;
        if (dom.threadCountSlider) dom.threadCountSlider.value = count;
        if (dom.threadCountValue) dom.threadCountValue.textContent = String(count);
    } catch (e) {
        // 忽略
    }
}

// ============ 更新相关事件绑定 ============
export function bindUpdateEvents() {
    bindDownloadEvents();
    if (dom.checkUpdateBtn) {
        dom.checkUpdateBtn.addEventListener('click', handleCheckUpdate);
    }
    if (dom.performUpdateBtn) {
        dom.performUpdateBtn.addEventListener('click', handlePerformUpdate);
    }
    if (dom.openReleasePageBtn) {
        dom.openReleasePageBtn.addEventListener('click', () => {
            const url = lastUpdateInfo?.releaseURL;
            if (url) {
                try { window.open(url, '_blank'); } catch (_) {}
            } else {
                // 兜底：打开 releases 页面
                try { window.open('https://github.com/LobbyChen/MusicLite/releases', '_blank'); } catch (_) {}
            }
        });
    }
    // 下载进度：取消按钮（下载中 / 暂停中都可以取消）
    if (dom.cancelDownloadBtn) {
        dom.cancelDownloadBtn.addEventListener('click', async () => {
            try {
                await CancelUpdateDownload();
                if (dom.downloadProgressEl) dom.downloadProgressEl.style.display = 'none';
                showToast(t('settings.downloadCancelled'), 'info');
            } catch (e) {
                showToast(t('settings.downloadCancelFailed', e?.message || String(e)), 'error');
            }
        });
    }
    // 下载进度：暂停 / 继续按钮
    if (dom.pauseResumeBtn) {
        dom.pauseResumeBtn.addEventListener('click', async () => {
            const status = dom.pauseResumeBtn.dataset.downloadStatus || 'downloading';
            try {
                if (status === 'paused') {
                    await PauseAndResumeUpdateDownload();
                    dom.pauseResumeBtn.dataset.downloadStatus = 'downloading';
                    dom.pauseResumeBtn.textContent = t('settings.pauseDownload');
                    showToast(t('settings.downloadResumed'), 'info');
                } else {
                    await PauseAndResumeUpdateDownload();
                    dom.pauseResumeBtn.dataset.downloadStatus = 'paused';
                    dom.pauseResumeBtn.textContent = t('settings.resumeDownload');
                    showToast(t('settings.downloadPaused'), 'info');
                }
            } catch (e) {
                showToast((status === 'paused'
                    ? t('settings.resumeDownloadFailed', e?.message || String(e))
                    : t('settings.pauseDownloadFailed', e?.message || String(e))), 'error');
            }
        });
    }
    // 下载完成：应用更新（自替换 + 单实例接管）
    if (dom.applyDownloadedUpdateBtn) {
        dom.applyDownloadedUpdateBtn.addEventListener('click', async () => {
            // 防止重复点击：后端第一次调用后已清除下载状态，第二次会报"没有已下载的更新"
            dom.applyDownloadedUpdateBtn.disabled = true;
            try {
                await ApplyDownloadedUpdate();
                // 后端已拉起新 exe，单实例机制会让旧实例自行退出
                showToast(t('settings.updateRestarting'), 'info', 5000);
                // 兜底：3 秒后若旧实例仍未退出则强制退出
                setTimeout(() => {
                    try { QuitApp(); } catch (_) {
                        try { window.close(); } catch (_) {}
                    }
                }, 3000);
            } catch (e) {
                dom.applyDownloadedUpdateBtn.disabled = false;
                showToast(t('settings.updateFailed', e?.message || String(e)), 'error');
            }
        });
    }
    // 下载线程数滑块：input 仅同步当前数字显示，实际保存交给"保存线程数"按钮
    if (dom.threadCountSlider) {
        dom.threadCountSlider.addEventListener('input', () => {
            if (dom.threadCountValue) dom.threadCountValue.textContent = dom.threadCountSlider.value;
        });
    }
    if (dom.saveThreadCountBtn) {
        dom.saveThreadCountBtn.addEventListener('click', async () => {
            const count = parseInt(dom.threadCountSlider?.value, 10) || 16;
            try {
                await SetUpdateThreadCount(count);
                state.currentSettings.update_thread_count = count;
                showToast(t('settings.downloadThreadsSavedOk'), 'success');
            } catch (e) {
                showToast(t('settings.downloadThreadsSaveFailed', e?.message || String(e)), 'error');
            }
        });
    }
    // 更新下载来源代理：切换模式时同步 UI；ghproxy 模式下对线程数做一次 clamp 保证合法
    dom.updateProxyBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const mode = btn.dataset.updateProxy;
            state.currentSettings.update_proxy_mode = mode;
            dom.updateProxyBtns.forEach(b => b.classList.toggle('active', b === btn));
            applyUpdateProxyModeUI(mode, state.currentSettings);
            // ghproxy 模式下若当前线程数 > 16，需要钳制（同步到 settings 后后端 LoadSettings 也会再钳制一次）
            if (mode === 'ghproxy') {
                const cur = parseInt(dom.threadCountSlider?.value || String(state.currentSettings.update_thread_count || 16), 10);
                if (cur > 16) {
                    state.currentSettings.update_thread_count = 16;
                    if (dom.threadCountSlider) dom.threadCountSlider.value = '16';
                    if (dom.threadCountValue) dom.threadCountValue.textContent = '16';
                }
            }
            markChanged();
        });
    });
    if (dom.ghProxyURLInput) {
        dom.ghProxyURLInput.addEventListener('input', () => {
            let url = (dom.ghProxyURLInput.value || '').trim();
            if (url && !url.endsWith('/')) url += '/';
            state.currentSettings.gh_proxy_url = url;
            markChanged();
        });
    }
}
