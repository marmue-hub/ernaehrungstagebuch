import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const allowedHosts = ['wiegehts.x73.eu', 'www.wiegehts.x73.eu'];

const originOf = (value) => {
  try {
    return value ? new URL(value).origin : null;
  } catch {
    return null;
  }
};

// API and home-network check may live on another origin (e.g. local test setup)
const connectSources = [
  "'self'",
  originOf(process.env.VITE_API_URL),
  originOf(process.env.VITE_HOME_CHECK_URL),
].filter(Boolean);

const securityHeaders = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    // React style={{...}} attributes need inline styles
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    `connect-src ${[...new Set(connectSources)].join(' ')}`,
    "manifest-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};
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

// The preview server answers unknown paths with index.html (SPA fallback). For build files that
// would hand HTML to the browser as JavaScript, so missing assets get a real 404.
const missingAssetsNotFoundPlugin = () => ({
  name: 'missing-assets-not-found',
  configurePreviewServer(server) {
    const outDir = resolve(server.config.root, server.config.build.outDir);
    server.middlewares.use((req, res, next) => {
      const path = (req.url || '').split('?')[0];
      if (path.startsWith('/assets/') && !existsSync(resolve(outDir, `.${decodeURIComponent(path)}`))) {
        res.statusCode = 404;
        res.end('Not found');
        return;
      }
      next();
    });
  },
});

export default defineConfig({
  plugins: [react(), serviceWorkerPlugin(), missingAssetsNotFoundPlugin()],
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
    headers: securityHeaders,
  },
});
