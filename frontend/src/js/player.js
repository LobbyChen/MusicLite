// 全局变量用于存储当前歌曲数据
let currentTrackData = null;
let isPlaying = false;
let isSeeking = false;
let parsedLyrics = [];
let currentLyricIndex = -1;
let lyricsExpanded = false;

const audio = document.getElementById('audioPlayer');
const playBtn = document.getElementById('playBtn');
const playIcon = document.getElementById('playIcon');
const pauseIcon = document.getElementById('pauseIcon');
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

// ============ 渲染歌词 ============
function renderLyrics(lyricsArray) {
    if (!lyricsArray || lyricsArray.length === 0) {
        lyricsContentEl.innerHTML = '<div class="no-lyrics">♪ 暂无歌词 ♪</div>';
        lyricsPreviewEl.textContent = '暂无歌词';
        lyricsPreviewEl.classList.remove('active');
        parsedLyrics = [];
        return;
    }
    parsedLyrics = lyricsArray;
    let html = '<div class="lyric-line empty"></div>'.repeat(2);
    for (let i = 0; i < lyricsArray.length; i++) {
        const line = lyricsArray[i];
        html += `<div class="lyric-line" data-index="${i}" data-time="${line.time}">${escapeHtml(line.text)}</div>`;
    }
    html += '<div class="lyric-line empty"></div>'.repeat(3);
    lyricsContentEl.innerHTML = html;

    // 绑定歌词行点击
    lyricsContentEl.querySelectorAll('.lyric-line[data-time]').forEach(el => {
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            const time = parseFloat(el.dataset.time);
            if (!isNaN(time) && audio.duration) {
                audio.currentTime = time;
            }
        });
    });

    currentLyricIndex = -1;
    updateLyricsScroll(0);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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

    // 更新折叠条的预览文本
    if (newIndex >= 0 && parsedLyrics[newIndex]) {
        lyricsPreviewEl.textContent = parsedLyrics[newIndex].text;
        lyricsPreviewEl.classList.add('active');
    } else {
        lyricsPreviewEl.textContent = parsedLyrics[0] ? parsedLyrics[0].text : '暂无歌词';
        lyricsPreviewEl.classList.remove('active');
    }

    if (newIndex === currentLyricIndex) return;
    currentLyricIndex = newIndex;

    lyricsContentEl.querySelectorAll('.lyric-line.active').forEach(el => {
        el.classList.remove('active');
    });

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
}

// ============ 歌词展开/收起 ============
function toggleLyrics(forceState) {
    const shouldExpand = typeof forceState === 'boolean' ? forceState : !lyricsExpanded;
    lyricsExpanded = shouldExpand;
    if (lyricsExpanded) {
        lyricsAreaEl.classList.add('expanded');
    } else {
        lyricsAreaEl.classList.remove('expanded');
    }
}
var toogleStatus = false;

lyricsToggleEl.addEventListener('click', (e) => {
    if (!toogleStatus) {
        toogleStatus = true;
        e.stopPropagation();
        toggleLyrics(true);
    } else {
        toogleStatus = false;
        toggleLyrics(false);
    };
});

lyricsCardEl.addEventListener('click', (e) => {
    if (e.target === lyricsCardEl || e.target === lyricsWrapperEl || e.target === lyricsContentEl) {
        toogleStatus = false;
        toggleLyrics(false);
    }
});

document.addEventListener('click', (e) => {
    if (lyricsExpanded && !lyricsAreaEl.contains(e.target)) {
        toogleStatus = false;
        toggleLyrics(false);
    }
});

