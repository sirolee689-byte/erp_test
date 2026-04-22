import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // 允许局域网其他设备通过 http://<内网IP>:5173 访问
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      // 将前端的 /api 请求代理到本地后端，避免开发环境跨域问题
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
