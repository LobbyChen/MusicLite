// 播放器歌词：LRC 解析、卡片/全屏渲染、高亮滚动与切换动画
import { audioManager } from '../../core/audio-manager.js';
import { applyMarquee } from '../../ui/marquee.js';
import { escapeHtml } from '../../ui/dom.js';
import { t } from '../../core/i18n.js';
import { playerState } from './player-state.js';
import {
    overlay, bgLayerEl,
    lyricsAreaEl, lyricsToggleEl, lyricsContentEl, lyricsWrapperEl, lyricsPreviewEl,
    expandFullscreenBtn, collapseCardBtn,
    fullscreenLyricsEl, fullscreenBgEl, fullscreenTrackNameEl, fullscreenArtistNameEl,
    fullscreenLyricsWrapperEl, fullscreenLyricsContentEl,
} from './player-dom.js';

let parsedLyrics = [];
let currentLyricIndex = -1;
let lyricsCardExpanded = false; // 卡片歌词展开状态

// ============ 弹簧物理滚动（弹动） ============
const SPRING = {
    mass: 1.0,
    stiffness: 220,
    dampingRatio: 0.91,
    anchor: 0.38, // 当前歌词垂直定位：容器高度的 38%
};
const SPRING_DAMPING = 2 * SPRING.dampingRatio * Math.sqrt(SPRING.stiffness * SPRING.mass);
const WAVE_MIN_INTERVAL = 500; // 波浪动画最小触发间隔
const WAVE_MAX_LINES = 7;      // 波浪动画最大切换行数

function createSpring() {
    return { pos: 0, vel: 0, target: 0, raf: null, lastTs: 0, initialized: false };
}
const cardSpring = createSpring();
const fsSpring = createSpring();

let userScrolling = false;      // 用户手动滚动时暂停自动跟随
let resumeTimer = null;         // 停止操作后恢复跟随
let lastLyricChangeTs = 0;
let lastActiveIndex = -1;

function applySpringTransform(spring, el) {
    if (!el) return;
    el.style.transform = `translateY(${-spring.pos}px)`;
}

function startSpring(spring, el) {
    if (spring.raf) return;
    spring.lastTs = 0;
    const tick = (ts) => {
        if (!spring.lastTs) spring.lastTs = ts;
        const dt = Math.min(0.064, (ts - spring.lastTs) / 1000);
        spring.lastTs = ts;
        // 固定子步长积分，避免掉帧时数值不稳定
        const steps = Math.max(1, Math.ceil(dt / 0.016));
        const h = dt / steps;
        for (let s = 0; s < steps; s++) {
            const accel = (-SPRING.stiffness * (spring.pos - spring.target) - SPRING_DAMPING * spring.vel) / SPRING.mass;
            spring.vel += accel * h;
            spring.pos += spring.vel * h;
        }
        applySpringTransform(spring, el);
        if (Math.abs(spring.vel) < 0.5 && Math.abs(spring.pos - spring.target) < 0.5) {
            spring.pos = spring.target;
            spring.vel = 0;
            applySpringTransform(spring, el);
            spring.raf = null;
            spring.lastTs = 0;
            return;
        }
        spring.raf = requestAnimationFrame(tick);
    };
    spring.raf = requestAnimationFrame(tick);
}

function setSpringTarget(spring, el, target, { snap = false } = {}) {
    if (!el || !isFinite(target)) return;
    spring.target = target;
    if (!spring.initialized || snap) {
        spring.pos = target;
        spring.vel = 0;
        spring.initialized = true;
        applySpringTransform(spring, el);
        return;
    }
    startSpring(spring, el);
}

// 当前歌词应停在容器的 38% 高度处
function targetOffsetFor(activeEl, wrapperEl) {
    const wrapperHeight = wrapperEl.clientHeight;
    return activeEl.offsetTop + activeEl.offsetHeight / 2 - wrapperHeight * SPRING.anchor;
}

