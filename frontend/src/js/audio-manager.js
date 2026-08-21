// audio-manager.js — 音频播放管理器（轮询驱动版）
//
// 设计：Go 后端是播放状态的唯一可信源。前端不依赖 Wails Events.On
// 推送（v3 IPC 时序不可靠），而是每 500ms 调用 PlayerGetState() 绑定
// 拉取快照，通过 diff 对比上一帧状态，自动 emit 对应的 UI 事件。
//
// 对外保留与旧版完全相同的事件接口：
//   play / pause / timeupdate / loadedmetadata / trackloaded /
//   trackcleared / modechange / volumemodechange / volumechange /
//   ended / error
// 让 player.js / libraries.js / designer.js 以零改动迁移。
//
// 仅保留 Events.On 用于一次性动作事件（player:ended / tray:toggle-play），
// 这类事件无法通过轮询可靠检测；若 Events.On 不可用，最坏只是停止时
// 不自动播放下一首，用户手动点击即可。

import { PlayerLoad, PlayerPlay, PlayerPause, PlayerSeek, PlayerStop, PlayerGetState, PlayerTogglePlayMode, PlayerGetPlayMode, SetApplicationVolume, GetApplicationVolume, SetSystemMasterVolume, GetSystemMasterVolume } from '@bindings/MusicLite/app/musicservice.js';
import { Events } from '@wailsio/runtime';

class AudioManager {
	constructor() {
		this.currentTrack = null;
		this.listeners = new Map();

		// 播放状态缓存（来自后端快照，前端只读）
		this._isPlaying = false;
		this._currentTime = 0;
		this._duration = 0;
		this._volume = 70;

		// 音量模式
		this._volumeMode = localStorage.getItem('musicLite.volumeMode') || 'synth';

		// 播放模式
		this.playMode = localStorage.getItem('playMode') || 'none';

		// 加载中标记
		this._pendingLoad = null;

		// 轮询并发守卫
		this._polling = false;

		// 启动轮询
		this._pollTimer = null;
		this._startPolling();

		// 保留 Events.On 用于一次性动作事件
		this._bindActionEvents();
	}

	// ============ 核心轮询：每 500ms 拉取后端状态，diff 后 emit UI 事件 ============
	_startPolling() {
		if (this._pollTimer) clearInterval(this._pollTimer);
		this._pollTimer = setInterval(() => this._pollState(), 500);
	}

	async _pollState() {
		if (this._polling) return;
		this._polling = true;
		try {
			let state;
			try {
				state = await PlayerGetState();
			} catch (e) {
				// IPC 尚未就绪，下次轮询自动重试
				return;
			}
			if (!state) return;

			// ---- 1. 曲目变更检测 ----
			const newTrack = state.track || null;
			const trackChanged = newTrack && (!this.currentTrack || this.currentTrack.id !== newTrack.id);
			if (trackChanged) {
				this.currentTrack = newTrack;
				try { localStorage.setItem('currentTrack', JSON.stringify(newTrack)); } catch (e) {}
				document.title = newTrack.name || newTrack.Name || 'MusicLite';
				// 先同步时长，再 emit trackloaded（让 UI 拿到正确的 duration）
				if (typeof state.duration === 'number' && state.duration > 0) {
					this._duration = state.duration;
				}
				this.emit('trackloaded', newTrack);
				if (this._duration > 0) {
					this.emit('loadedmetadata', { duration: this._duration });
				}
			}

			// ---- 2. 时长变更（非切曲但后端解码完成后时长更新） ----
			if (!trackChanged && typeof state.duration === 'number' && state.duration > 0 && state.duration !== this._duration) {
				this._duration = state.duration;
				this.emit('loadedmetadata', { duration: this._duration });
			}

			// ---- 3. 播放/暂停状态变更 ----
			const wasPlaying = this._isPlaying;
			this._isPlaying = !!state.isPlaying;
			if (this._isPlaying && !wasPlaying) {
				this.emit('play');
			} else if (!this._isPlaying && wasPlaying) {
				this.emit('pause');
			}

			// ---- 4. 进度更新 ----
			// 播放中：emit timeupdate 让 UI 刷新进度条和歌词
			// 暂停/停止：只更新内部缓存，不 emit（避免无意义的 UI 刷新）
			if (typeof state.position === 'number') {
				this._currentTime = state.position;
				if (this._isPlaying) {
					this.emit('timeupdate', {
						currentTime: this._currentTime,
						duration: this._duration
					});
				}
			}

			// ---- 5. 播放模式变更 ----
			if (state.playMode && state.playMode !== this.playMode) {
				this.playMode = state.playMode;
				try { localStorage.setItem('playMode', state.playMode); } catch (e) {}
				this.emit('modechange', state.playMode);
			}
		} finally {
			this._polling = false;
		}
	}

