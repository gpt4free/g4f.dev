/* ================================================================== *
 * Addon: Mobile experience                                            *
 *                                                                    *
 * Extracted from chat.v1.js lines 5605-6169. Sidebar overlay,         *
 * drag-and-drop file upload zones, mobile device detection,           *
 * orientation handling and file-upload loading feedback.              *
 *                                                                    *
 * Needs core DOM refs exposed on `window` (chatBody, sidebar,         *
 * sidebar_buttons) plus window.upload_files.                          *
 * ================================================================== */

(function () {
    'use strict';

    ChatAddons.register({
        id: 'builtin:mobile-experience',
        name: 'Mobile Experience',
        version: '1.0.0',
        description: 'Sidebar overlay, drag-and-drop uploads, orientation handling and mobile layout fixes.',
        author: 'g4f',
        builtin: true,
        permissions: ['dom:read', 'dom:write'],

        load() {
        },
    });
})();

const $ = (sel) => document.querySelector(sel);
const chatBody = () => window.chatBody || $('#chatBody');
const sidebar = () => window.sidebar || $('.sidebar');
const sidebarButtons = () => window.sidebar_buttons || document.querySelectorAll('.mobile-sidebar-toggle');

function createSidebarOverlay() {
    const overlay = document.createElement('div');
    overlay.className = 'sidebar-overlay';
    overlay.addEventListener('click', () => {
        sidebar()?.classList.remove('shown');
        overlay.classList.remove('active');
    });
    document.body.appendChild(overlay);
    return overlay;
}

function initMobileEnhancements() {
    const overlay = createSidebarOverlay();

    // Enhance sidebar toggle behavior
    sidebarButtons().forEach((el) => {
        el.removeEventListener('click', null);
        el.addEventListener('click', () => {
            if (window.innerWidth < 640) {
                if (sidebar()?.classList.contains('shown')) {
                    sidebar()?.classList.remove('shown');
                    overlay.classList.remove('active');
                } else {
                    sidebar()?.classList.add('shown');
                    overlay.classList.add('active');
                }
            } else {
                // Desktop behavior remains unchanged
                sidebar()?.classList.toggle('shown');
            }
        });
    });

    // Add touch feedback to file labels
    const fileLabels = document.querySelectorAll('.file-label');
    fileLabels.forEach(label => {
        label.addEventListener('touchstart', () => {
            label.classList.add('active-touch');
        });
        label.addEventListener('touchend', () => {
            setTimeout(() => {
                label.classList.remove('active-touch');
            }, 200);
        });
    });
}

function isMobileDevice() {
    return window.matchMedia('(max-width: 640px)').matches ||
        window.matchMedia('(pointer: coarse)').matches;
}

function applyMobileEnhancements() {
    if (document.body.classList.contains("screen-reader")) {
        return; // Skip enhancements for screen readers
    }

    // Hotfix for mobile
    document.querySelector(".container").style.maxHeight = window.innerHeight + "px";

    // Add mobile class to body for CSS targeting
    document.body.classList.add('mobile-device');

    // Adjust height for mobile browsers (handles address bar)
    function setMobileHeight() {
        document.querySelector(".container").style.maxHeight = window.innerHeight + "px";
        document.querySelector(".container").style.height = window.innerHeight + "px";
    }

    setMobileHeight();
    window.addEventListener('resize', setMobileHeight);

    // Optimize input field behavior
    const input = document.getElementById('userInput');
    if (input) {
        input.addEventListener('focus', () => {
            setTimeout(() => {
                window.scrollTo(0, 0);
                document.body.scrollTop = 0;
            }, 300);
        });
    }

    // Show/hide floating action button based on scroll position
    let lastScrollTop = 0;
    const floatingButton = document.querySelector('.new_convo_icon.mobile-only');
    if (floatingButton && chatBody()) {
        chatBody().addEventListener('scroll', () => {
            const st = chatBody().scrollTop;
            if (st > lastScrollTop && st > 100) {
                floatingButton.style.transform = 'translateY(80px)';
            } else {
                floatingButton.style.transform = 'translateY(0)';
            }
            lastScrollTop = st;
        }, { passive: true });
    }

    // Handle orientation classes
    function updateOrientationClass() {
        if (window.innerHeight > window.innerWidth) {
            document.body.classList.add('portrait');
            document.body.classList.remove('landscape');
        } else {
            document.body.classList.add('landscape');
            document.body.classList.remove('portrait');
        }
    }
    updateOrientationClass();
    window.addEventListener('resize', updateOrientationClass);
    window.addEventListener('orientationchange', updateOrientationClass);
}

