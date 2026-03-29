import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/trackingmore': {
        target: 'https://api.trackingmore.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/trackingmore/, '/v4'),
        headers: {
          'Tracking-Api-Key': process.env.VITE_TM_API_KEY || ''
        }
      }
    }
  }
})
