// player.js — 播放器视图（SPA overlay 模块）
// 与库视图共享同一个 window.audioManager，切换视图时 audio 不销毁，播放保持连续。
import { GetTrack, LoadSettings ,GetNextTracks} from '../../wailsjs/go/main/App.js';

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

// 模式切换按钮
const expandFullscreenBtn = document.getElementById('expandFullscreenBtn');
const collapseCardBtn = document.getElementById('collapseCardBtn');
const nextBtn = document.getElementById('nextBtn');

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
        lyricsContentEl.innerHTML = '<div class="no-lyrics">暂无歌词</div>';
        lyricsPreviewEl.textContent = '暂无歌词';
        lyricsPreviewEl.classList.remove('active');
        // 全屏
        fullscreenLyricsContentEl.innerHTML = '<div class="no-lyrics">暂无歌词</div>';
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

// ============ 歌词滚动与高亮 ============
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
        lyricsPreviewEl.textContent = parsedLyrics[0] ? parsedLyrics[0].text : '暂无歌词';
        lyricsPreviewEl.classList.remove('active');
    }

    if (newIndex === currentLyricIndex) return;
    currentLyricIndex = newIndex;

    // 小卡片高亮与滚动
    lyricsContentEl.querySelectorAll('.lyric-line.active').forEach(el => el.classList.remove('active'));
    if (newIndex >= 0) {
        const activeEl = lyricsContentEl.querySelector(`.lyric-line[data-index="${newIndex}"]`);
        if (activeEl) {
            activeEl.classList.add('active');
            const lineHeight = 30;
            const wrapperHeight = lyricsWrapperEl.clientHeight;
            const targetOffset = (newIndex + 2) * lineHeight - wrapperHeight / 2 + lineHeight / 2;
            lyricsContentEl.style.transform = `translateY(${-targetOffset}px)`;
        }
    }

    // 全屏歌词高亮与滚动
    fullscreenLyricsContentEl.querySelectorAll('.fs-lyric-line.active').forEach(el => el.classList.remove('active'));
    if (newIndex >= 0) {
        const fsActiveEl = fullscreenLyricsContentEl.querySelector(`.fs-lyric-line[data-index="${newIndex}"]`);
        if (fsActiveEl) {
            fsActiveEl.classList.add('active');
            const lineHeight = 56;
            const wrapperHeight = fullscreenLyricsWrapperEl.clientHeight;
            const targetOffset = (newIndex + 4) * lineHeight - wrapperHeight / 2 + lineHeight / 2;
            fullscreenLyricsContentEl.style.transform = `translateY(${-targetOffset}px)`;
        }
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

function toggleLyricsCard() {
    if (lyricsCardExpanded) {
        closeLyricsCard();
    } else {
        openLyricsCard();
    }
}

// ============ 全屏歌词模式 ============
function openFullscreenLyrics() {
    if (!currentTrackData) return;
    // 切换到全屏前收起卡片
    closeLyricsCard();
    fullscreenTrackNameEl.textContent = currentTrackData.name || '未知';
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

// 点击歌词预览区域 → toggle 全屏歌词展开/收起
lyricsToggleEl.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleLyricsCard();
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

// 同步循环按钮状态
function syncLoopState() {
    if (window.audioManager.getLoopOne()) {
        loopBtn.classList.add('active');
    } else {
        loopBtn.classList.remove('active');
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

function toggleLoop() {
    window.audioManager.toggleLoopOne();
    syncLoopState();
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

function setProgress() {
    if (!audio.duration || isNaN(audio.duration)) return;
    const newTime = (seekSlider.value / 100) * audio.duration;
    audio.currentTime = newTime;
}

function setVolume() {
    audio.volume = volSlider.value / 100;
    updateProgressFill('volProgress', volSlider.value);
    if (window.audioManager) {
        localStorage.setItem('volume', audio.volume.toString());
    }
}

// ============ 核心：加载单个轨道 ============
function loadTrack(data) {
    currentTrackData = data;

    trackNameEl.textContent = data.name || "Unknown Title";
    artistNameEl.textContent = data.artist || "Unknown Artist";

    const imgUrl = data.cover || "";
    if (imgUrl) {
        coverImgEl.innerHTML = `<img src="${imgUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;" />`;
    } else {
        coverImgEl.innerHTML = '<div class="card-icon"><svg viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"></path></svg></div>';
    }
    coverImgEl.style.display = 'flex';

    bgLayerEl.style.backgroundImage = imgUrl ? `url('${imgUrl}')` : 'none';

    // 共享 audioManager：仅在曲目变化时重新加载，保持同曲播放连续
    if (window.audioManager) {
        const savedTrackJson = localStorage.getItem('currentTrack');
        const savedTrack = savedTrackJson ? JSON.parse(savedTrackJson) : null;
        const isAlreadyLoaded = savedTrack && savedTrack.id === data.id;

        if (!isAlreadyLoaded) {
            // 不同曲目：正常加载（会重置播放位置）
            window.audioManager.loadTrack(data);
        }
        // 同一首曲目：不重新加载，audio 继续保持当前播放状态（无中断）
    }

    renderLyrics(parseLyrics(data.lyrics));

    seekSlider.value = 0;
    currentTimeEl.textContent = "0:00";
    totalDurationEl.textContent = "0:00";
    updateProgressFill('seekProgress', 0);

    syncPlayState();
    syncLoopState();
    if (audio.duration && !isNaN(audio.duration)) {
        seekSlider.disabled = false;
        totalDurationEl.textContent = formatTime(audio.duration);
        updateProgress();
    }
}

// ============ 事件绑定（只绑定一次） ============
playBtn.addEventListener('click', togglePlay);
loopBtn.addEventListener('click', toggleLoop);
backBtn.addEventListener('click', closePlayer);
nextBtn.addEventListener('click', playNextTrack);
audio.addEventListener('timeupdate', updateProgress);
audio.addEventListener('loadedmetadata', () => {
    totalDurationEl.textContent = formatTime(audio.duration);
    if (!audio.paused) seekSlider.disabled = false;
    // overlay 打开时同步一次进度
    if (overlay.classList.contains('active')) updateProgress();
});
audio.addEventListener('play', syncPlayState);
audio.addEventListener('pause', syncPlayState);
audio.addEventListener('error', (e) => {
    console.error("Audio Load Error:", e);
    trackNameEl.textContent = "Load Error";
    seekSlider.disabled = true;
});
audio.addEventListener('ended', () => {
    if (!window.audioManager.getLoopOne()) {
        playIcon.style.display = 'block';
        pauseIcon.style.display = 'none';
        seekSlider.value = 0;
        updateProgressFill('seekProgress', 0);
        playNextTrack();
    }
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
    syncLoopState();

    // 同步音量到滑块
    try {
        const settings = await LoadSettings();
        const savedVolume = localStorage.getItem('volume');
        if (savedVolume !== null) {
            audio.volume = parseFloat(savedVolume);
            volSlider.value = parseFloat(savedVolume) * 100;
        } else {
            audio.volume = (settings.volume || 70) / 100;
            volSlider.value = settings.volume || 70;
        }
        updateProgressFill('volProgress', volSlider.value);
    } catch (e) {
        console.warn('Failed to load settings:', e);
    }

    if (!trackId) {
        trackNameEl.textContent = "未指定曲目";
        artistNameEl.textContent = "";
        return true;
    }

    try {
        const track = await GetTrack(Number(trackId));
        loadTrack(track);
        return true;
    } catch (err) {
        console.error("加载曲目失败:", err);
        trackNameEl.textContent = "加载失败";
        artistNameEl.textContent = String(err);
        return false;
    }
}
async function playNextTrack() {
    if (!currentTrackData || !currentTrackData.id) {
        console.warn("No current track to determine next track");
        return;
    }

    try {
        // 调用后端获取下一首曲目
        const nextTrack = await GetNextTracks(currentTrackData.id);
        // 检查是否返回了有效数据 (如果返回列表为空或出错，nextTrack 可能是空对象)
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
function closePlayer() {
    overlay.classList.remove('active');
    document.body.classList.remove('player-active');
    closeFullscreenLyrics();
    closeLyricsCard();
}

export { openPlayer, closePlayer };
