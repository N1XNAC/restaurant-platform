import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// When the app is hosted away from the API (Netlify, GitHub Pages), a
// same-origin API default would silently point every request at the static
// host. Fail the build with a clear message instead; local/dev builds keep the
// same-origin default.
const apiBaseUrl = (process.env.VITE_API_BASE_URL ?? '').trim();
if ((process.env.NETLIFY === 'true' || process.env.GITHUB_ACTIONS === 'true') && !apiBaseUrl) {
  throw new Error(
    'VITE_API_BASE_URL is not set. In the hosting settings add:\n' +
      '  VITE_API_BASE_URL = https://api.your-domain.com\n' +
      '(the origin of the backend that serves /api).'
  );
}

// Project sites on GitHub Pages live under /<repo>/. Vite needs that as `base`
// so asset URLs and the router basename resolve correctly.
const base = (process.env.VITE_BASE_PATH ?? '').trim() || '/';

export default defineConfig({
  base,
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
