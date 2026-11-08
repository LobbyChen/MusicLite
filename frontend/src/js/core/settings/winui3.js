// ============================================================
// WinUI3 全页面布局：新UI开启时为音乐库和设计器生成左侧导航栏并重组 DOM
// ============================================================

// WinUI3 图标
const W3_ICONS = {
  library: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><line x1="8" y1="7" x2="16" y2="7"/><line x1="8" y1="11" x2="13" y2="11"/></svg>',
  
  queue: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
  
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>',
  
  designer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>',
  
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>',
  
  appearance: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18V3z" fill="currentColor" stroke="none"/></svg>',
  
  shape: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="3"/></svg>',
  
  light: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="M4.93 4.93l1.41 1.41"/><path d="M17.66 17.66l1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="M6.34 17.66l-1.41 1.41"/><path d="M19.07 4.93l-1.41 1.41"/></svg>',
  
  animation: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/><path d="M19 12h3"/><path d="M19 8h2"/><path d="M19 16h2"/></svg>',
  
  layout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="3" y1="9" x2="9" y2="9"/></svg>'
};

// 为音乐库页面生成 WinUI3 左侧导航并重组 DOM
function applyLibrariesWinUI3() {
    if (document.querySelector('.winui3-page-nav')) return;

    const header = document.querySelector('header');
    const main = document.querySelector('main');
    if (!header || !main) return;

    // i18n 获取翻译（支持 fallback + 占位符参数传递）
    // 用法：t(key, 'fallback文本', 'param0', 'param1') 或 t(key, 'fallback', { count: 5 })
    const t = (key, ...args) => {
        try {
            if (window.i18n && typeof window.i18n.t === 'function') {
                const v = window.i18n.t(key, ...args);
                if (v !== undefined && v !== null) return v;
            }
            if (window.I18N && typeof window.I18N.t === 'function') {
                const v = window.I18N.t(key, ...args);
                if (v !== undefined && v !== null) return v;
            }
        } catch (e) {}
        // 兜底：若 args[0] 是字符串（即 fallback），返回它；否则返回原始 key
        if (args.length > 0 && typeof args[0] === 'string') return args[0];
        return key;
    };

    // 创建左侧导航
    const nav = document.createElement('nav');
    nav.className = 'winui3-page-nav';

    // 导航头部（标题）
    const navHeader = document.createElement('div');
    navHeader.className = 'winui3-nav-header';
    navHeader.innerHTML = '<span class="winui3-nav-title">MusicLite</span>';
    nav.appendChild(navHeader);

    // 导航项
    const navList = document.createElement('div');
    navList.className = 'winui3-nav-list';
    const items = [
        { id: 'library',  labelKey: 'libraries.title',       fallback: '音乐库',     icon: W3_ICONS.library,  active: true },
        { id: 'queue',    labelKey: 'player.queue',          fallback: '播放队列',   icon: W3_ICONS.queue },
        { id: 'settings', labelKey: 'common.settings',       fallback: '设置',       icon: W3_ICONS.settings, url: '/#/settings' },
    ];

    // 收集 main 内原始的"音乐库"子内容（全部），后续用于切换显示
    const libraryPane = document.createElement('div');
    libraryPane.className = 'w3-pane w3-pane--library';
    while (main.firstChild) libraryPane.appendChild(main.firstChild);

    // 创建"队列"面板：把原 #libQueueSidebar 内部结构迁移成内嵌 section
    const queuePane = document.createElement('div');
    queuePane.className = 'w3-pane w3-pane--queue';
    queuePane.style.display = 'none';

    // 队列头部：标题 + 数量徽章 + 洗牌/清空操作
    const queueHeader = document.createElement('div');
    queueHeader.className = 'w3-queue-header';
    queueHeader.innerHTML = `
        <div class="w3-queue-title-group">
            <h2 class="w3-queue-title" data-i18n="player.queue">${t('player.queue', '播放队列')}</h2>
            <span class="w3-queue-badge" id="w3QueueBadge" style="display:none;">0</span>
        </div>
        <div class="w3-queue-actions">
            <button class="btn w3-queue-action" id="w3QueueShuffleBtn" title="${t('player.queueShuffle', '洗牌')}" data-i18n-title="player.queueShuffle">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>
                <span data-i18n="player.queueShuffle">${t('player.queueShuffle', '洗牌')}</span>
            </button>
            <button class="btn w3-queue-action" id="w3QueueClearBtn" title="${t('player.queueClear', '清空')}" data-i18n-title="player.queueClear">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                <span data-i18n="player.queueClear">${t('player.queueClear', '清空')}</span>
            </button>
        </div>
    `;
    const queueListWrap = document.createElement('div');
    queueListWrap.className = 'w3-queue-dropzone';
    queueListWrap.id = 'libQueueList'; // 保持原有 id，复用现有 renderLibQueueList / bindLibQueueItemEvents
    queueListWrap.innerHTML = `<div class="queue-empty" data-i18n="player.queueEmpty">${t('player.queueEmpty', '队列为空，右键曲目加入队列')}</div>`;
    queuePane.appendChild(queueHeader);
    queuePane.appendChild(queueListWrap);

    main.appendChild(libraryPane);
    main.appendChild(queuePane);

    // 把旧的 sidebar 队列 DOM 内容清掉（只保留空壳，避免影响旧 UI 代码引用，但切换到新布局时隐藏）
    const oldSidebar = document.getElementById('libQueueSidebar');
    const oldOverlay = document.getElementById('libQueueOverlay');
    if (oldSidebar) oldSidebar.style.display = 'none';
    if (oldOverlay) oldOverlay.style.display = 'none';

    // 同步 badge id：保持旧 id 可用
    const newBadge = queueHeader.querySelector('#w3QueueBadge');
    if (newBadge) {
        newBadge.id = 'libQueueBadge'; // 替换 id，复用旧逻辑
    }

    items.forEach(item => {
        const btn = document.createElement('button');
        btn.className = 'winui3-nav-item' + (item.active ? ' active' : '');
        btn.dataset.navPane = item.id;
        const label = t(item.labelKey, item.fallback);
        // 关键：写入 data-i18n，让后续 applyTranslations() 能在 i18n 数据就绪后重新翻译。
        // 本函数在 DOMContentLoaded 阶段同步执行，往往早于后端 i18n 数据加载完成，
        // 此时 t() 只能返回中文 fallback；若不挂 data-i18n，侧边栏会一直停留在中文。
        btn.innerHTML = '<span class="winui3-nav-icon">' + item.icon + '</span><span class="winui3-nav-label" data-i18n="' + item.labelKey + '">' + label + '</span>';
        if (item.url) {
            btn.addEventListener('click', () => { window.location.href = item.url; });
        } else if (item.id === 'library') {
            btn.addEventListener('click', () => {
                libraryPane.style.display = '';
                queuePane.style.display = 'none';
                navList.querySelectorAll('.winui3-nav-item').forEach(n => n.classList.remove('active'));
                btn.classList.add('active');
                document.body.classList.remove('w3-pane-queue');
                document.body.classList.add('w3-pane-library');
            });
        } else if (item.id === 'queue') {
            btn.addEventListener('click', () => {
                libraryPane.style.display = 'none';
                queuePane.style.display = '';
                navList.querySelectorAll('.winui3-nav-item').forEach(n => n.classList.remove('active'));
                btn.classList.add('active');
                document.body.classList.remove('w3-pane-library');
                document.body.classList.add('w3-pane-queue');
                // 队列显示时刷新（若刷新函数可用）
                try { if (typeof window.refreshLibQueue === 'function') window.refreshLibQueue(); } catch (_) {}
                try { if (typeof refreshLibQueue === 'function') refreshLibQueue(); } catch (_) {}
            });
        }
        navList.appendChild(btn);
    });
    nav.appendChild(navList);

    // 创建内容包裹容器
    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'winui3-content-wrapper';

    // 将 header 和 main 移入容器
    header.parentNode.insertBefore(nav, header);
    header.parentNode.insertBefore(contentWrapper, header);
    contentWrapper.appendChild(header);
    contentWrapper.appendChild(main);

    document.body.classList.add('w3-pane-library');

    // 把洗牌/清空按钮绑定到既有行为：沿用旧 id 按钮触发（如果存在）
    const w3Shuffle = document.getElementById('w3QueueShuffleBtn');
    const w3Clear = document.getElementById('w3QueueClearBtn');
    const legacyShuffle = document.getElementById('libQueueShuffleBtn');
    const legacyClear = document.getElementById('libQueueClearBtn');
    if (w3Shuffle && legacyShuffle) {
        w3Shuffle.addEventListener('click', () => legacyShuffle.click());
    }
    if (w3Clear && legacyClear) {
        w3Clear.addEventListener('click', () => legacyClear.click());
    }
}

