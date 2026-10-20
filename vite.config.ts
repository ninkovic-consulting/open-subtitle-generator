import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const serverPort = Number(process.env.PORT ?? 4747);

/** Dev only: fetch the API session token from the local server and embed it like production does. */
function devSessionToken(): Plugin {
  return {
    name: 'osg-dev-session-token',
    apply: 'serve',
    async transformIndexHtml(html) {
      for (let i = 0; i < 40; i++) {
        try {
          const res = await fetch(`http://127.0.0.1:${serverPort}/api/dev/token`);
          if (res.ok) {
            const { token } = (await res.json()) as { token: string };
            return html.replace('</head>', `<meta name="osg-token" content="${token}" /></head>`);
          }
        } catch {
          // server still starting
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      return html;
    },
  };
}

export default defineConfig({
  root: 'src/web',
  plugins: [react(), tailwindcss(), devSessionToken()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src/web'),
      '@shared': path.resolve(import.meta.dirname, 'src/shared'),
    },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/web'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: `http://127.0.0.1:${serverPort}`, changeOrigin: false },
    },
  },
});
