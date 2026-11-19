import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// On Netlify the app is on its own domain, so a same-origin API default would
// silently point every request at Netlify itself. Fail the build with a clear
// message instead; local/dev builds keep the same-origin default.
const apiBaseUrl = (process.env.VITE_API_BASE_URL ?? '').trim();
if (process.env.NETLIFY === 'true' && !apiBaseUrl) {
  throw new Error(
    'VITE_API_BASE_URL is not set. In the Netlify site settings add:\n' +
      '  VITE_API_BASE_URL = https://api.your-domain.com\n' +
      '(the origin of the backend that serves /api).'
  );
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
        ws: true,
      },
      '/uploads': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
      },
    },
  },
});
