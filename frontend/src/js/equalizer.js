// equalizer.js — 均衡器面板逻辑（模块化）
// 与后端 Equalizer（equalizer.go，biquad peaking filter）实时联动。
// 面板在 player-overlay 内，支持点击空白处或按 ESC 关闭。
import {
    PlayerSetEqBand, PlayerGetEqGains, PlayerGetEqFreqs, PlayerGetEqBandCount,
    PlayerSetEqEnabled, PlayerSetEqGains, PlayerGetEqEnabled, PlayerResetEq
} from '@bindings/MusicLite/app/musicservice.js';
import { t } from './i18n.js';

const LS_GAINS = 'musicLite.eqGains';
const LS_ENABLED = 'musicLite.eqEnabled';
const BAND_COUNT = 10;
const MAX_GAIN = 12;

let panelEl = null;
let bandsEl = null;
let toggleEl = null;
let resetBtn = null;
let openBtn = null;
let isOpen = false;
let bandSliders = [];
let initialized = false;

// 格式化频率显示：1000 以上用 k
function fmtFreq(hz) {
    if (hz >= 1000) {
        const k = hz / 1000;
        return (k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)) + 'k';
    }
    return String(hz);
}

// 构建 10 个频段滑块
function buildBands(freqs) {
    bandsEl.innerHTML = '';
    bandSliders = [];
    for (let i = 0; i < BAND_COUNT; i++) {
        const wrap = document.createElement('div');
        wrap.className = 'eq-band';
        const freq = freqs ? freqs[i] : 0;
        const label = document.createElement('span');
        label.className = 'eq-band-freq';
        label.textContent = fmtFreq(freq);
        const val = document.createElement('span');
        val.className = 'eq-band-val';
        val.textContent = '0';
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.className = 'eq-band-slider';
        slider.min = -MAX_GAIN;
        slider.max = MAX_GAIN;
        slider.step = 0.5;
        slider.value = 0;
        slider.dataset.band = String(i);
        slider.addEventListener('input', () => {
            const g = parseFloat(slider.value) || 0;
            val.textContent = (g > 0 ? '+' : '') + g.toFixed(1);
            updateBandFill(slider, g);
            // 实时推送到后端
            try { PlayerSetEqBand(i, g); } catch (e) { console.warn('PlayerSetEqBand failed:', e); }
        });
        wrap.appendChild(val);
        wrap.appendChild(slider);
        wrap.appendChild(label);
        bandsEl.appendChild(wrap);
        bandSliders.push({ slider, val, wrap });
        updateBandFill(slider, parseFloat(slider.value));
    }
}

// 更新滑块填充（中心为 0，向上下两侧填充）
function updateBandFill(slider, gain) {
    const pct = (gain + MAX_GAIN) / (MAX_GAIN * 2); // 0..1
    const mid = 50;
    const pos = pct * 100;
    if (pos >= mid) {
        slider.style.setProperty('--fill-from', mid + '%');
        slider.style.setProperty('--fill-to', pos + '%');
    } else {
        slider.style.setProperty('--fill-from', pos + '%');
        slider.style.setProperty('--fill-to', mid + '%');
    }
}

// 从 localStorage 读取上次增益（用于首屏快速恢复 UI）
function loadLocalGains() {
    try {
        const raw = localStorage.getItem(LS_GAINS);
        if (raw) {
            const arr = JSON.parse(raw);
            if (Array.isArray(arr) && arr.length === BAND_COUNT) return arr;
        }
    } catch (e) {}
    return null;
}
function saveLocalGains(arr) {
    try { localStorage.setItem(LS_GAINS, JSON.stringify(arr)); } catch (e) {}
}
function loadLocalEnabled() {
    try { return localStorage.getItem(LS_ENABLED) === '1'; } catch (e) { return false; }
}
function saveLocalEnabled(on) {
    try { localStorage.setItem(LS_ENABLED, on ? '1' : '0'); } catch (e) {}
}

// 应用增益数组到 UI
function applyGainsToUI(gains) {
    for (let i = 0; i < BAND_COUNT && i < bandSliders.length; i++) {
        const g = gains[i] || 0;
        const { slider, val } = bandSliders[i];
        slider.value = g;
        val.textContent = (g > 0 ? '+' : '') + (Math.round(g * 10) / 10).toFixed(1);
        updateBandFill(slider, g);
    }
}

// 打开/关闭面板
function open() {
    if (!panelEl) return;
    panelEl.classList.add('active');
    isOpen = true;
}
function close() {
    if (!panelEl) return;
    panelEl.classList.remove('active');
    isOpen = false;
}
function toggle() {
    if (isOpen) close(); else open();
}
function getIsOpen() { return isOpen; }

// 初始化：构建 UI、加载后端状态、绑定事件
// 仅首次调用时绑定；openPlayer 每次打开播放器都会调用 init()，若不幂等会
// 在 eqBtn 上累加多个 click 监听器 → 单次点击触发多次 toggle() → 开+关抵消，
// 表现为“均衡器拉不出来”。故已初始化则直接返回。
async function init() {
    if (initialized) return;
    panelEl = document.getElementById('eqPanel');
    bandsEl = document.getElementById('eqBands');
    toggleEl = document.getElementById('eqEnabledToggle');
    resetBtn = document.getElementById('eqResetBtn');
    openBtn = document.getElementById('eqBtn');
    if (!panelEl || !bandsEl) return;

    // 获取频段频率
    let freqs = null;
    try { freqs = await PlayerGetEqFreqs(); } catch (e) { console.warn('PlayerGetEqFreqs failed:', e); }
    buildBands(freqs);

    // 先用本地缓存快速恢复 UI
    const localGains = loadLocalGains();
    if (localGains) applyGainsToUI(localGains);
    const localEnabled = loadLocalEnabled();
    toggleEl.checked = localEnabled;

    // 再从后端同步真实状态
    try {
        const gains = await PlayerGetEqGains();
        if (Array.isArray(gains)) {
            applyGainsToUI(gains);
            saveLocalGains(gains);
        }
    } catch (e) { console.warn('PlayerGetEqGains failed:', e); }
    try {
        const enabled = await PlayerGetEqEnabled();
        toggleEl.checked = !!enabled;
        saveLocalEnabled(!!enabled);
    } catch (e) { console.warn('PlayerGetEqEnabled failed:', e); }

    // 启用开关
    toggleEl.addEventListener('change', () => {
        const on = toggleEl.checked;
        try { PlayerSetEqEnabled(on); } catch (e) { console.warn('PlayerSetEqEnabled failed:', e); }
        saveLocalEnabled(on);
        panelEl.classList.toggle('eq-disabled', !on);
    });
    panelEl.classList.toggle('eq-disabled', !toggleEl.checked);

    // 重置按钮
    resetBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        try { PlayerResetEq(); } catch (e) { console.warn('PlayerResetEq failed:', e); }
        const zeros = new Array(BAND_COUNT).fill(0);
        applyGainsToUI(zeros);
        saveLocalGains(zeros);
    });

    // 打开按钮
    if (openBtn) {
        openBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggle();
        });
    }

    // 点击面板内不关闭（让 stopPropagation 兜底）
    panelEl.addEventListener('click', (e) => { e.stopPropagation(); });

    // 保存增益到 localStorage（拖动结束时）
    bandSliders.forEach(({ slider }) => {
        slider.addEventListener('change', () => {
            const arr = bandSliders.map(s => parseFloat(s.slider.value) || 0);
            saveLocalGains(arr);
        });
    });

    initialized = true;
}

export const EqualizerPanel = { init, open, close, toggle, getIsOpen };
