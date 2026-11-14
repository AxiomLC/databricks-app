import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // Pinned so the URL is predictable. 5173/5174 are taken by other projects.
    port: 5180,
    // Fail loudly instead of silently drifting to another port.
    strictPort: true,
  },
  preview: {
    port: 4180,
    strictPort: true,
  },
})
