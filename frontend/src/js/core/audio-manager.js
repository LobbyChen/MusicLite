// audio-manager.js — 音频播放管理器（事件驱动版）
//
// 设计：Go 后端是播放状态的唯一可信源，并通过 Wails Events 主动推送：
//   player:state       → 播放/暂停、时长、曲目 ID
//   player:timeupdate  → 播放进度
//   player:trackloaded → 新曲目加载完成
//   player:modechange  → 播放模式变化
//   player:ended       → 播放结束
//
// 前端不再周期性轮询 PlayerGetState，只在页面恢复时做一次快照读取。
//
// 对外保留与旧版完全相同的事件接口：
//   play / pause / timeupdate / loadedmetadata / trackloaded /
//   trackcleared / modechange / volumemodechange / volumechange /
//   ended / error

import { PlayerLoad, PlayerPlay, PlayerPause, PlayerSeek, PlayerStop, PlayerGetState, PlayerTogglePlayMode, PlayerGetPlayMode, SetApplicationVolume, GetApplicationVolume, SetSystemMasterVolume, GetSystemMasterVolume } from './bindings.js';
import { Events } from '@wailsio/runtime';

class AudioManager {
	constructor() {
		this.currentTrack = null;
		this.listeners = new Map();

		// 播放状态缓存（来自后端事件，前端只读）
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
		// 播放意图：加载完成前用户又点了暂停时，避免延迟的 PlayerPlay 覆盖暂停
		this._playRequested = false;
		// 加载序号：切换曲目时丢弃上一次加载完成后的延迟播放
		this._loadSeq = 0;

		// 订阅后端事件
		this._bindEvents();
	}

	// Wails v3 的 Events.On 回调参数是 WailsEvent { name, data }，这里统一解包
	_unwrapEvent(e) {
		if (e && typeof e === 'object' && Object.prototype.hasOwnProperty.call(e, 'data')) {
			return e.data;
		}
		return e;
	}

	// ============ 后端事件订阅 ============
	_bindEvents() {
		try {
			Events.On('player:state', (e) => this._applyState(this._unwrapEvent(e)));
			Events.On('player:timeupdate', (e) => this._applyTimeUpdate(this._unwrapEvent(e)));
			Events.On('player:trackloaded', (e) => this._applyTrackLoaded(this._unwrapEvent(e)));
			Events.On('player:modechange', (e) => this._applyMode(this._unwrapEvent(e)));
			Events.On('player:ended', () => {
				this._isPlaying = false;
				this._currentTime = 0;
				this.emit('ended');
			});
			// 托盘播放/暂停
			Events.On('tray:toggle-play', () => {
				this.toggle();
			});
		} catch (e) {
			console.warn('订阅播放器事件失败:', e);
		}
	}

	// 应用后端状态快照（播放/暂停、时长、曲目清除）
	_applyState(state) {
		if (!state) return;

		// trackId=0 表示后端已停止/清除曲目。
		// 注意：PlayerGetState 快照没有 trackId 字段（undefined），不能用 undefined 判断清除，
		// 否则 restore() 刚恢复的曲目会被立即清掉，导致跨页后迷你播放器不显示、无播放态。
		if (state.trackId === 0 && this.currentTrack) {
			this.currentTrack = null;
			this._currentTime = 0;
			this._duration = 0;
			try { localStorage.removeItem('currentTrack'); } catch (e) {}
			this.emit('trackcleared');
		}

		const wasPlaying = this._isPlaying;
		this._isPlaying = !!state.isPlaying;
		if (this._isPlaying && !wasPlaying) {
			this.emit('play');
		} else if (!this._isPlaying && wasPlaying) {
			this.emit('pause');
		}

		if (typeof state.duration === 'number' && state.duration > 0 && state.duration !== this._duration) {
			this._duration = state.duration;
			this.emit('loadedmetadata', { duration: this._duration });
		}
		if (typeof state.position === 'number') {
			this._currentTime = state.position;
		}
		if (state.playMode) {
			this._applyMode(state.playMode);
		}
	}

	// 播放进度事件
	_applyTimeUpdate(payload) {
		if (!payload) return;
		if (typeof payload.duration === 'number' && payload.duration > 0) {
			this._duration = payload.duration;
		}
		if (typeof payload.position !== 'number') return;
		this._currentTime = payload.position;
		this.emit('timeupdate', {
			currentTime: this._currentTime,
			duration: this._duration
		});
	}

