// audio-manager.js — 音频播放管理器（后端驱动版）
//
// 重构后音频解码与输出全部在 Go 后端完成（player.go），前端只负责控制。
// Go 后端是播放状态的唯一可信源，通过 Wails Events 推送状态；本类是前端的
// 薄封装，对外保留与旧版相同的事件接口（play/pause/timeupdate/loadedmetadata/
// ended/trackloaded/trackcleared/modechange），让 player.js / libraries.js
// 以最小改动迁移。
//
// 跨页连续性：Go 进程在前端切页时持续播放，本类在构造时订阅后端事件，
// restore() 时向后端查询一次状态快照并同步 UI，无需依赖 localStorage 续播。
import { PlayerLoad, PlayerPlay, PlayerPause, PlayerSeek, PlayerStop, PlayerGetState, PlayerTogglePlayMode, PlayerGetPlayMode, SetApplicationVolume, GetApplicationVolume, SetSystemMasterVolume, GetSystemMasterVolume } from '../../wailsjs/go/main/App.js';
import { EventsOn } from '../../wailsjs/runtime/runtime.js';

class AudioManager {
	constructor() {
		this.currentTrack = null;
		this.listeners = new Map();

		// 播放状态缓存（来自后端事件，前端只读）
		this._isPlaying = false;
		this._currentTime = 0;
		this._duration = 0;
		this._volume = 70;

		// 音量模式：'synth'（合成器，由后端 Player 控制）| 'master'（系统主音量）
		// 与 settings.js 共享 localStorage key 'musicLite.volumeMode'
		this._volumeMode = localStorage.getItem('musicLite.volumeMode') || 'synth';

		// 播放模式: 'none' | 'loopOne' | 'random'（缓存后端值，localStorage 用于即时 UI）
		this.playMode = localStorage.getItem('playMode') || 'none';

		// 加载中标记：loadTrack 返回的 Promise，play() 需等待它完成避免空播放
		this._pendingLoad = null;

		this._bindBackendEvents();
	}

	// 订阅后端推送的播放器事件
	_bindBackendEvents() {
		// 曲目加载完成：同步元数据与时长
		EventsOn('player:trackloaded', (data) => {
			if (!data) return;
			const track = data.track;
			if (track) {
				this.currentTrack = track;
				try { localStorage.setItem('currentTrack', JSON.stringify(track)); } catch (e) {}
				document.title = track.name || track.Name || 'MusicLite';
				this.emit('trackloaded', track);
			}
			if (data.duration && data.duration !== this._duration) {
				this._duration = data.duration;
				this.emit('loadedmetadata', { duration: this._duration });
			}
		});

		// 状态变更：播放/暂停/停止
		EventsOn('player:state', (data) => {
			if (!data) return;
			if (typeof data.duration === 'number' && data.duration > 0 && data.duration !== this._duration) {
				this._duration = data.duration;
				this.emit('loadedmetadata', { duration: this._duration });
			}
			if (typeof data.position === 'number') {
				this._currentTime = data.position;
			}
			const wasPlaying = this._isPlaying;
			this._isPlaying = !!data.isPlaying;
			if (this._isPlaying && !wasPlaying) {
				this.emit('play');
			} else if (!this._isPlaying && wasPlaying) {
				this.emit('pause');
			}
		});

		// 周期位置更新（仅播放中）
		EventsOn('player:timeupdate', (data) => {
			if (!data) return;
			if (typeof data.position === 'number') this._currentTime = data.position;
			if (typeof data.duration === 'number' && data.duration > 0 && data.duration !== this._duration) {
				this._duration = data.duration;
				this.emit('loadedmetadata', { duration: this._duration });
			}
			this.emit('timeupdate', {
				currentTime: this._currentTime,
				duration: this._duration
			});
		});

		// 曲目自然结束（后端已处理单曲循环，这里仅顺序/随机模式触发）
		EventsOn('player:ended', () => {
			this._isPlaying = false;
			this._currentTime = 0;
			this.emit('ended');
		});

		// 播放模式变更
		EventsOn('player:modechange', (mode) => {
			this.playMode = mode;
			try { localStorage.setItem('playMode', mode); } catch (e) {}
			this.emit('modechange', mode);
		});
	}

