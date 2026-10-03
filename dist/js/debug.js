// debug.js - Browser debug panel + ErrorTracker
//
// Structure:
//   1. ErrorTracker — the single interception layer (console.error/warn,
//      window errors, promise rejections, fetch/XHR failures). Exposed as
//      window.ErrorTracker / framework.errors.
//   2. Debug panel — renders ErrorTracker entries, console log/info output,
//      navigation timing and an XHR stall watchdog. Hidden on Escape/click.

// ---------------------------------------------------------------------------
// ErrorTracker
// ---------------------------------------------------------------------------
//  * ErrorTracker captures all browser errors (console.error, window.onerror,
//  * unhandled promise rejections, resource load failures, network errors)
//  * and stores them in a ring buffer with rich metadata. It provides:
//  *   - Categorized error types (js, resource, promise, network, console)
//  *   - Severity levels (error, warn, info)
//  *   - Stack trace extraction and formatting
//  *   - Deduplication of repeated errors
//  *   - Error rate tracking and burst detection
//  *   - Export to JSON for the MCP agent
//  *   - Visual error log in the .log-content panel
//  *   - Global API via window.ErrorTracker for other scripts/addons
//  * ================================================================== */

// Everything runs inside one IIFE: re-injecting this script into a target
// that already has it (e.g. Escape debug action after auto-injection) must be
// a no-op instead of throwing "Identifier 'ErrorTracker' has already been
// declared" from a re-declared top-level const.
(() => {
if (window.ErrorTracker && window.g4fDebug) return; // already fully injected

// --- shims for minimal/headless browsers (e.g. Lightpanda) ---
// Pages crash with ReferenceErrors / null access when common window APIs are
// not implemented. Best-effort no-ops so scripts keep running:
try {
  const _noop = () => {};
  if (!window.top) window.top = window; // "Cannot read properties of null (reading 'document')"
  if (!window.parent) window.parent = window;
  if (!window.self) window.self = window;
  if (!window.document) window.document = document;
  for (const name of ['resizeBy', 'resizeTo', 'moveBy', 'moveTo', 'scroll', 'scrollBy', 'scrollTo',
                      'focus', 'blur', 'print', 'stop', 'alert', 'confirm', 'prompt']) {
    if (typeof window[name] !== 'function') {
      try { window[name] = _noop; } catch (e) { /* read-only */ }
    }
  }
  if (typeof window.matchMedia !== 'function') {
    window.matchMedia = query => ({
      matches: false, media: query, onchange: null,
      addListener: _noop, removeListener: _noop,
      addEventListener: _noop, removeEventListener: _noop, dispatchEvent: () => false,
    });
  }
  if (typeof window.requestAnimationFrame !== 'function') {
    window.requestAnimationFrame = cb => setTimeout(() => cb(Date.now()), 16);
    window.cancelAnimationFrame = id => clearTimeout(id);
  }
} catch (e) { /* shims are best-effort */ }

const ErrorTracker = window.ErrorTracker || (() => {
    const MAX_ERRORS = 200;
    const MAX_DEDUP = 50;
    // Per-type emoji shown next to the severity icon.
    const _TYPE_ICONS = { js: '⚠️', resource: '📦', promise: '⏳', network: '🌐', console: '💬' };
    const _errors = [];
    const _dedupMap = new Map(); // key → count
    _dedupMap._maxSize = MAX_DEDUP;
    let _installed = false;
    let _errorCount = 0;
    let _warnCount = 0;
    let _burstWindow = [];
    let _panelLog = null; // set via setPanelLog() once the debug panel exists
    
    const _BURST_THRESHOLD = 5;
    const _BURST_INTERVAL = 3000; // ms

    // --- helpers ---
    function _stringify(val) {
        if (val == null) return String(val);
        if (typeof val === 'string') return val;
        if (val instanceof Error) return val.message + (val.stack ? '\n' + val.stack : '');
        try { return JSON.stringify(val, null, 0); } catch (e) { return String(val); }
    }

    function _extractStack(args) {
        for (const a of args) {
            if (a instanceof Error && a.stack) return a.stack;
            if (a && typeof a === 'object' && a.stack) return String(a.stack);
        }
        // Try to get stack from Error.captureStackTrace
        try {
            const err = new Error();
            if (err.stack) return err.stack.split('\n').slice(3).join('\n');
        } catch (e) { /* ignore */ }
        return '';
    }

    function _dedupKey(entry) {
        // Dedup across types: a rethrown fetch failure logged as js/promise/
        // console collapses into the original [network] entry.
        const type = ['js', 'promise', 'console'].includes(entry.type) ? 'network' : entry.type;
        return `${type}:${entry.message}`.slice(0, 200);
    }

    function _truncate(str, max = 2000) {
        if (!str) return str;
        return str.length > max ? str.slice(0, max) + '…' : str;
    }

    // --- core capture ---
    function _capture(type, severity, args, extra = {}) {
        const message = Array.isArray(args) ? args.map(_stringify).join(' ') : _stringify(args);
        const stack = Array.isArray(args) ? _extractStack(args) : '';
        const entry = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            type,           // 'js' | 'resource' | 'promise' | 'network' | 'console'
            severity,       // 'error' | 'warn' | 'info'
            message: _truncate(message),
            stack: _truncate(stack, 4000),
            time: new Date().toISOString(),
            timestamp: Date.now(),
            url: location.href,
            ...extra,
        };

        // Deduplication
        const key = _dedupKey(entry);
        if (_dedupMap.has(key)) {
            const count = _dedupMap.get(key);
            _dedupMap.set(key, count + 1);
            entry.repeat = count + 1;
        } else {
            if (_dedupMap.size >= _dedupMap._maxSize) {
                // Evict oldest entry
                const firstKey = _dedupMap.keys().next().value;
                _dedupMap.delete(firstKey);
            }
            _dedupMap.set(key, 1);
            entry.repeat = 1;
        }

        _errors.push(entry);
        if (_errors.length > MAX_ERRORS) _errors.shift();

        if (severity === 'error') _errorCount++;
        else if (severity === 'warn') _warnCount++;

        // Burst detection
        const now = Date.now();
        _burstWindow.push(now);
        _burstWindow = _burstWindow.filter(t => now - t < _BURST_INTERVAL);
        if (_burstWindow.length >= _BURST_THRESHOLD) {
            entry._burst = true;
        }

        // Render to visual log (panel may not be attached yet)
        if (_panelLog) _panelLog(entry);

        // Notify listeners
        _notifyListeners(entry);

        return entry;
    }

    // --- entry formatting (shared default for panel + .log-content) ---
    function formatEntry(entry) {
        const icon = entry.severity === 'error' ? '🔴' : entry.severity === 'warn' ? '🟡' : '🔵';
        const repeatStr = entry.repeat > 1 ? ` (×${entry.repeat})` : '';
        const burstStr = entry._burst ? ' ⚡BURST' : '';

        let text = `${icon} ${_TYPE_ICONS[entry.type] || '❔'} [${entry.type}] ${entry.message}${repeatStr}${burstStr}`;
        if (entry.stack) {
            text += `\n${entry.stack.split('\n').slice(0, 4).join('\n')}`;
        }
        if (entry.resource) {
            text += `\nResource: ${entry.resource}`;
        }
        if (entry.status) {
            text += `\nHTTP ${entry.status}: ${entry.url || ''}`;
        }
        return text;
    }

    // --- listeners (for other addons / MCP agent) ---
    const _listeners = new Set();
    function _notifyListeners(entry) {
        for (const fn of _listeners) {
            try { fn(entry); } catch (e) { /* avoid infinite loop */ }
        }
    }

    // --- hook installation ---
    function install() {
        if (_installed) return;
        _installed = true;

        // --- window.onerror (uncaught JS exceptions) ---
        window.addEventListener('error', function (event) {
            if (event.error && event.error.__g4fCaptured) return; // already captured
            if (event.target && (event.target.src || event.target.href)) {
                // Resource load failure
                _capture('resource', 'error', [
                    `Resource failed to load: ${event.target.src || event.target.href}`,
                ], {
                    resource: event.target.src || event.target.href,
                    tagName: event.target.tagName,
                });
            } else {
                // JS error
                _capture('js', 'error', [event.message || event], {
                    filename: event.filename,
                    lineno: event.lineno,
                    colno: event.colno,
                    type: event.type,
                });
            }
        }, true);

        // --- unhandledrejection (promise rejections) ---
        window.addEventListener('unhandledrejection', function (event) {
            const reason = event.reason;
            if (reason && reason.__g4fCaptured) return; // already captured
            _capture('promise', 'error', [reason], {
                reason: _stringify(reason),
            });
        });

        // --- Network error interception (fetch) ---
        const _origFetch = window.fetch;
        window.fetch = async function (...args) {
            const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
            try {
                const response = await _origFetch.apply(this, args);
                if (!response.ok) {
                    _capture('network', 'warn', [`HTTP ${response.status} ${response.statusText}: ${url}`], {
                        status: response.status,
                        statusText: response.statusText,
                        url,
                    });
                }
                return response;
            } catch (err) {
                // Flag the error so the rethrow isn't captured again as a
                // js/promise/console entry — one failure, one [network] entry.
                try { err.__g4fCaptured = true; } catch (e) { /* frozen */ }
                _capture('network', 'error', [`Fetch failed: ${url}`, err], { url });
                throw err;
            }
        };

        // --- XHR error interception ---
        const _origXhrOpen = XMLHttpRequest.prototype.open;
        const _origXhrSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function (method, url, ...rest) {
            this._paMethod = method;
            this._paUrl = url;
            return _origXhrOpen.call(this, method, url, ...rest);
        };
        XMLHttpRequest.prototype.send = function (...args) {
            this.addEventListener('error', () => {
                _capture('network', 'error', [`XHR failed: ${this._paMethod} ${this._paUrl}`], {
                    method: this._paMethod,
                    url: this._paUrl,
                });
            });
            this.addEventListener('load', () => {
                if (this.status >= 400) {
                    _capture('network', 'warn', [`XHR ${this.status}: ${this._paMethod} ${this._paUrl}`], {
                        method: this._paMethod,
                        url: this._paUrl,
                        status: this.status,
                    });
                }
            });
            return _origXhrSend.apply(this, args);
        };
    }

    // --- public API ---
    return {
        install,
        formatEntry,
        getErrors() { return [..._errors]; },
        getErrorsByType(type) { return _errors.filter(e => e.type === type); },
        getErrorsBySeverity(severity) { return _errors.filter(e => e.severity === severity); },
        getRecent(limit = 20) { return _errors.slice(-limit); },
        getErrorCount() { return _errorCount; },
        getWarnCount() { return _warnCount; },
        getTotalCount() { return _errors.length; },
        clearErrors() { _errors.length = 0; _dedupMap.clear(); _errorCount = 0; _warnCount = 0; return true; },
        hasBurst() { return _burstWindow.length >= _BURST_THRESHOLD; },
        getStats() {
            const byType = {};
            const bySeverity = {};
            for (const e of _errors) {
                byType[e.type] = (byType[e.type] || 0) + 1;
                bySeverity[e.severity] = (bySeverity[e.severity] || 0) + 1;
            }
            return {
                total: _errors.length,
                errors: _errorCount,
                warnings: _warnCount,
                byType,
                bySeverity,
                burst: _burstWindow.length >= _BURST_THRESHOLD,
            };
        },
        exportJSON() { return JSON.stringify(_errors, null, 2); },
        onError(fn) {
            _listeners.add(fn);
            return () => _listeners.delete(fn);
        },
        setPanelLog(fn) {
            _panelLog = fn;
            return () => { _panelLog = null; };
        },
    };
})();

// Install error tracking immediately
ErrorTracker.install();
window.ErrorTracker = ErrorTracker;
if (window.framework) window.framework.errors = ErrorTracker;

(() => {
  if (window.g4fDebug) {
    return; // already initialized
  }
  const logStorage = document.querySelector(".log");
  const logContent = document.querySelector(".log-content") || logStorage;

  // Create panel element
  const panel = document.createElement('div');
  panel.id = 'g4f-debug-panel';
  panel.style.cssText = `
    position: fixed;
    top: 0;
    right: 0;
    width: 400px;
    max-width: 100%;
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
  const logEl = panel.querySelector('pre');
  logEl.classList.add('notranslate');
  panel.style.display = 'none'; // initially hidden
  (document.body || document.documentElement).appendChild(panel);

  const logged = [];

  // Helper to add a line to the panel and show it. Accepts a plain string
  // or an ErrorTracker entry — entries use the default _renderToLog formatting.
  const addLog = (msg, type = 'log') => {
    if (msg && typeof msg === 'object' && msg.type && msg.message !== undefined) {
      type = msg.severity === 'warn' ? 'warn' : msg.severity === 'error' ? 'error' : 'log';
      msg = window.ErrorTracker.formatEntry(msg);
    }
    const line = document.createElement('div');
    line.textContent = msg;
    line.className = `g4f-debug-${type}`;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
    panel.style.display = 'block';
  };

  // --- ErrorTracker stream: entries render here, not in the page console ---
  if (window.ErrorTracker) {
    const track = entry => {
      logged.push(`[${entry.type}] ${entry.message}`);
      addLog(entry);
    };
    // Replay errors captured before the panel existed, then stream live ones.
    window.ErrorTracker.getErrors().forEach(track);
    window.ErrorTracker.setPanelLog(track);
  }

  // XHR stall watchdog — hard fetch/XHR errors are captured by ErrorTracker.
  const originalXHRSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    const timer = setTimeout(() => addLog(`[XHR TIMEOUT] ${this._paUrl || this._url || ''}`, 'error'), 30000);
    this.addEventListener('loadend', () => clearTimeout(timer));
    return originalXHRSend.apply(this, args);
  };

  // JS errors and promise rejections are captured by ErrorTracker.

  // Capture navigation performance data
  const logNavigationData = () => {
    const navigationData = window.performance.getEntriesByType('navigation')[0];
    if (navigationData) {
      const status = navigationData.responseStatus;
      const statusText = status === 0 ? 'N/A (cached/redirect)' :
                         status >= 200 && status < 300 ? `${status} OK` :
                         status >= 300 && status < 400 ? `${status} Redirect` :
                         status >= 400 ? `${status} Error` : `${status}`;
      addLog(`[NAVIGATION] ${navigationData.name}`, 'log');
      addLog(`  responseStatus: ${statusText}`, status >= 400 ? 'error' : 'log');
      addLog(`  type: ${navigationData.type}`, 'log');
      addLog(`  transferSize: ${navigationData.transferSize} bytes`, 'log');
      addLog(`  domContentLoaded: ${Math.round(navigationData.domContentLoadedEventEnd)}ms`, 'log');
      addLog(`  loadComplete: ${Math.round(navigationData.loadEventEnd)}ms`, 'log');
      addLog(`  DOM interactive: ${Math.round(navigationData.domInteractive)}ms`, 'log');
      addLog(`  TTFB: ${Math.round(navigationData.responseStart)}ms`, 'log');
    } else {
      addLog('[NAVIGATION] No navigation entry found', 'warn');
    }
  };
  logNavigationData();

  // Capture console log/info (warn/error arrive via the ErrorTracker stream).
  ['log', 'info'].forEach((method) => {
    const orig = console[method];
    console[method] = (...args) => {
      const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
      logged.push(msg);
      addLog(`[${method.toUpperCase()}] ${msg}`, 'log');
      if (orig) orig.apply(console, args);
    };
  });

  // Expose API for external control
  const hide = () => {
    logEl.innerHTML = '';
    panel.style.display = 'none';
  };
  window.g4fDebug = {
    clear: hide,
    hide,
    getLogs: () => logged.slice(),
  };

  // Escape or any click hides the panel.
  document.addEventListener('keydown', (evt) => {
    const key = evt.key || '';
    if (key === 'Escape' || key === 'Esc' || evt.keyCode === 27) hide();
  });
  document.addEventListener('click', hide);
})();
})();