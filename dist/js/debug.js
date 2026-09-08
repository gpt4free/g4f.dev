// debug.js - Browser CDP debug panel
// This script creates a debugging panel that shows failed network requests
// and JavaScript errors using Chrome DevTools Protocol (CDP).

(() => {
  if (window.g4fDebug) {
    return; // already initialized
  }
  // Create panel element
  const panel = document.createElement('div');
  panel.id = 'g4f-debug-panel';
  panel.style.cssText = `
    position: fixed;
    top: 0;
    right: 0;
    width: 400px;
    max-height: 90vh;
    overflow: auto;
    background: rgba(0,0,0,0.85);
    color: #fff;
    font-family: monospace;
    font-size: 12px;
    padding: 8px;
    z-index: 2147483647;
    box-shadow: 0 0 15px rgba(0,0,0,0.5);
  `;
  panel.innerHTML = '<pre></pre>';
  document.body.appendChild(panel);
  const logEl = panel.querySelector('pre');

  // Helper to add log entry
  const addLog = (msg, type = 'log') => {
    const line = document.createElement('div');
    line.textContent = msg;
    line.className = type;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  };

  // Capture failed network requests
  const originalFetch = window.fetch;
  window.fetch = async (...args) => {
    try {
      const response = await originalFetch.apply(window, args);
      return response;
    } catch (e) {
      addLog(`[NETWORK ERROR] ${e.message || e}`, 'error');
      throw e;
    }
  };

  // Monkey-patch XHR to capture failures
  const originalXHROpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    this._url = url;
    return originalXHROpen.apply(this, arguments);
  };
  const originalXHRSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    const self = this;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        addLog(`[XHR TIMEOUT] ${self._url}`, 'error');
        reject(new Error('XHR timeout'));
      }, 30000);
      self.addEventListener('error', () => {
        clearTimeout(timeout);
        addLog(`[XHR ERROR] ${self._url}`, 'error');
        reject(new Error('XHR error'));
      });
      self.addEventListener('loadend', () => {
        clearTimeout(timeout);
        if (self.status >= 400) {
          addLog(`[XHR FAILED] ${self._url} (status ${self.status})`, 'error');
        }
        resolve(self.responseText);
      });
      originalXHRSend.apply(self, args);
    });
  };

  // Capture JavaScript errors
  window.onerror = (msg, src, line, col, error) => {
    const stack = error?.stack || '';
    addLog(`[JS ERROR] ${msg} at ${src}:${line}:${col}\n${stack}`, 'error');
    return true; // prevent default
  };

  // Capture unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    addLog(`[PROMISE ERROR] ${reason}`, 'error');
  });

  // Capture console API calls
  const originalConsole = console;
  const logged = [];
  ['log', 'warn', 'error', 'info'].forEach((method) => {
    const orig = originalConsole[method];
    originalConsole[method] = (...args) => {
        const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
        logged.push(msg);
        addLog(`[${method.toUpperCase()}] ${msg}`, method);
        if (orig) orig.apply(originalConsole, args);
      };
  });

  // Expose API for external control
  window.g4fDebug = {
    clear: () => {
      logged.length = 0;
      logEl.innerHTML = '';
    },
    getLogs: () => logged.slice(),
  };

  document.onkeydown = function(evt) {
    evt = evt || window.event;
    var isEscape = false;
    if ("key" in evt) {
        isEscape = (evt.key === "Escape" || evt.key === "Esc");
    } else {
        isEscape = (evt.keyCode === 27);
    }
    if (isEscape) {
        logEl.innerHTML = '';
    }
  }
  document.onclick = function(evt) {
    logEl.innerHTML = '';
  }
})();