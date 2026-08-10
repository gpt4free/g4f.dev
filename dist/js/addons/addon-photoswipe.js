import PhotoSwipeLightbox from "https://cdn.jsdelivr.net/npm/photoswipe@5.3.8/dist/photoswipe-lightbox.esm.min.js";
import PhotoSwipeVideoPlugin from "https://cdn.jsdelivr.net/gh/dimsemenov/photoswipe-video-plugin@5e32d6589df53df2887900bcd55267d72aee57a6/dist/photoswipe-video-plugin.esm.min.js";
import PhotoSwipeAutoHideUI from "https://cdn.jsdelivr.net/gh/arnowelzel/photoswipe-auto-hide-ui@1.0.1/photoswipe-auto-hide-ui.esm.min.js";
import PhotoSwipeSlideshow from "https://cdn.jsdelivr.net/gh/dpet23/photoswipe-slideshow@v2.0.0/photoswipe-slideshow.esm.min.js";

// ─── Demo-Screen HTML & CSS ────────────────────────────────────────────
const DEMO_HTML = `
<style>
    .ps-demo-overlay {
        position: fixed;
        inset: 0;
        z-index: 99999;
        background: rgba(0, 0, 0, 0.85);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        color: #fff;
        animation: psDemoFadeIn 0.4s ease;
    }
    @keyframes psDemoFadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
    }
    @keyframes psDemoSlideUp {
        from { opacity: 0; transform: translateY(30px); }
        to { opacity: 1; transform: translateY(0); }
    }
    .ps-demo-card {
        background: #1a1a2e;
        border-radius: 16px;
        padding: 32px;
        max-width: 520px;
        width: 90%;
        box-shadow: 0 20px 60px rgba(0,0,0,0.5);
        animation: psDemoSlideUp 0.5s ease 0.1s both;
    }
    .ps-demo-header {
        text-align: center;
        margin-bottom: 24px;
    }
    .ps-demo-header h2 {
        margin: 0 0 8px 0;
        font-size: 24px;
        background: linear-gradient(135deg, #667eea, #764ba2);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
    }
    .ps-demo-header p {
        margin: 0;
        color: #888;
        font-size: 14px;
    }
    .ps-demo-gallery {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 8px;
        margin-bottom: 24px;
    }
    .ps-demo-gallery a {
        display: block;
        border-radius: 8px;
        overflow: hidden;
        aspect-ratio: 1;
        cursor: pointer;
        transition: transform 0.2s ease, box-shadow 0.2s ease;
        position: relative;
    }
    .ps-demo-gallery a:hover {
        transform: scale(1.05);
        box-shadow: 0 4px 20px rgba(102, 126, 234, 0.4);
    }
    .ps-demo-gallery a img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
    }
    .ps-demo-gallery a .ps-demo-badge {
        position: absolute;
        bottom: 4px;
        right: 4px;
        background: rgba(0,0,0,0.7);
        color: #fff;
        font-size: 10px;
        padding: 2px 6px;
        border-radius: 4px;
    }
    .ps-demo-features {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        margin-bottom: 24px;
    }
    .ps-demo-feature {
        background: rgba(255,255,255,0.05);
        border-radius: 8px;
        padding: 12px;
        font-size: 12px;
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .ps-demo-feature i {
        font-size: 16px;
        color: #667eea;
        width: 20px;
        text-align: center;
    }
    .ps-demo-actions {
        display: flex;
        gap: 12px;
        justify-content: center;
    }
    .ps-demo-btn {
        padding: 10px 24px;
        border: none;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
    }
    .ps-demo-btn-primary {
        background: linear-gradient(135deg, #667eea, #764ba2);
        color: #fff;
    }
    .ps-demo-btn-primary:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
    }
    .ps-demo-btn-secondary {
        background: rgba(255,255,255,0.1);
        color: #fff;
    }
    .ps-demo-btn-secondary:hover {
        background: rgba(255,255,255,0.2);
    }
</style>
<div class="ps-demo-overlay" id="psDemoOverlay">
    <div class="ps-demo-card">
        <div class="ps-demo-header">
            <h2>📸 PhotoSwipe Gallery</h2>
            <p>Addon erfolgreich installiert! Hier eine Demo:</p>
        </div>
        <div class="ps-demo-gallery" id="psDemoGallery">
            <a href="https://picsum.photos/id/1015/1200/800"
               data-pswp-width="1200" data-pswp-height="800"
               data-caption="Berglandschaft" alt="Berglandschaft">
                <img src="https://picsum.photos/id/1015/300/300" alt="Berglandschaft" loading="lazy">
            </a>
            <a href="https://picsum.photos/id/1025/1200/800"
               data-pswp-width="1200" data-pswp-height="800"
               data-caption="Hund im Gras" alt="Hund im Gras">
                <img src="https://picsum.photos/id/1025/300/300" alt="Hund im Gras" loading="lazy">
            </a>
            <a href="https://picsum.photos/id/1035/1200/800"
               data-pswp-width="1200" data-pswp-height="800"
               data-caption="Wasserfall" alt="Wasserfall">
                <img src="https://picsum.photos/id/1035/300/300" alt="Wasserfall" loading="lazy">
            </a>
            <a href="https://picsum.photos/id/1040/1200/800"
               data-pswp-width="1200" data-pswp-height="800"
               data-caption="Herbstwald" alt="Herbstwald">
                <img src="https://picsum.photos/id/1040/300/300" alt="Herbstwald" loading="lazy">
            </a>
            <a href="https://picsum.photos/id/1050/1200/800"
               data-pswp-width="1200" data-pswp-height="800"
               data-caption="Sonnenuntergang" alt="Sonnenuntergang">
                <img src="https://picsum.photos/id/1050/300/300" alt="Sonnenuntergang" loading="lazy">
            </a>
            <a href="https://picsum.photos/id/1060/1200/800"
               data-pswp-width="1200" data-pswp-height="800"
               data-caption="Blumenwiese" alt="Blumenwiese">
                <img src="https://picsum.photos/id/1060/300/300" alt="Blumenwiese" loading="lazy">
            </a>
        </div>
        <div class="ps-demo-features">
            <div class="ps-demo-feature">
                <i class="fa-solid fa-magnifying-glass-plus"></i>
                <span>Zoom per Doppelklick</span>
            </div>
            <div class="ps-demo-feature">
                <i class="fa-solid fa-play"></i>
                <span>Slideshow (7s)</span>
            </div>
            <div class="ps-demo-feature">
                <i class="fa-solid fa-video"></i>
                <span>Video-Support</span>
            </div>
            <div class="ps-demo-feature">
                <i class="fa-solid fa-download"></i>
                <span>Download-Button</span>
            </div>
            <div class="ps-demo-feature">
                <i class="fa-solid fa-eye-slash"></i>
                <span>Auto-Hide UI</span>
            </div>
            <div class="ps-demo-feature">
                <i class="fa-solid fa-captions"></i>
                <span>Captions</span>
            </div>
        </div>
        <div class="ps-demo-actions">
            <button class="ps-demo-btn ps-demo-btn-primary" id="psDemoTryBtn">
                <i class="fa-solid fa-play"></i> Demo starten
            </button>
            <button class="ps-demo-btn ps-demo-btn-secondary" id="psDemoCloseBtn">
                <i class="fa-solid fa-xmark"></i> Schließen
            </button>
        </div>
    </div>
</div>
`;

