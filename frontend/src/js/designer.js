// designer.js — 独立设计器页面逻辑
// 迁移自原"外观设置"，提供圆角 / 模糊 / 阴影 / 辉光 / 字体晕影 / 动画速度 / 主题色
// 等几乎所有 CSS 变量的实时控件。修改实时生效，保存后持久化到 settings.json。
import { LoadSettings, SaveSettings, ResetSettings } from '../../wailsjs/go/main/App.js';
import { initI18n, t, applyTranslations } from './i18n.js';

// ============ 长歌名滚动显示（与 settings.js 一致） ============
function applyMarquee(el) {
    if (!el) return;
    const text = el.textContent || '';
    let span = el.querySelector('.scroll-text');
    if (!span || span.dataset.text !== text) {
        el.textContent = '';
        span = document.createElement('span');
        span.className = 'scroll-text';
        span.textContent = text;
        span.dataset.text = text;
        el.appendChild(span);
    }
    span.getAnimations().forEach(a => a.cancel());
    el.classList.remove('marquee');
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            const overflow = span.scrollWidth - el.clientWidth;
            if (overflow > 4) {
                el.classList.add('marquee');
                const duration = Math.max(6000, Math.min(20000, overflow * 60));
                span.animate(
                    [
                        { transform: 'translateX(0)' },
                        { transform: `translateX(-${overflow}px)` }
                    ],
                    {
                        duration: duration,
                        iterations: Infinity,
                        direction: 'alternate',
                        easing: 'ease-in-out'
                    }
                );
            }
        });
    });
}

// ============ 标题栏窗口控制 ============
document.getElementById('minimizeBtn')?.addEventListener('click', () => window.runtime?.WindowMinimise());
document.getElementById('closeBtn')?.addEventListener('click', () => window.runtime?.WindowHide());

// DOM Elements
const backBtn = document.getElementById('backBtn');
const saveBar = document.getElementById('saveBar');
const saveBtn = document.getElementById('saveBtn');
const resetBtn = document.getElementById('resetBtn');
const themeButtons = document.querySelectorAll('.theme-btn');
const accentColorItem = document.getElementById('accent-color-item');
const accentColorInput = document.getElementById('accent-color');
const accentColorText = document.getElementById('accent-color-text');
const radiusSlider = document.getElementById('radius-slider');
const radiusValue = document.getElementById('radius-value');
const blurSlider = document.getElementById('blur-slider');
const blurValue = document.getElementById('blur-value');
const shadowSlider = document.getElementById('shadow-slider');
const shadowValue = document.getElementById('shadow-value');
const glowSlider = document.getElementById('glow-slider');
const glowValue = document.getElementById('glow-value');
const textGlowSlider = document.getElementById('text-glow-slider');
const textGlowValue = document.getElementById('text-glow-value');
const animSpeedSlider = document.getElementById('anim-speed-slider');
const animSpeedValue = document.getElementById('anim-speed-value');
const animLevelBtns = document.querySelectorAll('.anim-level-btn[data-level]');

// 确认对话框 / Toast
const confirmModal = document.getElementById('confirmModal');
const confirmTitleEl = document.getElementById('confirmTitle');
const confirmMessageEl = document.getElementById('confirmMessage');
const confirmCancelBtn = document.getElementById('confirmCancel');
const confirmOkBtn = document.getElementById('confirmOk');
const toastContainer = document.getElementById('toastContainer');

// 预览区按钮：点击触发一次脉冲动画，直观展示动画速度
const previewBtn = document.getElementById('previewBtn');

let currentSettings = null;
let confirmCallback = null;

// ============ Toast / Confirm（与 settings.js 一致） ============
function showToast(message, type = 'info', duration = 2500) {
    if (!toastContainer) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const icon = {
        success: '<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>',
        error: '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>',
        warning: '<svg viewBox="0 0 24 24"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>',
        info: '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>'
    }[type] || '';
    toast.innerHTML = `<span class="toast-icon">${icon}</span><span class="toast-msg">${message}</span>`;
    toast.addEventListener('click', () => dismissToast(toast));
    toastContainer.appendChild(toast);
    if (duration > 0) setTimeout(() => dismissToast(toast), duration);
}

function dismissToast(toast) {
    if (!toast || toast.classList.contains('toast-out')) return;
    toast.classList.add('toast-out');
    setTimeout(() => toast.remove(), 260);
}

