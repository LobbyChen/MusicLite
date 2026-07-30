// audio-manager.js — 音频播放管理器
// 每个页面独立实例，通过 localStorage 同步曲目、播放位置、播放状态
// 切换页面时新页面会从上次位置自动续播

class AudioManager {
    constructor() {
        this.audio = document.createElement('audio');
        this.audio.preload = 'metadata';
        this.currentTrack = null;
        this.listeners = new Map();

        // 音频事件监听
        this.audio.addEventListener('play', () => {
            localStorage.setItem('isPlaying', '1');
            this.emit('play');
        });
        this.audio.addEventListener('pause', () => {
            localStorage.setItem('isPlaying', '0');
            localStorage.setItem('currentTime', this.audio.currentTime.toString());
            this.emit('pause');
        });
        this.audio.addEventListener('ended', () => {
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

        // 页面卸载前保存当前位置
        window.addEventListener('beforeunload', () => {
            if (this.audio && !isNaN(this.audio.currentTime)) {
                localStorage.setItem('currentTime', this.audio.currentTime.toString());
            }
        });
    }

    loadTrack(track) {
        if (!track || !track.src) return;
        this.currentTrack = track;
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

    // 从 localStorage 恢复播放状态并自动续播
    restore() {
        const savedTrack = localStorage.getItem('currentTrack');
        if (savedTrack) {
            try {
                const track = JSON.parse(savedTrack);
                this.currentTrack = track;
                this.audio.src = track.src;
                this.audio.load();

                // 恢复播放位置
                const savedTime = parseFloat(localStorage.getItem('currentTime') || '0');
                const wasPlaying = localStorage.getItem('isPlaying') === '1';

                // 等 metadata 加载后再 seek 和播放
                const onMeta = () => {
                    if (savedTime > 0 && savedTime < this.audio.duration) {
                        this.audio.currentTime = savedTime;
                    }
                    if (wasPlaying) {
                        // 自动续播
                        this.audio.play().catch(e => console.warn('Auto-resume failed:', e));
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