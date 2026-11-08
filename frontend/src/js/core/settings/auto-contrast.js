// ============ 自动对比度 ============
// 页面切换、打开播放器浮层、更换背景/主题/封面时，根据当前背景的实际亮度
// 决定文字与图标使用深色还是浅色方案，保证对比度。
//
// 判定方式：
//   - 页面：背景图片平均亮度 × 图层不透明度 + 页面底色，再按遮罩色合成
//   - 播放器：封面平均亮度 × .player-bg-layer 实际不透明度 + 浮层底色
//   - Aero 全透明且无自定义背景时无法获知桌面壁纸，保持主题默认
// 页面级：主题自身对比度已达标（>= 4.5）时不干预；
// 播放器：始终按对比度选择深/浅方案，避免继承页面级覆盖导致新的低对比。

const SCHEMES = {
    // 浅色背景 → 深色前景
    'on-light': {
        '--text-primary': '#121212',
        '--text-secondary': 'rgba(0, 0, 0, 0.62)',
        '--text-muted': 'rgba(0, 0, 0, 0.45)',
        '--border-color': 'rgba(0, 0, 0, 0.18)',
        '--hover-color': 'rgba(0, 0, 0, 0.07)',
        '--card-bg': '#ffffff',
        '--w3-layer-1': 'rgba(255, 255, 255, 0.45)',
        '--w3-layer-1-hover': 'rgba(255, 255, 255, 0.65)',
        '--w3-layer-2': 'rgba(255, 255, 255, 0.85)',
        '--w3-stroke': 'rgba(0, 0, 0, 0.08)',
        '--w3-stroke-strong': 'rgba(0, 0, 0, 0.16)',
        '--w3-text-secondary': 'rgba(0, 0, 0, 0.55)',
    },
    // 深色背景 → 浅色前景
    'on-dark': {
        '--text-primary': '#ffffff',
        '--text-secondary': 'rgba(255, 255, 255, 0.72)',
        '--text-muted': 'rgba(255, 255, 255, 0.50)',
        '--border-color': 'rgba(255, 255, 255, 0.16)',
        '--hover-color': 'rgba(255, 255, 255, 0.08)',
        '--card-bg': '#1e1e1e',
        '--w3-layer-1': 'rgba(255, 255, 255, 0.04)',
        '--w3-layer-1-hover': 'rgba(255, 255, 255, 0.075)',
        '--w3-layer-2': 'rgba(255, 255, 255, 0.10)',
        '--w3-stroke': 'rgba(255, 255, 255, 0.07)',
        '--w3-stroke-strong': 'rgba(255, 255, 255, 0.14)',
        '--w3-text-secondary': 'rgba(255, 255, 255, 0.55)',
    },
};

// 播放器浮层额外需要的背景/按钮/歌词卡片令牌
const PLAYER_EXTRA = {
    'on-light': {
        '--bg-color': '#f3f3f3',
        '--overlay-border-color': 'rgba(0, 0, 0, 0.18)',
        '--player-btn-bg': '#ffffff',
        '--player-btn-bg-hover': '#e6e6e6',
        '--player-btn-fg': '#121212',
        '--overlay-ctrl-btn-bg': 'rgba(0, 0, 0, 0.05)',
        '--overlay-ctrl-btn-bg-hover': 'rgba(0, 0, 0, 0.12)',
        '--overlay-card-bg': 'rgba(255, 255, 255, 0.92)',
        '--overlay-card-border': 'rgba(0, 0, 0, 0.12)',
        '--overlay-slider-thumb-active': 'var(--accent-color)',
    },
    'on-dark': {
        '--bg-color': '#0d0d0d',
        '--overlay-border-color': 'rgba(255, 255, 255, 0.14)',
        '--player-btn-bg': '#1a1a1a',
        '--player-btn-bg-hover': '#333333',
        '--player-btn-fg': '#ffffff',
        '--overlay-ctrl-btn-bg': 'rgba(255, 255, 255, 0.04)',
        '--overlay-ctrl-btn-bg-hover': 'rgba(255, 255, 255, 0.10)',
        '--overlay-card-bg': 'rgba(30, 30, 30, 0.95)',
        '--overlay-card-border': 'rgba(255, 255, 255, 0.10)',
        '--overlay-slider-thumb-active': 'var(--accent-color)',
    },
};

