import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    // A new version (after a deployment) is activated at app start, followed by one reload.
    // Not on the very first visit: there is no old version to replace yet.
    const hadController = Boolean(navigator.serviceWorker.controller);
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloading) return;
      reloading = true;
      window.location.reload();
    });

    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js')
        .then((registration) => {
          if (registration.waiting && hadController) {
            registration.waiting.postMessage('SKIP_WAITING');
          }
        })
        .catch((error) => {
          console.warn('Service Worker konnte nicht registriert werden:', error);
        });
    });
  } else {
    // Dev server: an old service worker would serve stale modules.
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => registration.unregister());
    });
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
