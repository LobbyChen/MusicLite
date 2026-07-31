// audio-manager.js — 音频播放管理器（单一可信源：this.audio.paused）
// 每个页面独立实例，通过 localStorage 同步曲目、播放位置、播放状态
// 切换页面时新页面会从上次位置自动续播
class AudioManager {
	constructor() {
		this.audio = document.createElement('audio');
		this.audio.preload = 'auto'; // 切页续播时提前缓冲，避免 play() 因 readyState 不够挂死
		this.currentTrack = null;
		this.listeners = new Map();

		// 状态标志：屏蔽切页 / reload 等场景的假 play/pause 事件
		this._unloading = false;      // 页面卸载中（beforeunload/pagehide）
		this._restoring = false;      // restore() 过程中（屏蔽 load 产生的假 pause）
		this._loadingTrack = false;   // loadTrack() 过程中

		// 播放模式: 'none' (顺序/默认), 'loopOne' (单曲循环), 'random' (随机)
		this.playMode = localStorage.getItem('playMode') || 'none';

		// 音频事件监听
		this.audio.addEventListener('play', () => {
			if (this._unloading || this._restoring || this._loadingTrack) {
				// 屏蔽过程性 play 事件，但仍然同步 localStorage 真实状态
				localStorage.setItem('isPlaying', '1');
				this.emit('play');
				return;
			}
			localStorage.setItem('isPlaying', '1');
			this.emit('play');
		});
		this.audio.addEventListener('pause', () => {
			// 假 pause：卸载 / restore 中 reload / loadTrack 中 load
			// → 不要写入 isPlaying='0' 覆盖真实状态
			if (this._unloading || this._restoring || this._loadingTrack) {
				localStorage.setItem('currentTime', this.audio.currentTime.toString());
				this.emit('pause');
				return;
			}
			localStorage.setItem('isPlaying', '0');
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

	// 比较 src 路径（去掉 file:// 前缀）和 id 判断是否同一曲目
	_sameTrack(track) {
		if (!track || !track.src || !this.currentTrack || !this.currentTrack.src) return false;
		if (track.id !== undefined && this.currentTrack.id !== undefined) {
			return track.id === this.currentTrack.id;
		}
		const normalize = s => String(s).replace(/^file:\/\//i, '').replace(/\\/g, '/').toLowerCase();
		return normalize(track.src) === normalize(this.currentTrack.src);
	}

	loadTrack(track) {
		if (!track || !track.src) return;
		// 同 src/id 直接跳过，避免 load() 打断正在的播放
		if (this._sameTrack(track)) {
			return;
		}
		this._loadingTrack = true;
		try {
			this.currentTrack = track;
			document.title = track.name || track.Name || 'MusicLite';
			this.audio.src = track.src;
			this.audio.load();
			// 保存到 localStorage 以便其他页面恢复
			localStorage.setItem('currentTrack', JSON.stringify(track));
			localStorage.setItem('currentTime', '0');
			localStorage.setItem('isPlaying', '0');
			this.emit('trackloaded', track);
		} finally {
			// 延迟清除标志，给 load() 触发的 pause 事件留出时间
			setTimeout(() => { this._loadingTrack = false; }, 100);
		}
	}

	// 确保 readyState 足够后再 play，避免浏览器因缓冲未到而挂死
	_ensureCanPlayThenPlay() {
		return new Promise((resolve, reject) => {
			const doPlay = () => {
				this.audio.play().then(resolve).catch(reject);
			};
			// readyState 2 = HAVE_CURRENT_DATA，已可以播放
			if (this.audio.readyState >= 2 || !this.audio.src) {
				doPlay();
				return;
			}
			const onCanPlay = () => {
				this.audio.removeEventListener('canplay', onCanPlay);
				doPlay();
			};
			const onErr = (e) => {
				this.audio.removeEventListener('canplay', onCanPlay);
				this.audio.removeEventListener('error', onErr);
				reject(e);
			};
			this.audio.addEventListener('canplay', onCanPlay);
			this.audio.addEventListener('error', onErr, { once: true });
			// 超时兜底 8s
			setTimeout(() => {
				this.audio.removeEventListener('canplay', onCanPlay);
				this.audio.removeEventListener('error', onErr);
				doPlay();
			}, 8000);
		});
	}

	play() {
		if (!this.audio.src) return;
		this._ensureCanPlayThenPlay().catch(e => console.warn('Play failed:', e));
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
		this._loadingTrack = true;
		try {
			this.audio.pause();
			this.audio.removeAttribute('src');
			this.audio.load();
			this.currentTrack = null;
			localStorage.removeItem('currentTrack');
			localStorage.removeItem('currentTime');
			localStorage.setItem('isPlaying', '0');
			this.emit('trackcleared');
		} finally {
			setTimeout(() => { this._loadingTrack = false; }, 100);
		}
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
	// - 同 src/id 的曲目：只 seek + play，不重新 load，避免打断正在的播放
	restore() {
		const savedTrack = localStorage.getItem('currentTrack');
		const wasPlaying = localStorage.getItem('isPlaying') === '1';
		const savedTime = parseFloat(localStorage.getItem('currentTime') || '0');
		const savedVolume = localStorage.getItem('volume');

		if (savedVolume) {
			let vol = parseFloat(savedVolume);
			if (vol > 1) vol = vol / 100;
			this.audio.volume = Math.max(0, Math.min(1, vol));
		}

		if (!savedTrack) return;

		try {
			const track = JSON.parse(savedTrack);
			// 同 src/id：只应用 currentTrack + seek + 按 wasPlaying 续播
			if (this._sameTrack(track)) {
				this.currentTrack = track; // 更新字段（title/artist 可能更新了）
				this._restoring = true;
				const tryFinish = () => {
					if (savedTime > 0 && (!this.audio.duration || savedTime < this.audio.duration)) {
						try { this.audio.currentTime = savedTime; } catch (e) {}
					}
					if (wasPlaying) {
						this.play();
					} else {
						if (!this.isPlaying()) localStorage.setItem('isPlaying', '0');
					}
					setTimeout(() => { this._restoring = false; }, 100);
					this.emit('trackloaded', track);
				};
				if (this.audio.readyState >= 2) {
					tryFinish();
				} else {
					const onReady = () => {
						this.audio.removeEventListener('loadedmetadata', onReady);
						tryFinish();
					};
					this.audio.addEventListener('loadedmetadata', onReady);
					setTimeout(onReady, 5000); // 兜底避免一直不触发
				}
				return;
			}

			// 不同 src/id：走标准 load + restore
			this._restoring = true;
			this.currentTrack = track;
			this.audio.src = track.src;
			this.audio.load();
			const onMeta = () => {
				if (savedTime > 0 && savedTime < this.audio.duration) {
					try { this.audio.currentTime = savedTime; } catch (e) {}
				}
				if (wasPlaying) {
					this.play();
				} else {
					localStorage.setItem('isPlaying', '0');
				}
				this.audio.removeEventListener('loadedmetadata', onMeta);
				setTimeout(() => { this._restoring = false; }, 100);
				this.emit('trackloaded', track);
			};
			this.audio.addEventListener('loadedmetadata', onMeta);
			setTimeout(() => {
				this.audio.removeEventListener('loadedmetadata', onMeta);
				this._restoring = false;
			}, 10000);
		} catch (e) {
			this._restoring = false;
			console.warn('Failed to restore track:', e);
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