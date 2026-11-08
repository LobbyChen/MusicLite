import { defineConfig } from "vite";
import wails from "@wailsio/runtime/plugins/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

// https://vitejs.dev/config/
export default defineConfig({
    server: {
        host: "127.0.0.1",
        port: Number(process.env.WAILS_VITE_PORT) || 9245,
        strictPort: true,
    },
    plugins: [wails("./bindings")],
    resolve: {
        alias: {
            "@bindings": path.resolve(root, "bindings"),
        },
    },
    build: {
        rollupOptions: {
            input: {
                main: path.resolve(root, "index.html"),
                libraries: path.resolve(root, "src/pages/libraries.html"),
                settings: path.resolve(root, "src/pages/settings.html"),
                tray: path.resolve(root, "src/pages/tray-menu.html"),
                librariesNew: path.resolve(root, "src/pages/libraries-new.html"),
                settingsNew: path.resolve(root, "src/pages/settings-new.html"),
                trayNew: path.resolve(root, "src/pages/tray-menu-new.html"),
            },
        },
    },
});
