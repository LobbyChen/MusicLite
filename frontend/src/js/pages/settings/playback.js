// 播放相关设置：音量与音源模式、歌词动画/行数、界面缩放、默认播放器
import { audioManager } from '../../core/audio-manager.js';
import {
    SetSystemMasterVolume, SetApplicationVolume,
    GetSystemMasterVolume, GetApplicationVolume,
    SetAsDefaultPlayer,
} from '../../core/bindings.js';
import { t } from '../../core/i18n.js';
import { applyLyricAnimation } from '../../core/settings/design-tokens.js';
import {
    volumeSlider, volumeValue, volumeModeBtns,
    maxLyricLinesSlider, maxLyricLinesValue,
    setDefaultPlayerBtn, defaultPlayerStatus,
    lyricAnimationSelect,
    uiScaleSlider, uiScaleValue, lyricsScaleSlider, lyricsScaleValue,
} from './dom.js';
import { state, markChanged } from './state.js';

// 更新默认播放器状态显示
export function updateDefaultPlayerStatus(isDefault) {
    if (!defaultPlayerStatus) return;
    if (isDefault) {
        defaultPlayerStatus.textContent = t('settings.isDefaultPlayer') || '✓ 已设为默认';
        defaultPlayerStatus.style.color = 'var(--accent-color, #1DB954)';
    } else {
        defaultPlayerStatus.textContent = t('settings.notDefaultPlayer') || '未设为默认';
        defaultPlayerStatus.style.color = '';
    }
}

export function bindPlaybackEvents() {
    // Volume slider — 按 volume_mode 路由到合成器/系统主音量
    volumeSlider.addEventListener('input', () => {
        const vol = parseInt(volumeSlider.value, 10);
        volumeValue.textContent = vol + '%';
        state.currentSettings.volume = vol;
        // 通过 audioManager 统一路由（它会按 _volumeMode 选择 SetApplicationVolume 或 SetSystemMasterVolume）
        // 同时更新 audioManager._volume 缓存，让播放器页滑块保持一致
        if (audioManager && typeof audioManager.setVolume === 'function') {
            audioManager.setVolume(vol);
        } else {
            // audioManager 尚未初始化时的兜底（理论上不会发生）
            const mode = state.currentSettings.volume_mode || 'synth';
            if (mode === 'master') {
                SetSystemMasterVolume(vol).catch(() => { });
            } else {
                SetApplicationVolume(vol).catch(() => { });
            }
        }
        markChanged();
    });

    // Volume mode buttons
    volumeModeBtns.forEach(btn => {
        btn.addEventListener('click', async () => {
            const mode = btn.dataset.volMode;
            state.currentSettings.volume_mode = mode;
            volumeModeBtns.forEach(b => b.classList.toggle('active', b === btn));
            try { localStorage.setItem('musicLite.volumeMode', mode); } catch (e) { }
            // 通知 audioManager 切换模式（它会从对应音源读取真实音量并更新缓存）
            if (audioManager && typeof audioManager.setVolumeMode === 'function') {
                await audioManager.setVolumeMode(mode);
            }
            // 切换后读取对应音量值更新滑块
            try {
                const vol = mode === 'master'
                    ? await GetSystemMasterVolume()
                    : await GetApplicationVolume();
                volumeSlider.value = vol;
                volumeValue.textContent = vol + '%';
                state.currentSettings.volume = vol;
            } catch (e) {
                // 读取失败，保持原值
            }
            markChanged();
        });
    });

    // Max lyric lines slider
    if (maxLyricLinesSlider) {
        maxLyricLinesSlider.addEventListener('input', () => {
            const v = parseInt(maxLyricLinesSlider.value, 10);
            maxLyricLinesValue.textContent = v;
            state.currentSettings.max_lyric_lines = v;
            try { localStorage.setItem('musicLite.maxLyricLines', v.toString()); } catch (e) { }
            markChanged();
        });
    }

    // Set as default player
    if (setDefaultPlayerBtn) {
        setDefaultPlayerBtn.addEventListener('click', async () => {
            try {
                await SetAsDefaultPlayer();
                updateDefaultPlayerStatus(true);
            } catch (e) {
                console.error('Set as default player failed:', e);
            }
        });
    }

    // Lyric animation select
    if (lyricAnimationSelect) {
        lyricAnimationSelect.addEventListener('change', () => {
            const mode = lyricAnimationSelect.value;
            state.currentSettings.lyric_animation = mode;
            // 实时预览 + 持久化由 applyLyricAnimation 统一处理
            applyLyricAnimation(mode);
            markChanged();
        });
    }

    // UI scale slider（界面缩放）
    uiScaleSlider.addEventListener('input', () => {
        const v = parseInt(uiScaleSlider.value, 10);
        uiScaleValue.textContent = v + '%';
        state.currentSettings.ui_scale = v;
        // 实时预览：基准 14px × 缩放比例
        const px = 14 * v / 100;
        document.documentElement.style.setProperty('--base-font-size', px + 'px');
        document.body.style.setProperty('--base-font-size', px + 'px');
        // 直接设置 <html> font-size，让 rem 单位跟随缩放
        document.documentElement.style.fontSize = px + 'px';
        markChanged();
    });

    // Lyrics scale slider（歌词缩放）
    lyricsScaleSlider.addEventListener('input', () => {
        const v = parseInt(lyricsScaleSlider.value, 10);
        lyricsScaleValue.textContent = v + '%';
        state.currentSettings.lyrics_scale = v;
        // 实时预览：基准 16px × 缩放比例
        const px = 16 * v / 100;
        document.documentElement.style.setProperty('--lyrics-font-size', px + 'px');
        document.body.style.setProperty('--lyrics-font-size', px + 'px');
        markChanged();
    });
}