// ============ 核心功能：加载单个轨道 ============
function loadTrack(data) {
    currentTrackData = data;

    // 更新文本信息
    trackNameEl.textContent = data.name || "Unknown Title";
    artistNameEl.textContent = data.artist || "Unknown Artist";

    // 更新图片 (Cover 和 Background)
    const imgUrl = data.cover || "";
    coverImgEl.src = imgUrl;
    coverImgEl.style.display = 'block'; // 重置可能的隐藏状态

    // 设置背景：使用同一张图片，CSS中已设置为 contain 和 blur
    bgLayerEl.style.backgroundImage = imgUrl ? `url('${imgUrl}')` : 'none';

    // 加载音频
    audio.src = data.src;
    audio.load();

    // 解析并渲染歌词
    renderLyrics(parseLyrics(data.lyrics));

    // 重置状态
    toggleLyrics(false);
    seekSlider.value = 0;
    seekSlider.disabled = true;
    currentTimeEl.textContent = "0:00";
    totalDurationEl.textContent = "0:00";
    updateProgressFill('seekProgress', 0);
    updateProgressFill('volProgress', volSlider.value);

    // 如果之前是播放状态，尝试继续播放新歌曲
    if (isPlaying) {
        playAudio();
    }
}

// ============ 异步加载文件数据 ============
async function loadFile() {
    try {
        // 这里假设有一个 API 端点返回 JSON 数据
        // 实际使用时，请替换为你真实的 JSON 文件路径或 API 地址
        // 例如: '/data/current-song.json' 或 '/api/music-info'
        const response = await fetch('/api/music-info');

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        // 数据结构映射:
        // Go Struct: Name, Author, AudioURI, CoverURI, Lyrics
        // JS Object expects: name, artist, src, cover, lyrics

        return {
            name: data.Name || data.name,
            artist: data.Author || data.artist,
            src: data.AudioURI || data.src,
            cover: data.CoverURI || data.cover,
            lyrics: data.Lyrics || data.lyrics
        };

    } catch (error) {
        return {
            name: "error",
            artist:"error",
            src: "",
            cover: "",
            lyrics: ""
        };
    }
}

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

function playAudio() {
    const playPromise = audio.play();
    if (playPromise !== undefined) {
        playPromise.then(_ => {
            isPlaying = true;
            playIcon.style.display = 'none';
            pauseIcon.style.display = 'block';
            pauseIcon.parentElement.classList.add('btn-pause');
        }).catch(error => {
            console.error("Playback failed:", error);
            isPlaying = false;
            playIcon.style.display = 'block';
            pauseIcon.style.display = 'none';
            alert("音频加载失败，请检查网络或控制台。");
        });
    }
}

function togglePlay() {
    if (audio.paused) {
        playAudio();
    } else {
        audio.pause();
        isPlaying = false;
        playIcon.style.display = 'block';
        pauseIcon.style.display = 'none';
        pauseIcon.parentElement.classList.remove('btn-pause');
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

function setProgress() {
    if (!audio.duration || isNaN(audio.duration)) return;
    const newTime = (seekSlider.value / 100) * audio.duration;
    audio.currentTime = newTime;
}

function setVolume() {
    audio.volume = volSlider.value / 100;
    updateProgressFill('volProgress', volSlider.value);
}

// Event Listeners
playBtn.addEventListener('click', togglePlay);
backBtn.addEventListener('click', () => window.history.back());

audio.addEventListener('timeupdate', updateProgress);
audio.addEventListener('loadedmetadata', () => {
    totalDurationEl.textContent = formatTime(audio.duration);
    if (!audio.paused) seekSlider.disabled = false;
});
audio.addEventListener('error', (e) => {
    console.error("Audio Load Error:", e);
    trackNameEl.textContent = "Load Error";
    seekSlider.disabled = true;
});
// 单曲播放结束后，不再自动切歌，可以重置或停止
audio.addEventListener('ended', () => {
    isPlaying = false;
    playIcon.style.display = 'block';
    pauseIcon.style.display = 'none';
    seekSlider.value = 0;
    updateProgressFill('seekProgress', 0);
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
    if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
    }
});

document.addEventListener("DOMContentLoaded", async function() {
    const data = await loadFile(); // 等待异步请求完成
    loadTrack(data);               // 传入解析后的数据对象
});