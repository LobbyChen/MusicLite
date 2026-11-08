// ============ 播放器对比度自动调整 ============
// 封面作为 player-overlay 的模糊背景（opacity 0.40 + blur 5px），叠加在 --bg-color 上。
// 策略：
//   亮色背景 (brightness > 0.6) → 强制深色文字/控件
//   深色背景 (brightness < 0.35) → 强制浅色文字/控件
//   中间区间 (0.35 ~ 0.6) → 跟随主题默认色，若主题默认对比度不足则自动兜底
// 播放器封面亮度分析：根据封面平均亮度调整播放器 overlay 文字/控件对比度
export const PlayerContrast = {
    lastCoverUrl: null,
    lastBrightness: 0.5, // 0=纯黑 1=纯白

    // 计算相对对比度（WCAG 简化版），返回 0-21，>=4.5 为合格
    _contrastRatio(l1, l2) {
        const lighter = Math.max(l1, l2);
        const darker = Math.min(l1, l2);
        return (lighter + 0.05) / (darker + 0.05);
    },

    // 分析图片平均亮度（0-1），失败返回 0.5
    analyzeBrightness(url) {
        return new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                try {
                    const size = 32;
                    const canvas = document.createElement('canvas');
                    canvas.width = size;
                    canvas.height = size;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, size, size);
                    const data = ctx.getImageData(0, 0, size, size).data;
                    let total = 0;
                    const count = data.length / 4;
                    for (let i = 0; i < data.length; i += 4) {
                        // 感知亮度公式（Rec. 601）
                        total += (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
                    }
                    resolve(total / count);
                } catch (e) {
                    // canvas 被跨域污染，无法读取像素，返回中性值
                    resolve(0.5);
                }
            };
            img.onerror = () => resolve(0.5);
            img.src = url;
        });
    },

    // 清除 overlay 上所有 PlayerContrast 注入的样式，让主题色生效
    _clearOverrides(overlay) {
        const props = [
            '--bg-color', '--card-bg',
            '--text-primary', '--text-secondary',
            '--player-btn-bg', '--player-btn-bg-hover', '--player-btn-fg',
            '--overlay-border-color',
            '--overlay-ctrl-btn-bg', '--overlay-ctrl-btn-bg-hover',
            '--overlay-card-bg', '--overlay-card-border',
            '--overlay-slider-thumb-active'
        ];
        props.forEach(p => overlay.style.removeProperty(p));
    },

    // 根据封面的"有效背景亮度"调整 #player-overlay 上的文字与控件颜色
    // effectiveBrightness：封面亮度 × 0.4 + 主题背景亮度 × 0.6（因为 bgLayer opacity=0.4）
    apply(coverBrightness) {
        this.lastBrightness = coverBrightness;
        const overlay = document.getElementById('player-overlay');
        if (!overlay) return;

        // 获取主题背景的实际亮度（读取计算后的 --bg-color）
        const rootStyle = getComputedStyle(document.documentElement);
        let themeBg = rootStyle.getPropertyValue('--bg-color').trim();
        if (!themeBg) themeBg = '#121212';
        let themeBgRgb;
        const m = themeBg.match(/^#([0-9a-f]{6})$/i);
        if (m) {
            themeBgRgb = [parseInt(m[1].slice(0,2),16), parseInt(m[1].slice(2,4),16), parseInt(m[1].slice(4,6),16)];
        } else {
            themeBgRgb = [18, 18, 18];
        }
        const themeBgLum = (0.299 * themeBgRgb[0] + 0.587 * themeBgRgb[1] + 0.114 * themeBgRgb[2]) / 255;

        // 有效背景亮度 = 封面 40% + 主题背景 60%（bgLayer opacity=0.4）
        const effective = coverBrightness * 0.4 + themeBgLum * 0.6;

        // 获取主题默认文字亮度用于检查对比度
        let themeFg = rootStyle.getPropertyValue('--text-primary').trim() || '#ffffff';
        let fgRgb;
        const mf = themeFg.match(/^#([0-9a-f]{6})$/i);
        if (mf) {
            fgRgb = [parseInt(mf[1].slice(0,2),16), parseInt(mf[1].slice(2,4),16), parseInt(mf[1].slice(4,6),16)];
        } else {
            fgRgb = [255, 255, 255];
        }
        const themeFgLum = (0.299 * fgRgb[0] + 0.587 * fgRgb[1] + 0.114 * fgRgb[2]) / 255;
        const defaultContrast = this._contrastRatio(effective, themeFgLum);

        // ========= 决定使用"深色方案"还是"浅色方案"还是"主题跟随" =========
        if (effective > 0.60) {
            // ===== 亮色背景 → 强制深色方案 =====
            // overlay 背景与容器：变浅色，让全屏歌词和主播放器背景一致
            overlay.style.setProperty('--bg-color', '#f5f5f5');
            overlay.style.setProperty('--card-bg', '#ffffff');
            overlay.style.setProperty('--text-primary', '#1a1a1a');
            overlay.style.setProperty('--text-secondary', '#555555');
            overlay.style.setProperty('--overlay-border-color', 'rgba(0, 0, 0, 0.18)');
            // 播放按钮：浅底深字
            overlay.style.setProperty('--player-btn-bg', '#ffffff');
            overlay.style.setProperty('--player-btn-bg-hover', '#e8e8e8');
            overlay.style.setProperty('--player-btn-fg', '#1a1a1a');
            // 其他控制按钮（prev/next/loop 等）：hover 背景用深色半透明
            overlay.style.setProperty('--overlay-ctrl-btn-bg', 'rgba(0, 0, 0, 0.05)');
            overlay.style.setProperty('--overlay-ctrl-btn-bg-hover', 'rgba(0, 0, 0, 0.12)');
            // 歌词卡片：浅色底 + 深色细边
            overlay.style.setProperty('--overlay-card-bg', 'rgba(255, 255, 255, 0.95)');
            overlay.style.setProperty('--overlay-card-border', 'rgba(0, 0, 0, 0.12)');
            // 滑块按下的 thumb：保持 accent
            overlay.style.setProperty('--overlay-slider-thumb-active', 'var(--accent-color)');
        } else if (effective < 0.35) {
            // ===== 深色背景 → 强制浅色方案 =====
            // overlay 背景与容器：变深色
            overlay.style.setProperty('--bg-color', '#0d0d0d');
            overlay.style.setProperty('--card-bg', '#1a1a1a');
            overlay.style.setProperty('--text-primary', '#ffffff');
            overlay.style.setProperty('--text-secondary', '#c0c0c0');
            overlay.style.setProperty('--overlay-border-color', 'rgba(255, 255, 255, 0.14)');
            // 播放按钮：深底浅字
            overlay.style.setProperty('--player-btn-bg', '#1a1a1a');
            overlay.style.setProperty('--player-btn-bg-hover', '#333333');
            overlay.style.setProperty('--player-btn-fg', '#ffffff');
            // 其他控制按钮：hover 背景用浅色半透明
            overlay.style.setProperty('--overlay-ctrl-btn-bg', 'rgba(255, 255, 255, 0.04)');
            overlay.style.setProperty('--overlay-ctrl-btn-bg-hover', 'rgba(255, 255, 255, 0.10)');
            // 歌词卡片：深色底 + 浅色细边
            overlay.style.setProperty('--overlay-card-bg', 'rgba(30, 30, 30, 0.95)');
            overlay.style.setProperty('--overlay-card-border', 'rgba(255, 255, 255, 0.1)');
            // 滑块按下的 thumb：保持 accent
            overlay.style.setProperty('--overlay-slider-thumb-active', 'var(--accent-color)');
        } else {
            // ===== 中间区间：跟随主题，但如果对比度不足则兜底 =====
            if (defaultContrast < 4.5) {
                // 对比度不合格：选择更合适的强制方案
                if (effective > 0.475) {
                    // 偏亮但没到阈值，用深色方案兜底
                    overlay.style.setProperty('--bg-color', '#f5f5f5');
                    overlay.style.setProperty('--card-bg', '#ffffff');
                    overlay.style.setProperty('--text-primary', '#1a1a1a');
                    overlay.style.setProperty('--text-secondary', '#555555');
                    overlay.style.setProperty('--overlay-border-color', 'rgba(0, 0, 0, 0.18)');
                    overlay.style.setProperty('--player-btn-bg', '#ffffff');
                    overlay.style.setProperty('--player-btn-bg-hover', '#e8e8e8');
                    overlay.style.setProperty('--player-btn-fg', '#1a1a1a');
                    overlay.style.setProperty('--overlay-ctrl-btn-bg', 'rgba(0, 0, 0, 0.05)');
                    overlay.style.setProperty('--overlay-ctrl-btn-bg-hover', 'rgba(0, 0, 0, 0.12)');
                    overlay.style.setProperty('--overlay-card-bg', 'rgba(255, 255, 255, 0.95)');
                    overlay.style.setProperty('--overlay-card-border', 'rgba(0, 0, 0, 0.12)');
                } else {
                    // 偏暗但没到阈值，用浅色方案兜底
                    overlay.style.setProperty('--bg-color', '#0d0d0d');
                    overlay.style.setProperty('--card-bg', '#1a1a1a');
                    overlay.style.setProperty('--text-primary', '#ffffff');
                    overlay.style.setProperty('--text-secondary', '#c0c0c0');
                    overlay.style.setProperty('--overlay-border-color', 'rgba(255, 255, 255, 0.14)');
                    overlay.style.setProperty('--player-btn-bg', '#1a1a1a');
                    overlay.style.setProperty('--player-btn-bg-hover', '#333333');
                    overlay.style.setProperty('--player-btn-fg', '#ffffff');
                    overlay.style.setProperty('--overlay-ctrl-btn-bg', 'rgba(255, 255, 255, 0.04)');
                    overlay.style.setProperty('--overlay-ctrl-btn-bg-hover', 'rgba(255, 255, 255, 0.10)');
                    overlay.style.setProperty('--overlay-card-bg', 'rgba(30, 30, 30, 0.95)');
                    overlay.style.setProperty('--overlay-card-border', 'rgba(255, 255, 255, 0.1)');
                }
            } else {
                // 对比度合格：清除所有覆盖，让主题默认值生效
                this._clearOverrides(overlay);
            }
        }
    },

    // 供 player.js 在 loadTrack 时调用：根据封面 URL 异步调整
    async adjustFromCover(url) {
        this.lastCoverUrl = url;
        if (!url) {
            // 无封面：清除覆盖，回到主题色
            this.apply(0.5);
            return;
        }
        const brightness = await this.analyzeBrightness(url);
        // 封面加载是异步的，若期间又切了歌，以最新的为准
        if (this.lastCoverUrl !== url) return;
        this.apply(brightness);
    },

    // 主题色变化后重新评估（用上次测得的亮度，避免重新读图）
    reapply() {
        if (this.lastCoverUrl) {
            this.apply(this.lastBrightness);
        } else {
            // 无封面时清除覆盖
            const overlay = document.getElementById('player-overlay');
            if (overlay) this._clearOverrides(overlay);
        }
    },
};
