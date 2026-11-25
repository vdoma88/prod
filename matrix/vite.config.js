import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
  base: '/matrix/',
  publicDir: false,
  plugins: [react()],
  build: { outDir: '../site/matrix', emptyOutDir: true }
})