// 波浪式位移：以当前行为锚点向两侧扩散，CSS translate 与 transform 互不冲突
function applyWave(container, selector, anchor, delta, isFullscreen) {
    if (!container || !delta) return;
    const direction = Math.sign(delta) || 1;
    const range = Math.min(4, Math.abs(delta) + 2);
    const amplitude = isFullscreen ? 16 : 10;
    for (let d = 1; d <= range; d++) {
        for (const idx of [anchor - d, anchor + d]) {
            const el = container.querySelector(`${selector}[data-index="${idx}"]`);
            if (!el) continue;
            const offset = direction * amplitude * (1 - d / (range + 1));
            try {
                el.animate(
                    [
                        { translate: `0 ${offset}px` },
                        { translate: '0 0' }
                    ],
                    {
                        duration: 520 + d * 40,
                        delay: d * 28,
                        easing: 'cubic-bezier(0.22, 1.4, 0.36, 1)',
                        fill: 'none'
                    }
                );
            } catch (_) {
                // 浏览器不支持 translate 关键帧时忽略波浪效果
            }
        }
    }
}

function syncSpringTargets() {
    if (currentLyricIndex >= 0) {
        const activeCard = lyricsContentEl.querySelector(`.lyric-line[data-index="${currentLyricIndex}"]`);
        if (activeCard) setSpringTarget(cardSpring, lyricsContentEl, targetOffsetFor(activeCard, lyricsWrapperEl));
        const activeFs = fullscreenLyricsContentEl.querySelector(`.fs-lyric-line[data-index="${currentLyricIndex}"]`);
        if (activeFs) setSpringTarget(fsSpring, fullscreenLyricsContentEl, targetOffsetFor(activeFs, fullscreenLyricsWrapperEl));
    }
}

function beginManualScroll() {
    userScrolling = true;
    if (resumeTimer) { clearTimeout(resumeTimer); resumeTimer = null; }
}

function scheduleResumeFollow() {
    if (resumeTimer) clearTimeout(resumeTimer);
    resumeTimer = setTimeout(() => {
        resumeTimer = null;
        userScrolling = false;
        syncSpringTargets();
    }, 2500);
}

// 手动滚动（滚轮 / 触摸拖拽）：暂停自动跟随
function setupManualScroll(wrapperEl, contentEl, spring) {
    if (!wrapperEl || !contentEl) return;

    wrapperEl.addEventListener('wheel', (e) => {
        e.preventDefault();
        beginManualScroll();
        spring.pos += e.deltaY * 0.6;
        spring.vel = 0;
        applySpringTransform(spring, contentEl);
        scheduleResumeFollow();
    }, { passive: false });

    let lastTouchY = 0;
    wrapperEl.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) return;
        lastTouchY = e.touches[0].clientY;
        beginManualScroll();
    }, { passive: true });
    wrapperEl.addEventListener('touchmove', (e) => {
        if (!userScrolling || e.touches.length !== 1) return;
        const y = e.touches[0].clientY;
        spring.pos += lastTouchY - y;
        lastTouchY = y;
        spring.vel = 0;
        applySpringTransform(spring, contentEl);
        e.preventDefault();
    }, { passive: false });
    wrapperEl.addEventListener('touchend', scheduleResumeFollow, { passive: true });
    wrapperEl.addEventListener('touchcancel', scheduleResumeFollow, { passive: true });
}

setupManualScroll(lyricsWrapperEl, lyricsContentEl, cardSpring);
setupManualScroll(fullscreenLyricsWrapperEl, fullscreenLyricsContentEl, fsSpring);

// 容器尺寸变化（卡片展开/收起、窗口缩放）时平滑重新定位，避免位置跳动
function observeLyricsResize(wrapperEl) {
    if (!wrapperEl || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
        if (!userScrolling) syncSpringTargets();
    });
    ro.observe(wrapperEl);
}
observeLyricsResize(lyricsWrapperEl);
observeLyricsResize(fullscreenLyricsWrapperEl);


// ============ LRC 解析 ============
function parseLyrics(lrcText) {
    if (!lrcText || typeof lrcText !== 'string') return [];
    const lines = lrcText.trim().split('\n');
    const lyrics = [];
    const timeRegex = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]/g;
    for (let line of lines) {
        line = line.trim();
        if (!line) continue;
        let match;
        const text = line.replace(timeRegex, '').trim();
        if (!text) continue;
        timeRegex.lastIndex = 0;
        while ((match = timeRegex.exec(line)) !== null) {
            const minutes = parseInt(match[1], 10);
            const seconds = parseInt(match[2], 10);
            const ms = match[3] ? parseInt(match[3].padEnd(3, '0'), 10) : 0;
            const time = minutes * 60 + seconds + ms / 1000;
            lyrics.push({ time, text });
        }
    }
    return lyrics.sort((a, b) => a.time - b.time);
}

