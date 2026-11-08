// 字体选择：从后端获取系统字体列表并填充播放器/歌词字体下拉框
import { GetInstalledFonts } from '../../core/bindings.js';
import { playerFontSelect, lyricsFontSelect, playerFontPreview, lyricsFontPreview } from './dom.js';
import { state, markChanged } from './state.js';

export const FONT_FALLBACK = ", -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

export async function populateFontSelects() {
    let fonts = [];
    try {
        fonts = await GetInstalledFonts();
    } catch (e) {
        console.warn('获取系统字体失败，使用默认列表', e);
    }
    if (!Array.isArray(fonts) || fonts.length === 0) {
        fonts = ['Microsoft YaHei', 'PingFang SC', 'Segoe UI', 'SimHei', 'SimSun', 'KaiTi', 'FangSong', 'Consolas', 'Monaco', 'Courier New'];
    }
    // 去重 & 排序
    fonts = Array.from(new Set(fonts)).sort((a, b) => a.localeCompare(b, 'zh'));

    // 播放器字体
    buildFontOptions(playerFontSelect, fonts, {
        preset: [
            { value: 'system-ui', label: '系统默认' },
            { value: 'sans-serif', label: '无衬线体' },
            { value: 'serif', label: '衬线体' }
        ],
        fontFamily: (v) => (v === 'system-ui' || v === 'sans-serif' || v === 'serif') ? v : `'${v}'${FONT_FALLBACK}`
    });
    // 歌词字体
    buildFontOptions(lyricsFontSelect, fonts, {
        preset: [
            { value: "'Consolas', 'Monaco', monospace", label: '等宽字体（推荐）' },
            { value: 'system-ui', label: '系统默认' },
            { value: 'sans-serif', label: '无衬线体' },
            { value: 'serif', label: '衬线体' }
        ],
        fontFamily: (v) => {
            if (v.startsWith("'Consolas'")) return v;
            if (v === 'system-ui' || v === 'sans-serif' || v === 'serif') return v;
            return `'${v}', monospace`;
        }
    });
}

function buildFontOptions(selectEl, fonts, { preset, fontFamily }) {
    const frag = document.createDocumentFragment();
    for (const p of preset) {
        const opt = document.createElement('option');
        opt.value = p.value;
        opt.textContent = p.label;
        opt.style.fontFamily = fontFamily(p.value);
        frag.appendChild(opt);
    }
    const divider = document.createElement('optgroup');
    divider.label = '—— 系统字体 ——';
    for (const name of fonts) {
        const opt = document.createElement('option');
        opt.value = `'${name}'`;
        opt.textContent = name;
        opt.style.fontFamily = fontFamily(`'${name}'`);
        divider.appendChild(opt);
    }
    frag.appendChild(divider);
    selectEl.innerHTML = '';
    selectEl.appendChild(frag);
}

// 让设置值匹配 select 的 option value（后端保存的值可能带引号，匹配最佳 option）
export function normalizeFontOptionValue(savedValue, selectEl) {
    if (!savedValue) return selectEl.options[0]?.value || '';
    // 完全匹配
    for (const opt of selectEl.options) {
        if (opt.value === savedValue) return savedValue;
    }
    // 去掉引号后匹配
    const clean = savedValue.replace(/^'|'$/g, '').replace(/^"|"$/g, '').trim();
    for (const opt of selectEl.options) {
        const optClean = opt.value.replace(/^'|'$/g, '').replace(/^"|"$/g, '').trim();
        if (optClean === clean) return opt.value;
    }
    // 字体名包含匹配
    for (const opt of selectEl.options) {
        const optClean = opt.value.replace(/^'|'$/g, '').trim();
        if (clean.includes(optClean) || optClean.includes(clean)) return opt.value;
    }
    return selectEl.options[0]?.value || savedValue;
}

export function bindFontEvents() {
    // Player font
    playerFontSelect.addEventListener('change', () => {
        state.currentSettings.player_font = playerFontSelect.value;
        // 实时预览：同时设置 <html> 和 <body>
        document.documentElement.style.setProperty('--player-font', playerFontSelect.value);
        document.body.style.fontFamily = playerFontSelect.value + FONT_FALLBACK;
        // 更新字体预览
        if (playerFontPreview) playerFontPreview.style.fontFamily = playerFontSelect.value + FONT_FALLBACK;
        markChanged();
    });

    // Lyrics font
    lyricsFontSelect.addEventListener('change', () => {
        state.currentSettings.lyrics_font = lyricsFontSelect.value;
        // 实时预览
        document.documentElement.style.setProperty('--lyrics-font', lyricsFontSelect.value);
        // 更新字体预览
        if (lyricsFontPreview) lyricsFontPreview.style.fontFamily = lyricsFontSelect.value;
        markChanged();
    });
}