function showConfirm(message, opts = {}) {
    return new Promise(resolve => {
        if (!confirmModal) { resolve(window.confirm(message)); return; }
        confirmTitleEl.textContent = opts.title || t('common.ok');
        confirmMessageEl.textContent = message;
        confirmOkBtn.textContent = opts.okText || t('common.ok');
        confirmCancelBtn.textContent = opts.cancelText || t('common.cancel');
        confirmOkBtn.className = 'btn ' + (opts.danger ? 'btn-danger' : 'btn-primary');
        const cleanup = (result) => {
            confirmModal.classList.add('closing');
            confirmModal.classList.remove('active');
            confirmOkBtn.removeEventListener('click', onOk);
            confirmCancelBtn.removeEventListener('click', onCancel);
            confirmModal.removeEventListener('click', onBackdrop);
            document.removeEventListener('keydown', onKey);
            setTimeout(() => confirmModal.classList.remove('closing'), 200);
            resolve(result);
        };
        const onOk = () => cleanup(true);
        const onCancel = () => cleanup(false);
        const onBackdrop = (e) => { if (e.target === confirmModal) cleanup(false); };
        const onKey = (e) => {
            if (e.key === 'Escape') cleanup(false);
            if (e.key === 'Enter') cleanup(true);
        };
        confirmOkBtn.addEventListener('click', onOk);
        confirmCancelBtn.addEventListener('click', onCancel);
        confirmModal.addEventListener('click', onBackdrop);
        document.addEventListener('keydown', onKey);
        confirmModal.classList.add('active');
    });
}

// ============ 颜色工具（与 settings.js 一致） ============
function normalizeColor(c) {
    if (!c) return '#1DB954';
    c = c.trim();
    if (!c.startsWith('#')) c = '#' + c;
    if (c.length === 4) c = '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
    return c.toLowerCase();
}

// ============ 实时应用：主题色 ============
function applyAccentToUI() {
    const c = currentSettings?.accent_color || '#1DB954';
    const theme = currentSettings?.theme || 'dark';
    if (window.MusicLiteSettings) {
        window.MusicLiteSettings.applyAccentColor(c, theme);
    } else {
        const n = normalizeColor(c);
        document.documentElement.style.setProperty('--accent-color', n);
        document.body.style.setProperty('--accent-color', n);
    }
}

function showOrHideAccentItem(theme) {
    if (!accentColorItem) return;
    accentColorItem.style.display = (theme === 'custom') ? 'block' : 'none';
}

// ============ 实时应用：设计令牌 ============
function applyDesignTokensLive() {
    if (!currentSettings) return;
    if (window.MusicLiteSettings && window.MusicLiteSettings.applyDesignTokens) {
        window.MusicLiteSettings.applyDesignTokens(
            currentSettings.design_radius,
            currentSettings.design_blur,
            currentSettings.design_anim_mult,
            currentSettings.design_shadow,
            currentSettings.design_glow,
            currentSettings.design_text_glow
        );
    }
}

function applyAnimationLevelLive() {
    if (!currentSettings) return;
    if (window.MusicLiteSettings && window.MusicLiteSettings.applyAnimationLevel) {
        window.MusicLiteSettings.applyAnimationLevel(currentSettings.animation_level);
    }
}

// ============ 把后端设置同步到 UI 控件 ============
function applySettingsToUI(s) {
    currentSettings = s;
    // 主题
    themeButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.theme === s.theme));
    showOrHideAccentItem(s.theme);
    // 主题色
    const accent = s.accent_color || '#1DB954';
    accentColorInput.value = normalizeColor(accent);
    accentColorText.value = accent;
    // 设计令牌
    radiusSlider.value = s.design_radius ?? 10;
    radiusValue.textContent = (s.design_radius ?? 10) + 'px';
    blurSlider.value = s.design_blur ?? 16;
    blurValue.textContent = (s.design_blur ?? 16) + 'px';
    shadowSlider.value = s.design_shadow ?? 0.45;
    shadowValue.textContent = Math.round((s.design_shadow ?? 0.45) * 100) + '%';
    glowSlider.value = s.design_glow ?? 0.35;
    glowValue.textContent = Math.round((s.design_glow ?? 0.35) * 100) + '%';
    textGlowSlider.value = s.design_text_glow ?? 0;
    textGlowValue.textContent = Math.round((s.design_text_glow ?? 0) * 100) + '%';
    animSpeedSlider.value = s.design_anim_mult ?? 1;
    animSpeedValue.textContent = (s.design_anim_mult ?? 1).toFixed(1) + '×';
    // 动画级别
    const lvl = (typeof s.animation_level === 'number') ? s.animation_level : 2;
    animLevelBtns.forEach(btn => btn.classList.toggle('active', Number(btn.dataset.level) === lvl));
}

// ============ 加载设置 ============
async function loadSettings() {
    try {
        const s = await LoadSettings();
        applySettingsToUI(s);
        applyAccentToUI();
        applyDesignTokensLive();
        applyAnimationLevelLive();
    } catch (e) {
        console.warn('LoadSettings failed:', e);
    }
}