// 移除 WinUI3 页面布局
function removeWinUI3PageLayout() {
    // 清理歌词行 MutationObserver
    if (window._lyricLineObserver) {
        window._lyricLineObserver.disconnect();
        window._lyricLineObserver = null;
    }
    // 播放器 overlay：先还原 DOM（搬走的元素回原位 + 移除 w3-* 容器）
    try { restorePlayerWinUI3(); } catch (e) { console.warn('restorePlayerWinUI3 failed:', e); }
    // 音乐库：恢复 DOM
    const libNav = document.querySelector('.winui3-page-nav');
    if (libNav) {
        const wrapper = document.querySelector('.winui3-content-wrapper');
        if (wrapper) {
            const header = wrapper.querySelector('header');
            const main = wrapper.querySelector('main');
            if (header && main) {
                wrapper.parentNode.insertBefore(header, wrapper);
                wrapper.parentNode.insertBefore(main, wrapper);
            }
            wrapper.remove();
        }
        libNav.remove();
    }
}

// ============================================================
// WinUI3 Player Overlay Builder (player-overlay 新结构)
// 将既有 #coverImg / #trackName / #backBtn / #playBtn 等 DOM 搬入新的 WinUI3 结构，
// 以保持原有事件监听器不丢失，同时 CSS 控制新旧结构显示切换。
//
// 关键设计决策：
//   - 整体搬迁 lyricsWrapper（而非仅 lyricsContent），保证 player.js 中
//     lyricsWrapperEl.clientHeight 滚动计算在 New UI 下仍有效。
//   - SVG 仅清除 width/height 属性，保留 viewBox，避免图标比例失调。
//   - 滑块继续复用旧 .track-bg / .progress-fill 元素（player.js 通过
//     updateProgressFill 直接操作其 style.width），CSS 不再使用 ::after 伪填充，
//     消除"双重填充条"问题。
//   - 返回按钮置于左上 header 内，符合 WinUI3 NavigationView 返回锚点惯例。
// ============================================================
function applyPlayerWinUI3() {
    const overlay = document.getElementById('player-overlay');
    if (!overlay || overlay.dataset.wui3Player === 'true') return;
    const container = overlay.querySelector(':scope > .player-container');
    if (!container) return;

    // i18n helper：支持 fallback + 占位符参数传递
    const t = (key, ...args) => {
        try {
            if (window.i18n && typeof window.i18n.t === 'function') {
                const v = window.i18n.t(key, ...args);
                if (v !== undefined && v !== null) return v;
            }
            if (window.I18N && typeof window.I18N.t === 'function') {
                const v = window.I18N.t(key, ...args);
                if (v !== undefined && v !== null) return v;
            }
        } catch (e) {}
        // 兜底：若 args[0] 是字符串（即 fallback），返回它；否则返回原始 key
        if (args.length > 0 && typeof args[0] === 'string') return args[0];
        return key;
    };

    // SVG 清理：仅移除 width/height 属性让 CSS 接管尺寸，保留 viewBox 保证缩放比例。
    // 同时将原始 width/height 暂存到 dataset，供 restorePlayerWinUI3 还原。
    const cleanSvg = (el) => {
        if (!el) return;
        const svgs = el.tagName === 'SVG' ? [el] : Array.from(el.querySelectorAll('svg'));
        svgs.forEach(svg => {
            if (svg.dataset.w3OrigW === undefined) {
                svg.dataset.w3OrigW = svg.getAttribute('width') || '';
                svg.dataset.w3OrigH = svg.getAttribute('height') || '';
            }
            svg.removeAttribute('width');
            svg.removeAttribute('height');
            svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        });
    };

    // 取出旧元素（带事件监听器，通过 id 保持 player.js 引用有效）
    const oldCover = document.getElementById('coverImg');
    const oldTrackName = document.getElementById('trackName');
    const oldArtist = document.getElementById('artistName');
    const oldLyricsWrapper = document.getElementById('lyricsWrapper');
    const oldLyricsContent = document.getElementById('lyricsContent');
    const oldLyrPrevBtn = document.getElementById('lyricPrevBtn');
    const oldLyrNextBtn = document.getElementById('lyricNextBtn');
    const oldFSToggleBtn = document.getElementById('expandFullscreenBtn');
    const oldProgress = document.querySelector('.progress-area');
    const oldCurt = document.getElementById('currentTime');
    const oldTota = document.getElementById('totalDuration');
    const oldSeek = document.getElementById('seekSlider');
    const oldSeekFill = document.getElementById('seekProgress');
    const oldSeekBg = oldProgress ? oldProgress.querySelector('.track-bg') : null;
    const oldLoop = document.getElementById('loopBtn');
    const oldPrev = document.getElementById('prevBtn');
    const oldPlay = document.getElementById('playBtn');
    const oldNext = document.getElementById('nextBtn');
    const oldEq = document.getElementById('eqBtn');
    const oldQueue = document.getElementById('queueBtn');
    const oldBack = document.getElementById('backBtn');
    const oldVolCtrl = document.querySelector('.volume-control');
    const oldVolIcon = document.getElementById('volIcon');
    const oldVolSlider = document.getElementById('volSlider');
    const oldVolFill = document.getElementById('volProgress');

    // 预记录所有将搬动元素的原始位置（parent + previousElementSibling），
    // 供 restorePlayerWinUI3 还原。必须在任何 appendChild 之前采集，
    // 否则 previousElementSibling 会随搬动而改变。
    const toMove = [
        oldBack, oldCover, oldTrackName, oldArtist, oldLyricsWrapper,
        oldSeekBg, oldSeekFill, oldSeek, oldCurt, oldTota,
        oldLoop, oldEq, oldQueue, oldPrev, oldPlay, oldNext, oldVolCtrl
    ].filter(Boolean);
    overlay._w3Moves = toMove.map(el => ({
        el, parent: el.parentNode, prev: el.previousElementSibling
    }));

    // ============================================================
    // 0) 顶部 header：左返回 + 右占位（保持 grid 三行结构）
    // ============================================================
    const header = document.createElement('div');
    header.className = 'w3-player-header';
    if (oldBack) {
        oldBack.classList.add('w3-back-btn');
        oldBack.setAttribute('data-i18n-title', 'player.backToLibrary');
        oldBack.title = t('player.backToLibrary', '返回音乐库');
        cleanSvg(oldBack);
        header.appendChild(oldBack);
    }

    // ============================================================
    // 1) Content (中部：左封面+信息 / 右歌词)
    // ============================================================
    const content = document.createElement('div');
    content.className = 'w3-player-content';

    const pcLeft = document.createElement('div');
    pcLeft.className = 'w3-pc-left';
    const coverWrap = document.createElement('div');
    coverWrap.className = 'w3-cover-wrap';
    if (oldCover) {
        oldCover.classList.add('w3-cover');
        coverWrap.appendChild(oldCover);
    }
    pcLeft.appendChild(coverWrap);

    const info = document.createElement('div');
    info.className = 'w3-track-info';
    if (oldTrackName) {
        oldTrackName.classList.add('w3-track-title');
        info.appendChild(oldTrackName);
    }
    if (oldArtist) {
        oldArtist.classList.add('w3-track-artist');
        info.appendChild(oldArtist);
    }
    pcLeft.appendChild(info);

    const pcRight = document.createElement('div');
    pcRight.className = 'w3-pc-right';
    const lyrCard = document.createElement('div');
    lyrCard.className = 'w3-lyrics-card';

    // 歌词工具栏：上一句 / 全屏切换 / 下一句
    const lyrTool = document.createElement('div');
    lyrTool.className = 'w3-lyrics-toolbar';
    const makeLyrBtn = (oldBtn, titleKey, titleFallback) => {
        if (!oldBtn) return null;
        const b = document.createElement('button');
        b.className = 'w3-lyrics-btn';
        b.type = 'button';
        b.title = t(titleKey, titleFallback);
        b.setAttribute('data-i18n-title', titleKey);
        b.innerHTML = oldBtn.innerHTML;
        cleanSvg(b);
        b.addEventListener('click', (e) => { e.stopPropagation(); oldBtn.click(); });
        return b;
    };
    const fsBtn = makeLyrBtn(oldFSToggleBtn, 'player.fullscreenLyrics', '全屏歌词');
    if (fsBtn) lyrTool.appendChild(fsBtn);
    lyrCard.appendChild(lyrTool);

    // 歌词内容：整体搬迁 lyricsWrapper（保留 player.js 的 clientHeight 滚动计算）
    if (oldLyricsWrapper) {
        oldLyricsWrapper.classList.add('w3-lyrics-wrapper');
        lyrCard.appendChild(oldLyricsWrapper);
        // 持续为新生成的 .lyric-line 注入 w3-lyric-line 类
        if (oldLyricsContent) {
            oldLyricsContent.querySelectorAll('.lyric-line').forEach(l => l.classList.add('w3-lyric-line'));
            if (window._lyricLineObserver) window._lyricLineObserver.disconnect();
            window._lyricLineObserver = new MutationObserver(() => {
                oldLyricsContent.querySelectorAll('.lyric-line:not(.w3-lyric-line)').forEach(l => l.classList.add('w3-lyric-line'));
            });
            window._lyricLineObserver.observe(oldLyricsContent, { childList: true });
        }
    }
    pcRight.appendChild(lyrCard);

    content.appendChild(pcLeft);
    content.appendChild(pcRight);

    // ============================================================
    // 2) 紧凑 Playback Controls (底部：进度 + 控件)
    // ============================================================
    const bottom = document.createElement('div');
    bottom.className = 'w3-player-bottom';

    const progRow = document.createElement('div');
    progRow.className = 'w3-progress-row';
    const curt = document.createElement('span');
    curt.className = 'w3-time';
    if (oldCurt) curt.appendChild(oldCurt); else curt.textContent = '0:00';
    const tota = document.createElement('span');
    tota.className = 'w3-time';
    if (oldTota) tota.appendChild(oldTota); else tota.textContent = '0:00';
    const seekSlider = document.createElement('div');
    seekSlider.className = 'w3-slider w3-seek-slider';
    if (oldSeekBg) seekSlider.appendChild(oldSeekBg);
    if (oldSeekFill) seekSlider.appendChild(oldSeekFill);
    if (oldSeek) seekSlider.appendChild(oldSeek);
    progRow.appendChild(curt);
    progRow.appendChild(seekSlider);
    progRow.appendChild(tota);
    bottom.appendChild(progRow);

    const ctrlRow = document.createElement('div');
    ctrlRow.className = 'w3-controls-row';
    const crLeft = document.createElement('div');
    crLeft.className = 'w3-cr-left';
    const crCenter = document.createElement('div');
    crCenter.className = 'w3-cr-center';
    const crRight = document.createElement('div');
    crRight.className = 'w3-cr-right';

    // 按钮搬迁：保留 id 与状态类（active / btn-pause 等），仅追加 w3-ctrl-btn 类。
    // CSS 通过更高优先级选择器覆盖旧 .btn 样式，无需 !important 战争。
    const moveBtn = (oldBtn, extraClass) => {
        if (!oldBtn) return;
        oldBtn.classList.add('w3-ctrl-btn');
        if (extraClass) oldBtn.classList.add(extraClass);
        cleanSvg(oldBtn);
        return oldBtn;
    };

    crLeft.appendChild(moveBtn(oldLoop) || document.createElement('span'));
    crLeft.appendChild(moveBtn(oldEq, 'w3-tool-btn') || document.createElement('span'));
    crLeft.appendChild(moveBtn(oldQueue, 'w3-tool-btn') || document.createElement('span'));

    crCenter.appendChild(moveBtn(oldPrev) || document.createElement('span'));
    crCenter.appendChild(moveBtn(oldPlay, 'w3-play-btn') || document.createElement('span'));
    crCenter.appendChild(moveBtn(oldNext) || document.createElement('span'));

    // 右：音量（整组搬迁，内部 slider 容器加 w3-slider 类）
    if (oldVolCtrl) {
        oldVolCtrl.classList.add('w3-volume');
        const sliderBox = oldVolCtrl.querySelector('.volume-slider-container');
        if (sliderBox) sliderBox.classList.add('w3-slider', 'w3-vol-slider');
        if (oldVolIcon) {
            oldVolIcon.classList.add('w3-volume-icon');
            cleanSvg(oldVolIcon);
        }
        crRight.appendChild(oldVolCtrl);
    }

    ctrlRow.appendChild(crLeft);
    ctrlRow.appendChild(crCenter);
    ctrlRow.appendChild(crRight);
    bottom.appendChild(ctrlRow);

    // ============================================================
    // 组装：header → content → bottom
    // ============================================================
    container.appendChild(header);
    container.appendChild(content);
    container.appendChild(bottom);

    // 隐藏旧结构（info-and-controls 与 album-art-wrapper 已被搬空，但仍保留壳）
    const oldInfo = container.querySelector(':scope > .info-and-controls');
    const oldAlbumWrap = container.querySelector(':scope > .album-art-wrapper');
    if (oldInfo) oldInfo.style.display = 'none';
    if (oldAlbumWrap) oldAlbumWrap.style.display = 'none';

    overlay.dataset.wui3Player = 'true';

    // 重新应用 i18n（新生成的 DOM 带有 data-i18n-title 属性）
    try {
        if (typeof window.applyTranslations === 'function') window.applyTranslations();
        else if (window.i18n && typeof window.i18n.applyTranslations === 'function') window.i18n.applyTranslations();
    } catch (e) {}
}