// ============ 渲染歌词（同时渲染小卡片和全屏） ============
function renderLyrics(lyricsArray) {
    // 新歌词：重置弹簧状态，直接定位到当前句，避免从上一首的位置滑入
    cardSpring.initialized = false;
    fsSpring.initialized = false;
    lastActiveIndex = -1;
    lastLyricChangeTs = 0;
    userScrolling = false;
    if (resumeTimer) { clearTimeout(resumeTimer); resumeTimer = null; }

    if (!lyricsArray || lyricsArray.length === 0) {
        // 小卡片
        lyricsContentEl.innerHTML = '<div class="no-lyrics">' + t('player.noLyrics') + '</div>';
        lyricsPreviewEl.textContent = t('player.noLyrics');
        lyricsPreviewEl.dataset.lastText = t('player.noLyrics');
        lyricsPreviewEl.classList.remove('active');
        // 全屏
        fullscreenLyricsContentEl.innerHTML = '<div class="no-lyrics">' + t('player.noLyrics') + '</div>';
        parsedLyrics = [];
        return;
    }
    parsedLyrics = lyricsArray;

    // 构建歌词 HTML（小卡片用）
    let html = '<div class="lyric-line empty"></div>'.repeat(2);
    for (let i = 0; i < lyricsArray.length; i++) {
        const line = lyricsArray[i];
        html += `<div class="lyric-line" data-index="${i}" data-time="${line.time}">${escapeHtml(line.text)}</div>`;
    }
    html += '<div class="lyric-line empty"></div>'.repeat(3);
    lyricsContentEl.innerHTML = html;

    // 构建歌词 HTML（全屏用，更大的行高）
    let fsHtml = '<div class="fs-lyric-line empty"></div>'.repeat(4);
    for (let i = 0; i < lyricsArray.length; i++) {
        const line = lyricsArray[i];
        fsHtml += `<div class="fs-lyric-line" data-index="${i}" data-time="${line.time}">${escapeHtml(line.text)}</div>`;
    }
    fsHtml += '<div class="fs-lyric-line empty"></div>'.repeat(4);
    fullscreenLyricsContentEl.innerHTML = fsHtml;

    // 小卡片点击跳转
    lyricsContentEl.querySelectorAll('.lyric-line[data-time]').forEach(el => {
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            const time = parseFloat(el.dataset.time);
            if (!isNaN(time) && audioManager.getDuration()) {
                audioManager.seek(time);
            }
        });
    });

    // 全屏歌词点击跳转
    fullscreenLyricsContentEl.querySelectorAll('.fs-lyric-line[data-time]').forEach(el => {
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            const time = parseFloat(el.dataset.time);
            if (!isNaN(time) && audioManager.getDuration()) {
                audioManager.seek(time);
            }
        });
    });

    currentLyricIndex = -1;
    // 清除预览缓存，强制下次 updateLyricsScroll 重新写入
    delete lyricsPreviewEl.dataset.lastText;
    updateLyricsScroll(audioManager.getCurrentTime() || 0);
}

// 解析 LRC 文本并渲染（供 loadTrack 调用）
export function renderLyricsFromText(lrcText) {
    renderLyrics(parseLyrics(lrcText));
}

// ============ 歌词行切换动画（Web Animations API） ============
// 从 body class 读取动画模式（由 settings-apply.js 在启动时设置）
// 比依赖 SettingsManager.cached 更可靠，因为 body class 在脚本加载时就已设置
function getLyricAnimationMode() {
    const body = document.body;
    if (!body) return 'fade';
    // 从 body class 中提取 lyric-anim-<mode>
    for (const cls of body.classList) {
        if (cls.startsWith('lyric-anim-')) {
            return cls.substring(11); // 'lyric-anim-'.length === 11
        }
    }
    return 'fade';
}