// 记录每个元素被本模块写入的变量，便于精确恢复（不误删主题写入的同名变量）
const appliedVars = new WeakMap();

export const AutoContrast = {
    _pageToken: 0,
    _playerToken: 0,
    _pageTimer: 0,
    _lastCover: '',
    _imageCache: new Map(),

    // ---------- 颜色工具 ----------
    _parseColor(str) {
        if (!str) return null;
        const s = String(str).trim();
        const hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
        if (hex) {
            let h = hex[1];
            if (h.length === 3) h = h.split('').map(c => c + c).join('');
            return {
                r: parseInt(h.slice(0, 2), 16),
                g: parseInt(h.slice(2, 4), 16),
                b: parseInt(h.slice(4, 6), 16),
                a: 1,
            };
        }
        const m = s.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/i);
        if (m) {
            let a = m[4] === undefined ? 1 : parseFloat(m[4]);
            if (String(m[4] || '').endsWith('%')) a /= 100;
            return { r: +m[1], g: +m[2], b: +m[3], a: isFinite(a) ? a : 1 };
        }
        return null;
    },

    _lum(c) {
        if (!c) return 0;
        return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
    },

    // WCAG 简化对比度，返回 1~21
    _contrast(l1, l2) {
        const light = Math.max(l1, l2);
        const dark = Math.min(l1, l2);
        return (light + 0.05) / (dark + 0.05);
    },

    // 分析图片平均亮度（0-1），失败返回 null
    _analyzeImage(url) {
        if (!url) return Promise.resolve(null);
        if (this._imageCache.has(url)) return Promise.resolve(this._imageCache.get(url));
        return new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                try {
                    const size = 32;
                    const canvas = document.createElement('canvas');
                    canvas.width = size;
                    canvas.height = size;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, size, size);
                    const data = ctx.getImageData(0, 0, size, size).data;
                    let total = 0;
                    const count = data.length / 4;
                    for (let i = 0; i < data.length; i += 4) {
                        total += (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
                    }
                    const lum = total / count;
                    this._imageCache.set(url, lum);
                    resolve(lum);
                } catch (e) {
                    // canvas 被污染时无法读取像素
                    resolve(null);
                }
            };
            img.onerror = () => resolve(null);
            img.src = url;
        });
    },

    // ---------- 变量写入/恢复 ----------
    _applyVars(el, vars) {
        if (!el) return;
        const rec = appliedVars.get(el) || {};
        for (const [k, v] of Object.entries(vars)) {
            el.style.setProperty(k, v);
            rec[k] = v;
        }
        appliedVars.set(el, rec);
    },

    _removeVars(el) {
        if (!el) return;
        const rec = appliedVars.get(el);
        if (rec) {
            for (const [k, v] of Object.entries(rec)) {
                // 仅移除仍等于本模块写入值的变量，避免误删主题/其他模块的覆盖
                if (el.style.getPropertyValue(k) === v) el.style.removeProperty(k);
            }
            appliedVars.delete(el);
        }
        el.removeAttribute('data-contrast');
    },

    // ---------- 决策 ----------
    _pickByContrast(bgLum) {
        const white = this._contrast(bgLum, 1);
        const black = this._contrast(bgLum, 0);
        return black >= white ? 'on-light' : 'on-dark';
    },

    // ---------- 页面级 ----------
    _pageBackdrop() {
        const root = document.documentElement;
        if (root.getAttribute('data-has-bg') === 'true') {
            const layer = document.getElementById('ml-bg-layer');
            const img = layer && layer.querySelector('img');
            if (!img || !img.src) return null;
            const base = this._parseColor(getComputedStyle(document.body).backgroundColor);
            const overlayEl = document.getElementById('ml-bg-overlay');
            const overlay = overlayEl ? this._parseColor(getComputedStyle(overlayEl).backgroundColor) : null;
            const o = parseFloat(getComputedStyle(layer).opacity);
            return {
                imgUrl: img.src,
                opacity: isFinite(o) ? Math.max(0, Math.min(1, o)) : 1,
                base,
                overlay,
            };
        }
        // Aero 全透明：桌面壁纸不可见，保持主题默认
        if (root.getAttribute('data-aero') === 'true') return null;
        const bg = this._parseColor(getComputedStyle(document.body).backgroundColor);
        if (!bg) return null;
        return { lum: this._lum(bg) };
    },

    _compositePage(imgLum, info) {
        const baseLum = info.base ? this._lum(info.base) : 0.07;
        let lum = imgLum * info.opacity + baseLum * (1 - info.opacity);
        if (info.overlay && info.overlay.a > 0) {
            lum = lum * (1 - info.overlay.a) + this._lum(info.overlay) * info.overlay.a;
        }
        return lum;
    },

    async applyPage() {
        const token = ++this._pageToken;
        const root = document.documentElement;
        const body = document.body;
        if (!body) return;

        // 先恢复主题值，确保读到的是主题自身的前景色
        this._removeVars(root);
        this._removeVars(body);

        const info = this._pageBackdrop();
        if (!info) return; // 无法判断：保持主题默认

        let lum = info.lum;
        if (info.imgUrl) {
            const imgLum = await this._analyzeImage(info.imgUrl);
            if (token !== this._pageToken) return;
            if (imgLum === null) return;
            lum = this._compositePage(imgLum, info);
        }

        const fg = this._parseColor(getComputedStyle(body).color);
        // 主题自身对比度已达标则不干预
        if (fg && this._contrast(lum, this._lum(fg)) >= 4.5) return;

        const scheme = this._pickByContrast(lum);
        const vars = SCHEMES[scheme];
        this._applyVars(root, vars);
        this._applyVars(body, vars);
        root.setAttribute('data-contrast', scheme);
        body.setAttribute('data-contrast', scheme);
    },

    // ---------- 播放器浮层 ----------
    async applyPlayer(coverUrl) {
        this._lastCover = coverUrl || '';
        const token = ++this._playerToken;
        const overlay = document.getElementById('player-overlay');
        if (!overlay) return;

        const fullscreen = document.getElementById('fullscreenLyrics');
        this._removeVars(overlay);
        this._removeVars(fullscreen);

        const bgLayer = overlay.querySelector('.player-bg-layer') || document.getElementById('bgLayer');
        let opacity = 0;
        if (bgLayer) {
            const o = parseFloat(getComputedStyle(bgLayer).opacity);
            if (isFinite(o)) opacity = Math.max(0, Math.min(1, o));
        }

        const overlayBg = this._parseColor(getComputedStyle(overlay).backgroundColor) || { r: 18, g: 18, b: 18, a: 1 };
        const baseLum = this._lum(overlayBg);

        let lum = baseLum;
        if (coverUrl) {
            const coverLum = await this._analyzeImage(coverUrl);
            if (token !== this._playerToken) return;
            if (coverLum !== null) lum = coverLum * opacity + baseLum * (1 - opacity);
        }

        const scheme = this._pickByContrast(lum);
        const vars = { ...SCHEMES[scheme], ...PLAYER_EXTRA[scheme] };
        this._applyVars(overlay, vars);
        if (fullscreen) this._applyVars(fullscreen, vars);
        overlay.setAttribute('data-contrast', scheme);
        if (fullscreen) fullscreen.setAttribute('data-contrast', scheme);
    },

    // 主题色/窗口透明度/背景变化后重新评估（页面 + 当前封面）
    reapply() {
        this.applyPage();
        if (this._lastCover !== undefined) this.applyPlayer(this._lastCover);
    },

    // 合并短时间内的多次触发（背景预览、透明度滑块等）
    schedulePage() {
        if (this._pageTimer) clearTimeout(this._pageTimer);
        this._pageTimer = setTimeout(() => {
            this._pageTimer = 0;
            this.applyPage();
        }, 60);
    },
};
