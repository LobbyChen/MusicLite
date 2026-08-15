// player.js — 播放器视图（SPA overlay 模块）
// 与库视图共享同一个 window.audioManager，切换视图时后端播放不中断，保持连续。
// 音频解码与输出全部在 Go 后端完成，本视图只负责 UI 控制与状态展示，
// 通过 audioManager（订阅后端 Wails Events）获取播放状态。
import { GetTrack, GetNextTracks, GetPrevTracks, GetRandomTrack, QueueGetStatus, QueueGetNext, QueueGetPrev } from '@bindings/MusicLite/app/musicservice.js';
import { initI18n, t } from './i18n.js';
import { EqualizerPanel } from './equalizer.js';
import { QueuePanel } from './queue.js';

// ============ 长歌名滚动显示：检测溢出后用 Web Animations API 驱动滚动 ============
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

// ============ DOM 元素（来自 libraries.html 的 player-overlay） ============
const overlay = document.getElementById('player-overlay');
const playBtn = document.getElementById('playBtn');
const playIcon = document.getElementById('playIcon');
const pauseIcon = document.getElementById('pauseIcon');
const loopBtn = document.getElementById('loopBtn');
const seekSlider = document.getElementById('seekSlider');
const volSlider = document.getElementById('volSlider');
const currentTimeEl = document.getElementById('currentTime');
const totalDurationEl = document.getElementById('totalDuration');
const trackNameEl = document.getElementById('trackName');
const artistNameEl = document.getElementById('artistName');
const coverImgEl = document.getElementById('coverImg');
const bgLayerEl = document.getElementById('bgLayer');
const lyricsAreaEl = document.getElementById('lyricsArea');
const lyricsToggleEl = document.getElementById('lyricsToggle');
const lyricsCardEl = document.getElementById('lyricsCard');
const lyricsContentEl = document.getElementById('lyricsContent');
const lyricsWrapperEl = document.getElementById('lyricsWrapper');
const lyricsPreviewEl = document.getElementById('lyricsPreview');
const backBtn = document.getElementById('backBtn');
const prevBtn = document.getElementById("prevBtn")
const nextBtn = document.getElementById('nextBtn');
// 模式切换按钮
const expandFullscreenBtn = document.getElementById('expandFullscreenBtn');
const collapseCardBtn = document.getElementById('collapseCardBtn');
// 全屏歌词 DOM
const fullscreenLyricsEl = document.getElementById('fullscreenLyrics');
const fullscreenBgEl = document.getElementById('fullscreenBg');
const fullscreenTrackNameEl = document.getElementById('fullscreenTrackName');
const fullscreenArtistNameEl = document.getElementById('fullscreenArtistName');
const fullscreenLyricsWrapperEl = document.getElementById('fullscreenLyricsWrapper');
const fullscreenLyricsContentEl = document.getElementById('fullscreenLyricsContent');

// 全局状态
let currentTrackData = null;
let isSeeking = false;
let parsedLyrics = [];
let currentLyricIndex = -1;
let lyricsCardExpanded = false; // 卡片歌词展开状态

