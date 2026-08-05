// i18n.js — MusicLite 国际化框架
// 翻译数据由后端 App.GetI18nData() 提供，初始数据打包在 Go 二进制内
// 首次启动时解压到 %APPDATA%/MusicLite/i18n.json，再次启动优先加载外部文件
//
// 用法：
//   import { initI18n, t, applyTranslations } from './i18n.js';
//   await initI18n();          // 启动时调用一次
//   t('libraries.title');      // 翻译；找不到时返回 undefined（不会返回原始 key）
//   applyTranslations();       // 翻译页面所有 [data-i18n] 元素，找不到的保留 DOM 内原始文本

import { GetI18nData } from '../../wailsjs/go/main/App.js';

// 翻译数据：{ 'zh-CN': { 'key': 'value', ... }, 'en-US': { ... } }
let translations = {};

// 当前语言（默认 zh-CN）
let currentLanguage = 'zh-CN';

// 标准化语言代码（把常见简称映射为完整代码，避免字典对不上）
function normalizeLang(lang) {
    if (!lang) return 'zh-CN';
    const l = String(lang).toLowerCase();
    if (l.startsWith('zh')) return 'zh-CN';
    if (l.startsWith('en')) return 'en-US';
    return lang;
}

// 翻译 fallback 顺序：当前语言 → en-US → zh-CN
const FALLBACK_LANGS = ['zh-CN', 'en-US'];

// 从 localStorage 恢复语言选择（跨页面同步）
try {
    const saved = localStorage.getItem('appLanguage');
    if (saved) {
        currentLanguage = saved;
    }
} catch (e) {
    // localStorage 不可用时忽略
}

// 兜底词典：仅当后端未加载或键缺失时使用（保证 UI 在极端情况下仍可用）
const fallbackTranslations = {
    'zh-CN': {
        'lang.name': '简体中文',
        'common.ok': '确定', 'common.cancel': '取消', 'common.save': '保存',
        'common.delete': '删除', 'common.close': '关闭', 'common.back': '返回',
        'common.play': '播放', 'common.pause': '暂停',
    },
    'en': {
        'lang.name': 'English',
        'common.ok': 'OK', 'common.cancel': 'Cancel', 'common.save': 'Save',
        'common.delete': 'Delete', 'common.close': 'Close', 'common.back': 'Back',
        'common.play': 'Play', 'common.pause': 'Pause',
    }
};

let initialized = false;
let initPromise = null;

/**
 * 初始化 i18n：从后端加载翻译数据
 * 必须在使用 t() 之前调用（各页面 DOMContentLoaded 时调用一次）
 * @returns {Promise<void>}
 */
export async function initI18n() {
    if (initialized) return;
    if (initPromise) return initPromise;

    initPromise = (async () => {
        try {
            const data = await GetI18nData();
            if (data && data.languages) {
                translations = data.languages;
                // 把当前语言标准化一次，并持久化
                currentLanguage = normalizeLang(currentLanguage);
                try { localStorage.setItem('appLanguage', currentLanguage); } catch (_) {}
                initialized = true;
                return;
            }
        } catch (e) {
            console.warn('从后端加载 i18n 数据失败，使用兜底词典', e);
        }
        // 兜底
        translations = fallbackTranslations;
        initialized = true;
    })();

    return initPromise;
}

/**
 * 翻译键值
 * @param {string} key — 翻译键，如 'libraries.title'
 * @param {...*} args — 支持以下形式：
 *   1. 位置参数：t('key', 'a', 'b')  → 替换 {0}, {1}
 *   2. 命名参数：t('key', { count: 5 }) → 替换 {count}
 *   3. fallback：t('key', '兜底') → 找不到时返回 '兜底'（或字符串 'undefined'）
 *   混合使用也支持：t('key', '兜底', 'a', 'b') 或 t('key', '兜底', { count: 5 })
 * @returns {string} 翻译后的字符串
 */
