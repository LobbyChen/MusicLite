// 音乐库迷你播放器：恢复上次播放、上下曲、展开播放器、启动参数处理
import { audioManager } from '../../core/audio-manager.js';
import { applyMarquee } from '../../ui/marquee.js';
import { t } from '../../core/i18n.js';
import { GetFileInArgs, GetNextTracks, GetPrevTracks, GetRandomTrack } from '../../core/bindings.js';
import { openPlayer } from './player.js';
import { state } from './state.js';
import { setCover } from './cover.js';
import { refreshList, applyNowPlayingIndicator } from './library-list.js';
import { refreshLibQueue } from './lib-queue.js';

// 按"当前播放模式"取下一首/上一首（随机模式走 GetRandomTrack）
async function pickAdjacentTrack(direction) {
    const cur = audioManager && audioManager.currentTrack;
    if (!cur || cur.id == null) return null;
    try {
        const mode = await audioManager.fetchPlayMode();
        if (mode === 'random') {
            return await GetRandomTrack(cur.id);
        }
        return direction < 0 ? await GetPrevTracks(cur.id) : await GetNextTracks(cur.id);
    } catch (e) {
        console.warn('pickAdjacentTrack failed:', e);
        return null;
    }
}

async function miniPrevTrack() {
    const prev = await pickAdjacentTrack(-1);
    if (prev && prev.id) {
        audioManager.loadTrack(prev);
        audioManager.play();
        state.currentTrack = prev;
    }
}

async function miniNextTrack() {
    const next = await pickAdjacentTrack(1);
    if (next && next.id) {
        audioManager.loadTrack(next);
        audioManager.play();
        state.currentTrack = next;
    }
}

