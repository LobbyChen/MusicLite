// 音乐库页共享状态
export const state = {
    currentTrack: null,   // 当前曲目
    allTracks: [],        // 后端返回的全部曲目（未过滤、未排序）
    currentQuery: '',     // 当前搜索关键词
    currentSort: 'recent',// 当前排序方式：recent | title | artist | album
    onlyMode: false,      // 单向模式状态
    defaultFile: null,    // 启动参数传入的文件
};

// 正在播放的动态条指示器（纯 CSS 动画，无 emoji）
export const NP_BARS_HTML = '<span class="np-bars" aria-hidden="true"><i></i><i></i><i></i></span>';
