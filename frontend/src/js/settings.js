import { LoadSettings, SaveSettings } from '../../wailsjs/go/main/App.js';

// ============ 标题栏窗口控制 ============
document.getElementById('minimizeBtn')?.addEventListener('click', () => window.runtime?.WindowMinimise());
document.getElementById('closeBtn')?.addEventListener('click', () => window.runtime?.Quit());

// DOM Elements
const backBtn = document.getElementById('backBtn');
const themeButtons = document.querySelectorAll('.theme-btn');
const playerFontSelect = document.getElementById('player-font');
const lyricsFontSelect = document.getElementById('lyrics-font');
const volumeSlider = document.getElementById('volume-slider');
const volumeValue = document.getElementById('volume-value');
const saveBar = document.getElementById('saveBar');
const saveBtn = document.getElementById('saveBtn');

let currentSettings = null;
let hasChanges = false;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    await loadSettings();
    applyTheme();
    setupEventListeners();
});

// Load settings from backend
async function loadSettings() {
    try {
        currentSettings = await LoadSettings();
        applySettingsToUI(currentSettings);
    } catch (err) {
        console.error('Failed to load settings:', err);
        currentSettings = {
            theme: 'dark',
            player_font: 'system-ui',
            lyrics_font: "'Consolas', 'Monaco', monospace",
            last_track_id: 0,
            last_position: 0,
            volume: 70
        };
        applySettingsToUI(currentSettings);
    }
}

// Apply settings to UI controls
function applySettingsToUI(s) {
    // Theme
    themeButtons.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.theme === s.theme);
    });

    // Fonts
    playerFontSelect.value = s.player_font || 'system-ui';
    lyricsFontSelect.value = s.lyrics_font || "'Consolas', 'Monaco', monospace";

    // Volume
    volumeSlider.value = s.volume || 70;
    volumeValue.textContent = s.volume + '%';
}

// Apply theme to body
function applyTheme() {
    document.body.setAttribute('data-theme', currentSettings.theme || 'dark');
}

// Setup event listeners
function setupEventListeners() {
    // Back button
    backBtn.addEventListener('click', () => {
        if (hasChanges) {
            if (confirm('设置未保存，是否放弃更改？')) {
                window.history.back();
            }
        } else {
            window.history.back();
        }
    });

    // Theme buttons
    themeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            themeButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentSettings.theme = btn.dataset.theme;
            applyTheme();
            markChanged();
        });
    });

    // Player font
    playerFontSelect.addEventListener('change', () => {
        currentSettings.player_font = playerFontSelect.value;
        document.body.style.fontFamily = playerFontSelect.value + ", system-ui";
        markChanged();
    });

    // Lyrics font
    lyricsFontSelect.addEventListener('change', () => {
        currentSettings.lyrics_font = lyricsFontSelect.value;
        markChanged();
    });

    // Volume slider
    volumeSlider.addEventListener('input', () => {
        volumeValue.textContent = volumeSlider.value + '%';
        currentSettings.volume = parseInt(volumeSlider.value, 10);
        markChanged();
    });

    // Save button
    saveBtn.addEventListener('click', saveSettings);
}

// Mark settings as changed
function markChanged() {
    hasChanges = true;
    saveBar.style.display = 'flex';
}

// Save settings
async function saveSettings() {
    try {
        await SaveSettings(currentSettings);
        hasChanges = false;
        saveBar.style.display = 'none';

        // 立即应用当前页面的设置
        document.body.setAttribute('data-theme', currentSettings.theme || 'dark');
        if (currentSettings.player_font) {
            document.body.style.fontFamily = currentSettings.player_font + ", -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
        }
        if (currentSettings.lyrics_font) {
            document.documentElement.style.setProperty('--lyrics-font', currentSettings.lyrics_font);
        }

        // 通知其他页面（libraries、player）应用新设置
        localStorage.setItem('settingsUpdated', Date.now().toString());
        localStorage.setItem('cachedSettings', JSON.stringify(currentSettings));
    } catch (err) {
        console.error('Failed to save settings:', err);
        alert('保存失败: ' + err);
    }
}