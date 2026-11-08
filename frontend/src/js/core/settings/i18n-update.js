// i18n 新键检查 & 确认覆盖流程
import { CheckI18nNewKeys, ConfirmI18nMerge, GetI18nAutoAction, SetI18nAutoAction } from '../bindings.js';
import { applyTranslations, reloadI18n } from '../i18n.js';

// 简易 toast（兜底，没有独立的 toast 系统时也能提示）
function _i18nToast(msg) {
    const id = 'i18n-toast';
    let el = document.getElementById(id);
    if (!el) {
        el = document.createElement('div');
        el.id = id;
        Object.assign(el.style, {
            position: 'fixed',
            left: '50%',
            bottom: '64px',
            transform: 'translateX(-50%)',
            padding: '10px 18px',
            borderRadius: '8px',
            background: 'rgba(0,0,0,0.78)',
            color: '#fff',
            fontSize: '13px',
            lineHeight: '1.5',
            zIndex: 2147483000,
            pointerEvents: 'none',
            opacity: 0,
            transition: 'opacity .22s ease, transform .22s ease',
            maxWidth: '80vw',
            wordBreak: 'break-word'
        });
        document.body.appendChild(el);
    }
    el.textContent = msg;
    // 触发 reflow 后再显示
    requestAnimationFrame(() => {
        el.style.opacity = '1';
        el.style.transform = 'translateX(-50%) translateY(-6px)';
    });
    clearTimeout(el._timer);
    el._timer = setTimeout(() => {
        el.style.opacity = '0';
        el.style.transform = 'translateX(-50%) translateY(0)';
    }, 3200);
}

// 获取 i18n 翻译，找不到就用 fallback
function _t(key, fallback, ...args) {
    try {
        if (window.i18n && typeof window.i18n.t === 'function') {
            const v = window.i18n.t(key, ...args);
            if (v !== undefined && v !== null) return v;
        }
    } catch (_) {}
    if (typeof fallback === 'string' && fallback !== '') return fallback;
    return key;
}

// 构造差异摘要（控制在 5 行内，避免弹窗过大）
function _buildDiffBrief(report) {
    const lines = [];
    const MAX_SHOW = 4; // 每种 diff 最多展示前 4 个键名
    const moreTpl = (n) => _t('i18n.itemsMore', ` (and ${n} more)`, n);

    if (report && report.new_langs && report.new_langs.length > 0) {
        lines.push(`<div class="i18n-diff-line"><strong>${_t('i18n.newLangs', 'New languages:')}</strong> ${report.new_langs.join(', ')}</div>`);
    }

    const diffs = (report && Array.isArray(report.diffs)) ? report.diffs : [];
    for (const d of diffs) {
        let parts = [];
        if (d.new_keys && d.new_keys.length) {
            const show = d.new_keys.slice(0, MAX_SHOW).join(', ');
            const rest = d.new_keys.length - MAX_SHOW;
            parts.push(`<span class="i18n-diff-tag i18n-diff-tag--new">${_t('i18n.newKeys', 'New keys:')}</span> ${show}${rest > 0 ? moreTpl(rest) : ''}`);
        }
        if (d.changed_keys && d.changed_keys.length) {
            const show = d.changed_keys.slice(0, MAX_SHOW).join(', ');
            const rest = d.changed_keys.length - MAX_SHOW;
            parts.push(`<span class="i18n-diff-tag i18n-diff-tag--chg">${_t('i18n.changedKeys', 'Updated keys:')}</span> ${show}${rest > 0 ? moreTpl(rest) : ''}`);
        }
        if (d.obsolete_keys && d.obsolete_keys.length) {
            const show = d.obsolete_keys.slice(0, MAX_SHOW).join(', ');
            const rest = d.obsolete_keys.length - MAX_SHOW;
            parts.push(`<span class="i18n-diff-tag i18n-diff-tag--obs">${_t('i18n.obsoleteKeys', 'Obsolete keys:')}</span> ${show}${rest > 0 ? moreTpl(rest) : ''}`);
        }
        if (parts.length === 0) continue;
        const title = d.lang_native || d.lang_code || '';
        lines.push(`<div class="i18n-diff-line"><strong>${title}</strong><br/>&nbsp;&nbsp;${parts.join('<br/>&nbsp;&nbsp;')}</div>`);
    }
    return lines.join('');
}

