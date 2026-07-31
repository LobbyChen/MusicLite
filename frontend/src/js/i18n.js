// i18n.js — MusicLite 国际化框架
// 支持语言：zh-CN（简体中文）、en（English）
const translations = {
    'zh-CN': {
        // ===== 元数据 =====
        'lang.name': '简体中文',

        // ===== 通用 =====
        'common.ok': '确定',
        'common.cancel': '取消',
        'common.save': '保存',
        'common.delete': '删除',
        'common.close': '关闭',
        'common.minimize': '最小化',
        'common.settings': '设置',
        'common.back': '返回',
        'common.play': '播放',
        'common.pause': '暂停',
        'common.loading': '加载中',
        'common.unknown': '未知',
        'common.unknownArtist': '未知艺术家',

        // ===== 标题栏 =====
        'titlebar.minimize': '最小化',
        'titlebar.close': '关闭',

        // ===== 音乐库页 =====
        'libraries.title': '我的音乐库',
        'libraries.importFiles': '导入文件',
        'libraries.allTracks': '全部曲目',
        'libraries.empty': '音乐库是空的',
        'libraries.emptyHint': '点击"导入文件"按钮添加音乐',
        'libraries.notPlaying': '未播放',
        'libraries.openPlayer': '打开播放器',
        'libraries.dropText': '松开鼠标导入音乐文件',
        'libraries.dropHint': '支持 MP3 / OGG / FLAC / WAV / APE',
        'libraries.importSuccess': '成功导入 {0} 首曲目',
        'libraries.importSuccessAlt': '成功导入 {0} 首音乐',
        'libraries.importNone': '未选择任何文件',
        'libraries.importNoneAlt': '未导入任何文件（可能格式不支持或已存在）',
        'libraries.importFailed': '导入失败: {0}',
        'libraries.deleteTitle': '删除曲目',
        'libraries.deleteConfirm': '确定要删除 "{0}" 吗？此操作无法撤销。',
        'libraries.deleted': '已删除曲目',
        'libraries.deleteFailed': '删除失败: {0}',
        'libraries.editInfo': '编辑信息',
        'libraries.changeCover': '添加/更换封面',
        'libraries.editLyrics': '编辑歌词',
        'libraries.editTrackTitle': '编辑曲目信息',
        'libraries.titleLabel': '标题',
        'libraries.artistLabel': '艺术家',
        'libraries.lyricsLabel': '歌词',
        'libraries.lyricsFormat': '歌词 (LRC 格式)',
        'libraries.lyricsPlaceholder': '粘贴 LRC 歌词，如：\n[00:12.34]歌词内容\n[00:15.67]下一行',
        'libraries.lyricsContent': '歌词内容 (LRC 格式)',
        'libraries.lyricsInputPlaceholder': '粘贴或输入 LRC 格式歌词',
        'libraries.importFromFile': '从文件导入',
        'libraries.titleRequired': '标题不能为空',
        'libraries.saved': '已保存',
        'libraries.saveFailed': '保存失败: {0}',
        'libraries.coverTooLarge': '封面图片过大，请选择 500KB 以内的图片',
        'libraries.coverUpdated': '封面已更新',
        'libraries.coverUpdateFailed': '封面更新失败: {0}',
        'libraries.lyricsSaved': '歌词已保存',
        'libraries.lyricsSaveFailed': '歌词保存失败: {0}',
        'libraries.confirmDeleteTitle': '确认删除',
        'libraries.confirmDeleteMsg': '确定要删除吗？',

        // ===== 播放器 =====
        'player.prevTrack': '上一曲',
        'player.nextTrack': '下一曲',
        'player.loopOne': '单曲循环',
        'player.backToLibrary': '返回音乐库',
        'player.prevLyric': '上一句歌词',
        'player.nextLyric': '下一句歌词',
        'player.fullscreenLyrics': '全屏歌词',
        'player.backToCardLyrics': '返回卡片歌词',
        'player.noLyrics': '暂无歌词',

        // ===== 设置页 =====
        'settings.title': '设置',
        'settings.appearance': '外观',
        'settings.themeMode': '主题模式',
        'settings.themeDark': '深色',
        'settings.themeLight': '浅色',
        'settings.themeAccent': '主题色',
        'settings.customAccent': '自定义主题色',
        'settings.fontSection': '字体',
        'settings.playerFont': '播放器界面字体',
        'settings.lyricsFont': '歌词字体',
        'settings.uiScale': '界面缩放',
        'settings.lyricsScale': '歌词缩放',
        'settings.playback': '播放',
        'settings.defaultVolume': '默认音量',
        'settings.language': '界面语言',
        'settings.about': '关于',
        'settings.aboutDesc': '轻量级离线音乐播放器',
        'settings.builtWith': '基于 Wails v2 构建',
        'settings.settingsChanged': '设置已更改',
        'settings.discardTitle': '放弃更改',
        'settings.discardConfirm': '设置未保存，是否放弃更改？',
        'settings.discardBtn': '放弃',
        'settings.stayBtn': '留在页面',
        'settings.systemDefault': '系统默认',
        'settings.sansSerif': '无衬线体',
        'settings.serif': '衬线体',
        'settings.monospaceRecommended': '等宽字体（推荐）',
        'settings.systemFonts': '—— 系统字体 ——',
        'settings.exportSettings': '导出设置',
        'settings.importSettings': '导入设置',
        'settings.exportSuccess': '设置已导出到 {0}',
        'settings.exportFailed': '导出失败: {0}',
        'settings.importSuccess': '设置导入成功',
        'settings.importFailed': '导入失败: {0}',
        'settings.fontPreviewPlayer': '音乐是心灵的呼吸 MusicLite 0123456789',
        'settings.fontPreviewLyrics': '天空的云啊 你要去哪里 ABCabc123',

        // ===== 迷你播放器 =====
        'miniplayer.title': '未播放',
    },

    'en': {
        // ===== Metadata =====
        'lang.name': 'English',

        // ===== Common =====
        'common.ok': 'OK',
        'common.cancel': 'Cancel',
        'common.save': 'Save',
        'common.delete': 'Delete',
        'common.close': 'Close',
        'common.minimize': 'Minimize',
        'common.settings': 'Settings',
        'common.back': 'Back',
        'common.play': 'Play',
        'common.pause': 'Pause',
        'common.loading': 'Loading',
        'common.unknown': 'Unknown',
        'common.unknownArtist': 'Unknown Artist',

        // ===== Titlebar =====
        'titlebar.minimize': 'Minimize',
        'titlebar.close': 'Close',

        // ===== Libraries =====
        'libraries.title': 'My Music Library',
        'libraries.importFiles': 'Import Files',
        'libraries.allTracks': 'All Tracks',
        'libraries.empty': 'Library is empty',
        'libraries.emptyHint': 'Click "Import Files" to add music',
        'libraries.notPlaying': 'Not Playing',
        'libraries.openPlayer': 'Open Player',
        'libraries.dropText': 'Release to import music files',
        'libraries.dropHint': 'Supports MP3 / OGG / FLAC / WAV / APE',
        'libraries.importSuccess': 'Successfully imported {0} tracks',
        'libraries.importSuccessAlt': 'Successfully imported {0} tracks',
        'libraries.importNone': 'No files selected',
        'libraries.importNoneAlt': 'No files imported (unsupported format or already exists)',
        'libraries.importFailed': 'Import failed: {0}',
        'libraries.deleteTitle': 'Delete Track',
        'libraries.deleteConfirm': 'Are you sure you want to delete "{0}"? This cannot be undone.',
        'libraries.deleted': 'Track deleted',
        'libraries.deleteFailed': 'Delete failed: {0}',
        'libraries.editInfo': 'Edit Info',
        'libraries.changeCover': 'Add/Change Cover',
        'libraries.editLyrics': 'Edit Lyrics',
        'libraries.editTrackTitle': 'Edit Track Info',
        'libraries.titleLabel': 'Title',
        'libraries.artistLabel': 'Artist',
        'libraries.lyricsLabel': 'Lyrics',
        'libraries.lyricsFormat': 'Lyrics (LRC Format)',
        'libraries.lyricsPlaceholder': 'Paste LRC lyrics, e.g.:\n[00:12.34]Lyric line\n[00:15.67]Next line',
        'libraries.lyricsContent': 'Lyrics Content (LRC Format)',
        'libraries.lyricsInputPlaceholder': 'Paste or type LRC format lyrics',
        'libraries.importFromFile': 'Import from File',
        'libraries.titleRequired': 'Title cannot be empty',
        'libraries.saved': 'Saved',
        'libraries.saveFailed': 'Save failed: {0}',
        'libraries.coverTooLarge': 'Cover image too large, please select an image under 500KB',
        'libraries.coverUpdated': 'Cover updated',
        'libraries.coverUpdateFailed': 'Cover update failed: {0}',
        'libraries.lyricsSaved': 'Lyrics saved',
        'libraries.lyricsSaveFailed': 'Lyrics save failed: {0}',
        'libraries.confirmDeleteTitle': 'Confirm Delete',
        'libraries.confirmDeleteMsg': 'Are you sure you want to delete?',

        // ===== Player =====
        'player.prevTrack': 'Previous',
        'player.nextTrack': 'Next',
        'player.loopOne': 'Loop One',
        'player.backToLibrary': 'Back to Library',
        'player.prevLyric': 'Previous Lyric',
        'player.nextLyric': 'Next Lyric',
        'player.fullscreenLyrics': 'Fullscreen Lyrics',
        'player.backToCardLyrics': 'Back to Card Lyrics',
        'player.noLyrics': 'No Lyrics',

        // ===== Settings =====
        'settings.title': 'Settings',
        'settings.appearance': 'Appearance',
        'settings.themeMode': 'Theme Mode',
        'settings.themeDark': 'Dark',
        'settings.themeLight': 'Light',
        'settings.themeAccent': 'Accent',
        'settings.customAccent': 'Custom Accent Color',
        'settings.fontSection': 'Font',
        'settings.playerFont': 'Player UI Font',
        'settings.lyricsFont': 'Lyrics Font',
        'settings.uiScale': 'UI Scale',
        'settings.lyricsScale': 'Lyrics Scale',
        'settings.playback': 'Playback',
        'settings.defaultVolume': 'Default Volume',
        'settings.language': 'Language',
        'settings.about': 'About',
        'settings.aboutDesc': 'Lightweight offline music player',
        'settings.builtWith': 'Built with Wails v2',
        'settings.settingsChanged': 'Settings changed',
        'settings.discardTitle': 'Discard Changes',
        'settings.discardConfirm': 'Unsaved settings will be lost. Discard changes?',
        'settings.discardBtn': 'Discard',
        'settings.stayBtn': 'Stay',
        'settings.systemDefault': 'System Default',
        'settings.sansSerif': 'Sans-serif',
        'settings.serif': 'Serif',
        'settings.monospaceRecommended': 'Monospace (Recommended)',
        'settings.systemFonts': '—— System Fonts ——',
        'settings.exportSettings': 'Export Settings',
        'settings.importSettings': 'Import Settings',
        'settings.exportSuccess': 'Settings exported to {0}',
        'settings.exportFailed': 'Export failed: {0}',
        'settings.importSuccess': 'Settings imported successfully',
        'settings.importFailed': 'Import failed: {0}',
        'settings.fontPreviewPlayer': 'Music is the breath of the soul MusicLite 0123456789',
        'settings.fontPreviewLyrics': 'Clouds in the sky, where are you going ABCabc123',

        // ===== Mini Player =====
        'miniplayer.title': 'Not Playing',
    }
};

