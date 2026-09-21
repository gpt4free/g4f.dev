/**
 * Window Controls Overlay ("title bar") integration for the G4F chat app.
 *
 * When the chat is installed as a PWA with the `window-controls-overlay`
 * display override (see /dist/img/site.webmanifest), the operating system
 * draws its title bar (window controls) on top of the web content. This
 * module exposes the title bar geometry as CSS custom properties on the
 * document root and toggles a `wco-active` class on <body>, so the layout
 * can reserve and style the title bar area (see the "Window Controls
 * Overlay" section at the end of /dist/css/style.css).
 *
 * CSS custom properties set here:
 *   --titlebar-x, --titlebar-y, --titlebar-width, --titlebar-height
 */
(function () {
    "use strict";

    var overlay = navigator.windowControlsOverlay;

    // Not supported (unsupported browser, or page not running as an
    // installed PWA): CSS falls back to the env()/0px defaults.
    if (!overlay || typeof overlay.getTitlebarGeometry !== "function") {
        return;
    }

    var scheduled = null;

    function update() {
        var geometry = overlay.getTitlebarGeometry();
        var style = document.documentElement.style;

        style.setProperty("--titlebar-x", geometry.x + "px");
        style.setProperty("--titlebar-y", geometry.y + "px");
        style.setProperty("--titlebar-width", geometry.width + "px");
        style.setProperty("--titlebar-height", geometry.height + "px");

        // `visible` is false in regular browser tabs and while in
        // fullscreen, where no title bar is drawn over the page.
        document.body.classList.toggle("wco-active", overlay.visible === true);
    }

    function requestUpdate() {
        // Coalesce the rapid geometrychange bursts fired while resizing.
        if (scheduled !== null) {
            return;
        }
        scheduled = requestAnimationFrame(function () {
            scheduled = null;
            update();
        });
    }

    // Fired when the window is moved or resized, and when the overlay
    // visibility changes (e.g. entering or leaving fullscreen).
    overlay.addEventListener("geometrychange", requestUpdate);

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", update);
    } else {
        update();
    }
})();