// 对新高亮行触发进入动画（Web Animations API，每次切换都可靠触发）
function animateLyricLine(el, isFullscreen) {
    if (!el) return;
    const mode = getLyricAnimationMode();

    // 先取消之前可能残留的动画
    el.getAnimations().forEach(a => a.cancel());

    const baseScale = isFullscreen ? 1.02 : 1;
    let keyframes;
    let duration = 600;
    let easing = 'cubic-bezier(0.16, 1, 0.3, 1)';
    switch (mode) {
        case 'slide-up':
            // 从下方较远位置滑入，位移加大
            keyframes = [
                { opacity: 0, transform: `translateY(${isFullscreen ? 60 : 40}px) scale(${baseScale})` },
                { opacity: 1, transform: `translateY(0) scale(${baseScale})` }
            ];
            break;
        case 'slide-left':
            // 从右侧较远位置滑入，位移加大
            keyframes = [
                { opacity: 0, transform: `translateX(${isFullscreen ? 80 : 60}px) scale(${baseScale})` },
                { opacity: 1, transform: `translateX(0) scale(${baseScale})` }
            ];
            break;
        case 'zoom':
            // 缩放幅度加大，从更小放大到 baseScale
            keyframes = [
                { opacity: 0, transform: `scale(${isFullscreen ? 0.5 : 0.4})` },
                { opacity: 1, transform: `scale(${baseScale})` }
            ];
            break;
        case 'bounce':
            // 弹跳：从上方落下并产生弹跳效果
            keyframes = [
                { opacity: 0, transform: `translateY(-${isFullscreen ? 80 : 60}px) scale(${baseScale})`, offset: 0 },
                { opacity: 1, transform: `translateY(0) scale(${baseScale})`, offset: 0.5 },
                { opacity: 1, transform: `translateY(-${isFullscreen ? 25 : 20}px) scale(${baseScale})`, offset: 0.7 },
                { opacity: 1, transform: `translateY(0) scale(${baseScale})`, offset: 0.85 },
                { opacity: 1, transform: `translateY(-${isFullscreen ? 8 : 6}px) scale(${baseScale})`, offset: 0.95 },
                { opacity: 1, transform: `translateY(0) scale(${baseScale})`, offset: 1 }
            ];
            duration = 800;
            easing = 'cubic-bezier(0.68, -0.55, 0.265, 1.55)';
            break;
        case 'flip':
            // 翻转：沿 X 轴翻转进入
            keyframes = [
                { opacity: 0, transform: `perspective(800px) rotateX(90deg) scale(${baseScale})` },
                { opacity: 1, transform: `perspective(800px) rotateX(0deg) scale(${baseScale})` }
            ];
            duration = 700;
            easing = 'cubic-bezier(0.16, 1, 0.3, 1)';
            break;
        case 'rotate':
            // 旋转：带缩放的旋转进入
            keyframes = [
                { opacity: 0, transform: `rotate(-${isFullscreen ? 270 : 360}deg) scale(${isFullscreen ? 0.3 : 0.2})` },
                { opacity: 1, transform: `rotate(0deg) scale(${baseScale})` }
            ];
            duration = 700;
            easing = 'cubic-bezier(0.34, 1.56, 0.64, 1)';
            break;
        case 'spring':
            // 弹动：带过冲的弹簧式进入
            keyframes = [
                { opacity: 0, transform: `translateY(${isFullscreen ? 38 : 26}px) scale(${isFullscreen ? 0.92 : 0.95})` },
                { opacity: 1, transform: `translateY(-${isFullscreen ? 6 : 4}px) scale(${isFullscreen ? 1.04 : 1.02})`, offset: 0.68 },
                { opacity: 1, transform: `translateY(0) scale(${baseScale})` }
            ];
            duration = 760;
            easing = 'cubic-bezier(0.22, 1.35, 0.36, 1)';
            break;
        case 'none':
            // 无动画，不触发
            return;
        case 'fade':
        default:
            // fade：opacity 从 0 淡入，更明显的淡入效果
            keyframes = [
                { opacity: 0 },
                { opacity: 1 }
            ];
            duration = 500;
            easing = 'ease';
            break;
    }
    el.animate(keyframes, {
        duration: duration,
        easing: easing,
        fill: 'forwards'
    });
}

// ============ 歌词滚动与高亮 ============
// getMaxLyricLines 获取当前"同一时间戳歌词行数"设置
// 优先从 localStorage 取（settings.js 实时同步），否则默认 1
function getMaxLyricLines() {
    try {
        const raw = localStorage.getItem('musicLite.maxLyricLines');
        if (raw) {
            const n = parseInt(raw, 10);
            if (!isNaN(n) && n >= 1 && n <= 10) return n;
        }
    } catch (e) {}
    return 1;
}

