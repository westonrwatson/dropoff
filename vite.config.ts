import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react()],
    server: {
      port: 5199,
      /** If 5199 is taken (e.g. old dev server), use the next free port. */
      strictPort: false,
      /**
       * Local dev: browser calls same-origin `/api/gemini/*` → Google Generative Language API.
       * Set GEMINI_API_KEY (or GOOGLE_API_KEY) in `.env.local` (not VITE_) so the key stays on the dev server.
       * The proxy appends `?key=` if the request does not already include one (BYOK in the URL still works).
       */
      proxy: {
        '/api/gemini': {
          target: 'https://generativelanguage.googleapis.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/gemini/, ''),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              const serverKey =
                env.GEMINI_API_KEY?.trim() || env.GOOGLE_API_KEY?.trim()
              if (!serverKey) return
              const path = proxyReq.path || ''
              if (/[?&]key=/.test(path)) return
              const sep = path.includes('?') ? '&' : '?'
              proxyReq.path = `${path}${sep}key=${encodeURIComponent(serverKey)}`
            })
          },
        },
      },
    },
  }
})
