// 通用操作：导入/导出/重置设置、打开数据目录/GitHub、版本号、教程、单向模式
import {
    SaveSettings, ExportSettings, ImportSettings, ResetSettings,
    OpenAppDataFolder, OpenGitHubRepo, GetVersionInfo,
} from '../../core/bindings.js';
import { t } from '../../core/i18n.js';
import { showToast } from '../../ui/toast.js';
import * as dom from './dom.js';
import { state, hideSaveBar, markChanged } from './state.js';
import { applyTheme, applyAccentToUI } from './appearance.js';
import { showConfirm } from './confirm.js';

// applySettingsToUI / renderHotkeyList 由 index.js 注入，避免循环依赖
export function bindActionEvents({ applySettingsToUI, renderHotkeyList }) {
    // Export settings button
    if (dom.exportBtn) {
        dom.exportBtn.addEventListener('click', async () => {
            try {
                // 先保存当前设置再导出
                await SaveSettings(state.currentSettings);
                state.hasChanges = false;
                hideSaveBar();
                const path = await ExportSettings();
                if (path) {
                    showToast(t('settings.exportSuccess', path), 'success');
                }
            } catch (err) {
                console.error('Export failed:', err);
                showToast(t('settings.exportFailed', err), 'error');
            }
        });
    }

    // Import settings button
    if (dom.importBtn) {
        dom.importBtn.addEventListener('click', async () => {
            try {
                const newSettings = await ImportSettings();
                // 后端在文件对话框取消时返回零值设置，此时不提示成功也不覆盖当前 UI
                if (!newSettings || !newSettings.theme) return;
                // 后端已保存导入的设置：同步本地状态并收起保存栏
                state.currentSettings = newSettings;
                state.hasChanges = false;
                hideSaveBar();
                // 应用导入的设置
                applySettingsToUI(newSettings);
                applyTheme();
                applyAccentToUI();
                renderHotkeyList();
                // 同步设置缓存（供新页面/其他模块读取）
                if (window.MusicLiteSettings) {
                    window.MusicLiteSettings.cached = { ...newSettings };
                    // 重新应用字体/缩放/设计令牌/背景等全局视觉，确保导入设置立即完整生效
                    try { window.MusicLiteSettings.reapply(); } catch (e) { }
                }
                try { localStorage.setItem('cachedSettings', JSON.stringify(newSettings)); } catch (e) { }
                // 通知其他页面设置已更新
                localStorage.setItem('settingsUpdated', Date.now().toString());
                showToast(t('settings.importSuccess'), 'success');

                // 新旧主题页面已拆分：导入设置可能切换 UI 风格，需按当前页面变体重新路由
                const desiredNew = !!newSettings.new_ui_enabled;
                const isNewPage = /-new\.html$/i.test(location.pathname);
                if (desiredNew !== isNewPage) {
                    // 用 replace 避免设置页在历史记录中叠加，返回时需按两次
                    window.location.replace('/#/settings');
                }
            } catch (err) {
                console.error('Import failed:', err);
                showToast(t('settings.importFailed', err), 'error');
            }
        });
    }

    // Reset settings button（重置为默认设置）
    if (dom.resetBtn) {
        dom.resetBtn.addEventListener('click', async () => {
            // 先确认
            const confirmed = await showConfirm(t('settings.resetConfirm'), {
                title: t('settings.resetSettings'),
                okText: t('settings.resetSettings'),
                danger: true,
            });
            if (!confirmed) return;
            try {
                const defaults = await ResetSettings();
                state.currentSettings = defaults;
                applySettingsToUI(defaults);
                applyTheme();
                applyAccentToUI();
                renderHotkeyList();
                // 立即保存
                await SaveSettings(defaults);
                state.hasChanges = false;
                hideSaveBar();
                // 同步设置缓存（供新页面/其他模块读取）
                if (window.MusicLiteSettings) {
                    window.MusicLiteSettings.cached = { ...defaults };
                    // 重新应用字体/缩放/设计令牌/背景等全局视觉，确保重置立即完整生效
                    try { window.MusicLiteSettings.reapply(); } catch (e) { }
                }
                try { localStorage.setItem('cachedSettings', JSON.stringify(defaults)); } catch (e) { }
                // 通知其他页面
                localStorage.setItem('settingsUpdated', Date.now().toString());
                showToast(t('settings.resetSuccess'), 'success');

                // 新旧主题页面已拆分：重置可能切回旧版 UI，需按当前页面变体重新路由
                const desiredNew = !!defaults.new_ui_enabled;
                const isNewPage = /-new\.html$/i.test(location.pathname);
                if (desiredNew !== isNewPage) {
                    // 用 replace 避免设置页在历史记录中叠加，返回时需按两次
                    window.location.replace('/#/settings');
                }
            } catch (err) {
                console.error('Reset failed:', err);
                showToast(t('settings.resetFailed', err), 'error');
            }
        });
    }

    // 打开程序数据文件夹（%APPDATA%/MusicLite）
    if (dom.openDataFolderBtn) {
        dom.openDataFolderBtn.addEventListener('click', async () => {
            try {
                await OpenAppDataFolder();
            } catch (e) {
                showToast(t('settings.openDataFolderFailed'), 'error');
            }
        });
    }
    // 在系统默认浏览器中打开项目 GitHub 仓库
    if (dom.openGitHubBtn) {
        dom.openGitHubBtn.addEventListener('click', async () => {
            try {
                await OpenGitHubRepo();
            } catch (e) {
                showToast(t('settings.openGitHubFailed'), 'error');
            }
        });
    }

    // 显示构建期注入的版本号（version / buildSHA / buildNum）
    const versionEl = document.getElementById('app-version');
    if (versionEl) {
        (async () => {
            try {
                const info = await GetVersionInfo();
                // 形如 "0.7.1" 或 "0.7.1-dev.5.gabc1234"；dev 构建追加 SHA 后缀
                const label = info.version.includes('-dev.')
                    ? `${info.version} (${info.buildSha})`
                    : info.version;
                versionEl.textContent = label;
            } catch (e) {
                versionEl.textContent = 'unknown';
            }
        })();
    }

    // 启动使用教程入口已从设置页移除（教程仍可在音乐库页首次使用时触发）

    // 单向模式开关：仅影响以系统链接方式打开音乐时的行为，可随时切换，下次启动生效
    dom.onlyModeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const on = btn.dataset.onlymodeMode === 'on';
            state.currentSettings.only_mode = on;
            dom.onlyModeBtns.forEach(b => b.classList.toggle('active', b === btn));
            markChanged();
        });
    });
}
