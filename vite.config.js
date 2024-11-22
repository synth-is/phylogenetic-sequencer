import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/', // Change this if not serving from root
  build: {
    outDir: 'dist',
    // Generate sourcemaps for production
    sourcemap: true,
  },
  server: {
    fs: {
      allow: ['..', '/Users/bjornpjo/Developer/vendor/strudel/strudel/packages/core']
    }
  }
})