// ============ 保存 / 重置 ============
let hasChanges = false;

// 任意设计项变更时调用：显示底部保存栏
function markChanged() {
    hasChanges = true;
    if (!saveBar) return;
    saveBar.style.display = 'flex';
    // 强制重排以重启动画（display:none→flex 切换后 animation 不会自动重播）
    void saveBar.offsetWidth;
    saveBar.classList.add('visible');
}

// 保存或重置后隐藏保存栏
function hideSaveBar() {
    hasChanges = false;
    if (!saveBar) return;
    saveBar.classList.remove('visible');
    saveBar.style.display = 'none';
}

async function saveSettings() {
    try {
        await SaveSettings(currentSettings);
        // 同步全局缓存，避免其他页面读到旧值
        if (window.MusicLiteSettings) window.MusicLiteSettings.cached = currentSettings;
        hideSaveBar();
        showToast(t('designer.saved'), 'success');
    } catch (e) {
        showToast(t('designer.saveFailed', String(e)), 'error');
    }
}

async function resetToDefaults() {
    const ok = await showConfirm(t('designer.resetConfirm'), {
        title: t('designer.reset'),
        okText: t('common.ok'),
        cancelText: t('common.cancel'),
        danger: true
    });
    if (!ok) return;
    try {
        const defaults = await ResetSettings();
        applySettingsToUI(defaults);
        applyAccentToUI();
        applyDesignTokensLive();
        applyAnimationLevelLive();
        await SaveSettings(defaults);
        if (window.MusicLiteSettings) window.MusicLiteSettings.cached = defaults;
        hideSaveBar();
        showToast(t('designer.saved'), 'success');
    } catch (e) {
        showToast(t('designer.saveFailed', String(e)), 'error');
    }
}

// ============ 事件绑定 ============
function setupEventListeners() {
    // 返回
    backBtn.addEventListener('click', () => {
        window.history.back();
    });

    // 主题切换
    themeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            themeButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentSettings.theme = btn.dataset.theme;
            showOrHideAccentItem(currentSettings.theme);
            applyAccentToUI();
            markChanged();
        });
    });

    // 主题色选择
    accentColorInput.addEventListener('input', () => {
        const v = accentColorInput.value;
        accentColorText.value = v;
        currentSettings.accent_color = v;
        applyAccentToUI();
        markChanged();
    });
    accentColorText.addEventListener('input', () => {
        let v = accentColorText.value.trim();
        if (/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(v)) v = '#' + v;
        if (/^#[0-9a-fA-F]{3}$|^#[0-9a-fA-F]{6}$/.test(v)) {
            const n = normalizeColor(v);
            accentColorInput.value = n;
            currentSettings.accent_color = n;
            applyAccentToUI();
            markChanged();
        }
    });

    // 圆角
    radiusSlider.addEventListener('input', () => {
        const v = parseFloat(radiusSlider.value) || 0;
        currentSettings.design_radius = v;
        radiusValue.textContent = v + 'px';
        applyDesignTokensLive();
        markChanged();
    });

    // 模糊
    blurSlider.addEventListener('input', () => {
        const v = parseInt(blurSlider.value, 10) || 0;
        currentSettings.design_blur = v;
        blurValue.textContent = v + 'px';
        applyDesignTokensLive();
        markChanged();
    });

    // 阴影
    shadowSlider.addEventListener('input', () => {
        const v = parseFloat(shadowSlider.value) || 0;
        currentSettings.design_shadow = v;
        shadowValue.textContent = Math.round(v * 100) + '%';
        applyDesignTokensLive();
        markChanged();
    });

    // 辉光
    glowSlider.addEventListener('input', () => {
        const v = parseFloat(glowSlider.value) || 0;
        currentSettings.design_glow = v;
        glowValue.textContent = Math.round(v * 100) + '%';
        applyDesignTokensLive();
        markChanged();
    });

    // 字体晕影
    textGlowSlider.addEventListener('input', () => {
        const v = parseFloat(textGlowSlider.value) || 0;
        currentSettings.design_text_glow = v;
        textGlowValue.textContent = Math.round(v * 100) + '%';
        applyDesignTokensLive();
        markChanged();
    });

    // 动画速度
    animSpeedSlider.addEventListener('input', () => {
        const v = parseFloat(animSpeedSlider.value) || 1;
        currentSettings.design_anim_mult = v;
        animSpeedValue.textContent = v.toFixed(1) + '×';
        applyDesignTokensLive();
        markChanged();
    });

    // 动画级别
    animLevelBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            animLevelBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentSettings.animation_level = Number(btn.dataset.level);
            applyAnimationLevelLive();
            markChanged();
        });
    });

    // 保存 / 重置
    saveBtn.addEventListener('click', saveSettings);
    resetBtn.addEventListener('click', resetToDefaults);

    // 预览按钮：触发脉冲动画，直观展示当前动画速度倍率
    if (previewBtn) {
        previewBtn.addEventListener('click', () => {
            previewBtn.getAnimations().forEach(a => a.cancel());
            const mult = currentSettings?.design_anim_mult ?? 1;
            previewBtn.animate(
                [
                    { transform: 'scale(1)' },
                    { transform: 'scale(0.92)' },
                    { transform: 'scale(1)' }
                ],
                { duration: Math.max(120, 400 / mult), easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }
            );
        });
    }

    // 动画重播按钮：重新触发入场动画
    const animReplayBtn = document.getElementById('animReplayBtn');
    const animDemo = document.querySelector('.designer-anim-demo');
    if (animReplayBtn && animDemo) {
        animReplayBtn.addEventListener('click', () => {
            animDemo.classList.remove('replay');
            // 强制 reflow 让 class 重新生效
            void animDemo.offsetWidth;
            animDemo.classList.add('replay');
            // 动画结束后移除 class，便于下次重播
            setTimeout(() => animDemo.classList.remove('replay'), 1500);
        });
    }
}

