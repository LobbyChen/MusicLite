// 多页面路由分发入口。
// Wails 各窗口统一加载 index.html，通过 hash 指定页面：
//   /#/library（默认） /#/settings /#/tray
// 新旧主题使用独立页面文件，路由根据设置直接分发，避免依赖 data-* CSS 选择器。
const NEW_PAGES = {
    library: "/src/pages/libraries-new.html",
    settings: "/src/pages/settings-new.html",
    tray: "/src/pages/tray-menu-new.html",
};
const LEGACY_PAGES = {
    library: "/src/pages/libraries.html",
    settings: "/src/pages/settings.html",
    tray: "/src/pages/tray-menu.html",
};

function isNewUI() {
    try {
        // 允许用 ?ui=new / ?ui=old 临时覆盖（调试用）
        const forced = new URLSearchParams(location.search).get('ui');
        if (forced === 'new') return true;
        if (forced === 'old') return false;
        return localStorage.getItem('musicLite.newUIEnabled') === '1';
    } catch (e) {
        return false;
    }
}

const route = (location.hash || "#/library").replace(/^#\/?/, "").trim();
const pages = isNewUI() ? NEW_PAGES : LEGACY_PAGES;
const target = pages[route] || pages.library;

// replace 避免在窗口历史中留下空白中转页。
window.location.replace(target + location.search);
