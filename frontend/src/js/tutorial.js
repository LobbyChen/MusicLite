// ============ 使用教程（Usage Tutorial） ============
// 跨页面分步引导：设置页 → 音乐库主页 → 设计器
// 通过 localStorage 保持状态，在每个页面的 JS 中调用 Tutorial.init(pageName)
// 即可在当前页面显示对应的引导步骤。

const TUTORIAL_STORAGE_KEY = 'musiclite.tutorial.state';

// 步骤定义：每个页面一个数组
// selector: 可选的 CSS 选择器，用于高亮该元素（为空则在屏幕中央显示无高亮）
// title: 可选的小标题
// textKey: i18n key for 内容描述
// position: tooltip 位置 'top' | 'bottom' | 'left' | 'right' | 'center'
// nextAction: 可选，'next' 步执行的动作（如跳转页面）
const TUTORIAL_STEPS = {
    settings: [
        { selector: '.about-info',                  textKey: 'tutorial.welcome',             position: 'bottom' },
        { selector: '[data-section-id="appearance"]', textKey: 'tutorial.settingsAppearance',  position: 'left' },
        { selector: '[data-section-id="font"]',       textKey: 'tutorial.settingsFont',        position: 'left' },
        { selector: '[data-section-id="playback"]',   textKey: 'tutorial.settingsPlayback',    position: 'left' },
        { selector: '[data-section-id="hotkeys"]',    textKey: 'tutorial.settingsHotkeys',     position: 'left' },
        { selector: '[data-section-id="language"]',   textKey: 'tutorial.settingsLanguage',    position: 'left' },
        { selector: '[data-section-id="about"]',      textKey: 'tutorial.settingsAbout',       position: 'left' },
        { selector: '[data-section-id="more"]',       textKey: 'tutorial.settingsMore',        position: 'left' },
        { selector: null,                             textKey: 'tutorial.toLibrariesHint',     position: 'center', nextPage: 'libraries' }
    ],
    libraries: [
        { selector: 'header',                        textKey: 'tutorial.librariesHeader',     position: 'bottom' },
        { selector: '#searchBox',                    textKey: 'tutorial.librariesSearch',     position: 'bottom' },
        { selector: '#openFileBtn',                  textKey: 'tutorial.librariesImport',     position: 'bottom' },
        { selector: '.tracks-controls',              textKey: 'tutorial.librariesView',       position: 'bottom' },
        { selector: '#libQueueBtn',                  textKey: 'tutorial.librariesQueue',      position: 'left' },
        { selector: '#mini-player',                  textKey: 'tutorial.librariesMiniPlayer', position: 'top' },
        { selector: '.tracks-header',                textKey: 'tutorial.librariesTrackCard',  position: 'bottom' },
        { selector: null,                            textKey: 'tutorial.toDesignerHint',      position: 'center', nextPage: 'designer' }
    ],
    designer: [
        { selector: 'header',                         textKey: 'tutorial.designerIntro',       position: 'bottom' },
        { selector: '[data-section-id="appearance"]', textKey: 'tutorial.designerAppearance',  position: 'left' },
        { selector: '.designer-controls',             textKey: 'tutorial.designerTokens',      position: 'right' },
        { selector: '.designer-preview-aside',        textKey: 'tutorial.designerPreview',     position: 'left' },
        { selector: '.designer-bottom-actions',       textKey: 'tutorial.designerReset',       position: 'bottom' },
        { selector: null,                             textKey: 'tutorial.finish',              position: 'center', isFinish: true }
    ]
};

// 页面 URL 映射
const PAGE_URLS = {
    libraries: '/src/html/libraries.html',
    settings:  '/src/html/settings.html',
    designer:  '/src/html/designer.html'
};

