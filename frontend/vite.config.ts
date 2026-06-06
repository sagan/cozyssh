import { defineConfig } from "vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import { VitePWA } from "vite-plugin-pwa";

const debug = false;

// https://vite.dev/config/
export default defineConfig({
  build: {
    emptyOutDir: true,
    sourcemap: true,
    minify: !debug,
  },
  resolve: debug
    ? {
        alias: {
          // Swaps the standard renderer for the profiling-enabled renderer
          "react-dom/client": "react-dom/profiling",
          // If your app or third-party libraries use the old scheduler directly:
          "scheduler/tracing": "scheduler/tracing-profiling",
        },
      }
    : undefined,
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
        // Only apply navigateFallback to page navigation requests, not API/WS endpoints
        navigateFallbackAllowlist: [/^\/(?!api\/|ws\/|manifest\.json)/],
        // Ignore all query parameters when matching precached entries.
        // Without this, /?noautoload=1 fails to match the cached "/" entry → ERR_FAILED.
        ignoreURLParametersMatching: [/.*/],
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