// ─── Demo-Screen Logic ─────────────────────────────────────────────────
function showDemoScreen() {
    // Remove existing demo if any
    const existing = document.getElementById('psDemoOverlay');
    if (existing) existing.remove();

    // Inject demo HTML
    const container = document.createElement('div');
    container.innerHTML = DEMO_HTML;
    document.body.appendChild(container.firstElementChild);

    const overlay = document.getElementById('psDemoOverlay');
    const gallery = document.getElementById('psDemoGallery');
    const tryBtn = document.getElementById('psDemoTryBtn');
    const closeBtn = document.getElementById('psDemoCloseBtn');

    // Close overlay
    const closeOverlay = () => {
        overlay.style.transition = 'opacity 0.3s ease';
        overlay.style.opacity = '0';
        setTimeout(() => overlay.remove(), 300);
    };

    closeBtn.addEventListener('click', closeOverlay);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeOverlay();
    });

    // "Demo starten" → open the demo gallery with PhotoSwipe
    tryBtn.addEventListener('click', () => {
        closeOverlay();

        // Create a temporary PhotoSwipe instance for the demo gallery
        const demoLightbox = new PhotoSwipeLightbox({
            gallery: '#psDemoGallery',
            children: 'a',
            secondaryZoomLevel: 1,
            maxZoomLevel: 3,
            allowPanToNext: true,
            doubleTapAction: 'close',
            pswpModule: () => import('https://cdn.jsdelivr.net/npm/photoswipe'),
        });

        demoLightbox.addFilter('itemData', (itemData) => {
            const el = itemData.element;
            if (el) {
                itemData.src = itemData.src || el.getAttribute('href');
                itemData.width = parseInt(el.dataset.pswpWidth) || 1200;
                itemData.height = parseInt(el.dataset.pswpHeight) || 800;
            }
            return itemData;
        });

        // Add caption to demo
        demoLightbox.on('uiRegister', function () {
            demoLightbox.pswp.ui.registerElement({
                name: 'demo-caption',
                order: 9,
                isButton: false,
                appendTo: 'root',
                html: '',
                onInit: (el, pswp) => {
                    el.style.cssText = `
                        position: absolute;
                        bottom: 0;
                        left: 0;
                        right: 0;
                        padding: 12px 16px;
                        background: linear-gradient(transparent, rgba(0,0,0,0.7));
                        color: #fff;
                        font-size: 14px;
                        text-align: center;
                        transition: opacity 0.3s;
                        z-index: 10;
                    `;
                    pswp.on('change', () => {
                        const data = pswp.currSlide?.data;
                        const caption = data?.element?.dataset?.caption || '';
                        el.textContent = caption;
                        el.style.opacity = caption ? '1' : '0';
                    });
                }
            });
        });

        // Slideshow for demo
        new PhotoSwipeSlideshow(demoLightbox, {
            defaultDelayMs: 5000,
            restartOnSlideChange: true,
            progressBarPosition: "top",
            autoHideProgressBar: false
        });

        new PhotoSwipeAutoHideUI(demoLightbox, {});

        demoLightbox.init();

        // Auto-open first image
        demoLightbox.pswp?.on('initialLayout', () => {
            // Already opens from the click
        });

        // Open first item programmatically
        setTimeout(() => {
            const firstLink = gallery.querySelector('a');
            if (firstLink) firstLink.click();
        }, 400);
    });
}