export function bindLibraryMiniPlayer() {
    // 迷你播放器
    const miniPlayer = document.getElementById('mini-player');
    const miniCover = document.getElementById('mini-cover');
    const miniTitle = document.getElementById('mini-title');
    const miniArtist = document.getElementById('mini-artist');
    const miniPlayBtn = document.getElementById('mini-play');
    const miniPlayIcon = document.getElementById('mini-play-icon');
    const miniPauseIcon = document.getElementById('mini-pause-icon');
    const miniExpand = document.getElementById('mini-expand');
    // 未播放占位文案由 JS 维护（HTML 上不能挂 data-i18n，否则 applyTranslations 会把正在播放的曲名覆盖成“未播放”）
    if (miniTitle) miniTitle.textContent = t('libraries.notPlaying');

    // 使用全局音频管理器
    if (audioManager) {
        // 单一可信源：根据后端播放状态同步按钮图标
        const syncPlayIcon = () => {
            if (!miniPlayIcon || !miniPauseIcon) return;
            if (audioManager.isPlaying()) {
                miniPlayIcon.style.display = 'none';
                miniPauseIcon.style.display = 'block';
            } else {
                miniPlayIcon.style.display = 'block';
                miniPauseIcon.style.display = 'none';
            }
        };

        const applyTrackUI = (track) => {
            if (!track || track.id === undefined || track.id === null) return;
            miniPlayer.style.display = 'flex';
            setCover(miniCover, track.cover);
            miniTitle.textContent = track.name || t('common.unknown');
            applyMarquee(miniTitle);
            miniArtist.textContent = track.artist || '--';
        };

        // 先绑定事件，再 restore()，避免事件早到
        audioManager.on('play', () => { syncPlayIcon(); applyNowPlayingIndicator(); });
        audioManager.on('pause', () => { syncPlayIcon(); applyNowPlayingIndicator(); });
        audioManager.on('trackloaded', (track) => {
            miniPlayer.style.display = 'flex';
            setCover(miniCover, track.cover);
            miniTitle.textContent = track.name || t('common.unknown');
            applyMarquee(miniTitle);
            miniArtist.textContent = track.artist || t('common.unknownArtist');
            // 同步更新全局当前曲目引用，供卡片点击时判断是否为同一曲目
            state.currentTrack = track;
            syncPlayIcon();
            applyNowPlayingIndicator();
            // 同步刷新队列侧栏的 is-current 标记（正在播放指示）
            refreshLibQueue();
        });
        // 曲目被清除时（删除检查）隐藏迷你播放器
        audioManager.on('trackcleared', () => {
            miniPlayer.style.display = 'none';
            miniTitle.textContent = t('libraries.notPlaying');
            miniArtist.textContent = '--';
            applyNowPlayingIndicator();
        });

        // 恢复上次播放状态（必须在 on() 绑定完成后调用）
        // restore() 会按 volume_mode 从对应音源（synth/master）读取真实音量并同步缓存
        state.currentTrack = audioManager.currentTrack;

        // 恢复上次状态后，继续检查这次启动是否传入参数
        return (async () => {
            // 等待后端状态快照恢复（跨页/启动时同步当前曲目与播放态）
            await audioManager.restore();
            state.currentTrack = audioManager.currentTrack;
            if (state.currentTrack) {
                document.title = state.currentTrack.name || state.currentTrack.Name || 'MusicLite · 我的音乐库';
            }
            state.defaultFile = await GetFileInArgs();
            if (state.defaultFile && state.defaultFile.src) {
                // 读取设置判断是否启用单向模式（OnlyMode）：
                // 启用时，自动进入播放器单曲播放，结束后关闭且不影响音乐库；
                // 关闭时走原有逻辑（刷新列表 + 后台播放 + 停留在音乐库）。
                state.onlyMode = false;
                try {
                    const { LoadSettings: _loadSettings } = await import('../../core/bindings.js');
                    const _s = await _loadSettings();
                    state.onlyMode = _s.only_mode !== undefined ? !!_s.only_mode : true;
                } catch (e) {
                    console.warn('读取 OnlyMode 设置失败，按默认禁用处理:', e);
                }

                if (state.onlyMode) {
                    // 单向模式：不刷新列表（保持原音乐库视图不受临时曲目影响）
                    // 标记 OnlyMode 会话，供 player.js 隐藏控件并在播放结束时自动清理
                    window.__onlyModeSession = true;
                    window.__onlyModeTrackId = state.defaultFile.id;
                    state.currentTrack = state.defaultFile;
                    document.title = state.currentTrack.name || state.currentTrack.Name || 'MusicLite · 我的音乐库';
                    audioManager.loadTrack(state.defaultFile);
                    audioManager.play();
                    // 自动转到播放器页面开始播放（openPlayer 内部会再次 loadTrack，
                    // 同曲不重载，仅同步 UI；此处 play 已发起，pending 期间排队等待）
                    try {
                        await openPlayer(state.defaultFile.id);
                    } catch (err) {
                        console.error('OnlyMode 打开播放器失败:', err);
                    }
                } else {
                    // 常规逻辑：命令行参数文件已经入库，刷新一下列表显示
                    await refreshList();
                    audioManager.loadTrack(state.defaultFile);
                    audioManager.play();
                    state.currentTrack = state.defaultFile;
                    document.title = state.currentTrack.name || state.currentTrack.Name || 'MusicLite · 我的音乐库';
                }
            }

            // 删除检查：若恢复的曲目已不存在，清理状态并隐藏迷你播放器
            if (state.currentTrack) {
                try {
                    const { GetTrack } = await import('../../core/bindings.js');
                    await GetTrack(Number(state.currentTrack.id));
                } catch (err) {
                    audioManager.clearTrack();
                    state.currentTrack = null;
                }
            }

            if (state.currentTrack) {
                applyTrackUI(state.currentTrack);
            }

            // 根据真实状态同步一次按钮（restore 已完成的情况）
            syncPlayIcon();
            // 兜底：如果 play() 在异步触发，再拉 2 次
            setTimeout(syncPlayIcon, 200);
            setTimeout(syncPlayIcon, 800);
        })();
    }

    return Promise.resolve();
}

// 迷你播放器按钮绑定（需在 init 中调用一次）
export function bindMiniPlayerControls() {
    const miniPlayer = document.getElementById('mini-player');
    const miniPlayBtn = document.getElementById('mini-play');
    const miniExpand = document.getElementById('mini-expand');

    // 迷你播放器播放/暂停
    if (miniPlayBtn) {
        miniPlayBtn.addEventListener('click', () => {
            if (audioManager && audioManager.currentTrack) {
                audioManager.toggle();
            }
        });
    }

    // 迷你播放器上一曲 / 下一曲
    const miniPrevBtn = document.getElementById('mini-prev');
    const miniNextBtn = document.getElementById('mini-next');
    if (miniPrevBtn) {
        miniPrevBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            miniPrevTrack();
        });
    }
    if (miniNextBtn) {
        miniNextBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            miniNextTrack();
        });
    }

    // 展开播放器—— 带删除检查
    const openCurrentPlayer = async () => {
        const currentTrack = audioManager?.currentTrack;
        if (!currentTrack) return;
        const ok = await openPlayer(currentTrack.id);
        // 若曲目已删除，openPlayer 返回 false 并已清理状态
        if (!ok) {
            miniPlayer.style.display = 'none';
        }
    };
    if (miniExpand) {
        miniExpand.addEventListener('click', openCurrentPlayer);
    }

    // 点击迷你播放器任意非按钮区域 → 返回播放器界面
    if (miniPlayer) {
        miniPlayer.addEventListener('click', (e) => {
            if (e.target.closest('button')) return;
            openCurrentPlayer();
        });
    }
}