	// ============ 一次性动作事件（保留 Events.On，轮询无法替代） ============
	_bindActionEvents() {
		try {
			// player:ended：队列空时后端通知前端选下一首（轮询只能检测到
			// isPlaying=false，无法区分"暂停"和"结束"，所以保留 Events.On）
			Events.On('player:ended', () => {
				this._isPlaying = false;
				this._currentTime = 0;
				this.emit('ended');
			});
		} catch (e) {
			// Events.On 不可用时，轮询仍能同步 play/pause/timeupdate，
			// 只是自动播放下一首功能不可用（用户手动点击即可）
		}
		try {
			// 托盘播放/暂停
			Events.On('tray:toggle-play', () => {
				this.toggle();
			});
		} catch (e) {}
	}

	// ============ 曲目比较（按 id） ============
	_sameTrack(track) {
		if (!track || !this.currentTrack) return false;
		if (track.id !== undefined && this.currentTrack.id !== undefined) {
			return track.id === this.currentTrack.id;
		}
		return false;
	}

	// ============ 控制方法（调用后端绑定，保持 UI 接口不变） ============

	// 加载曲目：调用后端解码并构建播放管线（加载后处于暂停态）
	loadTrack(track) {
		if (!track || track.id === undefined || track.id === null) return;
		// 同曲目跳过，避免重复解码打断后端播放
		if (this._sameTrack(track)) {
			this.currentTrack = track;
			try { localStorage.setItem('currentTrack', JSON.stringify(track)); } catch (e) {}
			this.emit('trackloaded', track);
			return;
		}
		this.currentTrack = track;
		this._currentTime = 0;
		this._duration = 0;
		this._isPlaying = false;
		try { localStorage.setItem('currentTrack', JSON.stringify(track)); } catch (e) {}
		document.title = track.name || track.Name || 'MusicLite';
		this.emit('trackloaded', track);

		// 提交到后端解码；记录 pending 以便 play() 等待
		this._pendingLoad = PlayerLoad(track)
			.then(() => { this._pendingLoad = null; })
			.catch((e) => {
				this._pendingLoad = null;
				console.error('PlayerLoad 失败:', e);
				this.emit('error', e);
			});
	}

	play() {
		const doPlay = () => { try { PlayerPlay(); } catch (e) { console.warn('PlayerPlay failed:', e); } };
		if (this._pendingLoad) {
			this._pendingLoad.then(doPlay);
		} else {
			doPlay();
		}
	}

	pause() {
		try { PlayerPause(); } catch (e) { console.warn('PlayerPause failed:', e); }
	}

	toggle() {
		if (this._isPlaying) {
			this.pause();
		} else {
			this.play();
		}
	}

	seek(time) {
		if (typeof time !== 'number' || time < 0) return;
		try { PlayerSeek(time); } catch (e) { console.warn('PlayerSeek failed:', e); }
	}

	// 设置音量（按当前 volume_mode 路由到对应后端接口）
	setVolume(value) {
		const vol = Math.max(0, Math.min(100, Math.round(value)));
		this._volume = vol;
		try { localStorage.setItem('volume', vol.toString()); } catch (e) {}
		try {
			if (this._volumeMode === 'master') {
				SetSystemMasterVolume(vol);
			} else {
				SetApplicationVolume(vol);
			}
		} catch (e) { console.warn('setVolume failed:', e); }
	}