// ============================================================
// restorePlayerWinUI3：将 applyPlayerWinUI3 搬走的元素还原到原始位置，
// 并移除新创建的 w3-* 容器。用于关闭 New UI 时恢复播放器原始结构。
// 依据 overlay._w3Moves（预记录的 parent + previousElementSibling）按
// 原始顺序逐个插回，保证按钮/滑块等元素回到正确的 DOM 位置。
// ============================================================
function restorePlayerWinUI3() {
    const overlay = document.getElementById('player-overlay');
    if (!overlay || overlay.dataset.wui3Player !== 'true') return;
    const container = overlay.querySelector(':scope > .player-container');
    const moves = overlay._w3Moves;

    // 1) 先把搬走的元素放回原 parent（此时 w3-* 容器仍存在，元素从其中取出）
    if (moves && moves.length) {
        // 按 parent 分组，组内按 previousElementSibling 链还原原始顺序
        const byParent = new Map();
        moves.forEach(m => {
            if (!m.el || !m.parent) return;
            if (!byParent.has(m.parent)) byParent.set(m.parent, []);
            byParent.get(m.parent).push(m);
        });
        byParent.forEach(list => {
            // 用 prev 链推导原始顺序：prev=null 最先，之后按链拼接
            const byPrev = new Map();
            let head = null;
            list.forEach(m => {
                if (m.prev === null) head = m;
                else byPrev.set(m.prev, m);
            });
            const ordered = [];
            let cur = head;
            // 兜底：若链断开（head 为空），退回原数组顺序
            if (!head && list.length) ordered.push(...list);
            let guard = 0;
            while (cur && guard++ < list.length + 1) {
                ordered.push(cur);
                cur = byPrev.get(cur.el) || null;
            }
            ordered.forEach(({ el, parent, prev }) => {
                try {
                    if (prev && prev.parentNode === parent) {
                        parent.insertBefore(el, prev.nextSibling);
                    } else if (prev === null) {
                        parent.insertBefore(el, parent.firstChild);
                    } else {
                        parent.appendChild(el);
                    }
                } catch (e) {
                    try { parent.appendChild(el); } catch (_) {}
                }
            });
        });
    }

    // 2) 移除新创建的 w3-* 容器（此时元素已取出，容器为空壳）
    if (container) {
        container.querySelectorAll(':scope > .w3-player-header, :scope > .w3-player-content, :scope > .w3-player-bottom').forEach(el => el.remove());
    }

    // 3) 显示旧壳
    if (container) {
        const oldInfo = container.querySelector(':scope > .info-and-controls');
        const oldAlbumWrap = container.querySelector(':scope > .album-art-wrapper');
        if (oldInfo) oldInfo.style.display = '';
        if (oldAlbumWrap) oldAlbumWrap.style.display = '';
    }

    // 4) 清理 w3-* 类与 SVG 属性还原
    if (moves && moves.length) {
        moves.forEach(({ el }) => {
            if (!el || !el.classList) return;
            Array.from(el.classList).forEach(c => { if (c.startsWith('w3-')) el.classList.remove(c); });
            el.querySelectorAll('svg').forEach(svg => {
                if (svg.dataset.w3OrigW !== undefined) {
                    const w = svg.dataset.w3OrigW;
                    const h = svg.dataset.w3OrigH;
                    if (w) svg.setAttribute('width', w); else svg.removeAttribute('width');
                    if (h) svg.setAttribute('height', h); else svg.removeAttribute('height');
                    delete svg.dataset.w3OrigW;
                    delete svg.dataset.w3OrigH;
                }
                svg.removeAttribute('preserveAspectRatio');
            });
        });
    }

    delete overlay._w3Moves;
    overlay.dataset.wui3Player = '';
}

// DOMContentLoaded 后应用 WinUI3 页面布局
export function applyWinUI3PageLayout() {
    if (document.body.getAttribute('data-new-ui') !== 'true') {
        removeWinUI3PageLayout();
        return;
    }
    const page = document.body.getAttribute('data-page');
    if (page === 'libraries') {
        applyLibrariesWinUI3();
        // Player 结构（在 libraries.html 内）需要在 DOM ready 后重组
        try { applyPlayerWinUI3(); } catch (e) { console.warn('applyPlayerWinUI3 failed:', e); }
    }
}
