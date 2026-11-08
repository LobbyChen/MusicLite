// player.js — 播放器视图（SPA overlay 模块）
// 与库视图共享同一个 audioManager，切换视图时后端播放不中断，保持连续。
// 音频解码与输出全部在 Go 后端完成，本视图只负责 UI 控制与状态展示，
// 通过 audioManager（订阅后端 Wails Events）获取播放状态。
import { audioManager } from '../../core/audio-manager.js';
import { applyMarquee } from '../../ui/marquee.js';
import { formatTime } from '../../ui/format.js';
import { GetTrack, DeleteTrack, GetNextTracks, GetPrevTracks, GetRandomTrack, QueueGetStatus, QueueGetNext, QueueGetPrev } from '../../core/bindings.js';
import { initI18n, t } from '../../core/i18n.js';
import { EqualizerPanel } from './equalizer.js';
import { QueuePanel } from './queue.js';
import {
    overlay, playBtn, playIcon, pauseIcon, loopBtn, seekSlider, volSlider,
    currentTimeEl, totalDurationEl, trackNameEl, artistNameEl, coverImgEl, bgLayerEl,
    backBtn, prevBtn, nextBtn,
} from './player-dom.js';
import { playerState } from './player-state.js';
import { bustCoverUrl } from './cover.js';
import {
    renderLyricsFromText, updateLyricsScroll,
    closeLyricsCard, closeFullscreenLyrics,
    isLyricsCardExpanded, isFullscreenLyricsOpen,
} from './player-lyrics.js';

// 全局状态
let isSeeking = false;

