import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'icons.svg'],
      manifest: {
        name: 'Nostr Clips',
        short_name: 'NostrClips',
        description: 'Consumption-first Nostr vertical short-form video client',
        theme_color: '#09090b',
        background_color: '#09090b',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          {
            src: 'favicon.svg',
            sizes: '192x192',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: 'favicon.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        // Exclude large video files from precaching
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        navigateFallback: 'index.html',
        navigateFallbackAllowlist: [/^\/.*$/],
        runtimeCaching: [
          {
            // Only cache m3u8 playlists (small text files); skip mp4/webm
            // to avoid filling Cache Storage with multi-MB video files
            urlPattern: /^https:\/\/.+\.m3u8(\?.*)?$/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'videos',
              networkTimeoutSeconds: 5,
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 24 * 60 * 60, // 1 day
                purgeOnQuotaError: true,
              },
            },
          },
          {
            // Cache Google Fonts stylesheets and font files
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'fonts',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
                purgeOnQuotaError: true,
              },
            },
          },
        ],
        navigateFallbackDenylist: [/^\/api\//, /^\/.*\.\w+$/],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/') || id.includes('node_modules/react-router')) {
            return 'vendor-react'
          }
          if (id.includes('node_modules/nostr-tools') || id.includes('node_modules/applesauce') || id.includes('node_modules/nostr-passkey') || id.includes('node_modules/nostr-passkey')) {
            return 'vendor-nostr'
          }
          if (id.includes('node_modules/swiper') || id.includes('node_modules/vaul') || id.includes('node_modules/lucide-react')) {
            return 'vendor-ui'
          }
          if (id.includes('node_modules/@vidstack') || id.includes('node_modules/hls.js')) {
            return 'vendor-video'
          }
          if (id.includes('node_modules/@ffmpeg')) {
            return 'vendor-ffmpeg'
          }
        },
      },
    },
  },
})
