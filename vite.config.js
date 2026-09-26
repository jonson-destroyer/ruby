import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      manifest: {
        name: "みかん検出・直径測定",
        short_name: "みかん測定",
        description: "端末内でみかんの個数と推定直径を確認",
        start_url: "/",
        scope: "/",
        display: "standalone",
        theme_color: "#22332a",
        background_color: "#22332a"
      },
      workbox: {
        globPatterns: ["**/*.{html,js,css,svg,png,webp,wasm}"],
        maximumFileSizeToCacheInBytes: 25 * 1024 * 1024,
        navigateFallback: "/"
      }
    })
  ]
});