export function t(key, ...args) {
    if (key === undefined || key === null || key === '') return '';
    const k = String(key);

    // 识别 fallback 参数：在第一个非占位参数之前、且是字符串的，作为兜底
    // args 顺序：fallback?, ...positionalOrNamed
    // 我们约定：若 args[0] 不是命名对象且看起来像文本（非空字符串），则视为 fallback
    let fallback = undefined;
    if (args.length > 0 && typeof args[0] === 'string') {
        fallback = args[0];
        args = args.slice(1);
    }

    // 构造查找链：当前语言（标准化后）→ en-US → zh-CN → 当前语言 fallbackTranslations → zh-CN fallbackTranslations → 'en' fallback
    const lookupChain = [];
    const normCur = normalizeLang(currentLanguage);
    lookupChain.push(translations[normCur]);
    for (const fb of FALLBACK_LANGS) {
        if (fb !== normCur) lookupChain.push(translations[fb]);
    }
    lookupChain.push(fallbackTranslations[normCur]);
    lookupChain.push(fallbackTranslations['zh-CN']);
    if (normCur === 'en-US') lookupChain.push(fallbackTranslations['en']);
    else lookupChain.push(fallbackTranslations['en']);

    let str = undefined;
    for (const dict of lookupChain) {
        if (dict && Object.prototype.hasOwnProperty.call(dict, k)) {
            const v = dict[k];
            if (v !== undefined && v !== null) {
                str = String(v);
                break;
            }
        }
    }

    // 完全找不到：若有 fallback 则使用 fallback，否则返回 undefined
    if (str === undefined) {
        if (fallback !== undefined) return fallback;
        return undefined;
    }

    // 插值
    if (args.length > 0) {
        for (let i = 0; i < args.length; i++) {
            const arg = args[i];
            if (arg && typeof arg === 'object' && !Array.isArray(arg) && !(arg instanceof Error)) {
                for (const kk of Object.keys(arg)) {
                    str = str.replace(new RegExp(`\\{${kk}\\}`, 'g'), String(arg[kk]));
                }
            } else {
                str = str.replace(new RegExp(`\\{${i}\\}`, 'g'), String(arg ?? ''));
            }
        }
    }
    return str;
}

/**
 * 设置当前语言
 * @param {string} lang — 语言代码：'zh-CN' | 'en'
 */
export function setLanguage(lang) {
    const normalized = normalizeLang(lang);
    const hasDict = translations && (
        Object.prototype.hasOwnProperty.call(translations, normalized) ||
        Object.prototype.hasOwnProperty.call(fallbackTranslations, normalized) ||
        // 兜底：旧 fallbackTranslations 可能只用 'en' 作 key
        (normalized === 'en-US' && Object.prototype.hasOwnProperty.call(fallbackTranslations, 'en'))
    );
    if (!hasDict) {
        console.warn(`Unknown language: ${lang} (normalized=${normalized}), falling back to zh-CN`);
        currentLanguage = 'zh-CN';
    } else {
        currentLanguage = normalized;
    }
    try {
        localStorage.setItem('appLanguage', currentLanguage);
    } catch (e) {
        // ignore
    }
}

/**
 * 获取当前语言
 * @returns {string} 当前语言代码
 */
export function getCurrentLanguage() {
    return currentLanguage;
}

/**
 * 获取可用语言列表，每项含 code 和 nativeName
 * @returns {Array<{code: string, nativeName: string}>}
 */
export function getAvailableLanguages() {
    const source = Object.keys(translations).length > 0 ? translations : fallbackTranslations;
    return Object.keys(source).map(code => ({
        code,
        nativeName: source[code]['lang.name'] || code,
    }));
}

/**
 * 翻译页面上所有 [data-i18n] 元素
 * 用法：<span data-i18n="libraries.title">我的音乐库</span>
 * 也支持 [data-i18n-placeholder] 用于 placeholder 属性
 */
export function applyTranslations() {
    // 翻译文本内容（找不到翻译时保留 DOM 内的原始默认文本，不写入原始 key 名）
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (!key) return;
        if (el.getAttribute('data-original-text') === null) {
            el.setAttribute('data-original-text', el.textContent);
        }
        const translated = t(key);
        if (translated !== undefined && translated !== null) {
            el.textContent = translated;
        } else {
            const backup = el.getAttribute('data-original-text');
            if (backup !== null) el.textContent = backup;
        }
    });
    // 翻译 placeholder（保留原 placeholder 作兜底）
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (!key) return;
        if (el.getAttribute('data-original-placeholder') === null && el.placeholder) {
            el.setAttribute('data-original-placeholder', el.placeholder);
        }
        const translated = t(key);
        if (translated !== undefined && translated !== null) {
            el.placeholder = translated;
        } else {
            const backup = el.getAttribute('data-original-placeholder');
            if (backup !== null) el.placeholder = backup;
        }
    });
    // 翻译 title 属性（保留原 title 作兜底）
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.getAttribute('data-i18n-title');
        if (!key) return;
        if (el.getAttribute('data-original-title') === null && el.title) {
            el.setAttribute('data-original-title', el.title);
        }
        const translated = t(key);
        if (translated !== undefined && translated !== null) {
            el.title = translated;
        } else {
            const backup = el.getAttribute('data-original-title');
            if (backup !== null) el.title = backup;
        }
    });
}

// 暴露到全局，供非模块脚本使用
window.i18n = { initI18n, t, setLanguage, getCurrentLanguage, applyTranslations, getAvailableLanguages };
