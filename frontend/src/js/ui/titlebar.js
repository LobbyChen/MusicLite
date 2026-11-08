// 共享标题栏组件：各页面只保留挂载点，避免重复 HTML。
const TITLEBAR_HTML = `
<div class="titlebar">
    <div class="titlebar-left">
        <svg width="24" height="24" xmlns="http://www.w3.org/2000/svg" clip-rule="evenodd" xml:space="preserve" version="1.1">
            <g>
                <g stroke-dasharray="5,2,2,2,2,2" fill="#666666" id="Icon">
                    <path fill="#00A4EF" stroke-dasharray="5,2,2,2,2,2" id="svg_1" d="m11.7619,2.25c-5.381,0 -9.75,4.369 -9.75,9.75c0,5.381 4.369,9.75 9.75,9.75c5.381,0 9.75,-4.369 9.75,-9.75c0,-5.381 -4.369,-9.75 -9.75,-9.75zm0,1.5c4.553,0 8.25,3.697 8.25,8.25c0,4.553 -3.697,8.25 -8.25,8.25c-4.553,0 -8.25,-3.697 -8.25,-8.25c0,-4.553 3.697,-8.25 8.25,-8.25z" />
                    <path fill="#00A4EF" stroke-dasharray="5,2,2,2,2,2" id="svg_2" d="m10.4729,8.841l-2.649,1.681c-0.506,0.321 -0.812,0.879 -0.812,1.478c0,0.599 0.306,1.157 0.812,1.478c0.799,0.506 1.817,1.152 2.649,1.681c0.539,0.342 1.222,0.363 1.781,0.056c0.559,-0.308 0.907,-0.896 0.907,-1.534c0,-1.035 0,-2.327 0,-3.362c0,-0.638 -0.348,-1.226 -0.907,-1.534c-0.559,-0.307 -1.242,-0.286 -1.781,0.056zm0.804,1.267c0.077,-0.049 0.175,-0.052 0.254,-0.008c0.08,0.044 0.13,0.128 0.13,0.219c0,1.035 0,2.327 0,3.362c0,0.091 -0.05,0.175 -0.13,0.219c-0.079,0.044 -0.177,0.041 -0.254,-0.008c-0.832,-0.528 -1.851,-1.174 -2.649,-1.681c-0.072,-0.046 -0.116,-0.125 -0.116,-0.211c0,-0.086 0.044,-0.165 0.116,-0.211l2.649,-1.681z" />
                    <path fill="#00A4EF" stroke-dasharray="5,2,2,2,2,2" id="svg_3" d="m14.4109,8.75l0.006,0c0.964,0.003 1.744,0.786 1.744,1.75c0,0.871 0,2.129 0,3c0,0.964 -0.78,1.747 -1.744,1.75l-0.006,0l0,0c-0.414,0 -0.749,-0.336 -0.749,-0.75c0,-0.414 0.335,-0.75 0.749,-0.75l0,0c0,0 0,0 0,0c0.138,0 0.25,-0.112 0.25,-0.25c0,-0.871 0,-2.129 0,-3c0,-0.138 -0.112,-0.25 -0.25,-0.25l0,0c-0.414,0 -0.749,-0.336 -0.749,-0.75c0,-0.414 0.335,-0.75 0.749,-0.75l0,0z" />
                </g>
            </g>
        </svg>
        <span class="titlebar-title" data-i18n="info.productNameFull">MusicLite Cuckoo</span>
    </div>
    <div class="titlebar-controls">
        <button class="titlebar-btn" id="minimizeBtn" title="最小化" data-i18n-title="titlebar.minimize">
            <svg viewBox="0 0 24 24" width="14" height="14"><path d="M19 13H5v-2h14v2z" /></svg>
        </button>
        <button class="titlebar-btn titlebar-close" id="closeBtn" title="关闭" data-i18n-title="titlebar.close">
            <svg viewBox="0 0 24 24" width="14" height="14"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
        </button>
    </div>
</div>`;

export function mountTitlebar() {
    const host = document.getElementById('app-titlebar');
    if (!host) return;
    host.outerHTML = TITLEBAR_HTML;
}
