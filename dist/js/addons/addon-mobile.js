/* ================================================================== *
 * Addon: Mobile Experience
 *
 * Mobile-specific UI adjustments and responsive behavior.
 * ================================================================== */

(function () {
    'use strict';

    ChatAddons.register({
        id: 'builtin:mobile',
        name: 'Mobile Experience',
        version: '1.0.0',
        description: 'Mobile-specific UI adjustments and responsive behavior.',
        author: 'g4f',
        builtin: true,
        permissions: ['dom:write', 'dom:query'],

        load() {
            return (async () => {})
        }
    });
})();


function showLog() {
    logStorage?.classList.remove("hidden");
    settings?.classList.add("hidden");
    logContent.scrollTop = logContent.scrollHeight;
    chat.classList.add("hidden");
}

function hideLog() {
    logStorage?.classList.add("hidden");
    chat.classList.remove("hidden");
}

function logRequestResponse(event, messageId, count=0) {
    const eventType = event.response ? "response" : "request";
    let details = document.createElement("details");
    let summary = document.createElement("summary");
    summary.textContent = `${eventType[0].toUpperCase() + eventType.slice(1)} ${messageId} #${count}`;
    details.appendChild(summary);
    let pre = document.createElement("pre");
    let code = document.createElement("code");
    if (typeof event.response === 'string' || event.response instanceof String) {
        code.classList.add("language-plaintext");
        code.textContent = event.response;
    } else {
        code.classList.add("language-json");
        code.textContent = JSON.stringify(event.response || event.request, null, 2);
    }
    pre.appendChild(code)
    details.appendChild(pre);
    const detailsList = logContent.getElementsByTagName('details');
    if (detailsList.length >= 100) {
          logContent.removeChild(detailsList[0]);
    }

    logContent.appendChild(details);
    if (window.hljs) {
        hljs.highlightElement(code);
    }
}

// Mobile Experience Enhancements

// Create overlay element for sidebar
function createSidebarOverlay() {
  const overlay = document.createElement('div');
  overlay.className = 'sidebar-overlay';
  overlay.addEventListener('click', () => {
    sidebar.classList.remove('shown');
    overlay.classList.remove('active');
  });
  document.body.appendChild(overlay);
  return overlay;
}

// Initialize mobile enhancements
function initMobileEnhancements() {
  const overlay = createSidebarOverlay();

  // Add swipe gesture support
  let touchStartX = 0;
  let touchEndX = 0;

  document.addEventListener('touchstart', e => {
    touchStartX = e.changedTouches[0].screenX;
  }, { passive: true });

  document.addEventListener('touchend', e => {
    touchEndX = e.changedTouches[0].screenX;
    handleSwipeGesture();
  }, { passive: true });

  function handleSwipeGesture() {
    const swipeThreshold = 100;

    // Right swipe (from left edge) - open sidebar
    if (touchEndX - touchStartX > swipeThreshold && touchStartX < 30) {
      sidebar.classList.add('shown');
      overlay.classList.add('active');
    }

    // Left swipe - close sidebar
    if (touchStartX - touchEndX > swipeThreshold && sidebar.classList.contains('shown')) {
      sidebar.classList.remove('shown');
      overlay.classList.remove('active');
    }
  }

  // Double tap to scroll to bottom
//   let lastTap = 0;
//   chatBody.addEventListener('touchend', e => {
//     const currentTime = new Date().getTime();
//     const tapLength = currentTime - lastTap;

//     if (tapLength < 300 && tapLength > 0) {
//       // Double tap detected
//       scroll_to_bottom();
//       e.preventDefault();
//     }

//     lastTap = currentTime;
//   });

  // Improve file input experience on mobile
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

// Call this function after the DOM is loaded
window.addEventListener('load', () => {
  if (window.matchMedia('(max-width: 640px)').matches || window.matchMedia('(pointer: coarse)').matches) {
    initMobileEnhancements();
  }
});

// Handle orientation changes
window.addEventListener('orientationchange', () => {
  // Adjust UI based on new orientation
  setTimeout(() => {
    document.querySelector(".container").style.maxHeight = window.innerHeight + "px";

    // Adjust media content display
    // adjustMediaContentForOrientation();
  }, 200);
});

// // Adaptive Media Content Display

// // Function to adjust media content based on screen size and orientation
// function adjustMediaContentForOrientation() {
//   const isLandscape = window.innerWidth > window.innerHeight;
//   const mediaElements = document.querySelectorAll('.message .content img, .message .content video');

//   mediaElements.forEach(media => {
//     // Reset styles first
//     media.style.maxWidth = '';
//     media.style.maxHeight = '';

//     // Get natural dimensions
//     const naturalWidth = media.naturalWidth || media.videoWidth || 400;
//     const naturalHeight = media.naturalHeight || media.videoHeight || 300;
//     const aspectRatio = naturalWidth / naturalHeight;

//     if (isLandscape) {
//       // In landscape, prioritize height
//       media.style.maxHeight = '70vh';
//       media.style.maxWidth = '90vw';
//     } else {
//       // In portrait, limit width more strictly
//       media.style.maxWidth = '95vw';
//       media.style.maxHeight = '50vh';
//     }

//     // Add special class for better display
//     media.classList.add('adaptive-media');
//   });
// }

// // Function to enhance image viewing experience
// function enhanceMobileImageViewing() {
//   // Improve image tap behavior
//   document.addEventListener('click', e => {
//     const target = e.target;

//     // Check if clicked element is an image in a message
//     if (target.tagName === 'IMG' && target.closest('.message')) {
//       // Don't apply to avatar images
//       if (target.alt === 'your avatar') return;

//       // Toggle fullscreen-like view
//       if (target.classList.contains('expanded-view')) {
//         target.classList.remove('expanded-view');
//       } else {
//         // Remove expanded view from any other images
//         document.querySelectorAll('.expanded-view').forEach(img => {
//           img.classList.remove('expanded-view');
//         });

//         target.classList.add('expanded-view');
//       }
//     } else if (!target.closest('img.expanded-view')) {
//       // Close expanded view when clicking elsewhere
//       document.querySelectorAll('.expanded-view').forEach(img => {
//         img.classList.remove('expanded-view');
//       });
//     }
//   });
// }

// // Register these functions to run after content is loaded
// function registerMediaEnhancements() {
//   // Run initially
//   adjustMediaContentForOrientation();
//   enhanceMobileImageViewing();

//   // Also run when new messages are added
//   const originalRegisterMessageImages = register_message_images;
//   register_message_images = function() {
//     originalRegisterMessageImages();
//     adjustMediaContentForOrientation();
//   };

//   // And when window is resized
//   window.addEventListener('resize', adjustMediaContentForOrientation);
// }

// Add this to the window load event
// window.addEventListener('load', registerMediaEnhancements);

// Mobile Experience Initialization

// Function to check if device is mobile
function isMobileDevice() {
  return window.matchMedia('(max-width: 640px)').matches || 
          window.matchMedia('(pointer: coarse)').matches;
}

// Function to apply mobile-specific enhancements
function applyMobileEnhancements() {
  if (document.body.classList.contains("screen-reader")) {
    return; // Skip enhancements for screen readers
  }

  // Hotfix for mobile
  document.querySelector(".container").style.maxHeight = window.innerHeight + "px";

  // Add mobile class to body for CSS targeting
  document.body.classList.add('mobile-device');
}
addonsLoaded.then(() => {
    domReady.then(() => {
      if (isMobileDevice()) {
        applyMobileEnhancements();
      }
    })
});

export default {
    isMobileDevice,
    applyMobileEnhancements,
};