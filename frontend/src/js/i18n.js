// i18n.js — MusicLite 国际化框架
// 翻译数据由后端 App.GetI18nData() 提供，初始数据打包在 Go 二进制内
// 首次启动时解压到 %APPDATA%/MusicLite/i18n.json，再次启动优先加载外部文件
//
// 用法：
//   import { initI18n, t, applyTranslations } from './i18n.js';
//   await initI18n();          // 启动时调用一次
//   t('libraries.title');      // 翻译
//   applyTranslations();       // 翻译页面所有 [data-i18n] 元素

import { GetI18nData } from '../../wailsjs/go/main/App.js';

// 翻译数据：{ 'zh-CN': { 'key': 'value', ... }, 'en': { ... } }
let translations = {};

// 当前语言（默认 zh-CN）
let currentLanguage = 'zh-CN';

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
 * @param {...*} args — 插值参数。支持两种形式：
 *   1. 位置参数：t('key', 'a', 'b')  → 替换 {0}, {1}
 *   2. 命名参数：t('key', { count: 5 }) → 替换 {count}
 *      混合使用也支持：t('key', 'pos1', { count: 5 })
 * @returns {string} 翻译后的字符串
 */
export function t(key, ...args) {
    const dict = translations[currentLanguage] || translations['zh-CN'] || fallbackTranslations[currentLanguage] || {};
    let str = dict[key];
    if (str === undefined) {
        // 回退到 zh-CN
        const zhDict = translations['zh-CN'] || fallbackTranslations['zh-CN'] || {};
        str = zhDict[key];
    }
    if (str === undefined) {
        // 键不存在，返回键名本身
        return key;
    }
    if (args.length > 0) {
        for (let i = 0; i < args.length; i++) {
            const arg = args[i];
            if (arg && typeof arg === 'object' && !Array.isArray(arg)) {
                // 命名参数：替换 {key}
                for (const k of Object.keys(arg)) {
                    str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(arg[k]));
                }
            } else {
                // 位置参数：替换 {0}, {1}, ...
                str = str.replace(new RegExp(`\\{${i}\\}`, 'g'), String(arg));
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
    if (!translations[lang] && !fallbackTranslations[lang]) {
        console.warn(`Unknown language: ${lang}, falling back to zh-CN`);
        lang = 'zh-CN';
    }
    currentLanguage = lang;
    try {
        localStorage.setItem('appLanguage', lang);
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
    // 翻译文本内容
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (key) {
            el.textContent = t(key);
        }
    });
    // 翻译 placeholder
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (key) {
            el.placeholder = t(key);
        }
    });
    // 翻译 title 属性
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.getAttribute('data-i18n-title');
        if (key) {
            el.title = t(key);
        }
    });
}

// 暴露到全局，供非模块脚本使用
window.i18n = { initI18n, t, setLanguage, getCurrentLanguage, applyTranslations, getAvailableLanguages };