// 当前语言（默认 zh-CN）
let currentLanguage = 'zh-CN';

// 从 localStorage 恢复语言选择（跨页面同步）
try {
    const saved = localStorage.getItem('appLanguage');
    if (saved && translations[saved]) {
        currentLanguage = saved;
    }
} catch (e) {
    // localStorage 不可用时忽略
}

/**
 * 翻译键值
 * @param {string} key — 翻译键，如 'libraries.title'
 * @param {...string} args — 插值参数，替换 {0}, {1}, ...
 * @returns {string} 翻译后的字符串
 */
export function t(key, ...args) {
    const dict = translations[currentLanguage] || translations['zh-CN'];
    let str = dict[key];
    if (str === undefined) {
        // 回退到 zh-CN
        str = translations['zh-CN'][key];
    }
    if (str === undefined) {
        // 键不存在，返回键名本身
        return key;
    }
    // 插值替换 {0}, {1}, ...
    if (args.length > 0) {
        for (let i = 0; i < args.length; i++) {
            str = str.replace(`{${i}}`, String(args[i]));
        }
    }
    return str;
}

/**
 * 设置当前语言
 * @param {string} lang — 语言代码：'zh-CN' | 'en'
 */
export function setLanguage(lang) {
    if (!translations[lang]) {
        console.warn(`Unknown language: ${lang}, falling back to zh-CN`);
        lang = 'zh-CN';
    }
    currentLanguage = lang;
    try {
        localStorage.setItem('appLanguage', lang);
    } catch (e) {
        // ignore
    }
}

/**
 * 获取当前语言
 * @returns {string} 当前语言代码
 */
export function getCurrentLanguage() {
    return currentLanguage;
}

/**
 * 获取可用语言列表，每项含 code 和 nativeName
 * @returns {Array<{code: string, nativeName: string}>}
 */
export function getAvailableLanguages() {
    return Object.keys(translations).map(code => ({
        code,
        nativeName: translations[code]['lang.name'] || code,
    }));
}

/**
 * 翻译页面上所有 [data-i18n] 元素
 * 用法：<span data-i18n="libraries.title">我的音乐库</span>
 * 也支持 [data-i18n-placeholder] 用于 placeholder 属性
 */
export function applyTranslations() {
    // 翻译文本内容
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (key) {
            el.textContent = t(key);
        }
    });
    // 翻译 placeholder
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (key) {
            el.placeholder = t(key);
        }
    });
    // 翻译 title 属性
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.getAttribute('data-i18n-title');
        if (key) {
            el.title = t(key);
        }
    });
}

// 暴露到全局，供非模块脚本使用
window.i18n = { t, setLanguage, getCurrentLanguage, applyTranslations, getAvailableLanguages };