// 使用全局音频管理器（后端驱动的播放状态，跨视图持久）
// audioManager 是后端播放状态的唯一前端入口：getCurrentTime/getDuration/isPlaying/play/pause/seek 等
const audioManager = window.audioManager;

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

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============ 渲染歌词（同时渲染小卡片和全屏） ============
function renderLyrics(lyricsArray) {
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

function updateLyricsScroll(currentTime) {
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

    if (newIndex === currentLyricIndex) return;
    currentLyricIndex = newIndex;

    const maxLines = getMaxLyricLines();

    // 小卡片高亮与滚动（用 offsetTop/offsetHeight 实测精准居中，避免硬编码行高不准）
    if (newIndex >= 0) {
        const activeEl = highlightActiveLyricLines(lyricsContentEl, '.lyric-line', newIndex, maxLines);
        if (activeEl) {
            animateLyricLine(activeEl, false);
            const wrapperHeight = lyricsWrapperEl.clientHeight;
            const targetOffset = activeEl.offsetTop + activeEl.offsetHeight / 2 - wrapperHeight / 2;
            lyricsContentEl.style.transform = `translateY(${-targetOffset}px)`;
        }
    } else {
        lyricsContentEl && lyricsContentEl.querySelectorAll('.lyric-line.active').forEach(el => el.classList.remove('active'));
    }

    // 全屏歌词高亮与滚动（同样用实测偏移精准居中）
    if (newIndex >= 0) {
        const fsActiveEl = highlightActiveLyricLines(fullscreenLyricsContentEl, '.fs-lyric-line', newIndex, maxLines);
        if (fsActiveEl) {
            animateLyricLine(fsActiveEl, true);
            const wrapperHeight = fullscreenLyricsWrapperEl.clientHeight;
            const targetOffset = fsActiveEl.offsetTop + fsActiveEl.offsetHeight / 2 - wrapperHeight / 2;
            fullscreenLyricsContentEl.style.transform = `translateY(${-targetOffset}px)`;
        }
    } else {
        fullscreenLyricsContentEl && fullscreenLyricsContentEl.querySelectorAll('.fs-lyric-line.active').forEach(el => el.classList.remove('active'));
    }
}

// ============ 卡片歌词模式 ============
function openLyricsCard() {
    if (!currentTrackData) return;
    lyricsCardExpanded = true;
    lyricsAreaEl.classList.add('expanded');
    // 同步一次滚动位置
    if (parsedLyrics.length > 0) {
        currentLyricIndex = -1;
        updateLyricsScroll(audioManager.getCurrentTime() || 0);
    }
}

function closeLyricsCard() {
    lyricsCardExpanded = false;
    lyricsAreaEl.classList.remove('expanded');
}

// 统一切换函数：折叠 → 全屏 → 折叠；卡片 → 折叠
// 顺序为"先全屏歌词再卡片歌词"：从折叠态点击先进入全屏，
// 全屏内的"卡片"按钮可再切到卡片，卡片内的"全屏"按钮可切回全屏。
function toggleLyrics() {
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
    if (!currentTrackData) return;
    // 切换到全屏前收起卡片
    closeLyricsCard();
    fullscreenTrackNameEl.textContent = currentTrackData.name || t('common.unknown');
    applyMarquee(fullscreenTrackNameEl);
    fullscreenArtistNameEl.textContent = currentTrackData.artist || '--';
    fullscreenBgEl.style.backgroundImage = bgLayerEl.style.backgroundImage;
    fullscreenLyricsEl.classList.add('active');
    // 立即同步一次滚动位置
    if (parsedLyrics.length > 0) {
        currentLyricIndex = -1;
        updateLyricsScroll(audioManager.getCurrentTime() || 0);
    }
}

function closeFullscreenLyrics() {
    fullscreenLyricsEl.classList.remove('active');
}

// 从全屏切回卡片
function switchFullscreenToCard() {
    closeFullscreenLyrics();
    openLyricsCard();
}

// ============ 歌词翻找（上一句 / 下一句） ============
// direction: -1 = 上一句, +1 = 下一句
// 跳转到目标歌词时间，并立即手动刷新高亮（不等 timeupdate）
function seekLyric(direction) {
    if (!parsedLyrics || parsedLyrics.length === 0) return;
    let targetIndex;
    if (direction < 0) {
        // 上一句：当前未开始或第一句 → 跳到第一句；否则跳到前一句
        targetIndex = currentLyricIndex <= 0 ? 0 : currentLyricIndex - 1;
    } else {
        // 下一句：当前是最后一句 → 停留在最后一句；否则跳到下一句
        targetIndex = Math.min(currentLyricIndex + 1, parsedLyrics.length - 1);
        if (currentLyricIndex < 0) targetIndex = 0;
    }
    const targetTime = parsedLyrics[targetIndex].time;
    if (!isNaN(targetTime)) {
        audioManager.seek(targetTime);
    }
    // 手动刷新一次高亮和滚动，避免等待 timeupdate（~250ms 延迟）
    updateLyricsScroll(targetTime);
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

// ============ 进度与音量工具函数 ============
function formatTime(seconds) {
    if (isNaN(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

function updateProgressFill(elementId, percent) {
    const fillEl = document.getElementById(elementId);
    if (!fillEl) return;
    if (isNaN(percent)) percent = 0;
    if (percent < 0) percent = 0;
    if (percent > 100) percent = 100;
    fillEl.style.width = `${percent}%`;
}

// 同步播放状态到 UI（基于后端 audioManager 状态，前端只读）
function syncPlayState() {
    if (audioManager.isPlaying() && audioManager.currentTrack) {
        playIcon.style.display = 'none';
        pauseIcon.style.display = 'block';
        playBtn.classList.add('btn-pause');
    } else {
        playIcon.style.display = 'block';
        pauseIcon.style.display = 'none';
        playBtn.classList.remove('btn-pause');
    }
}

// 同步播放模式按钮状态
function syncPlayModeState() {
    const mode = audioManager.getPlayMode();

    // 重置类名
    loopBtn.classList.remove('active-loop-one', 'active-random');

    if (mode === 'loopOne') {
        loopBtn.classList.add('active-loop-one');
        loopBtn.title = "当前: 单曲循环";
    } else if (mode === 'random') {
        loopBtn.classList.add('active-random');
        loopBtn.title = "当前: 随机播放";
    } else {
        loopBtn.title = "当前: 顺序播放";
    }
}

// playAudio：恢复播放（后端处理听歌时长记录，前端无需调用 RecordPlayStart）
function playAudio() {
    audioManager.play();
}

function togglePlay() {
    if (audioManager.isPlaying()) {
        audioManager.pause();
    } else {
        playAudio();
    }
}

// togglePlayMode：await 后端切换完成再同步 UI，避免读到旧模式
async function togglePlayMode() {
    await audioManager.togglePlayMode();
    syncPlayModeState();
}

async function playPrevTrack() {
    if (!currentTrackData || !currentTrackData.id) {
        console.warn("No current track to determine prev track");
        return;
    }
    try {
        // 队列优先：队列有多首时从队列取上一首
        const qStatus = await QueueGetStatus();
        if (qStatus && qStatus.count > 1) {
            const prevTrack = await QueueGetPrev();
            if (prevTrack && prevTrack.id) {
                loadTrack(prevTrack);
                playAudio();
                return;
            }
        }

        // 队列为空或只有一首：走库随机/顺序
        const mode = await window.audioManager.fetchPlayMode();
        let prevTrack = null;

        if (mode === 'random') {
            prevTrack = await GetRandomTrack(currentTrackData.id);
        } else {
            // 顺序模式或默认模式
            prevTrack = await GetPrevTracks(currentTrackData.id);
        }

        // 检查是否返回了有效数据
        if (prevTrack && prevTrack.id) {
            loadTrack(prevTrack);
            playAudio(); // 自动播放上一首
        } else {
            console.log("Reached end of playlist or no next track found.");
        }
    } catch (err) {
        console.error("Failed to get next track:", err);
    }
}

async function playNextTrack() {
    if (!currentTrackData || !currentTrackData.id) {
        console.warn("No current track to determine next track");
        return;
    }

    try {
        // 队列优先：队列有多首时从队列取下一首
        const qStatus = await QueueGetStatus();
        if (qStatus && qStatus.count > 1) {
            const nextTrack = await QueueGetNext();
            if (nextTrack && nextTrack.id) {
                loadTrack(nextTrack);
                playAudio();
                return;
            }
        }

        // 队列为空或只有一首：走库随机/顺序
        const mode = await window.audioManager.fetchPlayMode();
        let nextTrack = null;

        if (mode === 'random') {
            nextTrack = await GetRandomTrack(currentTrackData.id);
        } else {
            // 顺序模式或默认模式
            nextTrack = await GetNextTracks(currentTrackData.id);
        }

        // 检查是否返回了有效数据
        if (nextTrack && nextTrack.id) {
            loadTrack(nextTrack);
            playAudio(); // 自动播放下一首
        } else {
            console.log("Reached end of playlist or no next track found.");
        }
    } catch (err) {
        console.error("Failed to get next track:", err);
    }
}

function updateProgress() {
    const duration = audioManager.getDuration();
    const currentTime = audioManager.getCurrentTime();
    if (isSeeking || !duration || isNaN(duration)) return;
    const progressPercent = (currentTime / duration) * 100;
    seekSlider.value = progressPercent;
    currentTimeEl.textContent = formatTime(currentTime);
    totalDurationEl.textContent = formatTime(duration);
    updateProgressFill('seekProgress', progressPercent);
    updateLyricsScroll(currentTime);
    if (seekSlider.disabled) seekSlider.disabled = false;
}

// ============ 进度条平滑滚动（rAF 循环） ============
// 后端 player:timeupdate 事件约 250ms 推送一次，进度条会"一跳一跳"。
// 播放期间用 requestAnimationFrame 每帧根据本地插值估算位置更新 fill 和 thumb，
// 每 250ms 用后端推送的真实位置校正一次（timeupdate 事件触发 updateProgress）。
let progressRafId = null;
// 上次后端推送的位置与时间戳，用于帧间线性插值
let lastSyncPos = 0;
let lastSyncTs = 0;
// 上次写入的时间文本，避免每帧重复写 textContent（formatTime 只精确到秒，
// 但 rAF 每帧调用，无缓存会持续触发 DOM 标记）
let lastTimeText = '';
function startSmoothProgress() {
    if (progressRafId) return;
    lastSyncPos = audioManager.getCurrentTime();
    lastSyncTs = performance.now();
    const tick = () => {
        // 拖动中 / 无时长 / 暂停时停止平滑更新，交给 timeupdate
        const duration = audioManager.getDuration();
        if (isSeeking || !duration || isNaN(duration) || !audioManager.isPlaying()) {
            progressRafId = null;
            return;
        }
        // 帧间插值：按经过真实时间估算当前位置
        const elapsed = (performance.now() - lastSyncTs) / 1000;
        const estimated = lastSyncPos + elapsed;
        const clamped = Math.min(estimated, duration);
        const percent = (clamped / duration) * 100;
        seekSlider.value = percent;
        updateProgressFill('seekProgress', percent);
        // 时间文本只在变化时写入（每秒一次），避免 60fps 重复 DOM 写入
        const timeText = formatTime(clamped);
        if (timeText !== lastTimeText) {
            currentTimeEl.textContent = timeText;
            lastTimeText = timeText;
        }
        updateLyricsScroll(clamped);
        progressRafId = requestAnimationFrame(tick);
    };
    progressRafId = requestAnimationFrame(tick);
}
function stopSmoothProgress() {
    if (progressRafId) {
        cancelAnimationFrame(progressRafId);
        progressRafId = null;
    }
}

// 后端推送 timeupdate 时，刷新插值锚点（让下一帧从真实位置继续估算）
function syncProgressAnchor() {
    lastSyncPos = audioManager.getCurrentTime();
    lastSyncTs = performance.now();
}

function setProgress() {
    const duration = audioManager.getDuration();
    if (!duration || isNaN(duration)) return;
    const newTime = (seekSlider.value / 100) * duration;
    audioManager.seek(newTime);
    // seek 后立即更新插值锚点，避免平滑滚动回跳
    lastSyncPos = newTime;
    lastSyncTs = performance.now();
}

function setVolume() {
    const vol = parseInt(volSlider.value, 10);
    updateProgressFill('volProgress', volSlider.value);
    // 按 volume_mode 路由（synth→后端 Player / master→系统主音量），由 audioManager 统一处理
    audioManager.setVolume(vol);
}

// 监听音量模式切换（设置页切换 synth/master 后，同步滑块到新模式下的真实音量）
audioManager.on('volumemodechange', () => {
    const realVol = audioManager.getVolume();
    volSlider.value = realVol;
    updateProgressFill('volProgress', volSlider.value);
});
audioManager.on('volumechange', (vol) => {
    volSlider.value = vol;
    updateProgressFill('volProgress', volSlider.value);
});

// ============ 核心：加载单个轨道 ============
function loadTrack(data) {
    currentTrackData = data;
    trackNameEl.textContent = data.name || t('common.unknown');
    applyMarquee(trackNameEl);
    document.title = trackNameEl.textContent;
    artistNameEl.textContent = data.artist || t('common.unknownArtist');
    const imgUrl = data.cover || "";
    if (imgUrl) {
        coverImgEl.innerHTML = `<img src="${imgUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;" />`;
    } else {
        coverImgEl.innerHTML = '<div class="card-icon"><svg viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"></path></svg></div>';
    }
    coverImgEl.style.display = 'flex';
    bgLayerEl.style.backgroundImage = imgUrl ? `url('${imgUrl}')` : 'none';

    // 根据封面亮度自动调整播放器文字对比度（避免封面背景导致控件看不清）
    const pc = window.MusicLiteSettings?.PlayerContrast;
    if (pc) pc.adjustFromCover(imgUrl);

    // 委托后端加载：audioManager.loadTrack 内部会判断同曲不重载（保持同曲播放连续）
    // 加载后处于暂停态，需调用 playAudio() 开始播放
    audioManager.loadTrack(data);

    renderLyrics(parseLyrics(data.lyrics));
    seekSlider.value = 0;
    currentTimeEl.textContent = "0:00";
    totalDurationEl.textContent = "0:00";
    updateProgressFill('seekProgress', 0);
    syncPlayState();
    syncPlayModeState();
    // 若后端已有该曲目时长（同曲重入），立即同步
    const dur = audioManager.getDuration();
    if (dur && !isNaN(dur)) {
        seekSlider.disabled = false;
        totalDurationEl.textContent = formatTime(dur);
        updateProgress();
    }
}

// ============ 事件绑定（只绑定一次） ============
playBtn.addEventListener('click', togglePlay);
loopBtn.addEventListener('click', togglePlayMode);
backBtn.addEventListener('click', closePlayer);

// 后端播放模式变更（其他页面切换或后端主动变更时，同步本页 UI）
audioManager.on('modechange', () => {
    syncPlayModeState();
});

// 后端状态事件（替代原生 audio 元素事件）
// timeupdate：周期推送播放位置，更新进度并刷新插值锚点
audioManager.on('timeupdate', () => {
    syncProgressAnchor();
    updateProgress();
});
// loadedmetadata：后端解码完成，时长就绪
audioManager.on('loadedmetadata', () => {
    const dur = audioManager.getDuration();
    totalDurationEl.textContent = formatTime(dur);
    if (audioManager.isPlaying()) seekSlider.disabled = false;
    // overlay 打开时同步一次进度
    if (overlay.classList.contains('active')) updateProgress();
});
// play：后端进入播放态（听歌时长由后端 RecordPlayStart 记录，前端无需调用）
audioManager.on('play', () => {
    syncPlayState();
    startSmoothProgress();
});
nextBtn.addEventListener('click', playNextTrack);
prevBtn.addEventListener('click', playPrevTrack);
// pause：后端进入暂停态（听歌时长由后端 RecordPlayPause 记录）
audioManager.on('pause', () => {
    syncPlayState();
    stopSmoothProgress();
});
// trackcleared：曲目被删除/清除时，清理播放器 UI
audioManager.on('trackcleared', () => {
    currentTrackData = null;
    trackNameEl.textContent = '';
    artistNameEl.textContent = '';
    totalDurationEl.textContent = '0:00';
    currentTimeEl.textContent = '0:00';
    seekSlider.value = 0;
    seekSlider.disabled = true;
    if (coverImgEl) coverImgEl.src = '';
    if (bgLayerEl) bgLayerEl.style.backgroundImage = '';
    stopSmoothProgress();
    syncPlayState();
});
// error：后端解码/播放错误
audioManager.on('error', (e) => {
    console.error("Playback Error:", e);
    trackNameEl.textContent = "Load Error";
    seekSlider.disabled = true;
});

// ended：后端单曲循环已在 player.go 内处理，此处仅处理顺序/随机模式的下一首
audioManager.on('ended', async () => {
    // 从后端确认最新模式，避免前端缓存滞后（单曲循环不应到达此处，但防御性检查）
    const mode = await audioManager.fetchPlayMode();
    if (mode === 'loopOne') {
        return;
    }
    // 随机或顺序模式下，自动播放下一首
    await playNextTrack();
});

// trackloaded：后端加载新曲完成，同步 UI
audioManager.on('trackloaded', (track) => {
    if (!track) return;
    // 后端主动加载（如 QueueJumpTo）时，前端需完整更新封面/背景/歌词/信息
    if (!currentTrackData || currentTrackData.id !== track.id) {
        loadTrack(track);
    }
    syncPlayState();
    syncPlayModeState();
    // 同步队列当前指针（切歌时高亮新的当前项）
    try { QueuePanel.refresh(); } catch (e) {}
});

seekSlider.addEventListener('mousedown', () => { isSeeking = true; });
seekSlider.addEventListener('touchstart', () => { isSeeking = true; });
seekSlider.addEventListener('input', () => {
    const percent = seekSlider.value;
    updateProgressFill('seekProgress', percent);
    const dur = audioManager.getDuration();
    if (dur && !isNaN(dur)) {
        const previewTime = (percent / 100) * dur;
        currentTimeEl.textContent = formatTime(previewTime);
    }
});

const finishSeeking = () => {
    isSeeking = false;
    setProgress();
    // 拖动结束后，若仍在播放，重启平滑更新
    if (audioManager.isPlaying()) startSmoothProgress();
};
seekSlider.addEventListener('change', finishSeeking);
seekSlider.addEventListener('mouseup', finishSeeking);
seekSlider.addEventListener('touchend', finishSeeking);
seekSlider.addEventListener('touchcancel', finishSeeking);

volSlider.addEventListener('input', setVolume);

document.addEventListener('keydown', (e) => {
    // 仅在播放器视图激活时响应快捷键
    if (!overlay.classList.contains('active')) return;
    if (e.code === 'Space') {
        // 浮层面板打开时，空格不触发播放（避免与滑块/按钮冲突）
        if (!EqualizerPanel.getIsOpen() && !QueuePanel.getIsOpen()) {
            e.preventDefault();
            togglePlay();
        }
    }
    if (e.code === 'Escape') {
        // 优先关闭浮层（均衡器/队列），其次全屏歌词/卡片歌词
        if (EqualizerPanel.getIsOpen()) { EqualizerPanel.close(); e.preventDefault(); return; }
        if (QueuePanel.getIsOpen()) { QueuePanel.close(); e.preventDefault(); return; }
        if (fullscreenLyricsEl.classList.contains('active')) {
            closeFullscreenLyrics();
        } else if (lyricsCardExpanded) {
            closeLyricsCard();
        }
    }
});

// ============ 浮层（EQ / 队列）空白区域关闭 ============
// 点击 overlay 内、但不在任何浮层或交互控件上时，关闭已打开的浮层
overlay.addEventListener('click', (e) => {
    // 只在浮层打开时才拦截
    if (!EqualizerPanel.getIsOpen() && !QueuePanel.getIsOpen()) return;
    // 点击在浮层内部 → 不关闭（各面板自身 stopPropagation 兜底）
    if (e.target.closest('#eqPanel') || e.target.closest('#queuePanel')) return;
    // 点击在触发按钮上 → 不关闭（按钮自身会 toggle）
    if (e.target.closest('#eqBtn') || e.target.closest('#queueBtn')) return;
    EqualizerPanel.close();
    QueuePanel.close();
});

// ============ 导出：打开/关闭播放器视图 ============
async function openPlayer(trackId) {
    // 阻止触摸板双指缩放（ctrl+wheel）及键盘缩放快捷键
    if (!window.__zoomBlocked) {
        window.addEventListener('wheel', (e) => {
            if (e.ctrlKey) e.preventDefault();
        }, { passive: false });
        window.addEventListener('keydown', (e) => {
            if (e.ctrlKey && ['=', '+', '-', '0'].includes(e.key)) e.preventDefault();
        });
        window.__zoomBlocked = true;
    }

    // 先初始化 i18n（从后端加载翻译数据），确保 t() 能拿到正确文案
    await initI18n();
    // 删除检查：若曲目不存在则不打开播放器
    if (trackId) {
        try {
            await GetTrack(Number(trackId));
        } catch (err) {
            // 曲目已删除，清理状态并通知
            console.warn('Track not found, clearing:', err);
            window.audioManager.clearTrack();
            return false;
        }
    }

    // 显示 overlay（带过渡动画）
    overlay.classList.add('active');
    document.body.classList.add('player-active');
    syncPlayModeState();

    // 初始化均衡器与队列面板（仅首次打开时初始化一次）
    try { await EqualizerPanel.init(); } catch (e) { console.warn('EqualizerPanel init:', e); }
    try { await QueuePanel.init(); } catch (e) { console.warn('QueuePanel init:', e); }
    // 每次打开播放器时刷新队列（显示最新状态）
    try { await QueuePanel.refresh(); } catch (e) {}

    // 同步音量到滑块 — 从后端 Player 读取当前音量（synth 模式由后端控制）
    const curVol = audioManager.getVolume();
    volSlider.value = curVol;
    updateProgressFill('volProgress', volSlider.value);
    try { localStorage.setItem('volume', curVol.toString()); } catch (e) {}

    if (!trackId) {
        trackNameEl.textContent = "未指定曲目";
        artistNameEl.textContent = "";
        return true;
    }

    try {
        const track = await GetTrack(Number(trackId));
        // loadTrack 内部委托 audioManager.loadTrack，同曲不重载，保持同曲播放连续
        loadTrack(track);
        // 若后端已在播放该曲目（跨页恢复），同步一次进度与状态
        if (audioManager.isPlaying()) {
            updateProgress();
            startSmoothProgress();
        }
        return true;
    } catch (err) {
        console.error("加载曲目失败:", err);
        trackNameEl.textContent = "加载失败";
        artistNameEl.textContent = String(err);
        return false;
    }
}

function closePlayer() {
    overlay.classList.remove('active');
    document.body.classList.remove('player-active');
    closeFullscreenLyrics();
    closeLyricsCard();
    EqualizerPanel.close();
    QueuePanel.close();
}

export { openPlayer, closePlayer };