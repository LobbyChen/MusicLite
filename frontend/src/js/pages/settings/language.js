// 语言、标题栏文字与翻译更新策略
import { SetI18nAutoAction } from '../../core/bindings.js';
import { setLanguage, applyTranslations, getAvailableLanguages } from '../../core/i18n.js';
import { languageSelect, titlebarTextInput, i18nAutoActionSelect, i18nAutoCleanCheckbox } from './dom.js';
import { state, markChanged } from './state.js';

// ============ 语言选择器填充 ============
export function populateLanguageSelect() {
    if (!languageSelect) return;
    const langs = getAvailableLanguages();
    const frag = document.createDocumentFragment();
    for (const { code, nativeName } of langs) {
        const opt = document.createElement('option');
        opt.value = code;
        opt.textContent = nativeName;
        frag.appendChild(opt);
    }
    languageSelect.innerHTML = '';
    languageSelect.appendChild(frag);
}

export function bindLanguageEvents() {
    // Language selector
    if (languageSelect) {
        languageSelect.addEventListener('change', () => {
            const lang = languageSelect.value;
            state.currentSettings.language = lang;
            setLanguage(lang);
            applyTranslations();
            markChanged();
        });
    }

    // 翻译更新策略：修改即时持久化（与 i18n 弹窗"下次自动"同源，便于事后调整）
    if (i18nAutoActionSelect) {
        i18nAutoActionSelect.addEventListener('change', () => {
            const action = i18nAutoActionSelect.value;
            state.currentSettings.i18n_auto_action = action;
            const clean = i18nAutoCleanCheckbox ? i18nAutoCleanCheckbox.checked : false;
            SetI18nAutoAction(action, clean).catch(e => console.warn('[i18n] 设置自动动作失败:', e));
        });
    }
    if (i18nAutoCleanCheckbox) {
        i18nAutoCleanCheckbox.addEventListener('change', () => {
            const clean = i18nAutoCleanCheckbox.checked;
            state.currentSettings.i18n_auto_clean_obsolete = clean;
            const action = i18nAutoActionSelect ? i18nAutoActionSelect.value : '';
            SetI18nAutoAction(action, clean).catch(e => console.warn('[i18n] 设置清理冗余键失败:', e));
        });
    }

    // 标题栏文字
    if (titlebarTextInput) {
        titlebarTextInput.addEventListener('input', () => {
            state.currentSettings.titlebar_text = titlebarTextInput.value;
            // 实时预览：有自定义文字则覆盖，否则恢复翻译（data-i18n）
            const custom = titlebarTextInput.value.trim();
            if (custom) {
                document.querySelectorAll('.titlebar-title').forEach(el => { el.textContent = custom; });
            } else {
                // 无自定义：先重新 applyTranslations 以翻译 data-i18n 元素
                applyTranslations();
            }
            markChanged();
        });
    }
}
