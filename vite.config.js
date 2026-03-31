import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/trackingmore': {
        target: 'https://api.trackingmore.com',
        changeOrigin: true,
        rewrite: (path) => '/v4/trackings/get',
        headers: {
          'Tracking-Api-Key': process.env.VITE_TM_API_KEY || ''
        }
      }
    }
  }
})
