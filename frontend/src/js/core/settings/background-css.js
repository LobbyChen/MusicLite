// 全页面背景层与 Aero 透明的基础样式（由 background.js 注入一次）
export const BG_CSS = `
/* ===== MusicLite 全局背景层（img/video）基础样式 ===== */
#ml-bg-layer, #ml-bg-overlay {
    position: fixed;
    inset: 0;
    width: 100vw;
    height: 100vh;
    pointer-events: none;
    overflow: hidden;
}
#ml-bg-layer {
    z-index: -2;
    transform-origin: center center;
    will-change: transform, opacity, filter;
}
#ml-bg-overlay {
    z-index: -1;
}
html, body {
    isolation: isolate;
}
/* ============ 整窗 Aero 透明（核心重构）============
   原方案：html { opacity: x } 让所有元素一起透明 → 文字发虚不可读
   新方案：html[data-aero="true"] 标记后，仅让 body 和各容器的背景色变为半透明，
          透出 WebView2 窗口下的桌面；同时给主要容器加 backdrop-filter 毛玻璃，
          实现真正的 Windows Aero 效果：背景朦胧通透，前景文字清晰锐利。
   --aero-*-alpha 控制各层背景色透明度（0=完全透出桌面, 1=完全不透明），
   由 applyWindowAlpha() 根据 window_alpha 值动态计算。 */
html[data-aero="true"] body {
    background-color: color-mix(in srgb, var(--bg-color, #121212) calc(var(--aero-bg-alpha, 1) * 100%), transparent) !important;
}

/* ========== Aero 增强：玻璃质感内发光边框 ==========
   用 box-shadow inset 模拟玻璃边缘的高光/暗角，让半透明容器不只是"透"，而是"玻璃"。
   深色主题 → 顶边 10% 白高光 + 底边 10% 黑暗角
   浅色主题 → 顶边 35% 白高光 + 底边 15% 黑暗角（浅色更需要边框高光区分边界）*/
html[data-aero="true"]:not([data-has-bg="true"]) .media-card,
html[data-aero="true"]:not([data-has-bg="true"]) .media-list-item,
html[data-aero="true"]:not([data-has-bg="true"]) .settings-section,
html[data-aero="true"]:not([data-has-bg="true"]) .designer-sidebar,
html[data-aero="true"]:not([data-has-bg="true"]) .designer-toolbar,
html[data-aero="true"]:not([data-has-bg="true"]) .search-box,
html[data-aero="true"]:not([data-has-bg="true"]) .sort-control,
html[data-aero="true"]:not([data-has-bg="true"]) .view-toggle,
html[data-aero="true"]:not([data-has-bg="true"]) .tab-panel,
html[data-aero="true"]:not([data-has-bg="true"]) .save-bar,
html[data-aero="true"]:not([data-has-bg="true"]) .modal,
html[data-aero="true"]:not([data-has-bg="true"]) .context-menu,
html[data-aero="true"]:not([data-has-bg="true"]) .toast,
html[data-aero="true"]:not([data-has-bg="true"]) .lib-queue-sidebar,
html[data-aero="true"]:not([data-has-bg="true"]) .eq-panel,
html[data-aero="true"]:not([data-has-bg="true"]) .queue-panel {
    box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, calc(var(--aero-border-alpha, 0.5) * 0.18)),
        inset 0 -1px 0 rgba(0, 0, 0, calc(var(--aero-border-alpha, 0.5) * 0.22)),
        0 4px 24px rgba(0, 0, 0, calc(var(--aero-border-alpha, 0.5) * 0.22)) !important;
}
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .media-card,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .media-list-item,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .settings-section,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .designer-sidebar,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .designer-toolbar,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .search-box,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .sort-control,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .view-toggle,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .tab-panel,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .save-bar,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .modal,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .context-menu,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .toast,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .lib-queue-sidebar,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .eq-panel,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .queue-panel {
    box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, calc(var(--aero-border-alpha, 0.5) * 0.55)),
        inset 0 -1px 0 rgba(0, 0, 0, calc(var(--aero-border-alpha, 0.5) * 0.10)),
        0 4px 20px rgba(0, 0, 0, calc(var(--aero-border-alpha, 0.5) * 0.10)) !important;
}
/* 面板级（main / header / winui3-nav）玻璃边框：高光更柔 */
html[data-aero="true"]:not([data-has-bg="true"]) .winui3-nav,
html[data-aero="true"]:not([data-has-bg="true"]) main,
html[data-aero="true"]:not([data-has-bg="true"]) .library-sidebar,
html[data-aero="true"]:not([data-has-bg="true"]) header,
html[data-aero="true"]:not([data-has-bg="true"]) .settings-tabs,
html[data-aero="true"]:not([data-has-bg="true"]) .player-overlay,
html[data-aero="true"]:not([data-has-bg="true"]) .fullscreen-lyrics {
    box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, calc(var(--aero-border-alpha, 0.5) * 0.10)),
        inset 0 -1px 0 rgba(0, 0, 0, calc(var(--aero-border-alpha, 0.5) * 0.12)) !important;
}
/* 标题栏 + 迷你播放器：玻璃质感更强（作为"系统级"条带）*/
html[data-aero="true"]:not([data-has-bg="true"]) .titlebar,
html[data-aero="true"]:not([data-has-bg="true"]) .mini-player {
    box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, calc(var(--aero-border-alpha, 0.5) * 0.22)),
        inset 0 -1px 0 rgba(0, 0, 0, calc(var(--aero-border-alpha, 0.5) * 0.28)),
        0 -2px 18px rgba(0, 0, 0, calc(var(--aero-border-alpha, 0.5) * 0.20)) !important;
}

/* ========== 修复A：关闭毛玻璃时，全局通杀 * 所有元素的 backdrop-filter，一个不漏 ========== */
html[data-glass-disabled="true"],
html[data-glass-disabled="true"] * {
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
}
/* ========== 修复B：关闭毛玻璃时，清除多余 box-shadow / border / outline ========== */
html[data-glass-disabled="true"] .media-card,
html[data-glass-disabled="true"] .media-list-item,
html[data-glass-disabled="true"] .settings-section,
html[data-glass-disabled="true"] .winui3-nav,
html[data-glass-disabled="true"] main,
html[data-glass-disabled="true"] .mini-player,
html[data-glass-disabled="true"] .library-sidebar,
html[data-glass-disabled="true"] .save-bar,
html[data-glass-disabled="true"] .search-box,
html[data-glass-disabled="true"] .tab-panel,
html[data-glass-disabled="true"] .designer-sidebar,
html[data-glass-disabled="true"] .designer-toolbar,
html[data-glass-disabled="true"] .modal,
html[data-glass-disabled="true"] .toast,
html[data-glass-disabled="true"] .context-menu {
    box-shadow: none !important;
    border: none !important;
    outline: none !important;
}

/* ========== 启用毛玻璃：主要容器加 backdrop-filter ==========
   两种场景生效：「有自定义背景图」或「Aero 窗口透明已开启」
   —— 性能优化：仅对小面积容器使用 blur，移除 saturate/brightness 减少GPU开销 ——
   注意：player-overlay / fullscreen-lyrics 不加 backdrop-filter！
   它们是全屏元素，backdrop-filter 会导致 GPU 每帧对全屏纹理做模糊，占用率飙升到 90%。
   它们已有 player-bg-layer（模糊封面背景）提供视觉深度，不需要额外 backdrop-filter。 */
html[data-has-bg="true"] .media-card,
html[data-has-bg="true"] .media-list-item,
html[data-has-bg="true"] .save-bar,
html[data-has-bg="true"] .modal-dialog,
html[data-has-bg="true"] .modal-content,
html[data-has-bg="true"] .context-menu,
html[data-has-bg="true"] .settings-section,
html[data-has-bg="true"] .mini-player,
html[data-has-bg="true"] .toast,
html[data-has-bg="true"] .designer-sidebar,
html[data-has-bg="true"] .designer-toolbar,
html[data-has-bg="true"] .tab-panel,
html[data-has-bg="true"] .search-box,
html[data-has-bg="true"] .sort-control,
html[data-has-bg="true"] .view-toggle,
html[data-has-bg="true"] main,
html[data-has-bg="true"] header,
html[data-has-bg="true"] .winui3-nav,
html[data-has-bg="true"] .settings-main,
html[data-has-bg="true"] .library-sidebar,
html[data-has-bg="true"] .settings-tabs,
/* ↓↓↓ Aero 透明模式下也启用毛玻璃，即使没有自定义背景 ↓↓↓ */
html[data-aero="true"]:not([data-has-bg="true"]) .media-card,
html[data-aero="true"]:not([data-has-bg="true"]) .media-list-item,
html[data-aero="true"]:not([data-has-bg="true"]) .save-bar,
html[data-aero="true"]:not([data-has-bg="true"]) .modal-dialog,
html[data-aero="true"]:not([data-has-bg="true"]) .modal-content,
html[data-aero="true"]:not([data-has-bg="true"]) .context-menu,
html[data-aero="true"]:not([data-has-bg="true"]) .settings-section,
html[data-aero="true"]:not([data-has-bg="true"]) .mini-player,
html[data-aero="true"]:not([data-has-bg="true"]) .toast,
html[data-aero="true"]:not([data-has-bg="true"]) .designer-sidebar,
html[data-aero="true"]:not([data-has-bg="true"]) .designer-toolbar,
html[data-aero="true"]:not([data-has-bg="true"]) .tab-panel,
html[data-aero="true"]:not([data-has-bg="true"]) .search-box,
html[data-aero="true"]:not([data-has-bg="true"]) .sort-control,
html[data-aero="true"]:not([data-has-bg="true"]) .view-toggle,
html[data-aero="true"]:not([data-has-bg="true"]) main,
html[data-aero="true"]:not([data-has-bg="true"]) header,
html[data-aero="true"]:not([data-has-bg="true"]) .winui3-nav,
html[data-aero="true"]:not([data-has-bg="true"]) .settings-main,
html[data-aero="true"]:not([data-has-bg="true"]) .library-sidebar,
html[data-aero="true"]:not([data-has-bg="true"]) .settings-tabs,
html[data-aero="true"]:not([data-has-bg="true"]) .titlebar,
html[data-aero="true"]:not([data-has-bg="true"]) .modal,
html[data-aero="true"]:not([data-has-bg="true"]) .lib-queue-sidebar,
html[data-aero="true"]:not([data-has-bg="true"]) .eq-panel,
html[data-aero="true"]:not([data-has-bg="true"]) .queue-panel {
    backdrop-filter: blur(var(--design-blur, 16px));
    -webkit-backdrop-filter: blur(var(--design-blur, 16px));
}
/* Aero 模式下：使用独立的 --aero-blur 覆盖 --design-blur */
html[data-aero="true"] .media-card,
html[data-aero="true"] .media-list-item,
html[data-aero="true"] .save-bar,
html[data-aero="true"] .modal-dialog,
html[data-aero="true"] .modal-content,
html[data-aero="true"] .context-menu,
html[data-aero="true"] .settings-section,
html[data-aero="true"] .mini-player,
html[data-aero="true"] .toast,
html[data-aero="true"] .designer-sidebar,
html[data-aero="true"] .designer-toolbar,
html[data-aero="true"] .tab-panel,
html[data-aero="true"] .search-box,
html[data-aero="true"] .sort-control,
html[data-aero="true"] .view-toggle,
html[data-aero="true"] main,
html[data-aero="true"] header,
html[data-aero="true"] .winui3-nav,
html[data-aero="true"] .settings-main,
html[data-aero="true"] .library-sidebar,
html[data-aero="true"] .settings-tabs,
html[data-aero="true"] .titlebar,
html[data-aero="true"] .modal,
html[data-aero="true"] .lib-queue-sidebar,
html[data-aero="true"] .eq-panel,
html[data-aero="true"] .queue-panel {
    backdrop-filter: blur(var(--aero-blur, var(--design-blur, 16px)));
    -webkit-backdrop-filter: blur(var(--aero-blur, var(--design-blur, 16px)));
}
/* aero_blur=0 时：完全禁用 backdrop-filter，降低 GPU 占用 */
html[data-aero-blur-disabled="true"] .media-card,
html[data-aero-blur-disabled="true"] .media-list-item,
html[data-aero-blur-disabled="true"] .save-bar,
html[data-aero-blur-disabled="true"] .modal-dialog,
html[data-aero-blur-disabled="true"] .modal-content,
html[data-aero-blur-disabled="true"] .context-menu,
html[data-aero-blur-disabled="true"] .settings-section,
html[data-aero-blur-disabled="true"] .mini-player,
html[data-aero-blur-disabled="true"] .toast,
html[data-aero-blur-disabled="true"] .designer-sidebar,
html[data-aero-blur-disabled="true"] .designer-toolbar,
html[data-aero-blur-disabled="true"] .tab-panel,
html[data-aero-blur-disabled="true"] .search-box,
html[data-aero-blur-disabled="true"] .sort-control,
html[data-aero-blur-disabled="true"] .view-toggle,
html[data-aero-blur-disabled="true"] main,
html[data-aero-blur-disabled="true"] header,
html[data-aero-blur-disabled="true"] .winui3-nav,
html[data-aero-blur-disabled="true"] .settings-main,
html[data-aero-blur-disabled="true"] .library-sidebar,
html[data-aero-blur-disabled="true"] .settings-tabs,
html[data-aero-blur-disabled="true"] .titlebar,
html[data-aero-blur-disabled="true"] .modal,
html[data-aero-blur-disabled="true"] .lib-queue-sidebar,
html[data-aero-blur-disabled="true"] .eq-panel,
html[data-aero-blur-disabled="true"] .queue-panel {
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
}
/* player-overlay / fullscreen-lyrics：强制禁用 backdrop-filter，防止全屏时 GPU 飙升 */
html[data-aero="true"]:not([data-has-bg="true"]) .player-overlay,
html[data-aero="true"]:not([data-has-bg="true"]) .fullscreen-lyrics,
html[data-has-bg="true"] .player-overlay,
html[data-has-bg="true"] .fullscreen-lyrics {
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
}

/* ========== Aero 窗口透明 + 无自定义背景：让所有主要容器底色降为半透明，透出桌面 ==========
   深色主题（默认） */
html[data-aero="true"]:not([data-has-bg="true"]) body {
    background-color: color-mix(in srgb, var(--bg-color, #121212) calc(var(--aero-body-alpha, 0.5) * 100%), transparent) !important;
}
html[data-aero="true"]:not([data-has-bg="true"]) .media-card,
html[data-aero="true"]:not([data-has-bg="true"]) .media-list-item,
html[data-aero="true"]:not([data-has-bg="true"]) .settings-section,
html[data-aero="true"]:not([data-has-bg="true"]) .designer-sidebar,
html[data-aero="true"]:not([data-has-bg="true"]) .designer-toolbar,
html[data-aero="true"]:not([data-has-bg="true"]) .search-box,
html[data-aero="true"]:not([data-has-bg="true"]) .sort-control,
html[data-aero="true"]:not([data-has-bg="true"]) .view-toggle,
html[data-aero="true"]:not([data-has-bg="true"]) .tab-panel,
html[data-aero="true"]:not([data-has-bg="true"]) .save-bar,
html[data-aero="true"]:not([data-has-bg="true"]) .lib-queue-sidebar,
html[data-aero="true"]:not([data-has-bg="true"]) .eq-panel,
html[data-aero="true"]:not([data-has-bg="true"]) .queue-panel {
    background-color: color-mix(in srgb, var(--card-bg, #1e1e1e) calc(var(--aero-card-alpha, 0.65) * 100%), transparent) !important;
    border: 1px solid color-mix(in srgb, var(--border-color, #333) calc(var(--aero-border-alpha, 0.5) * 100%), rgba(255,255,255,0.08)) !important;
}
/* —— 修复 UI 问题 1：modal 弹窗 Aero 半透明 + 毛玻璃（之前遗漏，导致全黑块破坏通透感）—— */
html[data-aero="true"]:not([data-has-bg="true"]) .modal,
html[data-aero="true"]:not([data-has-bg="true"]) .context-menu,
html[data-aero="true"]:not([data-has-bg="true"]) .toast {
    background-color: color-mix(in srgb, var(--card-bg, #1e1e1e) calc(var(--aero-modal-alpha, 0.7) * 100%), transparent) !important;
    border: 1px solid color-mix(in srgb, var(--border-color, #333) calc(var(--aero-border-alpha, 0.5) * 100%), rgba(255,255,255,0.12)) !important;
}
/* —— 修复 UI 问题 2：modal-backdrop 遮罩在 Aero 下也要半透明，不能全黑 —— */
html[data-aero="true"]:not([data-has-bg="true"]) .modal-backdrop.active {
    background-color: color-mix(in srgb, #000000 calc(var(--aero-overlay-alpha, 0.4) * 100%), transparent) !important;
    backdrop-filter: blur(2px) saturate(110%);
    -webkit-backdrop-filter: blur(2px) saturate(110%);
}
/* 浅色主题 */
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .media-card,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .media-list-item,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .settings-section,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .designer-sidebar,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .designer-toolbar,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .search-box,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .sort-control,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .view-toggle,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .tab-panel,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .save-bar,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .lib-queue-sidebar,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .eq-panel,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .queue-panel {
    background-color: color-mix(in srgb, var(--card-bg, #ffffff) calc(var(--aero-card-alpha, 0.7) * 100%), transparent) !important;
    border: 1px solid color-mix(in srgb, var(--border-color, #e0e0e0) calc(var(--aero-border-alpha, 0.5) * 100%), rgba(0,0,0,0.06)) !important;
}
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .modal,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .context-menu,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .toast {
    background-color: color-mix(in srgb, var(--card-bg, #ffffff) calc(var(--aero-modal-alpha, 0.8) * 100%), transparent) !important;
    border: 1px solid color-mix(in srgb, var(--border-color, #e0e0e0) calc(var(--aero-border-alpha, 0.5) * 100%), rgba(0,0,0,0.08)) !important;
}
/* 墨绿(accent)主题 */
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .media-card,
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .media-list-item,
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .settings-section,
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .designer-sidebar,
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .designer-toolbar,
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .search-box,
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .sort-control,
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .view-toggle,
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .tab-panel,
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .save-bar,
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .lib-queue-sidebar,
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .eq-panel,
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .queue-panel {
    background-color: color-mix(in srgb, var(--card-bg, #142814) calc(var(--aero-card-alpha, 0.7) * 100%), transparent) !important;
    border: 1px solid color-mix(in srgb, var(--border-color, #1a3a1a) calc(var(--aero-border-alpha, 0.5) * 100%), rgba(255,255,255,0.05)) !important;
}
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .modal,
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .context-menu,
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .toast {
    background-color: color-mix(in srgb, var(--card-bg, #142814) calc(var(--aero-modal-alpha, 0.75) * 100%), transparent) !important;
    border: 1px solid color-mix(in srgb, var(--border-color, #1a3a1a) calc(var(--aero-border-alpha, 0.5) * 100%), rgba(255,255,255,0.08)) !important;
}

/* WinUI3 侧边栏 / main / library-sidebar —— Aero 透明时半透明化 */
html[data-aero="true"]:not([data-has-bg="true"]) .winui3-nav,
html[data-aero="true"]:not([data-has-bg="true"]) main,
html[data-aero="true"]:not([data-has-bg="true"]) .library-sidebar {
    background-color: color-mix(in srgb, var(--bg-color, #121212) calc(var(--aero-panel-alpha, 0.45) * 100%), transparent) !important;
}
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .winui3-nav,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) main,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .library-sidebar {
    background-color: color-mix(in srgb, var(--bg-color, #fafafa) calc(var(--aero-panel-alpha, 0.5) * 100%), transparent) !important;
}
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .winui3-nav,
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) main,
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .library-sidebar {
    background-color: color-mix(in srgb, var(--bg-color, #0a1f0a) calc(var(--aero-panel-alpha, 0.5) * 100%), transparent) !important;
}

/* header / settings-tabs —— Aero 透明时半透明化（条带类，用 panel-alpha 即可） */
html[data-aero="true"]:not([data-has-bg="true"]) header,
html[data-aero="true"]:not([data-has-bg="true"]) .settings-tabs {
    background-color: color-mix(in srgb, var(--bg-color, #121212) calc(var(--aero-panel-alpha, 0.45) * 100%), transparent) !important;
}
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) header,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .settings-tabs {
    background-color: color-mix(in srgb, var(--bg-color, #fafafa) calc(var(--aero-panel-alpha, 0.5) * 100%), transparent) !important;
}
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) header,
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .settings-tabs {
    background-color: color-mix(in srgb, var(--bg-color, #0a1f0a) calc(var(--aero-panel-alpha, 0.5) * 100%), transparent) !important;
}

/* —— 修复：player-overlay / fullscreen-lyrics 使用 modal 级高不透明度 ——
   它们是全屏覆盖层，之前用 panel-alpha（最低 0.10）导致几乎完全透明，
   桌面壁纸直接透出，歌词/封面/控件根本看不清。
   改用 --aero-modal-alpha（0.50-0.90），确保内容可读性的同时保留通透感。 */
html[data-aero="true"]:not([data-has-bg="true"]) .player-overlay,
html[data-aero="true"]:not([data-has-bg="true"]) .fullscreen-lyrics {
    background-color: color-mix(in srgb, var(--bg-color, #121212) calc(var(--aero-modal-alpha, 0.7) * 100%), transparent) !important;
}
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .player-overlay,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .fullscreen-lyrics {
    background-color: color-mix(in srgb, var(--bg-color, #fafafa) calc(var(--aero-modal-alpha, 0.75) * 100%), transparent) !important;
}
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .player-overlay,
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .fullscreen-lyrics {
    background-color: color-mix(in srgb, var(--bg-color, #0a1f0a) calc(var(--aero-modal-alpha, 0.72) * 100%), transparent) !important;
}

/* player-bg-layer（模糊封面背景层）在 Aero 下保持高不透明度，作为播放器的视觉基底 */
html[data-aero="true"]:not([data-has-bg="true"]) .player-bg-layer {
    opacity: 0.85 !important;
}

/* 迷你播放器 —— Aero 透明时半透明化 */
html[data-aero="true"]:not([data-has-bg="true"]) .mini-player {
    background-color: color-mix(in srgb, var(--card-bg, #1e1e1e) calc(var(--aero-mini-alpha, 0.75) * 100%), transparent) !important;
    border-top: 1px solid color-mix(in srgb, var(--border-color, #333) calc(var(--aero-border-alpha, 0.5) * 100%), rgba(255,255,255,0.10)) !important;
}
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .mini-player {
    background-color: color-mix(in srgb, var(--card-bg, #ffffff) calc(var(--aero-mini-alpha, 0.8) * 100%), transparent) !important;
    border-top: 1px solid color-mix(in srgb, var(--border-color, #e0e0e0) calc(var(--aero-border-alpha, 0.5) * 100%), rgba(0,0,0,0.06)) !important;
}
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .mini-player {
    background-color: color-mix(in srgb, var(--card-bg, #142814) calc(var(--aero-mini-alpha, 0.8) * 100%), transparent) !important;
    border-top: 1px solid color-mix(in srgb, var(--border-color, #1a3a1a) calc(var(--aero-border-alpha, 0.5) * 100%), rgba(255,255,255,0.06)) !important;
}

/* 标题栏 —— Aero 透明时半透明化（保持自绘边框的边界感） */
html[data-aero="true"]:not([data-has-bg="true"]) .titlebar {
    background-color: color-mix(in srgb, var(--card-bg, #1e1e1e) calc(var(--aero-titlebar-alpha, 0.6) * 100%), transparent) !important;
    border-bottom: 1px solid color-mix(in srgb, var(--border-color, #333) calc(var(--aero-border-alpha, 0.5) * 100%), rgba(255,255,255,0.10)) !important;
}
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .titlebar {
    background-color: color-mix(in srgb, var(--card-bg, #ffffff) calc(var(--aero-titlebar-alpha, 0.65) * 100%), transparent) !important;
    border-bottom: 1px solid color-mix(in srgb, var(--border-color, #e0e0e0) calc(var(--aero-border-alpha, 0.5) * 100%), rgba(0,0,0,0.06)) !important;
}
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .titlebar {
    background-color: color-mix(in srgb, var(--card-bg, #142814) calc(var(--aero-titlebar-alpha, 0.6) * 100%), transparent) !important;
    border-bottom: 1px solid color-mix(in srgb, var(--border-color, #1a3a1a) calc(var(--aero-border-alpha, 0.5) * 100%), rgba(255,255,255,0.06)) !important;
}

/* —— 修复 UI 问题 3：Aero 下文字对比度保障（避免通透导致文字与桌面混色不可读）——
   当窗口透明度很低（<0.5，即 data-window-alpha 存在但背景很透）时，
   给正文文字和二级文字加非常淡的轮廓阴影（不是发光，是锐边衬底）。
   注意：不使用 drop-shadow 影响性能，只用 text-shadow 1px 偏移模拟 1px 描边 */
html[data-aero="true"]:not([data-has-bg="true"]) .track-name,
html[data-aero="true"]:not([data-has-bg="true"]) .mini-title,
html[data-aero="true"]:not([data-has-bg="true"]) .card-title,
html[data-aero="true"]:not([data-has-bg="true"]) .list-item-title,
html[data-aero="true"]:not([data-has-bg="true"]) .modal h3,
html[data-aero="true"]:not([data-has-bg="true"]) .modal p,
html[data-aero="true"]:not([data-has-bg="true"]) .toast-message,
html[data-aero="true"]:not([data-has-bg="true"]) h1,
html[data-aero="true"]:not([data-has-bg="true"]) h2 {
    text-shadow:
        0 1px 1px rgba(0, 0, 0, calc((1 - var(--aero-modal-alpha, 0.7)) * 0.35)),
        0 -1px 0 rgba(255, 255, 255, calc((1 - var(--aero-modal-alpha, 0.7)) * 0.04));
}
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .track-name,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .mini-title,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .card-title,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .list-item-title,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .modal h3,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .modal p,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .toast-message,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) h1,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) h2 {
    text-shadow:
        0 1px 1px rgba(255, 255, 255, calc((1 - var(--aero-modal-alpha, 0.7)) * 0.45)),
        0 -1px 0 rgba(0, 0, 0, calc((1 - var(--aero-modal-alpha, 0.7)) * 0.04));
}

/* ========== Aero 增强 4：设计师页面预览面板、设置页区块半透明化 ========== */
html[data-aero="true"]:not([data-has-bg="true"]) .designer-preview-aside,
html[data-aero="true"]:not([data-has-bg="true"]) .designer-preview-card,
html[data-aero="true"]:not([data-has-bg="true"]) .designer-preview-panel,
html[data-aero="true"]:not([data-has-bg="true"]) .designer-anim-demo,
html[data-aero="true"]:not([data-has-bg="true"]) .font-preview,
html[data-aero="true"]:not([data-has-bg="true"]) .hotkey-item {
    background-color: color-mix(in srgb, var(--card-bg, #1e1e1e) calc(var(--aero-card-alpha, 0.7) * 100%), transparent) !important;
    border: 1px solid color-mix(in srgb, var(--border-color, #333) calc(var(--aero-border-alpha, 0.5) * 100%), rgba(255,255,255,0.08)) !important;
}
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .designer-preview-aside,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .designer-preview-card,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .designer-preview-panel,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .designer-anim-demo,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .font-preview,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .hotkey-item {
    background-color: color-mix(in srgb, var(--card-bg, #ffffff) calc(var(--aero-card-alpha, 0.75) * 100%), transparent) !important;
    border: 1px solid color-mix(in srgb, var(--border-color, #e0e0e0) calc(var(--aero-border-alpha, 0.5) * 100%), rgba(0,0,0,0.06)) !important;
}
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .designer-preview-aside,
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .designer-preview-card,
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .designer-preview-panel,
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .designer-anim-demo,
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .font-preview,
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .hotkey-item {
    background-color: color-mix(in srgb, var(--card-bg, #142814) calc(var(--aero-card-alpha, 0.72) * 100%), transparent) !important;
    border: 1px solid color-mix(in srgb, var(--border-color, #1a3a1a) calc(var(--aero-border-alpha, 0.5) * 100%), rgba(255,255,255,0.05)) !important;
}

/* ========== Aero 增强 5：表单输入控件（滑块底色、输入框背景）半透明化 ========== */
html[data-aero="true"]:not([data-has-bg="true"]) .form-input,
html[data-aero="true"]:not([data-has-bg="true"]) .form-textarea,
html[data-aero="true"]:not([data-has-bg="true"]) .text-input,
html[data-aero="true"]:not([data-has-bg="true"]) .font-select,
html[data-aero="true"]:not([data-has-bg="true"]) .color-text {
    background-color: color-mix(in srgb, var(--bg-color, #121212) calc(var(--aero-panel-alpha, 0.5) * 100%), transparent) !important;
    border-color: color-mix(in srgb, var(--border-color, #333) calc(var(--aero-border-alpha, 0.5) * 100%), rgba(255,255,255,0.10)) !important;
}
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .form-input,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .form-textarea,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .text-input,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .font-select,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .color-text {
    background-color: color-mix(in srgb, var(--bg-color, #fafafa) calc(var(--aero-panel-alpha, 0.55) * 100%), transparent) !important;
    border-color: color-mix(in srgb, var(--border-color, #e0e0e0) calc(var(--aero-border-alpha, 0.5) * 100%), rgba(0,0,0,0.06)) !important;
}

/* 滑块轨道底色在 Aero 下也半透明（拇指本身保持实色，确保可交互） */
html[data-aero="true"]:not([data-has-bg="true"]) .setting-slider {
    background-color: color-mix(in srgb, var(--border-color, #333) calc(var(--aero-border-alpha, 0.5) * 100%), transparent) !important;
}

/* ========== Aero 增强 6：保存栏（save-bar）保持高对比度，但边框透出玻璃感 ========== */
html[data-aero="true"]:not([data-has-bg="true"]) .save-bar {
    /* save-bar 用主题色实色底色（强调"需要保存"的状态），仅通过边框柔化玻璃感 */
    border-top: 1px solid color-mix(in srgb, var(--accent-color) calc(var(--aero-border-alpha, 0.5) * 100%), rgba(255,255,255,0.3)) !important;
    box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, calc(var(--aero-border-alpha, 0.5) * 0.25)),
        0 -4px 16px rgba(0, 0, 0, calc(var(--aero-border-alpha, 0.5) * 0.25)) !important;
}

/* ========== Aero 增强 7：WinUI3 导航栏（tabs 栏）在 Aero 下毛玻璃 + 半透明 ========== */
html[data-aero="true"]:not([data-has-bg="true"]) .settings-tabs,
html[data-aero="true"]:not([data-has-bg="true"]) .winui3-page-nav {
    backdrop-filter: blur(var(--design-blur, 16px)) saturate(145%) brightness(1.05);
    -webkit-backdrop-filter: blur(var(--design-blur, 16px)) saturate(145%) brightness(1.05);
}

/* ========== Aero 增强 8：次要文字与标签也加上淡轮廓，防止通透时消失 ========== */
html[data-aero="true"]:not([data-has-bg="true"]) .text-secondary,
html[data-aero="true"]:not([data-has-bg="true"]) .card-meta,
html[data-aero="true"]:not([data-has-bg="true"]) .card-album,
html[data-aero="true"]:not([data-has-bg="true"]) .mini-artist,
html[data-aero="true"]:not([data-has-bg="true"]) .list-item-artist,
html[data-aero="true"]:not([data-has-bg="true"]) .list-item-album,
html[data-aero="true"]:not([data-has-bg="true"]) .artist-name,
html[data-aero="true"]:not([data-has-bg="true"]) .text-muted,
html[data-aero="true"]:not([data-has-bg="true"]) .setting-item label,
html[data-aero="true"]:not([data-has-bg="true"]) .toggle-desc,
html[data-aero="true"]:not([data-has-bg="true"]) .slider-value,
html[data-aero="true"]:not([data-has-bg="true"]) .settings-section h2,
html[data-aero="true"]:not([data-has-bg="true"]) .titlebar-title {
    text-shadow:
        0 1px 1px rgba(0, 0, 0, calc((1 - var(--aero-modal-alpha, 0.7)) * 0.22));
}
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .text-secondary,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .card-meta,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .card-album,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .mini-artist,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .list-item-artist,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .list-item-album,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .artist-name,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .text-muted,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .setting-item label,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .toggle-desc,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .slider-value,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .settings-section h2,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .titlebar-title {
    text-shadow:
        0 1px 1px rgba(255, 255, 255, calc((1 - var(--aero-modal-alpha, 0.7)) * 0.30));
}

/* ========== Aero 增强 9：修复硬编码的暗色占位背景 ==========
   libraries.css 中 card-cover / card-icon / mini-cover / list-item-cover 等
   默认使用 #282828 硬编码暗色占位背景，在浅色主题 & Aero 下显得突兀。
   统一改为用 color-mix + 主题变量，深浅色与透明度都协调。 */
html[data-aero="true"]:not([data-has-bg="true"]) .card-cover,
html[data-aero="true"]:not([data-has-bg="true"]) .card-icon,
html[data-aero="true"]:not([data-has-bg="true"]) .mini-cover,
html[data-aero="true"]:not([data-has-bg="true"]) .list-item-cover,
html[data-aero="true"]:not([data-has-bg="true"]) .album-art-wrapper {
    background-color: color-mix(in srgb, var(--card-bg, #1e1e1e) calc(var(--aero-card-alpha, 0.7) * 90%), rgba(255,255,255,0.04)) !important;
}
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .card-cover,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .card-icon,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .mini-cover,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .list-item-cover,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .album-art-wrapper {
    background-color: color-mix(in srgb, var(--card-bg, #ffffff) calc(var(--aero-card-alpha, 0.75) * 92%), rgba(0,0,0,0.03)) !important;
}
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .card-cover,
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .card-icon,
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .mini-cover,
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .list-item-cover,
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .album-art-wrapper {
    background-color: color-mix(in srgb, var(--card-bg, #142814) calc(var(--aero-card-alpha, 0.72) * 90%), rgba(255,255,255,0.04)) !important;
}

/* 正在播放指示器的半透明黑底：也换成主题色半透明，Aero 下不再是死黑方块 */
html[data-aero="true"]:not([data-has-bg="true"]) .media-card .np-bars {
    background-color: color-mix(in srgb, #000000 calc(var(--aero-modal-alpha, 0.7) * 70%), transparent) !important;
}

/* ========== Aero 增强 10：theme-selector / anim-level-btn / toggle-switch 等控件背景半透明 ========== */
html[data-aero="true"]:not([data-has-bg="true"]) .theme-btn,
html[data-aero="true"]:not([data-has-bg="true"]) .anim-level-btn,
html[data-aero="true"]:not([data-has-bg="true"]) .toggle-switch,
html[data-aero="true"]:not([data-has-bg="true"]) .view-toggle,
html[data-aero="true"]:not([data-has-bg="true"]) .sort-control {
    background-color: color-mix(in srgb, var(--card-bg, #1e1e1e) calc(var(--aero-card-alpha, 0.7) * 100%), transparent) !important;
    border-color: color-mix(in srgb, var(--border-color, #333) calc(var(--aero-border-alpha, 0.5) * 100%), rgba(255,255,255,0.08)) !important;
}
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .theme-btn,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .anim-level-btn,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .toggle-switch,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .view-toggle,
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .sort-control {
    background-color: color-mix(in srgb, var(--card-bg, #ffffff) calc(var(--aero-card-alpha, 0.75) * 100%), transparent) !important;
    border-color: color-mix(in srgb, var(--border-color, #e0e0e0) calc(var(--aero-border-alpha, 0.5) * 100%), rgba(0,0,0,0.06)) !important;
}

/* 非 Aero 模式下也修复浅色主题占位图：#282828 硬编码 → 变量驱动 */
html[data-theme="light"]:not([data-aero="true"]) .card-cover,
html[data-theme="light"]:not([data-aero="true"]) .card-icon,
html[data-theme="light"]:not([data-aero="true"]) .mini-cover,
html[data-theme="light"]:not([data-aero="true"]) .list-item-cover,
html[data-theme="light"]:not([data-aero="true"]) .album-art-wrapper {
    background-color: color-mix(in srgb, var(--card-bg) 92%, #000 8%) !important;
}
html[data-theme="accent"]:not([data-aero="true"]) .card-cover,
html[data-theme="accent"]:not([data-aero="true"]) .card-icon,
html[data-theme="accent"]:not([data-aero="true"]) .mini-cover,
html[data-theme="accent"]:not([data-aero="true"]) .list-item-cover,
html[data-theme="accent"]:not([data-aero="true"]) .album-art-wrapper {
    background-color: color-mix(in srgb, var(--card-bg) 85%, #000 15%) !important;
}

/* 有背景时：body 主背景透明，露出下方背景层 */
html[data-has-bg="true"] body {
    background-color: transparent !important;
}

/* ========== 有自定义背景图：保持原有半透明底色规则（兼容旧逻辑）========== */
html[data-has-bg="true"] .media-card,
html[data-has-bg="true"] .media-list-item,
html[data-has-bg="true"] .settings-section,
html[data-has-bg="true"] .designer-sidebar,
html[data-has-bg="true"] .designer-toolbar,
html[data-has-bg="true"] .search-box,
html[data-has-bg="true"] .sort-control,
html[data-has-bg="true"] .view-toggle,
html[data-has-bg="true"] .tab-panel,
html[data-has-bg="true"] .save-bar {
    background-color: rgba(30, 30, 30, 0.45) !important;
}
html[data-has-bg="true"][data-theme="light"] .media-card,
html[data-has-bg="true"][data-theme="light"] .media-list-item,
html[data-has-bg="true"][data-theme="light"] .settings-section,
html[data-has-bg="true"][data-theme="light"] .designer-sidebar,
html[data-has-bg="true"][data-theme="light"] .designer-toolbar,
html[data-has-bg="true"][data-theme="light"] .search-box,
html[data-has-bg="true"][data-theme="light"] .sort-control,
html[data-has-bg="true"][data-theme="light"] .view-toggle,
html[data-has-bg="true"][data-theme="light"] .tab-panel,
html[data-has-bg="true"][data-theme="light"] .save-bar {
    background-color: rgba(255, 255, 255, 0.45) !important;
}
html[data-has-bg="true"][data-theme="accent"] .media-card,
html[data-has-bg="true"][data-theme="accent"] .media-list-item,
html[data-has-bg="true"][data-theme="accent"] .settings-section,
html[data-has-bg="true"][data-theme="accent"] .designer-sidebar,
html[data-has-bg="true"][data-theme="accent"] .designer-toolbar,
html[data-has-bg="true"][data-theme="accent"] .search-box,
html[data-has-bg="true"][data-theme="accent"] .sort-control,
html[data-has-bg="true"][data-theme="accent"] .view-toggle,
html[data-has-bg="true"][data-theme="accent"] .tab-panel,
html[data-has-bg="true"][data-theme="accent"] .save-bar {
    background-color: rgba(20, 40, 20, 0.55) !important;
}
/* —— 有自定义背景图时也补上 modal/context-menu/toast 的半透明，避免之前的遗漏 —— */
html[data-has-bg="true"] .modal,
html[data-has-bg="true"] .context-menu,
html[data-has-bg="true"] .toast {
    background-color: rgba(30, 30, 30, 0.62) !important;
}
html[data-has-bg="true"][data-theme="light"] .modal,
html[data-has-bg="true"][data-theme="light"] .context-menu,
html[data-has-bg="true"][data-theme="light"] .toast {
    background-color: rgba(255, 255, 255, 0.70) !important;
}
html[data-has-bg="true"][data-theme="accent"] .modal,
html[data-has-bg="true"][data-theme="accent"] .context-menu,
html[data-has-bg="true"][data-theme="accent"] .toast {
    background-color: rgba(20, 40, 20, 0.68) !important;
}
html[data-has-bg="true"] .modal-backdrop.active {
    background-color: rgba(0, 0, 0, 0.45) !important;
}
/* 新 UI 与 新 UI WinUI3：侧边栏与主面板彻底半透明化 */
html[data-has-bg="true"] .winui3-nav,
html[data-has-bg="true"] main,
html[data-has-bg="true"] .library-sidebar {
    background-color: rgba(18, 18, 18, 0.35) !important;
}
html[data-has-bg="true"][data-theme="light"] .winui3-nav,
html[data-has-bg="true"][data-theme="light"] main,
html[data-has-bg="true"][data-theme="light"] .library-sidebar {
    background-color: rgba(250, 250, 250, 0.35) !important;
}
html[data-has-bg="true"][data-theme="accent"] .winui3-nav,
html[data-has-bg="true"][data-theme="accent"] main,
html[data-has-bg="true"][data-theme="accent"] .library-sidebar {
    background-color: rgba(10, 31, 10, 0.35) !important;
}
/* header / tabs 半透明化（条带类，低不透明度即可） */
html[data-has-bg="true"] header,
html[data-has-bg="true"] .settings-tabs {
    background-color: rgba(18, 18, 18, 0.35) !important;
}
html[data-has-bg="true"][data-theme="light"] header,
html[data-has-bg="true"][data-theme="light"] .settings-tabs {
    background-color: rgba(250, 250, 250, 0.35) !important;
}
html[data-has-bg="true"][data-theme="accent"] header,
html[data-has-bg="true"][data-theme="accent"] .settings-tabs {
    background-color: rgba(10, 31, 10, 0.4) !important;
}
/* player-overlay 在有背景图时也需要较高不透明度，否则背景图透出导致看不清内容 */
html[data-has-bg="true"] .player-overlay,
html[data-has-bg="true"] .fullscreen-lyrics {
    background-color: rgba(18, 18, 18, 0.75) !important;
}
html[data-has-bg="true"][data-theme="light"] .player-overlay,
html[data-has-bg="true"][data-theme="light"] .fullscreen-lyrics {
    background-color: rgba(250, 250, 250, 0.78) !important;
}
html[data-has-bg="true"][data-theme="accent"] .player-overlay,
html[data-has-bg="true"][data-theme="accent"] .fullscreen-lyrics {
    background-color: rgba(10, 31, 10, 0.78) !important;
}
/* 迷你播放器：半透明化 */
html[data-has-bg="true"] body[data-page="libraries"][data-new-ui="true"] .mini-player {
    background-color: rgba(20, 20, 20, 0.55) !important;
}
html[data-has-bg="true"][data-theme="light"] body[data-page="libraries"][data-new-ui="true"] .mini-player {
    background-color: rgba(250, 250, 250, 0.6) !important;
}
html[data-has-bg="true"][data-theme="accent"] body[data-page="libraries"][data-new-ui="true"] .mini-player {
    background-color: rgba(10, 31, 10, 0.6) !important;
}
/* 标题栏保持半透明，配合背景 */
html[data-has-bg="true"] .titlebar {
    background-color: rgba(18, 18, 18, 0.35) !important;
}
html[data-has-bg="true"][data-theme="light"] .titlebar {
    background-color: rgba(250, 250, 250, 0.35) !important;
}
html[data-has-bg="true"][data-theme="accent"] .titlebar {
    background-color: rgba(10, 31, 10, 0.35) !important;
}

/* ========== 新 UI（WinUI3）透明背景对齐 ==========
   新 UI 自身的 Mica 层（白/黑 2%-6%）与旧 UI 的 Aero 分层不一致，
   会出现导航、内容、卡片透明程度参差。这里让新 UI 专属容器复用旧 UI
   同一组 --aero-panel-alpha / --aero-card-alpha，只统一表现层，
   不改变 applyWindowAlpha 的透明计算。 */
html[data-aero="true"]:not([data-has-bg="true"]) .winui3-page-nav {
    background-color: color-mix(in srgb, var(--bg-color, #121212) calc(var(--aero-panel-alpha, 0.45) * 100%), transparent) !important;
    border-right-color: color-mix(in srgb, var(--border-color, #333) calc(var(--aero-border-alpha, 0.5) * 100%), transparent) !important;
}
html[data-aero="true"][data-theme="light"]:not([data-has-bg="true"]) .winui3-page-nav {
    background-color: color-mix(in srgb, var(--bg-color, #fafafa) calc(var(--aero-panel-alpha, 0.5) * 100%), transparent) !important;
}
html[data-aero="true"][data-theme="accent"]:not([data-has-bg="true"]) .winui3-page-nav {
    background-color: color-mix(in srgb, var(--bg-color, #0a1f0a) calc(var(--aero-panel-alpha, 0.5) * 100%), transparent) !important;
}
html[data-has-bg="true"] body[data-new-ui="true"] .winui3-page-nav,
html[data-has-bg="true"] body[data-new-ui="true"] .winui3-nav {
    background-color: rgba(18, 18, 18, 0.35) !important;
}
html[data-has-bg="true"][data-theme="light"] body[data-new-ui="true"] .winui3-page-nav,
html[data-has-bg="true"][data-theme="light"] body[data-new-ui="true"] .winui3-nav {
    background-color: rgba(250, 250, 250, 0.35) !important;
}
html[data-has-bg="true"][data-theme="accent"] body[data-new-ui="true"] .winui3-page-nav,
html[data-has-bg="true"][data-theme="accent"] body[data-new-ui="true"] .winui3-nav {
    background-color: rgba(10, 31, 10, 0.4) !important;
}

/* ========== Aero 全界面统一可读层 ==========
   仅调整 UI 表现层，不改变 applyWindowAlpha 的底层透明计算：
   - 画布统一为一层带下限的玻璃；
   - 头部/主区/导航不再各自叠加低透明度背景，避免同一界面深浅不一；
   - 卡片、标题栏、迷你播放器、弹窗按层级派生，所有页面（旧/新 UI）共用。 */
html[data-aero="true"]:not([data-has-bg="true"]) body {
    background-color: color-mix(in srgb, var(--bg-color, #121212) calc((0.55 + var(--aero-bg-alpha, 0) * 0.45) * 100%), transparent) !important;
}
html[data-aero="true"]:not([data-has-bg="true"]) header,
html[data-aero="true"]:not([data-has-bg="true"]) main,
html[data-aero="true"]:not([data-has-bg="true"]) .settings-tabs,
html[data-aero="true"]:not([data-has-bg="true"]) .winui3-nav,
html[data-aero="true"]:not([data-has-bg="true"]) .winui3-page-nav,
html[data-aero="true"]:not([data-has-bg="true"]) .library-sidebar,
html[data-aero="true"]:not([data-has-bg="true"]) .settings-main {
    background-color: transparent !important;
}
html[data-aero="true"]:not([data-has-bg="true"]) .media-card,
html[data-aero="true"]:not([data-has-bg="true"]) .media-list-item,
html[data-aero="true"]:not([data-has-bg="true"]) .settings-section,
html[data-aero="true"]:not([data-has-bg="true"]) .search-box,
html[data-aero="true"]:not([data-has-bg="true"]) .sort-control,
html[data-aero="true"]:not([data-has-bg="true"]) .view-toggle,
html[data-aero="true"]:not([data-has-bg="true"]) .tab-panel,
html[data-aero="true"]:not([data-has-bg="true"]) .designer-sidebar,
html[data-aero="true"]:not([data-has-bg="true"]) .designer-toolbar,
html[data-aero="true"]:not([data-has-bg="true"]) .lib-queue-sidebar,
html[data-aero="true"]:not([data-has-bg="true"]) .eq-panel,
html[data-aero="true"]:not([data-has-bg="true"]) .queue-panel,
html[data-aero="true"]:not([data-has-bg="true"]) .hotkey-item,
html[data-aero="true"]:not([data-has-bg="true"]) .theme-btn,
html[data-aero="true"]:not([data-has-bg="true"]) .anim-level-btn{
    background-color: color-mix(in srgb, var(--card-bg, #1e1e1e) calc((0.50 + var(--aero-card-alpha, 0) * 0.35) * 100%), transparent) !important;
    border-color: color-mix(in srgb, var(--border-color, #333) calc(var(--aero-border-alpha, 0.5) * 100%), transparent) !important;
}
html[data-aero="true"]:not([data-has-bg="true"]) .form-input,
html[data-aero="true"]:not([data-has-bg="true"]) .form-textarea,
html[data-aero="true"]:not([data-has-bg="true"]) .text-input,
html[data-aero="true"]:not([data-has-bg="true"]) .font-select,
html[data-aero="true"]:not([data-has-bg="true"]) .color-text {
    background-color: color-mix(in srgb, var(--bg-color, #121212) calc((0.45 + var(--aero-panel-alpha, 0) * 0.4) * 100%), transparent) !important;
}
html[data-aero="true"]:not([data-has-bg="true"]) .titlebar {
    background-color: color-mix(in srgb, var(--card-bg, #1e1e1e) calc((0.55 + var(--aero-titlebar-alpha, 0) * 0.30) * 100%), transparent) !important;
}
html[data-aero="true"]:not([data-has-bg="true"]) .mini-player {
    background-color: color-mix(in srgb, var(--card-bg, #1e1e1e) calc((0.60 + var(--aero-mini-alpha, 0) * 0.30) * 100%), transparent) !important;
}
html[data-aero="true"]:not([data-has-bg="true"]) .modal,
html[data-aero="true"]:not([data-has-bg="true"]) .context-menu,
html[data-aero="true"]:not([data-has-bg="true"]) .toast {
    background-color: color-mix(in srgb, var(--card-bg, #1e1e1e) calc((0.80 + var(--aero-modal-alpha, 0) * 0.15) * 100%), transparent) !important;
}
html[data-aero="true"]:not([data-has-bg="true"]) .player-overlay,
html[data-aero="true"]:not([data-has-bg="true"]) .fullscreen-lyrics {
    background-color: color-mix(in srgb, var(--bg-color, #121212) calc((0.72 + var(--aero-modal-alpha, 0) * 0.20) * 100%), transparent) !important;
}
`;