// ─── Main Lightbox Factory ─────────────────────────────────────────────
function createLightbox() {
    // Ensure gallery container exists
    const galleryContainer = document.querySelector('#chatBody');
    if (!galleryContainer) {
        console.warn('[PhotoSwipe] #chatBody not found, lightbox not initialized.');
        return null;
    }

    const lb = new PhotoSwipeLightbox({
        gallery: '#chatBody',
        children: 'a:has(img), video',
        secondaryZoomLevel: 1,
        maxZoomLevel: 2,
        allowPanToNext: true,
        doubleTapAction: 'close',
        pswpModule: () => import('https://cdn.jsdelivr.net/npm/photoswipe'),
    });

    // ── Item Data Filter ───────────────────────────────────────────
    lb.addFilter('itemData', (itemData, index) => {
        const el = itemData.element;
        if (!el) return itemData;

        // Video detection
        if (el.tagName === 'VIDEO' || el.videoWidth) {
            itemData.type = 'video';
            itemData.videoSrc = el.src || el.querySelector('source')?.src || '';
            itemData.width = el.videoWidth || 1280;
            itemData.height = el.videoHeight || 720;
            return itemData;
        }

        // Image handling
        const img = el.tagName === 'IMG' ? el : el.querySelector('img');
        if (img) {
            // Resolve src: data-src > href > img.src, replace thumbnail paths
            let src = el.dataset.src || el.getAttribute('href') || img.getAttribute('src') || '';
            if (src && src.includes('/thumbnail/')) {
                src = src.replace('/thumbnail/', '/media/');
            }
            itemData.src = src;

            // Dimensions: data-width > naturalWidth > fallback
            itemData.width = parseInt(el.dataset.width) || img.naturalWidth || 1024;
            itemData.height = parseInt(el.dataset.height) || img.naturalHeight || 1024;

            // Alt text for captions
            itemData.alt = img.getAttribute('alt') || '';
        }

        return itemData;
    });

    // ── Custom Caption UI ──────────────────────────────────────────
    lb.on('uiRegister', function () {
        lb.pswp.ui.registerElement({
            name: 'custom-caption',
            order: 9,
            isButton: false,
            appendTo: 'root',
            html: '',
            onInit: (el, pswp) => {
                // Style the caption container
                el.style.cssText = `
                    position: absolute;
                    bottom: 0;
                    left: 0;
                    right: 0;
                    padding: 12px 16px;
                    background: linear-gradient(transparent, rgba(0,0,0,0.75));
                    color: #fff;
                    font-size: 14px;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 12px;
                    transition: opacity 0.3s ease;
                    z-index: 10;
                    pointer-events: auto;
                `;

                // Hover / touch toggle
                el.addEventListener('mouseleave', () => { el.style.opacity = '0'; });
                el.addEventListener('mouseenter', () => { el.style.opacity = '1'; });
                el.addEventListener('touchstart', (e) => {
                    e.stopPropagation();
                    el.style.opacity = el.style.opacity === '1' ? '0' : '1';
                }, { passive: true });

                // Update caption on slide change
                const updateCaption = () => {
                    const slideData = pswp.currSlide?.data;
                    if (!slideData) return;

                    const slideEl = slideData.element;
                    if (!slideEl) {
                        el.innerHTML = '';
                        return;
                    }

                    el.innerHTML = '';

                    const img = slideEl.tagName === 'IMG' ? slideEl : slideEl.querySelector('img');
                    if (!img) return;

                    const alt = slideData.alt || img.getAttribute('alt') || '';
                    const src = slideData.src || img.getAttribute('src') || '';

                    // Download button
                    if (src) {
                        const download = document.createElement('a');
                        download.href = src;
                        const ext = src.includes('.webp') ? '.webp'
                                  : src.includes('.png')  ? '.png'
                                  : src.includes('.gif')  ? '.gif'
                                  : '.jpg';
                        download.download = `${alt || 'image'}_${pswp.currSlide.index}${ext}`;
                        download.style.cssText = `
                            color: #fff;
                            text-decoration: none;
                            font-size: 18px;
                            padding: 4px 8px;
                            border-radius: 4px;
                            transition: background 0.2s;
                            flex-shrink: 0;
                        `;
                        download.addEventListener('mouseenter', () => {
                            download.style.background = 'rgba(255,255,255,0.15)';
                        });
                        download.addEventListener('mouseleave', () => {
                            download.style.background = 'transparent';
                        });
                        download.innerHTML = '<i class="fa-solid fa-download"></i>';
                        el.appendChild(download);
                    }

                    // Caption text
                    if (alt) {
                        const span = document.createElement('span');
                        span.textContent = alt;
                        span.style.cssText = `
                            flex: 1;
                            overflow: hidden;
                            text-overflow: ellipsis;
                            white-space: nowrap;
                        `;
                        el.appendChild(span);
                    }

                    // Counter
                    const counter = document.createElement('span');
                    counter.textContent = `${pswp.currSlide.index + 1} / ${pswp.options.dataSource?.items?.length || '?'}`;
                    counter.style.cssText = `
                        color: rgba(255,255,255,0.6);
                        font-size: 12px;
                        flex-shrink: 0;
                    `;
                    el.appendChild(counter);
                };

                pswp.on('change', updateCaption);
                // Initial update
                updateCaption();
            }
        });
    });

    // ── Plugins ────────────────────────────────────────────────────
    new PhotoSwipeSlideshow(lb, {
        defaultDelayMs: 7000,
        restartOnSlideChange: true,
        progressBarPosition: 'top',
        autoHideProgressBar: false
    });

    new PhotoSwipeVideoPlugin(lb, {});
    new PhotoSwipeAutoHideUI(lb, {});

    // ── Init ───────────────────────────────────────────────────────
    lb.init();
    return lb;
}

// ─── ChatAddons Registration ───────────────────────────────────────────
ChatAddons.register({
    id: 'builtin:photoswipe',
    name: 'PhotoSwipe Gallery',
    version: '1.1.0',
    description: 'Adds a full-featured PhotoSwipe gallery with zoom, slideshow, video support, captions, and download.',
    author: 'g4f',
    builtin: true,
    permissions: ['net:fetch'],

    load() {
        // Initialize the main lightbox
        createLightbox();

        // Show demo screen on first install
        const DEMO_KEY = 'photoswipe_demo_shown';
        if (!localStorage.getItem(DEMO_KEY)) {
            // Wait for DOM to be ready
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', showDemoScreen);
            } else {
                // Small delay so the UI is fully rendered
                setTimeout(showDemoScreen, 500);
            }
            localStorage.setItem(DEMO_KEY, '1');
        }
    },

    // Allow re-showing demo via settings or command
    showDemo: showDemoScreen
});

export default { createLightbox, showDemoScreen };