	// 比较曲目是否相同（按 id）
	_sameTrack(track) {
		if (!track || !this.currentTrack) return false;
		if (track.id !== undefined && this.currentTrack.id !== undefined) {
			return track.id === this.currentTrack.id;
		}
		return false;
	}

	// 加载曲目：调用后端解码并构建播放管线（加载后处于暂停态）
	loadTrack(track) {
		if (!track || track.id === undefined || track.id === null) return;
		// 同曲目跳过，避免重复解码打断后端播放
		if (this._sameTrack(track)) {
			this.currentTrack = track; // 更新可能变更的字段
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
	// synth 模式 → SetApplicationVolume（后端 Player beep effects.Volume）
	// master 模式 → SetSystemMasterVolume（Windows 系统主音量）
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

	// 切换音量模式（设置页点击 synth/master 时调用）
	// 切换后从对应音源读取真实音量并更新缓存，让播放器滑块立即反映新模式
	async setVolumeMode(mode) {
		if (mode !== 'synth' && mode !== 'master') return;
		this._volumeMode = mode;
		try { localStorage.setItem('musicLite.volumeMode', mode); } catch (e) {}
		// 读取新模式下的真实音量并更新缓存
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

	// 切换播放模式（委托后端，后端处理单曲循环）
	// 后端会通过 player:modechange 事件同步，这里也乐观更新返回值
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

	// 从后端实时查询最新播放模式并同步缓存（用于 playNextTrack 等关键决策点）
	// 避免 togglePlayMode 异步未完成或跨页状态不同步时读到旧值
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

	// 清除当前曲目（曲目被删除等场景）
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

	// 事件系统
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
			this.listeners.get(event).forEach(callback => callback(data));
		}
	}

	// 从后端恢复播放状态（页面加载时调用一次）
	// Go 进程跨页持久播放，这里只查询快照并同步 UI
	async restore() {
		try {
			const state = await PlayerGetState();
			if (state && state.track) {
				this.currentTrack = state.track;
				this._isPlaying = !!state.isPlaying;
				this._currentTime = state.position || 0;
				this._duration = state.duration || 0;
				// 音量按 volume_mode 从对应音源读取真实值（master 模式下 PlayerGetState 的 volume 不代表系统音量）
				try {
					this._volume = this._volumeMode === 'master'
						? await GetSystemMasterVolume()
						: (state.volume || await GetApplicationVolume());
					if (typeof this._volume !== 'number' || isNaN(this._volume)) this._volume = 70;
					try { localStorage.setItem('volume', this._volume.toString()); } catch (e) {}
				} catch (e) {
					this._volume = state.volume || 70;
				}
				try { localStorage.setItem('currentTrack', JSON.stringify(state.track)); } catch (e) {}
				document.title = state.track.name || state.track.Name || 'MusicLite';
				this.emit('trackloaded', state.track);
				if (this._duration > 0) {
					this.emit('loadedmetadata', { duration: this._duration });
				}
				if (this._isPlaying) {
					this.emit('play');
				} else {
					this.emit('pause');
				}
			}
			// 同步播放模式
			try {
				const mode = await PlayerGetPlayMode();
				if (mode) {
					this.playMode = mode;
					try { localStorage.setItem('playMode', mode); } catch (e) {}
				}
			} catch (e) {}
		} catch (e) {
			console.warn('restore 查询后端状态失败:', e);
		}
	}
}

// 每个页面独立创建实例
window.audioManager = new AudioManager();

// 监听托盘"播放/暂停"菜单事件（由后端 tray.go 通过 Wails EventsEmit 发送）
if (window.runtime && typeof window.runtime.EventsOn === 'function') {
	window.runtime.EventsOn('tray:toggle-play', () => {
		window.audioManager.toggle();
	});
}