// 确认覆盖对话框：创建专用 modal（不与删除/设置的 confirm 复用，避免互相冲突）
// 返回 { action: ""|"skip"|"fill"|"overwrite", removeObsolete: bool, autoNext: bool }
//   action: "" 表示用户关闭弹窗未选择（按 skip 处理）
function _openI18nUpdateModal(report) {
    return new Promise((resolve) => {
        const id = 'i18n-update-modal';
        if (document.getElementById(id)) {
            document.getElementById(id).remove();
        }
        const style = document.createElement('style');
        style.id = 'i18n-update-modal-style';
        style.textContent = `
#i18n-update-modal.modal-backdrop.active .modal,
#i18n-update-modal.modal-backdrop.active { opacity: 1; pointer-events: auto; }
#i18n-update-modal.modal-backdrop.closing { pointer-events: none; }
#i18n-update-modal.modal-backdrop.closing .modal { transform: scale(.96); opacity: 0; }
#i18n-update-modal .modal {
  transform: scale(.98); opacity: 0; transition: transform .18s ease, opacity .18s ease;
  max-width: 560px; width: calc(100% - 40px); padding: 20px 22px 16px;
}
#i18n-update-modal .modal h3 { margin: 0 0 8px; font-size: 16px; }
#i18n-update-modal .modal > p { margin: 0 0 12px; opacity: .88; font-size: 13.5px; line-height: 1.55; }
.i18n-diff-box {
  margin: 4px 0 12px; padding: 10px 12px; border-radius: 8px;
  background: color-mix(in srgb, var(--card-bg, #1e1e1e) 62%, transparent);
  border: 1px solid color-mix(in srgb, var(--border-color, #333) 60%, transparent);
  max-height: 220px; overflow: auto; font-size: 12.5px; line-height: 1.6;
}
.i18n-diff-line + .i18n-diff-line { margin-top: 6px; padding-top: 6px; border-top: 1px dashed color-mix(in srgb, var(--border-color, #333) 40%, transparent); }
.i18n-diff-tag { display: inline-block; padding: 1px 7px; border-radius: 4px; font-size: 11.5px; margin-right: 4px; }
.i18n-diff-tag--new { background: color-mix(in srgb, var(--accent-color, #1db954) 32%, transparent); color: var(--accent-color, #1db954); }
.i18n-diff-tag--chg { background: color-mix(in srgb, #ffb020 32%, transparent); color: #ffb020; }
.i18n-diff-tag--obs { background: color-mix(in srgb, #ff5252 28%, transparent); color: #ff5252; }
.i18n-opt-row {
  display: flex; align-items: center; gap: 8px; margin: 0 0 8px;
  font-size: 13px; opacity: .92; cursor: pointer; user-select: none;
}
.i18n-opt-row input[type="checkbox"] { width: 15px; height: 15px; cursor: pointer; accent-color: var(--accent-color, #1db954); }
.i18n-auto-row {
  display: flex; align-items: center; gap: 6px; margin: 8px 0 14px;
  font-size: 12.5px; opacity: .85; cursor: pointer; user-select: none;
}
.i18n-auto-row input[type="checkbox"] { width: 14px; height: 14px; cursor: pointer; accent-color: var(--accent-color, #1db954); }
.i18n-auto-row select {
  padding: 2px 6px; border-radius: 4px; font-size: 12.5px; cursor: pointer;
  background: color-mix(in srgb, var(--card-bg, #1e1e1e) 80%, transparent);
  color: inherit; border: 1px solid color-mix(in srgb, var(--border-color, #333) 60%, transparent);
}
#i18n-update-modal .modal-buttons { justify-content: flex-end; gap: 8px; display: flex; }
#i18n-update-modal .btn {
  padding: 7px 14px; border-radius: 6px; border: none; cursor: pointer; font-size: 13.5px;
  background: transparent; color: inherit;
  border: 1px solid color-mix(in srgb, var(--border-color, #333) 80%, transparent);
}
#i18n-update-modal .btn-primary {
  background: var(--accent-color, #1db954); color: #fff; border-color: transparent;
}
#i18n-update-modal .btn-warn {
  background: #ffb020; color: #1a1a1a; border-color: transparent;
}
#i18n-update-modal .btn:hover { filter: brightness(1.08); }
`;
        if (!document.getElementById(style.id)) document.head.appendChild(style);

        const backdrop = document.createElement('div');
        backdrop.id = id;
        backdrop.className = 'modal-backdrop';
        const titleText = _t('i18n.updateTitle', 'Translation Updates Available');
        const descText = _t('i18n.updateDesc', 'Built-in translations include new entries or corrections. Sync them to your local file?');
        const fillText = _t('i18n.fill', 'Fill Missing');
        const overwriteText = _t('i18n.overwrite', 'Overwrite All');
        const skipText = _t('i18n.skip', 'Skip');
        const cleanObsText = _t('i18n.cleanObsolete', 'Also clean obsolete keys (removed from built-in)');
        const autoNextText = _t('i18n.autoNext', 'Next time auto');
        const fillOptText = _t('i18n.autoFillOpt', 'Fill');
        const overwriteOptText = _t('i18n.autoOverwriteOpt', 'Overwrite');
        const brief = _buildDiffBrief(report);
        const hasObsolete = !!(report && report.total_obsolete && report.total_obsolete > 0);
        const obsoleteOpt = hasObsolete
            ? `<label class="i18n-opt-row"><input type="checkbox" id="i18n-chk-clean"/><span>${cleanObsText}</span></label>`
            : '';
        backdrop.innerHTML = `
<div class="modal" role="dialog" aria-modal="true" aria-labelledby="i18n-modal-title">
  <h3 id="i18n-modal-title">${titleText}</h3>
  <p>${descText}</p>
  <div class="i18n-diff-box">${brief || '<em style="opacity:.7">—</em>'}</div>
  ${obsoleteOpt}
  <label class="i18n-auto-row">
    <input type="checkbox" id="i18n-chk-auto"/>
    <span>${autoNextText}</span>
    <select id="i18n-select-auto" disabled>
      <option value="fill">${fillOptText}</option>
      <option value="overwrite">${overwriteOptText}</option>
    </select>
  </label>
  <div class="modal-buttons">
    <button class="btn" id="i18n-btn-skip">${skipText}</button>
    <button class="btn btn-warn" id="i18n-btn-overwrite">${overwriteText}</button>
    <button class="btn btn-primary" id="i18n-btn-fill">${fillText}</button>
  </div>
</div>`;
        document.body.appendChild(backdrop);

        // 应用翻译到按钮/标题（如果之后 reload 也会重写）
        applyTranslations();

        // 勾选"下次自动"后启用下拉选择
        const chkAuto = backdrop.querySelector('#i18n-chk-auto');
        const selAuto = backdrop.querySelector('#i18n-select-auto');
        if (chkAuto && selAuto) {
            chkAuto.addEventListener('change', () => {
                selAuto.disabled = !chkAuto.checked;
            });
        }

        const cleanup = (action) => {
            const removeObsolete = hasObsolete && !!(backdrop.querySelector('#i18n-chk-clean') && backdrop.querySelector('#i18n-chk-clean').checked);
            const autoNext = !!(chkAuto && chkAuto.checked);
            const autoAction = autoNext ? (selAuto ? selAuto.value : action) : '';
            backdrop.classList.add('closing');
            setTimeout(() => { backdrop.remove(); }, 200);
            resolve({ action, removeObsolete, autoNext, autoAction });
        };

        backdrop.querySelector('#i18n-btn-skip').addEventListener('click', () => cleanup('skip'));
        backdrop.querySelector('#i18n-btn-fill').addEventListener('click', () => cleanup('fill'));
        backdrop.querySelector('#i18n-btn-overwrite').addEventListener('click', () => cleanup('overwrite'));
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) cleanup('skip');
        });
        requestAnimationFrame(() => {
            requestAnimationFrame(() => backdrop.classList.add('active'));
        });
    });
}