// Create drag-and-drop zones
function setupDragAndDrop() {
    const container = document.querySelector('.container');
    if (!container) return;

    const dropZone = document.createElement('div');
    dropZone.className = 'file-drop-zone hidden';
    dropZone.innerHTML = `
        <div class="file-drop-content">
            <i class="fa-solid fa-cloud-arrow-up"></i>
            <p>Drop files here to upload</p>
        </div>
    `;
    container.appendChild(dropZone);

    // Add CSS for drop zone
    const dropZoneStyles = document.createElement('style');
    dropZoneStyles.textContent = `
        .file-drop-zone { position: fixed; inset: 0; z-index: 9999; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.5); pointer-events: none; opacity: 0; transition: opacity 0.2s; }
        .file-drop-zone.active { opacity: 1; pointer-events: auto; }
        .file-drop-content { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 40px; border: 2px dashed var(--accent); border-radius: var(--border-radius-1); background: var(--blur-bg); color: var(--colour-3); font-size: 1.1em; }
        .file-drop-zone .fa-cloud-arrow-up { font-size: 2.5em; color: var(--accent); }
    `;
    document.head.appendChild(dropZoneStyles);

    function handleDragOver(e) {
        e.preventDefault();
        e.stopPropagation();
        if (!dropZone.classList.contains('active')) dropZone.classList.add('active');
    }

    function handleDragLeave(e) {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove('active');
    }

    function handleDrop(e) {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove('active');
        chatBody()?.classList.remove('drag-highlight');

        const files = e.dataTransfer?.files;
        if (files && files.length && typeof window.upload_files === 'function') {
            const input = document.getElementById('fileInput') || document.querySelector('input[type="file"]');
            if (input) {
                input.files = files;
                window.upload_files(input);
            }
        }
    }

    document.addEventListener('dragenter', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.add('active');
        chatBody()?.classList.add('drag-highlight');
    });
    document.addEventListener('dragover', handleDragOver);
    document.addEventListener('dragleave', handleDragLeave);
    document.addEventListener('drop', handleDrop);

    if (chatBody()) {
        chatBody().addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            chatBody()?.classList.add('drag-highlight');
        });
    }
}

function enhanceFileUpload() {
    if (typeof window.upload_files !== 'function') return;
    const originalUploadFiles = window.upload_files;
    window.upload_files = async function (fileInput) {
        const loadingIndicator = document.createElement('div');
        loadingIndicator.className = 'file-upload-loading';
        loadingIndicator.innerHTML = `
            <div class="upload-spinner"></div>
            <p>${window.framework?.translate("Uploading files...") || "Uploading files..."}</p>
        `;
        document.body.appendChild(loadingIndicator);

        try {
            await originalUploadFiles(fileInput);
        } finally {
            document.body.removeChild(loadingIndicator);
        }
    };

    // Add CSS for loading indicator
    const loadingStyles = document.createElement('style');
    loadingStyles.textContent = `
        .file-upload-loading {
            position: fixed;
            bottom: 20px;
            right: 20px;
            background-color: var(--blur-bg);
            border-radius: var(--border-radius-1);
            padding: 15px;
            display: flex;
            align-items: center;
            gap: 10px;
            z-index: 1000;
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
        }
        .upload-spinner {
            width: 20px;
            height: 20px;
            border: 2px solid var(--colour-3);
            border-top-color: var(--accent);
            border-radius: 50%;
            animation: spinner 0.8s linear infinite;
        }
        .file-upload-loading p {
            margin: 0;
            color: var(--colour-3);
        }
    `;
    document.head.appendChild(loadingStyles);
}

const run = () => {
    if (isMobileDevice()) {
        applyMobileEnhancements();
        initMobileEnhancements();
    }
    setupDragAndDrop();
    enhanceFileUpload();
};

domReady.then(run);

export default {
    isMobileDevice,
    applyMobileEnhancements,
    initMobileEnhancements,
    setupDragAndDrop,
    enhanceFileUpload,
};