// highlightActiveLyricLines 高亮"同一时间戳"下的多行歌词
// 规则：从 currentIndex 向前找，只激活时间戳与 parsedLyrics[currentIndex].time
//       完全相同的连续行；最多激活 maxLines 行。
// 返回：最后一个（最新）的 DOM 元素，用于滚动定位
function highlightActiveLyricLines(containerEl, selector, currentIndex, maxLines) {
    if (!containerEl || !parsedLyrics || parsedLyrics.length === 0 || currentIndex < 0) {
        if (containerEl) containerEl.querySelectorAll(selector + '.active').forEach(el => el.classList.remove('active'));
        return null;
    }
    containerEl.querySelectorAll(selector).forEach(el => el.classList.remove('active'));

    const anchorTime = parsedLyrics[currentIndex].time;
    let activated = 0;
    let lastActiveEl = null;

    // 从 currentIndex 向前找与锚点时间相同的行，最多 maxLines 行
    for (let i = currentIndex; i >= 0 && activated < maxLines; i--) {
        if (parsedLyrics[i].time !== anchorTime) break;
        const el = containerEl.querySelector(`${selector}[data-index="${i}"]`);
        if (el) {
            el.classList.add('active');
            if (i === currentIndex) lastActiveEl = el;
        }
        activated++;
    }
    return lastActiveEl;
}

export function updateLyricsScroll(currentTime) {
    if (!parsedLyrics || parsedLyrics.length === 0) return;

    let newIndex = -1;
    for (let i = 0; i < parsedLyrics.length; i++) {
        if (parsedLyrics[i].time <= currentTime) {
            newIndex = i;
        } else {
            break;
        }
    }

    // 更新小卡片预览（仅在文本变化时写入，避免每帧 textContent 写入触发 DOM 标记）
    let previewText;
    let previewActive;
    if (newIndex >= 0 && parsedLyrics[newIndex]) {
        previewText = parsedLyrics[newIndex].text;
        previewActive = true;
    } else {
        previewText = parsedLyrics[0] ? parsedLyrics[0].text : t('player.noLyrics');
        previewActive = false;
    }
    if (lyricsPreviewEl.dataset.lastText !== previewText) {
        lyricsPreviewEl.textContent = previewText;
        lyricsPreviewEl.dataset.lastText = previewText;
    }
    if (previewActive) {
        if (!lyricsPreviewEl.classList.contains('active')) lyricsPreviewEl.classList.add('active');
    } else {
        if (lyricsPreviewEl.classList.contains('active')) lyricsPreviewEl.classList.remove('active');
    }

    const previousIndex = currentLyricIndex;
    if (newIndex === currentLyricIndex) return;
    currentLyricIndex = newIndex;

    const now = performance.now();
    const lineDelta = previousIndex >= 0 ? Math.abs(newIndex - previousIndex) : 0;
    // 波浪动画触发条件：歌词间隔不少于 500ms，切换行数不超过 7 行
    const canWave = previousIndex >= 0
        && (now - lastLyricChangeTs) >= WAVE_MIN_INTERVAL
        && lineDelta > 0
        && lineDelta <= WAVE_MAX_LINES;
    lastLyricChangeTs = now;
    lastActiveIndex = newIndex;

    const maxLines = getMaxLyricLines();

    // 小卡片高亮与滚动（弹簧物理，目标位置为容器高度的 38%）
    if (newIndex >= 0) {
        const activeEl = highlightActiveLyricLines(lyricsContentEl, '.lyric-line', newIndex, maxLines);
        if (activeEl) {
            animateLyricLine(activeEl, false);
            if (!userScrolling) {
                setSpringTarget(cardSpring, lyricsContentEl, targetOffsetFor(activeEl, lyricsWrapperEl));
            }
            if (canWave) applyWave(lyricsContentEl, '.lyric-line', newIndex, lineDelta, false);
        }
    } else {
        lyricsContentEl && lyricsContentEl.querySelectorAll('.lyric-line.active').forEach(el => el.classList.remove('active'));
    }

    // 全屏歌词高亮与滚动（同样使用弹簧物理与 38% 锚点）
    if (newIndex >= 0) {
        const fsActiveEl = highlightActiveLyricLines(fullscreenLyricsContentEl, '.fs-lyric-line', newIndex, maxLines);
        if (fsActiveEl) {
            animateLyricLine(fsActiveEl, true);
            if (!userScrolling) {
                setSpringTarget(fsSpring, fullscreenLyricsContentEl, targetOffsetFor(fsActiveEl, fullscreenLyricsWrapperEl));
            }
            if (canWave) applyWave(fullscreenLyricsContentEl, '.fs-lyric-line', newIndex, lineDelta, true);
        }
    } else {
        fullscreenLyricsContentEl && fullscreenLyricsContentEl.querySelectorAll('.fs-lyric-line.active').forEach(el => el.classList.remove('active'));
    }
}