	// 后端加载新曲完成
	_applyTrackLoaded(payload) {
		const track = payload && (payload.track || payload);
		if (!track || track.id === undefined || track.id === null) return;

		const isSame = this.currentTrack && Number(this.currentTrack.id) === Number(track.id);
		this.currentTrack = track;
		if (typeof payload.duration === 'number' && payload.duration > 0) {
			this._duration = payload.duration;
		}
		try { localStorage.setItem('currentTrack', JSON.stringify(track)); } catch (e) {}
		document.title = track.name || track.Name || 'MusicLite';

		// loadTrack() 已经乐观地 emit 过同曲目，避免重复重置歌词/UI
		if (!isSame) {
			this.emit('trackloaded', track);
		}
		if (this._duration > 0) {
			this.emit('loadedmetadata', { duration: this._duration });
		}
	}

	_applyMode(mode) {
		if (!mode || mode === this.playMode) return;
		this.playMode = mode;
		try { localStorage.setItem('playMode', mode); } catch (e) {}
		this.emit('modechange', mode);
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
		// 同曲目跳过，避免重复解码打断后端播放（不能清除播放意图：
		// 点击曲目后 openPlayer 会再次 loadTrack 同曲，此时首次 play() 仍应生效）
		if (this._sameTrack(track)) {
			this.currentTrack = track;
			try { localStorage.setItem('currentTrack', JSON.stringify(track)); } catch (e) {}
			this.emit('trackloaded', track);
			return;
		}
		// 新曲目加载会清除上一次的播放意图，由调用方 play() 重新置位
		this._playRequested = false;
		const seq = ++this._loadSeq;
		this.currentTrack = track;
		this._currentTime = 0;
		this._duration = 0;
		this._isPlaying = false;
		try { localStorage.setItem('currentTrack', JSON.stringify(track)); } catch (e) {}
		document.title = track.name || track.Name || 'MusicLite';
		this.emit('trackloaded', track);

		// 提交到后端解码；记录 pending 以便 play() 等待
		this._pendingLoad = PlayerLoad(track)
			.then(() => { if (seq === this._loadSeq) this._pendingLoad = null; })
			.catch((e) => {
				if (seq === this._loadSeq) this._pendingLoad = null;
				console.error('PlayerLoad 失败:', e);
				this.emit('error', e);
			});
	}

	play() {
		this._playRequested = true;
		const seq = this._loadSeq;
		const doPlay = () => {
			// 加载期间用户可能已点暂停或切换了曲目：此时不能再补发播放
			if (!this._playRequested || seq !== this._loadSeq) return;
			try { PlayerPlay(); } catch (e) { console.warn('PlayerPlay failed:', e); }
		};
		if (this._pendingLoad) {
			this._pendingLoad.then(doPlay);
		} else {
			doPlay();
		}
	}

	pause() {
		this._playRequested = false;
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
			this._applyMode(mode);
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
			this._applyMode(mode);
			return mode;
		} catch (e) {
			console.warn('fetchPlayMode failed:', e);
			return this.playMode;
		}
	}

	// 清除当前曲目
	clearTrack() {
		this._playRequested = false;
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

	// ============ 初始状态恢复（页面加载时调用一次，不做持续轮询） ============
	async restore() {
		// 跨页/跨窗口同步音量模式（设置窗口切换后本窗口内存中的模式可能已过期）
		try {
			const storedMode = localStorage.getItem('musicLite.volumeMode');
			if (storedMode === 'synth' || storedMode === 'master') {
				this._volumeMode = storedMode;
			}
		} catch (e) {}

		try {
			const state = await PlayerGetState();
			if (state) {
				if (state.track) {
					this._applyTrackLoaded({ track: state.track, duration: state.duration });
				}
				this._applyState(state);
			}
		} catch (e) {
			// IPC 未就绪：后续事件会补齐状态
		}

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
			// IPC 未就绪，保留缓存值
		}
	}
}

// 单例：页面通过 import 共享同一个实例，避免重复订阅与状态分裂。
export const audioManager = new AudioManager();
export default audioManager;

// 迁移期兼容：旧代码仍可通过 window.audioManager 访问。
window.audioManager = audioManager;
