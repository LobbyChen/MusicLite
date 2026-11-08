// 设置页迷你播放器：显示当前曲目并控制播放/暂停
import { audioManager } from '../../core/audio-manager.js';
import { applyMarquee } from '../../ui/marquee.js';
import { t } from '../../core/i18n.js';
import { setCover } from '../libraries/cover.js';

export function initMiniPlayer() {
    const miniPlayer = document.getElementById('mini-player');
    const miniCover = document.getElementById('mini-cover');
    const miniTitle = document.getElementById('mini-title');
    const miniArtist = document.getElementById('mini-artist');
    const miniPlayBtn = document.getElementById('mini-play');
    const miniPlayIcon = document.getElementById('mini-play-icon');
    const miniPauseIcon = document.getElementById('mini-pause-icon');
    const miniExpand = document.getElementById('mini-expand');
    if (!miniPlayer || !audioManager) return;

    // 未播放占位文案由 JS 维护（HTML 上不能挂 data-i18n，否则 applyTranslations 会把正在播放的曲名覆盖成“未播放”）
    miniTitle.textContent = t('libraries.notPlaying');

    // 显示 mini-player 时，同步在 body 上打标，让 save-bar 上移避免遮挡
    const showMiniPlayer = () => {
        miniPlayer.style.display = 'flex';
        document.body.classList.add('has-mini-player');
    };
    const hideMiniPlayer = () => {
        miniPlayer.style.display = 'none';
        document.body.classList.remove('has-mini-player');
    };

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
        showMiniPlayer();
        miniTitle.textContent = track.name || t('common.unknown');
        applyMarquee(miniTitle);
        miniArtist.textContent = track.artist || t('common.unknownArtist');
        setCover(miniCover, track.cover);
    };

    // 返回播放器：跳回音乐库并自动展开当前曲目
    const goPlayer = () => {
        const track = audioManager?.currentTrack;
        if (track && track.id != null) {
            localStorage.setItem('openPlayerOnLoad', String(track.id));
        }
        window.location.href = '/#/library';
    };

    // 播放/暂停
    miniPlayBtn?.addEventListener('click', () => {
        audioManager.toggle();
    });

    // 点击迷你播放器（按钮以外区域）或返回键 → 回到播放器界面
    miniPlayer.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        goPlayer();
    });
    miniExpand?.addEventListener('click', goPlayer);

    // 先绑定事件，再 restore()，避免事件早到但还没被绑定
    audioManager.on('play', () => syncPlayIcon());
    audioManager.on('pause', () => syncPlayIcon());
    audioManager.on('trackloaded', (track) => {
        applyTrackUI(track);
        // trackloaded 后同步一次图标（此时 play/pause 可能已经被 restore 驱动过）
        syncPlayIcon();
    });
    // 曲目被删除/清除时隐藏迷你播放器，避免残留旧标题与 "--"
    audioManager.on('trackcleared', () => {
        hideMiniPlayer();
        miniTitle.textContent = t('libraries.notPlaying');
        miniArtist.textContent = '--';
        setCover(miniCover, '');
        syncPlayIcon();
    });

    // 跨页恢复：等待后端状态快照（曲目 / 播放态）后再同步 UI，
    // 避免直接同步读取 currentTrack（restore 是异步的）导致显示为空。
    audioManager.restore().then(() => {
        const currentTrack = audioManager.currentTrack;
        if (currentTrack) applyTrackUI(currentTrack);
        syncPlayIcon();
    }).catch(() => {
        syncPlayIcon();
    });

    // 从历史缓存（bfcache）恢复时，重新同步播放状态
    window.addEventListener('pageshow', (e) => {
        if (!e.persisted) return;
        audioManager.restore().then(() => {
            const currentTrack = audioManager.currentTrack;
            if (currentTrack) applyTrackUI(currentTrack);
            syncPlayIcon();
        }).catch(() => syncPlayIcon());
    });
}
