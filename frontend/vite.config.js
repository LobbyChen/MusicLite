import { defineConfig } from 'vite'
import path from 'path'

export default defineConfig({
    resolve: {
        alias: {
            // Wails v3: 让 ES 模块内部的 import '@wailsio/runtime' 解析到已安装的 npm 包
            '@wailsio/runtime': path.resolve(__dirname, 'node_modules/@wailsio/runtime'),
            // bindings 生成目录别名，供前端 import 使用（避免复杂相对路径）
            '@bindings': path.resolve(__dirname, 'bindings'),
            // HTML 中 <script type="module" src="/wails/runtime.js"> 的根路径，
            // Vite/Rollup 会把它当成模块入口，需映射到 @wailsio/runtime 包里的模块
            '/wails/runtime.js': path.resolve(__dirname, 'node_modules/@wailsio/runtime'),
        },
    },
    build: {
        rollupOptions: {
            // 如果 Wails 运行时会独立注入 /wails/runtime.js，可在此 external；
            // 但目前已用 npm 包安装，让 Rollup 一起打包 @wailsio/runtime 更稳妥
            external: [],
            input: {
                main: path.resolve(__dirname, 'index.html'),
                libs: path.resolve(__dirname, './src/html/libraries.html'),
                settings: path.resolve(__dirname, './src/html/settings.html'),
                designer: path.resolve(__dirname, './src/html/designer.html'),
                tray: path.resolve(__dirname, './src/html/tray-menu.html'),
            },
        },
    },
})