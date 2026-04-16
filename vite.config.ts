import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY':     JSON.stringify(env.GEMINI_API_KEY     || process.env.GEMINI_API_KEY),
      'process.env.ANTHROPIC_API_KEY':  JSON.stringify(env.ANTHROPIC_API_KEY  || process.env.ANTHROPIC_API_KEY),
      'process.env.AI_GATEWAY_API_KEY': JSON.stringify(env.AI_GATEWAY_API_KEY || process.env.AI_GATEWAY_API_KEY),
      'process.env.DAYTONA_API_KEY':    JSON.stringify(env.DAYTONA_API_KEY    || process.env.DAYTONA_API_KEY),
      'process.env.FIRECRAWL_API_KEY':  JSON.stringify(env.FIRECRAWL_API_KEY  || process.env.FIRECRAWL_API_KEY),
      'process.env.DAYTONA_SERVER_URL': JSON.stringify(env.DAYTONA_SERVER_URL || process.env.DAYTONA_SERVER_URL || 'https://app.daytona.io/api'),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom', 'react-router-dom'],
            ui: ['lucide-react', 'framer-motion'],
            editor: ['prismjs']
          }
        }
      }
    }
  };
});