// ============ 卡片歌词模式 ============
function openLyricsCard() {
    if (!playerState.currentTrackData) return;
    lyricsCardExpanded = true;
    lyricsAreaEl.classList.add('expanded');
    // 同步一次滚动位置
    if (parsedLyrics.length > 0) {
        currentLyricIndex = -1;
        updateLyricsScroll(audioManager.getCurrentTime() || 0);
    }
}

export function closeLyricsCard() {
    lyricsCardExpanded = false;
    lyricsAreaEl.classList.remove('expanded');
    // 收起后容器高度变化，平滑回正
    requestAnimationFrame(syncSpringTargets);
}

// 统一切换函数：折叠 → 全屏 → 折叠；卡片 → 折叠
// 顺序为"先全屏歌词再卡片歌词"：从折叠态点击先进入全屏，
// 全屏内的"卡片"按钮可再切到卡片，卡片内的"全屏"按钮可切回全屏。
export function toggleLyrics() {
    const isFullscreen = fullscreenLyricsEl.classList.contains('active');
    if (isFullscreen) {
        // 全屏 → 折叠
        closeFullscreenLyrics();
    } else if (lyricsCardExpanded) {
        // 卡片 → 折叠
        closeLyricsCard();
    } else {
        // 折叠 → 全屏（先全屏）
        openFullscreenLyrics();
    }
}

// ============ 全屏歌词模式 ============
function openFullscreenLyrics() {
    if (!playerState.currentTrackData) return;
    // 切换到全屏前收起卡片
    closeLyricsCard();
    fullscreenTrackNameEl.textContent = playerState.currentTrackData.name || t('common.unknown');
    applyMarquee(fullscreenTrackNameEl);
    fullscreenArtistNameEl.textContent = playerState.currentTrackData.artist || '--';
    fullscreenBgEl.style.backgroundImage = bgLayerEl.style.backgroundImage;
    fullscreenLyricsEl.classList.add('active');
    // 立即同步一次滚动位置
    if (parsedLyrics.length > 0) {
        currentLyricIndex = -1;
        updateLyricsScroll(audioManager.getCurrentTime() || 0);
    }
}

export function closeFullscreenLyrics() {
    fullscreenLyricsEl.classList.remove('active');
    requestAnimationFrame(syncSpringTargets);
}

// 从全屏切回卡片
function switchFullscreenToCard() {
    closeFullscreenLyrics();
    openLyricsCard();
}

export function isLyricsCardExpanded() {
    return lyricsCardExpanded;
}

export function isFullscreenLyricsOpen() {
    return fullscreenLyricsEl.classList.contains('active');
}

// 点击歌词预览区域 → toggle 歌词（折叠 → 全屏 → 折叠；卡片 → 折叠）
lyricsToggleEl.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleLyrics();
});

// 卡片歌词中的"全屏"按钮 → 切换到全屏歌词
expandFullscreenBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openFullscreenLyrics();
});

// 全屏歌词中的"卡片"按钮 → 切换回卡片歌词
collapseCardBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    switchFullscreenToCard();
});

// 点击全屏歌词任意处或按 Esc 退出（回到收起状态）
fullscreenLyricsEl.addEventListener('click', (e) => {
    // 点击歌词行本身不退出（让跳转逻辑生效）
    if (e.target.closest('.fs-lyric-line[data-time]')) return;
    // 点击切换按钮不退出
    if (e.target.closest('#collapseCardBtn')) return;
    closeFullscreenLyrics();
});

// 点击歌词区域外的空白处 → 收起卡片歌词
overlay.addEventListener('click', (e) => {
    if (!lyricsCardExpanded) return;
    // 点击歌词区域内的内容不收起（让卡片内部交互生效）
    if (e.target.closest('#lyricsArea')) return;
    closeLyricsCard();
});