// ============ 迷你播放器（与 settings.js 一致） ============
function setMiniCover(container, coverUrl) {
    if (!container) return;
    if (coverUrl) {
        container.innerHTML = `<img src="${coverUrl}" alt="cover" style="width:100%;height:100%;object-fit:cover;border-radius:4px;" />`;
    } else {
        container.innerHTML = `<div class="card-icon"><svg viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"></path></svg></div>`;
    }
}

function initMiniPlayer() {
    const miniPlayer = document.getElementById('mini-player');
    const miniPlayerLeft = miniPlayer?.querySelector('.mini-player-left');
    const miniCover = document.getElementById('mini-cover');
    const miniTitle = document.getElementById('mini-title');
    const miniArtist = document.getElementById('mini-artist');
    const miniPlayBtn = document.getElementById('mini-play');
    const miniPlayIcon = document.getElementById('mini-play-icon');
    const miniPauseIcon = document.getElementById('mini-pause-icon');
    const miniExpand = document.getElementById('mini-expand');
    if (!miniPlayer || !window.audioManager) return;

    const showMiniPlayer = () => {
        miniPlayer.style.display = 'flex';
        document.body.classList.add('has-mini-player');
    };

    const syncPlayIcon = () => {
        if (!miniPlayIcon || !miniPauseIcon) return;
        if (window.audioManager.isPlaying()) {
            miniPlayIcon.style.display = 'none';
            miniPauseIcon.style.display = 'block';
        } else {
            miniPlayIcon.style.display = 'block';
            miniPauseIcon.style.display = 'none';
        }
    };

    const applyTrackUI = (track) => {
        if (!track || !track.src) return;
        showMiniPlayer();
        miniTitle.textContent = track.name || t('common.unknown');
        applyMarquee(miniTitle);
        miniArtist.textContent = track.artist || '--';
        setMiniCover(miniCover, track.cover);
    };

    miniPlayBtn.addEventListener('click', () => window.audioManager.toggle());
    miniExpand.addEventListener('click', () => {
        window.location.href = '/src/html/libraries.html';
    });
    if (miniPlayerLeft) {
        miniPlayerLeft.addEventListener('click', () => {
            const track = window.audioManager?.currentTrack;
            if (track && track.id) {
                localStorage.setItem('openPlayerOnLoad', String(track.id));
            }
            window.location.href = '/src/html/libraries.html';
        });
    }

    window.audioManager.on('play', () => syncPlayIcon());
    window.audioManager.on('pause', () => syncPlayIcon());
    window.audioManager.on('trackloaded', (track) => {
        applyTrackUI(track);
        syncPlayIcon();
    });

    window.audioManager.restore();
    const currentTrack = window.audioManager.currentTrack;
    if (currentTrack && currentTrack.src) applyTrackUI(currentTrack);
    syncPlayIcon();
    setTimeout(syncPlayIcon, 200);
    setTimeout(syncPlayIcon, 800);
}

// ============ 初始化 ============
document.addEventListener('DOMContentLoaded', async () => {
    // 阻止触摸板/键盘缩放
    window.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
    window.addEventListener('keydown', (e) => {
        if (e.ctrlKey && ['=', '+', '-', '0'].includes(e.key)) e.preventDefault();
    });

    await initI18n();
    applyTranslations();
    await loadSettings();
    setupEventListeners();
    initMiniPlayer();

    // 为设置区块添加逐级入场延迟
    document.querySelectorAll('.settings-section').forEach((sec, i) => {
        sec.style.setProperty('--sec-i', i);
    });
});