// ---------- 状态管理 ----------
function loadState() {
    try {
        const raw = localStorage.getItem(TUTORIAL_STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        return null;
    }
}
function saveState(state) {
    try {
        localStorage.setItem(TUTORIAL_STORAGE_KEY, JSON.stringify(state));
    } catch (e) {}
}
function clearState() {
    try { localStorage.removeItem(TUTORIAL_STORAGE_KEY); } catch (e) {}
}

// ---------- 工具：确保目标元素所在 section 处于可见状态 ----------
// 新 UI 的 winui3 / tabs 布局会把非激活的 .settings-section 设为 display:none，
// 此时 getBoundingClientRect 返回 0，导致高亮框与 tooltip 定位错乱。
// 这里在测量前把目标所在的 section 激活（并同步左侧导航项 / 顶部选项卡状态）。
// 对 scroll / columns 布局无副作用（.active 不影响它们的显示）。
function activateSectionForTarget(target) {
    const section = target.closest('.settings-section[data-section-id]');
    if (!section) return;
    if (section.classList.contains('active')) return; // 已可见
    const sectionId = section.dataset.sectionId;
    // 切换 section 可见性
    document.querySelectorAll('.settings-section[data-section-id]').forEach(sec => {
        sec.classList.toggle('active', sec === section);
    });
    // 同步 winui3 左侧导航项 / tabs 顶部选项卡的激活状态
    document.querySelectorAll('.winui3-nav-item, .settings-tab').forEach(item => {
        const tid = item.dataset.navTarget || item.dataset.tabTarget;
        item.classList.toggle('active', tid === sectionId);
    });
}

// ---------- 工具：i18n 格式化 ----------
function tfmt(key, ...args) {
    let s = window.__tutorialT ? window.__tutorialT(key) : key;
    if (!s) s = key;
    args.forEach((a, i) => {
        s = s.replace(new RegExp(`\\{${i}\\}`, 'g'), String(a));
    });
    return s;
}

// ---------- Tutorial 主类 ----------
class TutorialRunner {
    constructor(pageName, translator) {
        this.pageName = pageName;
        window.__tutorialT = translator || (k => k);
        this.steps = TUTORIAL_STEPS[pageName] || [];
        this.stepIdx = 0;
        this.running = false;
        this.overlayEl = null;
        this.highlightEl = null;
        this.tooltipEl = null;
        this.backdropEl = null;
        this._scrollHandler = null;
        this._resizeHandler = null;
    }

    // 检查当前页是否有需要恢复的教程状态
    static restoreIfNeeded(pageName, translator) {
        const state = loadState();
        if (!state || !state.running) return null;
        // 如果当前页面与 state.page 一致，恢复
        if (state.page === pageName) {
            const runner = new TutorialRunner(pageName, translator);
            runner.stepIdx = state.stepIdx || 0;
            runner.running = true;
            // 在 DOM 就绪后显示
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => runner.show());
            } else {
                runner.show();
            }
            return runner;
        }
        return null;
    }

    // 从设置页开始一个全新的教程
    static startFromSettings(translator) {
        const runner = new TutorialRunner('settings', translator);
        runner.stepIdx = 0;
        runner.running = true;
        saveState({ running: true, page: 'settings', stepIdx: 0 });
        runner.show();
        return runner;
    }

    // ---------- DOM: 创建覆盖层 ----------
    ensureOverlay() {
        if (this.backdropEl) return;
        // 半透明遮罩
        this.backdropEl = document.createElement('div');
        this.backdropEl.className = 'tutorial-backdrop';
        // 高亮框（突出目标元素）
        this.highlightEl = document.createElement('div');
        this.highlightEl.className = 'tutorial-highlight';
        // Tooltip 卡片
        this.tooltipEl = document.createElement('div');
        this.tooltipEl.className = 'tutorial-tooltip';
        this.tooltipEl.innerHTML = `
            <div class="tutorial-tooltip-header">
                <span class="tutorial-page-name"></span>
                <span class="tutorial-step-indicator"></span>
            </div>
            <div class="tutorial-tooltip-body"></div>
            <div class="tutorial-tooltip-footer">
                <button class="tutorial-btn tutorial-btn-skip"></button>
                <div class="tutorial-nav">
                    <button class="tutorial-btn tutorial-btn-prev"></button>
                    <button class="tutorial-btn tutorial-btn-primary tutorial-btn-next"></button>
                </div>
            </div>
        `;
        document.body.appendChild(this.backdropEl);
        document.body.appendChild(this.highlightEl);
        document.body.appendChild(this.tooltipEl);

        // 绑定按钮
        this.$('.tutorial-btn-skip').addEventListener('click', () => this.skip());
        this.$('.tutorial-btn-prev').addEventListener('click', () => this.prev());
        this.$('.tutorial-btn-next').addEventListener('click', () => this.next());

        this._scrollHandler = () => this.updatePositions();
        this._resizeHandler = () => this.updatePositions();
        window.addEventListener('scroll', this._scrollHandler, true);
        window.addEventListener('resize', this._resizeHandler);
    }

    $(sel) { return this.tooltipEl.querySelector(sel); }

    destroy() {
        this.running = false;
        if (this._scrollHandler)  window.removeEventListener('scroll', this._scrollHandler, true);
        if (this._resizeHandler)  window.removeEventListener('resize', this._resizeHandler);
        [this.backdropEl, this.highlightEl, this.tooltipEl].forEach(el => el && el.remove());
        this.backdropEl = this.highlightEl = this.tooltipEl = null;
    }

    // ---------- 核心：展示当前步骤 ----------
    show() {
        if (this.stepIdx >= this.steps.length) {
            this.finish();
            return;
        }
        this.ensureOverlay();
        const step = this.steps[this.stepIdx];
        // 填文案
        const pageNameKey = {
            settings:  'tutorial.pageSettings',
            libraries: 'tutorial.pageLibraries',
            designer:  'tutorial.pageDesigner'
        }[this.pageName] || 'info.productNameFull';

        this.$('.tutorial-page-name').textContent = tfmt(pageNameKey);
        this.$('.tutorial-step-indicator').textContent =
            tfmt('tutorial.step', this.stepIdx + 1, this.steps.length);
        this.$('.tutorial-tooltip-body').textContent = tfmt(step.textKey);

        // 按钮文案
        this.$('.tutorial-btn-skip').textContent = tfmt('tutorial.skip');
        this.$('.tutorial-btn-prev').textContent  = tfmt('tutorial.prev');
        const isFinish = step.isFinish;
        const nextBtn = this.$('.tutorial-btn-next');
        nextBtn.textContent = isFinish ? tfmt('tutorial.done') : tfmt('tutorial.next');

        // prev 按钮状态
        this.$('.tutorial-btn-prev').disabled = (this.stepIdx === 0);

        // 更新高亮框和 tooltip 位置
        this.updatePositions();
        // 保存进度
        saveState({ running: true, page: this.pageName, stepIdx: this.stepIdx });
    }

    updatePositions() {
        const step = this.steps[this.stepIdx];
        if (!step) return;
        let target = null;
        if (step.selector) {
            target = document.querySelector(step.selector);
            if (target) {
                // 新 UI（winui3 / tabs 布局）下，非激活的 section 为 display:none，
                // getBoundingClientRect 会返回 0 导致定位错乱。
                // 这里先确保目标所在的 section 被激活可见，再进行测量。
                activateSectionForTarget(target);
                // 如果目标不可见，滚动到它
                const r = target.getBoundingClientRect();
                if (r.top < 0 || r.bottom > window.innerHeight) {
                    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }
        }

        if (target) {
            const rect = target.getBoundingClientRect();
            const pad = 6;
            const hRect = {
                top:    rect.top - pad + window.scrollY,
                left:   rect.left - pad + window.scrollX,
                width:  rect.width + pad * 2,
                height: rect.height + pad * 2
            };
            Object.assign(this.highlightEl.style, {
                top:    hRect.top + 'px',
                left:   hRect.left + 'px',
                width:  hRect.width + 'px',
                height: hRect.height + 'px',
                display: 'block'
            });
            this.placeTooltip(hRect, step.position);
        } else {
            // 无目标：居中展示，无高亮
            this.highlightEl.style.display = 'none';
            this.placeTooltip(null, 'center');
        }
    }

    placeTooltip(hRect, position) {
        const tooltip = this.tooltipEl;
        // 先重置，取自然尺寸
        tooltip.style.top = '0px';
        tooltip.style.left = '0px';
        tooltip.style.position = 'absolute';
        const tw = tooltip.offsetWidth;
        const th = tooltip.offsetHeight;
        const gap = 14;
        let top, left;

        if (position === 'center' || !hRect) {
            top  = window.scrollY + (window.innerHeight - th) / 2;
            left = window.scrollX + (window.innerWidth  - tw) / 2;
        } else if (position === 'top') {
            top  = hRect.top - th - gap;
            left = hRect.left + (hRect.width - tw) / 2;
        } else if (position === 'bottom') {
            top  = hRect.top + hRect.height + gap;
            left = hRect.left + (hRect.width - tw) / 2;
        } else if (position === 'left') {
            top  = hRect.top + (hRect.height - th) / 2;
            left = hRect.left - tw - gap;
        } else { // right
            top  = hRect.top + (hRect.height - th) / 2;
            left = hRect.left + hRect.width + gap;
        }

        // 边界修正：不要超出视口
        const maxLeft = window.scrollX + window.innerWidth  - tw - 8;
        const maxTop  = window.scrollY + window.innerHeight - th - 8;
        left = Math.max(window.scrollX + 8, Math.min(left, maxLeft));
        top  = Math.max(window.scrollY + 8,  Math.min(top,  maxTop));

        tooltip.style.top = top + 'px';
        tooltip.style.left = left + 'px';
    }

    // ---------- 操作：上一步 / 下一步 / 跳过 / 完成 ----------
    prev() {
        if (this.stepIdx > 0) {
            this.stepIdx--;
            this.show();
        }
    }

    next() {
        const step = this.steps[this.stepIdx];
        if (step && step.nextPage && PAGE_URLS[step.nextPage]) {
            // 先保存下一步的目标页面 + 目标 index
            const nextPageName = step.nextPage;
            saveState({ running: true, page: nextPageName, stepIdx: 0 });
            // 清理当前页的 UI，避免跳转前看到残影
            this.destroy(false);
            window.location.href = PAGE_URLS[nextPageName];
            return;
        }
        if (step && step.isFinish) {
            this.finish();
            return;
        }
        this.stepIdx++;
        this.show();
    }

    skip() {
        clearState();
        this.destroy();
    }

    finish() {
        clearState();
        this.destroy();
    }
}

// 导出公共 API
export function createTutorial(pageName, translator) {
    return new TutorialRunner(pageName, translator);
}

export function startTutorialFromSettings(translator) {
    return TutorialRunner.startFromSettings(translator);
}

export function resumeTutorialIfAny(pageName, translator) {
    return TutorialRunner.restoreIfNeeded(pageName, translator);
}
