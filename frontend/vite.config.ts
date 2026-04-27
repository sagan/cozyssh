import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'script',
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        navigateFallback: 'index.html',
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5MB
        runtimeCaching: [
          {
            urlPattern: /\/manifest\.json$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'manifest-cache',
              expiration: {
                maxEntries: 1,
              }
            },
          },
          {
            urlPattern: /\/api\/(?:fulldata|hosts)$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-data-cache',
              expiration: {
                maxEntries: 2,
                maxAgeSeconds: 60 * 60 * 24, // 24 hours
              }
            },
          }
        ]
      },
      manifest: false,
    })
  ],
})
