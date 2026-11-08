// 全局快捷键：列表渲染、按键捕获与配置写入
import { t } from '../../core/i18n.js';
import { hotkeyListEl } from './dom.js';
import { state, markChanged } from './state.js';

export const HOTKEY_ACTIONS = [
    { action: 'playpause', field: 'hotkey_playpause', label: 'settings.hotkeyPlayPause', default: 'Ctrl+Shift+P' },
    { action: 'next', field: 'hotkey_next', label: 'settings.hotkeyNext', default: 'Ctrl+Shift+Right' },
    { action: 'prev', field: 'hotkey_prev', label: 'settings.hotkeyPrev', default: 'Ctrl+Shift+Left' },
];

let hotkeyListeningAction = null; // 当前正在监听按键的动作名

export function renderHotkeyList() {
    if (!hotkeyListEl) return;
    const frag = document.createDocumentFragment();
    for (const { action, label, default: defaultKey } of HOTKEY_ACTIONS) {
        const cfg = state.currentSettings?.[HOTKEY_ACTIONS.find(h => h.action === action).field] || { enabled: false, keys: '' };
        const item = document.createElement('div');
        item.className = 'hotkey-item';
        item.dataset.action = action;
        item.innerHTML = `
            <span class="hotkey-label" data-i18n="${label}">${t(label)}</span>
            <div class="hotkey-toggle${cfg.enabled ? ' active' : ''}" data-action="${action}"></div>
            <button class="hotkey-key-btn${cfg.keys ? '' : ' empty'}" data-action="${action}">
                ${cfg.keys || t('settings.hotkeyNotSet')}
            </button>
            <button class="hotkey-clear-btn" data-action="${action}">${t('settings.hotkeyClear')}</button>
        `;
        frag.appendChild(item);
    }
    hotkeyListEl.innerHTML = '';
    hotkeyListEl.appendChild(frag);
    bindHotkeyEvents();
}

function bindHotkeyEvents() {
    // 开关
    hotkeyListEl.querySelectorAll('.hotkey-toggle').forEach(toggle => {
        toggle.addEventListener('click', () => {
            const action = toggle.dataset.action;
            const field = HOTKEY_ACTIONS.find(h => h.action === action).field;
            const cfg = state.currentSettings[field] || { enabled: false, keys: '' };
            const newEnabled = !cfg.enabled;
            state.currentSettings[field] = { ...cfg, enabled: newEnabled };
            toggle.classList.toggle('active', newEnabled);
            markChanged();
        });
    });
    // 按键捕获按钮
    hotkeyListEl.querySelectorAll('.hotkey-key-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            // 取消之前的监听
            if (hotkeyListeningAction) {
                const prevBtn = hotkeyListEl.querySelector(`.hotkey-key-btn[data-action="${hotkeyListeningAction}"]`);
                if (prevBtn) {
                    prevBtn.classList.remove('listening');
                    const prevField = HOTKEY_ACTIONS.find(h => h.action === hotkeyListeningAction).field;
                    const prevCfg = state.currentSettings[prevField] || { enabled: false, keys: '' };
                    prevBtn.textContent = prevCfg.keys || t('settings.hotkeyNotSet');
                    prevBtn.classList.toggle('empty', !prevCfg.keys);
                }
            }
            hotkeyListeningAction = btn.dataset.action;
            btn.classList.add('listening');
            btn.textContent = t('settings.hotkeyListening');
            btn.classList.remove('empty');
        });
    });
    // 清除按钮
    hotkeyListEl.querySelectorAll('.hotkey-clear-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.dataset.action;
            const field = HOTKEY_ACTIONS.find(h => h.action === action).field;
            const cfg = state.currentSettings[field] || { enabled: false, keys: '' };
            state.currentSettings[field] = { ...cfg, keys: '' };
            const keyBtn = hotkeyListEl.querySelector(`.hotkey-key-btn[data-action="${action}"]`);
            if (keyBtn) {
                keyBtn.textContent = t('settings.hotkeyNotSet');
                keyBtn.classList.add('empty');
            }
            markChanged();
        });
    });
}

// 全局 keydown 监听：当 hotkeyListeningAction 不为 null 时捕获按键组合
document.addEventListener('keydown', (e) => {
    if (!hotkeyListeningAction) return;
    e.preventDefault();
    e.stopPropagation();
    // 修饰键单独按下不触发捕获
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
    // Escape 取消监听
    if (e.key === 'Escape') {
        const btn = hotkeyListEl.querySelector(`.hotkey-key-btn[data-action="${hotkeyListeningAction}"]`);
        if (btn) {
            btn.classList.remove('listening');
            const field = HOTKEY_ACTIONS.find(h => h.action === hotkeyListeningAction).field;
            const cfg = state.currentSettings[field] || { enabled: false, keys: '' };
            btn.textContent = cfg.keys || t('settings.hotkeyNotSet');
            btn.classList.toggle('empty', !cfg.keys);
        }
        hotkeyListeningAction = null;
        return;
    }
    // 构建组合键字符串
    const parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.shiftKey) parts.push('Shift');
    if (e.altKey) parts.push('Alt');
    if (e.metaKey) parts.push('Win');
    // 标准化键名
    let keyName = e.key;
    if (keyName === ' ') keyName = 'Space';
    if (keyName.length === 1) keyName = keyName.toUpperCase();
    parts.push(keyName);
    const combo = parts.join('+');
    // 写入 currentSettings
    const action = hotkeyListeningAction;
    const field = HOTKEY_ACTIONS.find(h => h.action === action).field;
    const cfg = state.currentSettings[field] || { enabled: false, keys: '' };
    state.currentSettings[field] = { ...cfg, keys: combo };
    // 更新 UI
    const btn = hotkeyListEl.querySelector(`.hotkey-key-btn[data-action="${action}"]`);
    if (btn) {
        btn.classList.remove('listening');
        btn.textContent = combo;
        btn.classList.remove('empty');
    }
    // 自动启用开关
    if (!cfg.enabled) {
        state.currentSettings[field] = { ...state.currentSettings[field], enabled: true };
        const toggle = hotkeyListEl.querySelector(`.hotkey-toggle[data-action="${action}"]`);
        if (toggle) toggle.classList.add('active');
    }
    hotkeyListeningAction = null;
    markChanged();
});
