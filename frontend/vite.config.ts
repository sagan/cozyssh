import { defineConfig } from "vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import { VitePWA } from "vite-plugin-pwa";

// https://vite.dev/config/
export default defineConfig({
  build: {
    emptyOutDir: true,
  },
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "script",
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        globPatterns: ["**/*.{js,css,html,ico,png,svg}"],
        navigateFallback: "index.html",
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5MB
        runtimeCaching: [
          {
            urlPattern: /\/manifest\.json$/,
            handler: "NetworkFirst",
            options: {
              cacheName: "manifest-cache",
              expiration: {
                maxEntries: 1,
              },
            },
          },
          {
            urlPattern: /\/api\/(?:fulldata|hosts)$/,
            handler: "NetworkFirst",
            options: {
              cacheName: "api-data-cache",
              expiration: {
                maxEntries: 100,
                // maxAgeSeconds: 60 * 60 * 24 * 365,
              },
            },
          },
        ],
      },
      manifest: false,
    }),
  ],
});
