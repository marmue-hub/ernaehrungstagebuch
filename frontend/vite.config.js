import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const allowedHosts = ['wiegehts.x73.eu', 'www.wiegehts.x73.eu'];
const publicFiles = ['manifest.webmanifest', 'ernaehrungstagebuch-icon.svg'];

// Emits sw.js with the complete list of build files, so the app works fully offline.
const serviceWorkerPlugin = () => ({
  name: 'service-worker-precache',
  apply: 'build',
  generateBundle(_options, bundle) {
    const bundleFiles = Object.keys(bundle).filter((fileName) => fileName !== 'index.html' && !fileName.endsWith('.map'));
    const urls = ['/', '/index.html', ...[...bundleFiles, ...publicFiles].sort().map((fileName) => `/${fileName}`)];
    const version = createHash('sha256').update(urls.join('\n')).digest('hex').slice(0, 12);
    const template = readFileSync(new URL('./sw.js', import.meta.url), 'utf8');

    this.emitFile({
      type: 'asset',
      fileName: 'sw.js',
      source: template
        .replace('self.__PRECACHE_MANIFEST', JSON.stringify(urls))
        .replace('__CACHE_VERSION__', version),
    });
  },
});

export default defineConfig({
  plugins: [react(), serviceWorkerPlugin()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts,
    proxy: {
      '/api': {
        target: 'http://backend:8000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts,
  },
});
