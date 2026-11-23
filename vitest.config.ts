import { defineConfig } from 'vitest/config'

// Separate from vite.config.ts, whose root is the webapp.
export default defineConfig({
  test: { include: ['test/**/*.test.ts'] }
})
