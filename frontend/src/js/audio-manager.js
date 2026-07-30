// audio-manager.js — 音频播放管理器
// 每个页面独立实例，通过 localStorage 同步曲目、播放位置、播放状态
// 切换页面时新页面会从上次位置自动续播
class AudioManager {
	constructor() {
		this.audio = document.createElement('audio');
		this.audio.preload = 'metadata';
		this.currentTrack = null;
		this.listeners = new Map();

		// 播放模式: 'none' (顺序/默认), 'loopOne' (单曲循环), 'random' (随机)
		this.playMode = localStorage.getItem('playMode') || 'none';

		// 音频事件监听
		this.audio.addEventListener('play', () => {
			localStorage.setItem('isPlaying', '1');
			this.emit('play');
		});
		this.audio.addEventListener('pause', () => {
			// 只有用户主动暂停才写 '0'；页面卸载导致的 pause 不覆盖
			// 通过 beforeunload 里设置的 _unloading 标志区分
			if (!this._unloading) {
				localStorage.setItem('isPlaying', '0');
			}
			localStorage.setItem('currentTime', this.audio.currentTime.toString());
			this.emit('pause');
		});
		this.audio.addEventListener('ended', () => {
			// 单曲循环：播放结束后自动回到开头重播
			if (this.playMode === 'loopOne') {
				this.audio.currentTime = 0;
				this.audio.play().catch(e => console.warn('Loop replay failed:', e));
				return; // 不触发 ended 事件，保持播放
			}
			
			localStorage.setItem('isPlaying', '0');
			localStorage.setItem('currentTime', '0');
			this.emit('ended');
		});
		this.audio.addEventListener('timeupdate', () => {
			// 持续保存播放位置（每秒更新一次足够）
			const t = Math.floor(this.audio.currentTime);
			if (t !== this._lastSavedTime) {
				this._lastSavedTime = t;
				localStorage.setItem('currentTime', t.toString());
			}
			this.emit('timeupdate', {
				currentTime: this.audio.currentTime,
				duration: this.audio.duration
			});
		});
		this.audio.addEventListener('loadedmetadata', () => this.emit('loadedmetadata', {
			duration: this.audio.duration
		}));
		// 页面卸载前保存当前位置和播放状态
		// 用 pagehide + beforeunload 双保险，确保跨页时状态被保存
		const saveStateOnUnload = () => {
			this._unloading = true;
			if (this.audio && !isNaN(this.audio.currentTime)) {
				localStorage.setItem('currentTime', this.audio.currentTime.toString());
			}
			// 保存当前播放状态，供下个页面 restore 判断是否续播
			localStorage.setItem('isPlaying', this.isPlaying() ? '1' : '0');
		};
		window.addEventListener('beforeunload', saveStateOnUnload);
		window.addEventListener('pagehide', saveStateOnUnload);
	}
	
	loadTrack(track) {
		if (!track || !track.src) return;
		this.currentTrack = track;
        document.title = track.name || track.Name || 'MusicLite';
		this.audio.src = track.src;
		this.audio.load();
		// 保存到 localStorage 以便其他页面恢复
		localStorage.setItem('currentTrack', JSON.stringify(track));
		localStorage.setItem('currentTime', '0');
		localStorage.setItem('isPlaying', '0');
		this.emit('trackloaded', track);
	}
	
	play() {
		if (this.audio.src) {
			this.audio.play().catch(e => console.warn('Play failed:', e));
		}
	}
	
	pause() {
		this.audio.pause();
	}
	
	toggle() {
		if (this.audio.paused) {
			this.play();
		} else {
			this.pause();
		}
	}
	
	seek(time) {
		if (this.audio.duration && time >= 0 && time <= this.audio.duration) {
			this.audio.currentTime = time;
		}
	}
	
	setVolume(value) {
		this.audio.volume = Math.max(0, Math.min(1, value));
		localStorage.setItem('volume', this.audio.volume.toString());
	}
	
	getVolume() {
		return this.audio.volume;
	}
	
	getCurrentTime() {
		return this.audio.currentTime;
	}
	
	getDuration() {
		return this.audio.duration || 0;
	}
	
	isPlaying() {
		return !this.audio.paused;
	}
	
	// 切换播放模式
	togglePlayMode() {
		const modes = ['none', 'loopOne', 'random'];
		const currentIndex = modes.indexOf(this.playMode);
		const nextIndex = (currentIndex + 1) % modes.length;
		this.playMode = modes[nextIndex];
		
		localStorage.setItem('playMode', this.playMode);
		this.emit('modechange', this.playMode);
		return this.playMode;
	}

	getPlayMode() {
		return this.playMode;
	}

	// 清除当前曲目（用于曲目已删除的场景）
	clearTrack() {
		this.audio.pause();
		this.audio.removeAttribute('src');
		this.audio.load();
		this.currentTrack = null;
		localStorage.removeItem('currentTrack');
		localStorage.removeItem('currentTime');
		localStorage.setItem('isPlaying', '0');
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
	
	// 从 localStorage 恢复曲目信息
	restore() {
		const savedTrack = localStorage.getItem('currentTrack');
		const wasPlaying = localStorage.getItem('isPlaying') === '1';
		if (savedTrack) {
			try {
				const track = JSON.parse(savedTrack);
				this.currentTrack = track;
				this.audio.src = track.src;
				this.audio.load();
				// 恢复播放位置（等 metadata 加载后 seek）
				const savedTime = parseFloat(localStorage.getItem('currentTime') || '0');
				const onMeta = () => {
					if (savedTime > 0 && savedTime < this.audio.duration) {
						this.audio.currentTime = savedTime;
					}
					// 如果之前在播放，跨页恢复后继续播放
					if (wasPlaying) {
						this.audio.play().catch(e => console.warn('Restore play failed:', e));
					} else {
						localStorage.setItem('isPlaying', '0');
					}
					this.audio.removeEventListener('loadedmetadata', onMeta);
				};
				this.audio.addEventListener('loadedmetadata', onMeta);
				this.emit('trackloaded', track);
			} catch (e) {
				console.warn('Failed to restore track:', e);
			}
		}
		const savedVolume = localStorage.getItem('volume');
		if (savedVolume) {
			this.audio.volume = parseFloat(savedVolume);
		}

	}
}

// 每个页面独立创建实例
window.audioManager = new AudioManager();