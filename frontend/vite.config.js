import { defineConfig } from 'vite'
import path from 'path'

export default defineConfig({
    build: {
        rollupOptions: {
            input: {
                main: path.resolve(__dirname, 'index.html'),
                libs: path.resolve(__dirname, './src/html/libraries.html'),
                settings: path.resolve(__dirname, './src/html/settings.html'),
                designer: path.resolve(__dirname, './src/html/designer.html'),
            },
        },
    },
})