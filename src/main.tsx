import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Unregister any active Progressive Web App Service Workers and clear caches to force-bypass stale cache
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const registration of registrations) {
      registration.unregister().then(() => {
        console.log("Service Worker unregistered successfully.");
      });
    }
  });
}

// Clear Cache Storage to purge old index.html and asset bundles
if ("caches" in window) {
  caches.keys().then((names) => {
    for (const name of names) {
      caches.delete(name).then(() => {
        console.log("Cache deleted:", name);
      });
    }
  });
}