	getVolume() {
		return this._volume;
	}

	// 切换音量模式
	async setVolumeMode(mode) {
		if (mode !== 'synth' && mode !== 'master') return;
		this._volumeMode = mode;
		try { localStorage.setItem('musicLite.volumeMode', mode); } catch (e) {}
		try {
			const realVol = mode === 'master'
				? await GetSystemMasterVolume()
				: await GetApplicationVolume();
			if (typeof realVol === 'number' && !isNaN(realVol)) {
				this._volume = realVol;
				try { localStorage.setItem('volume', realVol.toString()); } catch (e) {}
			}
		} catch (e) {
			console.warn('setVolumeMode 读取音量失败:', e);
		}
		this.emit('volumemodechange', mode);
		this.emit('volumechange', this._volume);
	}

	getVolumeMode() {
		return this._volumeMode;
	}

	getCurrentTime() {
		return this._currentTime;
	}

	getDuration() {
		return this._duration;
	}

	isPlaying() {
		return this._isPlaying;
	}

	// 切换播放模式（委托后端）
	async togglePlayMode() {
		try {
			const mode = await PlayerTogglePlayMode();
			this.playMode = mode;
			try { localStorage.setItem('playMode', mode); } catch (e) {}
			this.emit('modechange', mode);
			return mode;
		} catch (e) {
			console.warn('togglePlayMode failed:', e);
			return this.playMode;
		}
	}

	getPlayMode() {
		return this.playMode;
	}

	// 从后端实时查询最新播放模式
	async fetchPlayMode() {
		try {
			const mode = await PlayerGetPlayMode();
			if (mode && mode !== this.playMode) {
				this.playMode = mode;
				try { localStorage.setItem('playMode', mode); } catch (e) {}
				this.emit('modechange', mode);
			}
			return mode;
		} catch (e) {
			console.warn('fetchPlayMode failed:', e);
			return this.playMode;
		}
	}

	// 清除当前曲目
	clearTrack() {
		try { PlayerStop(); } catch (e) { console.warn('PlayerStop failed:', e); }
		this.currentTrack = null;
		this._isPlaying = false;
		this._currentTime = 0;
		this._duration = 0;
		try { localStorage.removeItem('currentTrack'); } catch (e) {}
		try { localStorage.removeItem('currentTime'); } catch (e) {}
		try { localStorage.setItem('isPlaying', '0'); } catch (e) {}
		this.emit('trackcleared');
	}

	// ============ 事件系统（与旧版完全兼容） ============
	on(event, callback) {
		if (!this.listeners.has(event)) {
			this.listeners.set(event, []);
		}
		this.listeners.get(event).push(callback);
	}

	off(event, callback) {
		if (this.listeners.has(event)) {
			const callbacks = this.listeners.get(event);
			const index = callbacks.indexOf(callback);
			if (index > -1) {
				callbacks.splice(index, 1);
			}
		}
	}

	emit(event, data) {
		if (this.listeners.has(event)) {
			[...this.listeners.get(event)].forEach(callback => callback(data));
		}
	}

	// ============ 初始状态恢复（页面加载时调用一次） ============
	// 轮询已经覆盖初始状态同步，这里只触发一次立即轮询 + 同步音量
	async restore() {
		// 立即轮询一次（不等 500ms 定时器）
		await this._pollState();
		// 同步音量
		try {
			const vol = this._volumeMode === 'master'
				? await GetSystemMasterVolume()
				: await GetApplicationVolume();
			if (typeof vol === 'number' && !isNaN(vol)) {
				this._volume = vol;
				try { localStorage.setItem('volume', vol.toString()); } catch (e) {}
			}
		} catch (e) {
			// IPC 未就绪，轮询会在后续自动同步
		}
	}
}

// 每个页面独立创建实例
window.audioManager = new AudioManager();
