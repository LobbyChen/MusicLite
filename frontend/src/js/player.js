// player.js — 播放器视图（SPA overlay 模块）
// 与库视图共享同一个 window.audioManager，切换视图时 audio 不销毁，播放保持连续。
import { GetTrack, LoadSettings, GetNextTracks,GetPrevTracks, GetRandomTrack, RecordPlayStart, RecordPlayPause, SetApplicationVolume, GetApplicationVolume } from '../../wailsjs/go/main/App.js';
import { initI18n, t } from './i18n.js';

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
// 歌词翻找按钮（卡片 + 全屏）
const lyricPrevBtn = document.getElementById('lyricPrevBtn');
const lyricNextBtn = document.getElementById('lyricNextBtn');
const fsLyricPrevBtn = document.getElementById('fsLyricPrevBtn');
const fsLyricNextBtn = document.getElementById('fsLyricNextBtn');

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

// 使用全局音频管理器（与库页面共享同一个 audio 实例，跨视图持久）
const audio = window.audioManager.audio;

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
            if (!isNaN(time) && audio.duration) {
                audio.currentTime = time;
            }
        });
    });

    // 全屏歌词点击跳转
    fullscreenLyricsContentEl.querySelectorAll('.fs-lyric-line[data-time]').forEach(el => {
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            const time = parseFloat(el.dataset.time);
            if (!isNaN(time) && audio.duration) {
                audio.currentTime = time;
            }
        });
    });

    currentLyricIndex = -1;
    updateLyricsScroll(audio.currentTime || 0);
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

    // 更新小卡片预览
    if (newIndex >= 0 && parsedLyrics[newIndex]) {
        lyricsPreviewEl.textContent = parsedLyrics[newIndex].text;
        lyricsPreviewEl.classList.add('active');
    } else {
        lyricsPreviewEl.textContent = parsedLyrics[0] ? parsedLyrics[0].text : t('player.noLyrics');
        lyricsPreviewEl.classList.remove('active');
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
        updateLyricsScroll(audio.currentTime || 0);
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
        updateLyricsScroll(audio.currentTime || 0);
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
// 跳转 audio.currentTime 到目标歌词时间，并立即手动刷新高亮（不等 timeupdate）
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
        audio.currentTime = targetTime;
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

// 歌词翻找按钮（卡片 + 全屏，点击不冒泡，避免触发"点击空白收起"逻辑）
[lyricPrevBtn, lyricNextBtn, fsLyricPrevBtn, fsLyricNextBtn].forEach(btn => {
    if (!btn) return;
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const direction = (btn === lyricPrevBtn || btn === fsLyricPrevBtn) ? -1 : 1;
        seekLyric(direction);
    });
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

// 同步 audio 实际播放状态到 UI
function syncPlayState() {
    if (!audio.paused && audio.src) {
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
    const mode = window.audioManager.getPlayMode();

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

function playAudio() {
    const playPromise = audio.play();
    if (playPromise !== undefined) {
        playPromise.then(_ => {
            syncPlayState();
        }).catch(error => {
            if (error.name !== 'AbortError') {
                console.error("Playback failed:", error);
            }
            syncPlayState();
        });
    }
}

function togglePlay() {
    if (audio.paused) {
        playAudio();
    } else {
        audio.pause();
    }
}

function togglePlayMode() {
    window.audioManager.togglePlayMode();
    syncPlayModeState();
}

async function playPrevTrack() {
    if (!currentTrackData || !currentTrackData.id) {
        console.warn("No current track to determine prev track");
        return;
    }
    try {
        const mode = window.audioManager.getPlayMode();
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
        const mode = window.audioManager.getPlayMode();
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
    if (isSeeking || !audio.duration || isNaN(audio.duration)) return;
    const progressPercent = (audio.currentTime / audio.duration) * 100;
    seekSlider.value = progressPercent;
    currentTimeEl.textContent = formatTime(audio.currentTime);
    totalDurationEl.textContent = formatTime(audio.duration);
    updateProgressFill('seekProgress', progressPercent);
    updateLyricsScroll(audio.currentTime);
    if (seekSlider.disabled) seekSlider.disabled = false;
}

// ============ 进度条平滑滚动（rAF 循环） ============
// timeupdate 事件约 250ms 触发一次，进度条会"一跳一跳"。
// 播放期间用 requestAnimationFrame 每帧根据 audio.currentTime 更新 fill 和 thumb，
// 两者同源（都用 audio.currentTime 计算）保证完全同步。
let progressRafId = null;
function startSmoothProgress() {
    if (progressRafId) return;
    const tick = () => {
        // 拖动中或无时长时停止平滑更新，交给 timeupdate
        if (isSeeking || !audio.duration || isNaN(audio.duration) || audio.paused) {
            progressRafId = null;
            return;
        }
        const percent = (audio.currentTime / audio.duration) * 100;
        // fill 和 thumb 同源同步更新
        seekSlider.value = percent;
        updateProgressFill('seekProgress', percent);
        currentTimeEl.textContent = formatTime(audio.currentTime);
        updateLyricsScroll(audio.currentTime);
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

function setProgress() {
    if (!audio.duration || isNaN(audio.duration)) return;
    const newTime = (seekSlider.value / 100) * audio.duration;
    audio.currentTime = newTime;
}

function setVolume() {
    const vol = parseInt(volSlider.value, 10);
    updateProgressFill('volProgress', volSlider.value);
    // 控制 Windows 系统合成器本程序音量（不再是 audio.volume）
    SetApplicationVolume(vol).catch(() => {});
    if (window.audioManager) {
        localStorage.setItem('volume', vol.toString());
    }
}

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

    // 共享 audioManager：仅在曲目变化时重新加载，保持同曲播放连续
    if (window.audioManager) {
        const savedTrackJson = localStorage.getItem('currentTrack');
        const savedTrack = savedTrackJson ? JSON.parse(savedTrackJson) : null;
        const isAlreadyLoaded = savedTrack && savedTrack.id === data.id;
        if (!isAlreadyLoaded) {
            // 不同曲目：正常加载（会重置播放位置）
            window.audioManager.loadTrack(data);
        }
    }

    renderLyrics(parseLyrics(data.lyrics));
    seekSlider.value = 0;
    currentTimeEl.textContent = "0:00";
    totalDurationEl.textContent = "0:00";
    updateProgressFill('seekProgress', 0);
    syncPlayState();
    syncPlayModeState();
    if (audio.duration && !isNaN(audio.duration)) {
        seekSlider.disabled = false;
        totalDurationEl.textContent = formatTime(audio.duration);
        updateProgress();
    }
}

// ============ 事件绑定（只绑定一次） ============
playBtn.addEventListener('click', togglePlay);
loopBtn.addEventListener('click', togglePlayMode);
backBtn.addEventListener('click', closePlayer);

audio.addEventListener('timeupdate', updateProgress);
audio.addEventListener('loadedmetadata', () => {
    totalDurationEl.textContent = formatTime(audio.duration);
    if (!audio.paused) seekSlider.disabled = false;
    // overlay 打开时同步一次进度
    if (overlay.classList.contains('active')) updateProgress();
});
audio.addEventListener('play', () => {
    syncPlayState();
    startSmoothProgress(); // 播放时启动平滑进度更新
    // 听歌时长统计：记录开始播放时间
    // 优先使用 currentTrackData，回退到 audioManager.currentTrack（恢复播放时 currentTrackData 可能为 null）
    const track = currentTrackData || (window.audioManager && window.audioManager.currentTrack);
    if (track && track.id) {
        RecordPlayStart(track.id).catch((e) => console.warn('RecordPlayStart failed:', e));
    }
});
nextBtn.addEventListener('click', playNextTrack);
prevBtn.addEventListener('click', playPrevTrack);
audio.addEventListener('pause', () => {
    syncPlayState();
    stopSmoothProgress(); // 暂停时停止平滑更新，最终状态由 timeupdate 兜底
    // 听歌时长统计：计算本次播放时长并写入注册表
    const track = currentTrackData || (window.audioManager && window.audioManager.currentTrack);
    if (track && track.id) {
        RecordPlayPause(track.id).catch((e) => console.warn('RecordPlayPause failed:', e));
    }
});
audio.addEventListener('error', (e) => {
    console.error("Audio Load Error:", e);
    trackNameEl.textContent = "Load Error";
    seekSlider.disabled = true;
});

audio.addEventListener('ended', async () => {
    // 听歌时长统计：播放结束也需记录（ended 不会触发 pause 事件）
    const track = currentTrackData || (window.audioManager && window.audioManager.currentTrack);
    if (track && track.id) {
        RecordPlayPause(track.id).catch((e) => console.warn('RecordPlayPause failed:', e));
    }
    const mode = window.audioManager.getPlayMode();

    // 单曲循环由 audioManager 内部处理，这里不需要操作
    if (mode === 'loopOne') {
        return;
    }

    // 随机或顺序模式下，自动播放下一首
    await playNextTrack();
});

seekSlider.addEventListener('mousedown', () => { isSeeking = true; });
seekSlider.addEventListener('touchstart', () => { isSeeking = true; });
seekSlider.addEventListener('input', () => {
    const percent = seekSlider.value;
    updateProgressFill('seekProgress', percent);
    if (audio.duration && !isNaN(audio.duration)) {
        const previewTime = (percent / 100) * audio.duration;
        currentTimeEl.textContent = formatTime(previewTime);
    }
});

const finishSeeking = () => {
    isSeeking = false;
    setProgress();
    // 拖动结束后，若仍在播放，重启平滑更新
    if (!audio.paused) startSmoothProgress();
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
        e.preventDefault();
        togglePlay();
    }
    if (e.code === 'Escape') {
        if (fullscreenLyricsEl.classList.contains('active')) {
            closeFullscreenLyrics();
        } else if (lyricsCardExpanded) {
            closeLyricsCard();
        }
    }
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

    // 同步音量到滑块 — 从 Windows 系统合成器读取本程序音量
    try {
        const sysVol = await GetApplicationVolume();
        volSlider.value = sysVol;
        updateProgressFill('volProgress', volSlider.value);
        localStorage.setItem('volume', sysVol.toString());
    } catch (e) {
        // 读取系统音量失败，回退到 localStorage 或默认值
        const savedVolume = localStorage.getItem('volume');
        volSlider.value = savedVolume ? parseInt(savedVolume, 10) : 70;
        updateProgressFill('volProgress', volSlider.value);
    }

    if (!trackId) {
        trackNameEl.textContent = "未指定曲目";
        artistNameEl.textContent = "";
        return true;
    }

    try {
        const track = await GetTrack(Number(trackId));
        // loadTrack 内部会判断同曲不重载 audio，保持同曲播放连续
        loadTrack(track);
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
}

export { openPlayer, closePlayer };