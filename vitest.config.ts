import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  // Mirror vite.config.ts aliases so runtime imports (not just erased type-only
  // ones) resolve under vitest — e.g. '@shared/agents'.
  resolve: {
    alias: {
      '@': path.join(__dirname, 'src'),
      '@shared': path.join(__dirname, 'shared'),
    },
  },
  test: {
    root: __dirname,
    include: ['test/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    testTimeout: 1000 * 29,
  },
})