/**
 * 启动时调用：检查内嵌 vs 用户本地 i18n 是否有差异（缺失键 / 值变更 / 冗余键）。
 * 若无差异 → 直接返回；
 * 若有差异 → 先查用户是否设置了"下次自动"，若已设置则按设置自动执行；
 *   否则弹确认框，3 个选项：补全 / 覆盖 / 放弃，并可选"下次自动[补全/覆盖]"。
 * 用户可在弹窗里勾选「同时清理冗余键」来删除用户文件中内嵌已不存在的旧键。
 */
export async function checkAndPromptI18nUpdate() {
    // tray-menu 窗口也加载 settings-apply.js，但不应弹 i18n 更新框（会覆盖菜单）
    if (document.body && document.body.classList.contains('tray-menu-body')) return;

    // 单会话内只检查一次（避免多窗口/反复进入设置页反复弹）
    const FLAG_KEY = 'musicLite.i18nCheckedOnce';
    try {
        if (sessionStorage.getItem(FLAG_KEY) === '1') return;
    } catch (_) {}

    let report;
    try {
        report = await CheckI18nNewKeys();
    } catch (e) {
        // CheckI18nNewKeys 是我们新加的后端方法，老构建上可能不存在，忽略即可。
        console.warn('[i18n] CheckI18nNewKeys unavailable, skipping:', e && e.message ? e.message : e);
        return;
    }

    try { sessionStorage.setItem(FLAG_KEY, '1'); } catch (_) {}

    if (!report || !report.has_new) return;

    // 检查用户是否已设置"下次自动"动作
    let autoAction = '';
    let autoCleanObsolete = false;
    try {
        const r = await GetI18nAutoAction();
        if (r && r.action) {
            autoAction = r.action;
            autoCleanObsolete = !!r.cleanObsolete;
        }
    } catch (e) {
        // GetI18nAutoAction 是新方法，老构建上可能不存在，忽略
        console.warn('[i18n] GetI18nAutoAction unavailable:', e && e.message ? e.message : e);
    }

    let action, removeObsolete;
    if (autoAction) {
        // 已设置自动动作：直接执行，不弹窗
        action = autoAction;
        removeObsolete = autoCleanObsolete;
    } else {
        // 未设置：弹窗让用户选择
        const choice = await _openI18nUpdateModal(report);
        if (!choice) return;
        action = choice.action;
        removeObsolete = !!choice.removeObsolete;

        // 用户勾选了"下次自动"：持久化选择
        if (choice.autoNext && choice.autoAction) {
            try {
                await SetI18nAutoAction(choice.autoAction, removeObsolete);
            } catch (e) {
                console.warn('[i18n] SetI18nAutoAction failed:', e && e.message ? e.message : e);
            }
        }
    }

    if (action === 'skip') return;

    // action: "fill" → keepCustom=true（仅补全，保留用户值）
    //         "overwrite" → keepCustom=false（内嵌值覆盖同键不同值）
    const keepCustom = action === 'fill';
    const result = await ConfirmI18nMerge(keepCustom, removeObsolete);
    if (!result || !result.ok) {
        const msg = (result && result.message) ? result.message : '';
        _i18nToast(_t('i18n.mergedFail', `Failed to write translation file: ${msg || '(unknown)'}`, { msg: msg || '' }));
        return;
    }

    // 合并成功 → 就地刷新翻译（不再重启应用，避免与下次启动的 i18n 差异检测形成重启死循环）
    _i18nToast(_t('i18n.mergedOk', 'Translations have been synced and applied.'));
    try {
        await reloadI18n();
        applyTranslations();
    } catch (e2) {
        console.warn('[i18n] 合并后刷新翻译失败：', e2);
    }
}
