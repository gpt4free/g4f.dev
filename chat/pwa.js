/* G4F Chat PWA bootstrap: registers the /chat/ service worker. */
(function () {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;

  window.addEventListener('load', function () {
    navigator.serviceWorker
      .register('/chat/sw.js', { scope: '/chat/', updateViaCache: 'none' })
      .catch(function (error) {
        console.warn('[pwa] Service worker registration failed:', error);
      });
  });
})();
