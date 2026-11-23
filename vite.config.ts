import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import checker from 'vite-plugin-checker'

// Absolute, so the type check does not depend on the directory the build runs from.
const web = fileURLToPath(new URL('./web', import.meta.url))

export default defineConfig({
  root: 'web',
  base: '/briefing-engine/',
  // A Vite root moves the default publicDir; the icon lives in static/.
  publicDir: '../static',
  // rjsf and its validator make one ~600 kB bundle; the webapp loads once.
  build: { outDir: '../public', emptyOutDir: true, chunkSizeWarningLimit: 900 },
  plugins: [react(), checker({ typescript: { root: web, tsconfigPath: 'tsconfig.json' } })],
  server: {
    proxy: {
      '^/plugins/': { target: process.env.SK_URL ?? 'http://localhost:3000', changeOrigin: true }
    }
  }
})
