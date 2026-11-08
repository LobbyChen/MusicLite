// 设置页共享状态与保存栏控制
import { saveBar } from './dom.js';

// currentSettings 保持单一引用：各模块读取/修改同一对象；
// 导入/重置等场景通过 state.currentSettings = newSettings 整体替换。
export const state = {
    currentSettings: null,
    hasChanges: false,
};

export function markChanged() {
    state.hasChanges = true;
    saveBar.style.display = 'flex';
    // 强制重排以重启动画（display:none→flex 切换后 animation 不会自动重播）
    void saveBar.offsetWidth;
    saveBar.classList.add('visible');
}

export function hideSaveBar() {
    saveBar.classList.remove('visible');
    saveBar.style.display = 'none';
}

// 放弃未保存的“新风格 UI”预览：把 localStorage 恢复为后端已保存值，
// 避免返回音乐库后下一次进入设置被预览值误导到另一套页面。
export function revertNewUIPreview() {
    try {
        const cached = window.MusicLiteSettings && window.MusicLiteSettings.cached;
        if (cached) {
            localStorage.setItem('musicLite.newUIEnabled', cached.new_ui_enabled ? '1' : '0');
        }
    } catch (e) { }
}
