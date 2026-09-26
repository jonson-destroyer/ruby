import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      // アプリの見た目・アイコンはここに置き換えてください(public/配下に画像を用意)
      manifest: {
        name: "みかんカウント・摘果測定",
        short_name: "みかん摘果",
        description: "オフラインで使えるみかん検出・カウント・摘果判定アプリ",
        theme_color: "#2f6b3a",
        background_color: "#fbf7ee",
        display: "standalone",
        start_url: "/",
        icons: [
          // 実際のアイコンファイルをpublic/に置いてパスを合わせてください
          // { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          // { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
      workbox: {
        // アプリ本体(HTML/JS/CSS)はプリキャッシュしてオフラインでも起動できるようにする。
        // Roboflowのモデル本体はinferencejsが独自にIndexedDBへキャッシュするため対象外でよい。
        globPatterns: ["**/*.{js,css,html,ico,png,svg}"],
      },
    }),
  ],
});
