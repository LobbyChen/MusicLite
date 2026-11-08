// 封面工具：默认封面、缓存破坏与封面元素填充
export const DEFAULT_COVER_HTML = '<div class="card-icon"><svg viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"></path></svg></div>';

// 封面缓存破坏时间戳：每次手动更换封面后更新，避免 /cover/<id> URL 不变导致浏览器一直用旧缓存
// 持久化到 localStorage：页面跳转（模块重新加载）后仍能沿用，保证迷你播放器/播放器不会显示旧封面
const COVER_BUST_KEY = 'musicLite.coverBustTs';
let coverBustTs = 0;
try {
    const saved = parseInt(localStorage.getItem(COVER_BUST_KEY) || '', 10);
    if (!isNaN(saved) && saved > 0) coverBustTs = saved;
} catch (e) { }

// 更新缓存破坏时间戳（封面变更后调用）
export function bustCoverCache() {
    coverBustTs = Date.now();
    try { localStorage.setItem(COVER_BUST_KEY, coverBustTs.toString()); } catch (e) { }
}

// 给封面 URL 追加缓存破坏参数（?v=ts），确保后端封面更新后立即生效
export function bustCoverUrl(url) {
    if (!url) return url;
    if (coverBustTs <= 0) return url;
    const sep = url.includes('?') ? '&' : '?';
    return url + sep + 'v=' + coverBustTs;
}

// 设置封面元素内容（img 或 div 容器）
export function setCover(el, coverUrl) {
    if (!el) return;
    if (coverUrl) {
        el.innerHTML = `<img src="${bustCoverUrl(coverUrl)}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;" />`;
    } else {
        el.innerHTML = DEFAULT_COVER_HTML;
    }
}
