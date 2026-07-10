import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  return {
    root: __dirname,
    plugins: [react(), tailwindcss()],
    build: {
      outDir: 'dist',
      emptyOutDir: true
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src')
      }
    },
    server: {
      port: 5173,
      proxy: {
        '/api': 'http://127.0.0.1:3000',
        '/health': 'http://127.0.0.1:3000',
        '/chat': 'http://127.0.0.1:3000',
        '/state': 'http://127.0.0.1:3000',
        '/actions': 'http://127.0.0.1:3000',
        '/achievements': 'http://127.0.0.1:3000',
        '/learning': 'http://127.0.0.1:3000',
        '/management': 'http://127.0.0.1:3000',
        '/memory': 'http://127.0.0.1:3000',
        '/summary': 'http://127.0.0.1:3000',
        '/stt': 'http://127.0.0.1:3000',
        '/tts': 'http://127.0.0.1:3000'
      },
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {}
    }
  };
});