// ============ 进度与音量工具函数 ============
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
        loopBtn.title = t('player.loopOne', '当前: 单曲循环');
    } else if (mode === 'random') {
        loopBtn.classList.add('active-random');
        loopBtn.title = t('player.loopRandom', '当前: 随机播放');
    } else {
        loopBtn.title = t('player.loopSequential', '当前: 顺序播放');
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
    if (!playerState.currentTrackData || !playerState.currentTrackData.id) {
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
        const mode = await audioManager.fetchPlayMode();
        let prevTrack = null;

        if (mode === 'random') {
            prevTrack = await GetRandomTrack(playerState.currentTrackData.id);
        } else {
            // 顺序模式或默认模式
            prevTrack = await GetPrevTracks(playerState.currentTrackData.id);
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
    if (!playerState.currentTrackData || !playerState.currentTrackData.id) {
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
        const mode = await audioManager.fetchPlayMode();
        let nextTrack = null;

        if (mode === 'random') {
            nextTrack = await GetRandomTrack(playerState.currentTrackData.id);
        } else {
            // 顺序模式或默认模式
            nextTrack = await GetNextTracks(playerState.currentTrackData.id);
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
// 应用曲目元信息到播放器 UI（标题/艺术家/封面/背景），不触发后端加载
function applyTrackMeta(data) {
    playerState.currentTrackData = data;
    trackNameEl.textContent = data.name || t('common.unknown');
    applyMarquee(trackNameEl);
    document.title = trackNameEl.textContent;
    artistNameEl.textContent = data.artist || t('common.unknownArtist');
    const imgUrl = data.cover || "";
    // 追加缓存破坏参数：编辑封面后 URL 不变，避免播放器命中浏览器旧缓存
    const displayUrl = bustCoverUrl(imgUrl);
    if (imgUrl) {
        coverImgEl.innerHTML = '';
        const img = document.createElement('img');
        img.src = displayUrl;
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:inherit;';
        coverImgEl.appendChild(img);
    } else {
        coverImgEl.innerHTML = '<div class="card-icon"><svg viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"></path></svg></div>';
    }
    coverImgEl.style.display = 'flex';
    bgLayerEl.style.backgroundImage = displayUrl ? `url('${displayUrl}')` : 'none';

    // 根据封面亮度自动调整播放器文字对比度（避免封面背景导致控件看不清）
    const pc = window.MusicLiteSettings?.PlayerContrast;
    if (pc) pc.adjustFromCover(displayUrl);
}

function loadTrack(data) {
    applyTrackMeta(data);

    // 委托后端加载：audioManager.loadTrack 内部会判断同曲不重载（保持同曲播放连续）
    // 加载后处于暂停态，需调用 playAudio() 开始播放
    audioManager.loadTrack(data);

    renderLyricsFromText(data.lyrics);
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
    playerState.currentTrackData = null;
    trackNameEl.textContent = '';
    artistNameEl.textContent = '';
    totalDurationEl.textContent = '0:00';
    currentTimeEl.textContent = '0:00';
    seekSlider.value = 0;
    seekSlider.disabled = true;
    if (coverImgEl) coverImgEl.innerHTML = '';
    if (bgLayerEl) bgLayerEl.style.backgroundImage = '';
    stopSmoothProgress();
    syncPlayState();
});
// error：后端解码/播放错误
audioManager.on('error', (e) => {
    console.error("Playback Error:", e);
    trackNameEl.textContent = t('player.loadError', 'Load Error');
    seekSlider.disabled = true;
});

// ended：后端单曲循环已在 player.go 内处理，此处仅处理顺序/随机模式的下一首
audioManager.on('ended', async () => {
    // 单向模式：播放完成自动关闭播放器并清理临时曲目，不进入下一首
    if (window.__onlyModeSession) {
        await exitOnlyMode();
        return;
    }
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
    if (!playerState.currentTrackData || playerState.currentTrackData.id !== track.id) {
        loadTrack(track);
    }
    syncPlayState();
    syncPlayModeState();
    // 同步队列当前指针（切歌时高亮新的当前项）
    try { QueuePanel.refresh(); } catch (e) {}
});

// trackupdated：编辑弹窗保存后同步当前曲目的标题/封面/歌词（不重新加载音频）
audioManager.on('trackupdated', (track) => {
    if (!track) return;
    const cur = playerState.currentTrackData;
    if (!cur || Number(cur.id) !== Number(track.id)) return;
    applyTrackMeta(track);
    renderLyricsFromText(track.lyrics);
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
        // 单向模式：无浮层打开时 Esc 中途退出（关闭播放器并清理临时曲目）
        if (window.__onlyModeSession
            && !EqualizerPanel.getIsOpen()
            && !QueuePanel.getIsOpen()
            && !isFullscreenLyricsOpen()
            && !isLyricsCardExpanded()) {
            e.preventDefault();
            exitOnlyMode();
            return;
        }
        // 优先关闭浮层（均衡器/队列），其次全屏歌词/卡片歌词
        if (EqualizerPanel.getIsOpen()) { EqualizerPanel.close(); e.preventDefault(); return; }
        if (QueuePanel.getIsOpen()) { QueuePanel.close(); e.preventDefault(); return; }
        if (isFullscreenLyricsOpen()) {
            closeFullscreenLyrics();
        } else if (isLyricsCardExpanded()) {
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
            audioManager.clearTrack();
            return false;
        }
    }

    // 显示 overlay（带过渡动画）
    overlay.classList.add('active');
    document.body.classList.add('player-active');
    // 单向模式（OnlyMode）：根据会话标记在 body 上加 class，CSS 据此隐藏循环/上下曲/列表/返回
    applyOnlyMode();
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

// ============ 单向模式（OnlyMode） ============
// 仅当以系统链接方式打开音乐时由 libraries.js 启动逻辑置位：
//   window.__onlyModeSession = true
//   window.__onlyModeTrackId = <临时曲目 id>
// 该模式下播放器隐藏循环/上下曲/播放列表/返回按钮，
// 播放结束或按 Esc 自动关闭播放器并清理临时曲目，不影响原有音乐库。

// 根据会话标记在 body 上切换 only-mode class（CSS 据此隐藏控件）
function applyOnlyMode() {
    const on = !!window.__onlyModeSession;
    document.body.classList.toggle('only-mode', on);
}

// 退出单向模式：关闭播放器、删除临时曲目、清除当前曲目引用
// 在 'ended'（播放完成）与 Esc 中途退出时调用
async function exitOnlyMode() {
    const tempId = window.__onlyModeTrackId;
    // 先重置标记，再关闭 overlay，避免 closePlayer 过程中仍受 OnlyMode 影响
    window.__onlyModeSession = false;
    window.__onlyModeTrackId = null;
    closePlayer();
    applyOnlyMode(); // 移除 body.only-mode class
    // 删除临时入库的曲目，保持原有音乐库不受影响（删除失败也不影响关闭流程）
    try {
        if (tempId !== undefined && tempId !== null) {
            await DeleteTrack(Number(tempId));
        }
    } catch (e) {
        console.warn('OnlyMode 临时曲目删除失败:', e);
    }
    // 清除当前曲目引用并停止后端播放，隐藏迷你播放器
    try { audioManager.clearTrack(); } catch (e) {}
}

export { openPlayer, closePlayer };
