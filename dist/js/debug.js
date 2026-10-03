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
// Lightpanda implements only a subset of the Chrome DOM (verified by probing
// ~535 globals in Chrome 152 vs Lightpanda nightly: 188 missing). Pages crash
// with ReferenceErrors / null access when common window APIs are not
// implemented. Everything here is best-effort: guarded + try/catch wrapped.
// No-ops where behavior does not matter, functional stubs where it does
// (calling code gets a Promise / object it can work with instead of a crash).
try {
  const _noop = () => {};
  const _asyncNoop = () => Promise.resolve();
  const _deny = (name = 'NotSupportedError', msg = 'not supported in this browser') =>
    Promise.reject(new (window.DOMException || Error)(msg, name));
  const _listenerObj = () => ({ addEventListener: _noop, removeEventListener: _noop, dispatchEvent: () => false });
  const _api = methods => Object.assign(_listenerObj(), methods);
  const _define = (obj, prop, value) => {
    try {
      if (obj && obj[prop] === undefined) {
        Object.defineProperty(obj, prop, { value, writable: true, enumerable: true, configurable: true });
      }
    } catch (e) { /* read-only / frozen */ }
  };
  const _class = (name, base, body) => {
    if (typeof window[name] !== 'undefined') return;
    try { window[name] = body || (class extends (base || class {}) {}); } catch (e) { /* read-only */ }
  };

  // window self references
  if (!window.top) window.top = window; // "Cannot read properties of null (reading 'document')"
  if (!window.parent) window.parent = window;
  if (!window.self) window.self = window;
  if (!window.document) window.document = document;

  // window methods that only move/resize/annoy — safe no-ops
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

  // window geometry / chrome-specific properties
  _define(window, 'outerWidth', window.innerWidth || 0);
  _define(window, 'outerHeight', window.innerHeight || 0);
  _define(window, 'screenLeft', 0); _define(window, 'screenX', 0);
  _define(window, 'screenTop', 0); _define(window, 'screenY', 0);
  _define(window, 'status', ''); _define(window, 'defaultStatus', ''); _define(window, 'defaultstatus', '');
  _define(window, 'crossOriginIsolated', false);
  _define(window, 'clientInformation', navigator);
  _define(window, 'external', { AddSearchProvider: _noop, IsSearchProviderInstalled: () => 0 });
  _class('External');
  _define(window, 'styleMedia', { type: 'screen' });
  _class('StyleMedia');
  _define(window, 'webkitStorageInfo', { queryUsageAndQuota: _noop, requestQuota: _noop });
  _define(screen, 'isExtended', false);
  if (typeof window.chrome === 'undefined') {
    try {
      window.chrome = {
        runtime: {
          id: undefined, connect: () => ({}), sendMessage: _noop, getManifest: () => ({}), getURL: p => String(p),
          onMessage: { addListener: _noop, removeListener: _noop, hasListeners: () => false, hasListener: () => false },
          onConnect: { addListener: _noop, removeListener: _noop, hasListener: () => false },
        },
        loadTimes: () => ({}), csi: () => ({}),
        app: {
          isInstalled: false, getDetails: () => null,
          InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
          RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
        },
      };
    } catch (e) { /* read-only */ }
  }

  // missing event constructors (Lightpanda only ships a few)
  const _eventCtor = (name, extra) => {
    if (typeof window[name] !== 'undefined' || typeof window.Event !== 'function') return;
    try {
      window[name] = class extends Event {
        constructor(type, init = {}) { super(type, init); if (extra) Object.assign(this, extra(init)); }
      };
    } catch (e) { try { window[name] = window.Event; } catch (e2) { /* read-only */ } }
  };
  _eventCtor('TransitionEvent', init => ({ propertyName: init.propertyName ?? '', elapsedTime: init.elapsedTime ?? 0, pseudoElement: init.pseudoElement ?? '' }));
  _eventCtor('AnimationEvent', init => ({ animationName: init.animationName ?? '', elapsedTime: init.elapsedTime ?? 0, pseudoElement: init.pseudoElement ?? '' }));
  _eventCtor('ClipboardEvent', init => ({ clipboardData: init.clipboardData || { getData: () => '', setData: _noop, types: [], files: [], items: [] } }));
  _eventCtor('WebGLContextEvent', init => ({ statusMessage: init.statusMessage ?? '' }));
  _eventCtor('FontFaceSetLoadEvent', init => ({ fontfaces: init.fontfaces ?? [] }));
  _eventCtor('NotificationEvent', init => ({ notification: init.notification || null, action: init.action ?? '' }));
  _eventCtor('SecurityPolicyViolationEvent', init => ({
    documentURI: init.documentURI ?? location.href, referrer: init.referrer ?? '', blockedURI: init.blockedURI ?? '',
    violatedDirective: init.violatedDirective ?? '', effectiveDirective: init.effectiveDirective ?? '',
    originalPolicy: init.originalPolicy ?? '', sourceFile: init.sourceFile ?? '', statusCode: init.statusCode ?? 0,
    lineNumber: init.lineNumber ?? 0, columnNumber: init.columnNumber ?? 0, sample: init.sample ?? '',
    disposition: init.disposition ?? '',
  }));

  // observers / streams / misc constructors
  _class('ReportingObserver', null, class {
    constructor(cb) { this.callback = cb; } observe() {} disconnect() {} takeRecords() { return []; }
  });
  // pass-through streams: keep pipeTo() code paths alive (no real compression)
  if (typeof window.TransformStream === 'function') {
    _class('CompressionStream', null, class extends window.TransformStream { constructor(format) { super(); this.format = format; } });
    _class('DecompressionStream', null, class extends window.TransformStream { constructor(format) { super(); this.format = format; } });
  }
  if (typeof window.createImageBitmap !== 'function') {
    window.createImageBitmap = src => Promise.resolve({
      width: (src && (src.naturalWidth || src.width)) || 0,
      height: (src && (src.naturalHeight || src.height)) || 0, close: _noop,
    });
  }
  if (typeof window.fetchLater !== 'function' && typeof window.fetch === 'function') {
    window.fetchLater = (url, opts = {}) => {
      try { fetch(url, { method: opts.method, headers: opts.headers, body: opts.body }).catch(_noop); } catch (e) { /* best-effort */ }
    };
  }

  // CSS / XSLT classes
  for (const name of ['CSSMediaRule', 'CSSSupportsRule', 'CSSKeyframesRule', 'CSSKeyframeRule', 'CSSFontFaceRule',
                      'CSSImportRule', 'CSSNamespaceRule', 'CSSConditionRule', 'CSSPageRule', 'CSSPositionTryRule',
                      'CSSPropertyRule']) {
    _class(name, window.CSSRule);
  }
  _class('StyleSheet');
  if (typeof window.XSLTProcessor !== 'function') {
    try {
      window.XSLTProcessor = class {
        importStylesheet() {} reset() {} setParameter() {} removeParameter() {} getParameter() { return null; }
        transformToDocument() { return document.implementation.createDocument(null, null); }
        transformToFragment() { return document.createDocumentFragment(); }
      };
    } catch (e) { /* read-only */ }
  }

  // performance: entry classes + synthetic navigation entry (Lightpanda has none,
  // which surfaced as "[NAVIGATION] No navigation entry found" in the panel)
  _class('PerformanceNavigationTiming', window.PerformanceEntry);
  _class('PerformanceLongTaskTiming', window.PerformanceEntry);
  if (window.performance && typeof performance.getEntriesByType === 'function') {
    try {
      const _getByType = performance.getEntriesByType.bind(performance);
      performance.getEntriesByType = type => {
        const entries = _getByType(type);
        if (type === 'navigation' && (!entries || !entries.length)) {
          const now = performance.now();
          return [{
            entryType: 'navigation', type: 'navigate', name: String(location.href), initiatorType: 'navigation',
            startTime: 0, duration: now, redirectCount: 0, transferSize: 0, encodedBodySize: 0, decodedBodySize: 0,
            fetchStart: 0, domainLookupStart: 0, domainLookupEnd: 0, connectStart: 0, connectEnd: 0,
            secureConnectionStart: 0, requestStart: 0, responseStart: 0, responseEnd: 0,
            domContentLoadedEventStart: 0, domContentLoadedEventEnd: 0, domComplete: now,
            loadEventStart: 0, loadEventEnd: 0, redirectStart: 0, redirectEnd: 0,
            unloadEventStart: 0, unloadEventEnd: 0, nextHopProtocol: '', renderBlockingStatus: 'non-blocking',
            toJSON: () => ({}),
          }];
        }
        return entries;
      };
    } catch (e) { /* best-effort */ }
  }

  // storage / credentials / push
  if (typeof window.caches === 'undefined') {
    try {
      const _stores = new Map();
      const _cache = () => ({ match: async () => undefined, put: _asyncNoop, add: _asyncNoop, addAll: _asyncNoop,
                              delete: async () => false, keys: async () => [], has: async () => false });
      window.caches = {
        open: async name => { if (!_stores.has(name)) _stores.set(name, _cache()); return _stores.get(name); },
        has: async () => false, delete: async () => false, keys: async () => [],
      };
    } catch (e) { /* read-only */ }
  }
  _class('CookieStoreManager', null, class {
    getSubscriptions() { return Promise.resolve([]); } subscribe() { return Promise.resolve(); } unsubscribe() { return Promise.resolve(); }
  });
  _class('Credential'); _class('CredentialsContainer'); _class('PasswordCredential');
  _class('FederatedCredential'); _class('IdentityCredential');
  _class('PushManager', null, class {
    getSubscription() { return Promise.resolve(null); } permissionState() { return Promise.resolve('denied'); }
    subscribe() { return _deny('NotAllowedError', 'Push subscription denied'); }
  });
  _class('PushSubscription', null, class {
    constructor() { this.endpoint = ''; this.expirationTime = null; this.options = {}; }
    getKey() { return null; } toJSON() { return {}; }
  });
  _class('PushSubscriptionOptions', null, class { constructor() { this.applicationServerKey = null; } });

  // media / webrtc
  _class('MediaRecorder', null, class {
    constructor(stream, opts) {
      this.stream = stream; this.mimeType = (opts && opts.mimeType) || ''; this.state = 'inactive';
      this.ondataavailable = this.onerror = this.onstart = this.onstop = this.onpause = this.onresume = null;
    }
    static isTypeSupported() { return false; }
    start() {} stop() {} pause() {} resume() {} requestData() {}
    addEventListener() {} removeEventListener() {} dispatchEvent() { return false; }
  });
  _class('MediaStream', null, class {
    constructor(streamOrTracks) {
      const src = Array.isArray(streamOrTracks) ? streamOrTracks
        : (streamOrTracks && typeof streamOrTracks.getTracks === 'function' ? streamOrTracks.getTracks() : []);
      this._tracks = src.slice(); this.id = String(Math.random()).slice(2); this.active = true;
      this.onaddtrack = this.onremovetrack = null;
    }
    getTracks() { return this._tracks.slice(); }
    getVideoTracks() { return this._tracks.filter(t => t && t.kind === 'video'); }
    getAudioTracks() { return this._tracks.filter(t => t && t.kind === 'audio'); }
    addTrack(t) { this._tracks.push(t); } removeTrack(t) { this._tracks = this._tracks.filter(x => x !== t); }
    clone() { return new window.MediaStream(this._tracks); }
    addEventListener() {} removeEventListener() {} dispatchEvent() { return false; }
  });
  _class('MediaStreamTrack', null, class {
    constructor() {
      this.kind = 'video'; this.enabled = true; this.muted = false; this.readyState = 'live';
      this.onended = this.onmute = this.onunmute = null;
    }
    stop() {} clone() { return new window.MediaStreamTrack(); }
    getCapabilities() { return {}; } getSettings() { return {}; } getConstraints() { return {}; }
    applyConstraints() { return Promise.resolve(); }
    addEventListener() {} removeEventListener() {} dispatchEvent() { return false; }
  });
  _class('MediaSource', null, class {
    constructor() {
      this.sourceBuffers = { length: 0 }; this.duration = 0; this.readyState = 'closed';
      this.onsourceopen = this.onsourceended = this.onsourceclose = null;
    }
    static isTypeSupported() { return false; }
    addSourceBuffer() { throw new (window.DOMException || Error)('MediaSource not supported', 'NotSupportedError'); }
    removeSourceBuffer() {} endOfStream() {} setLiveSeekableRange() {} clearLiveSeekableRange() {}
    addEventListener() {} removeEventListener() {} dispatchEvent() { return false; }
  });
  _class('CanvasCaptureMediaStreamTrack', window.MediaStreamTrack);

  // WebAudio: functional context stub (all nodes are inert but chainable)
  if (typeof window.AudioContext !== 'function') {
    try {
      const _param = value => {
        const p = { value, defaultValue: value, minValue: value, maxValue: value, automationRate: 'a-rate' };
        for (const m of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'setTargetAtTime',
                         'setValueCurveAtTime', 'cancelScheduledValues', 'cancelAndHoldAtTime']) p[m] = () => p;
        return p;
      };
      const _node = ctx => ({
        context: ctx, numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: 'max',
        channelInterpretation: 'speakers', connect: t => t || undefined, disconnect: _noop,
        addEventListener: _noop, removeEventListener: _noop, dispatchEvent: () => false,
      });
      const _source = ctx => Object.assign(_node(ctx), { start: _noop, stop: _noop, onended: null, playbackRate: _param(1), detune: _param(0) });
      window.BaseAudioContext = window.BaseAudioContext || class {};
      window.AudioNode = window.AudioNode || class {};
      window.AudioParam = window.AudioParam || class {};
      window.AudioBuffer = window.AudioBuffer || class {
        constructor(opts = {}) {
          this.sampleRate = opts.sampleRate || 48000; this.length = opts.length || 0;
          this.duration = this.length / this.sampleRate; this.numberOfChannels = opts.numberOfChannels || 1;
        }
        getChannelData() { return new Float32Array(0); } copyFromChannel() {} copyToChannel() {}
      };
      window.AudioContext = class {
        constructor() {
          this.state = 'suspended'; this.currentTime = 0; this.sampleRate = 48000; this.baseLatency = 0;
          this.audioWorklet = null; this.onstatechange = null;
          this.destination = Object.assign(_node(this), { numberOfOutputs: 0 });
          this.listener = Object.assign(_node(this), {
            positionX: _param(0), positionY: _param(0), positionZ: _param(0),
            forwardX: _param(0), forwardY: _param(0), forwardZ: _param(-1),
            upX: _param(0), upY: _param(1), upZ: _param(0),
            setPosition: _noop, setOrientation: _noop, setVelocity: _noop,
          });
        }
        resume() { return Promise.resolve(); } suspend() { return Promise.resolve(); } close() { return Promise.resolve(); }
        decodeAudioData() { return Promise.resolve(new window.AudioBuffer({})); }
        createBuffer(ch, len, rate) { return new window.AudioBuffer({ length: len, sampleRate: rate, numberOfChannels: ch }); }
        createBufferSource() { return Object.assign(_source(this), { buffer: null }); }
        createOscillator() { return Object.assign(_source(this), { type: 'sine', frequency: _param(440), setPeriodicWave: _noop }); }
        createGain() { return Object.assign(_node(this), { gain: _param(1) }); }
        createAnalyser() { return Object.assign(_node(this), { fftSize: 2048, frequencyBinCount: 1024, minDecibels: -100, maxDecibels: -30, smoothingTimeConstant: 0.8, getByteFrequencyData: _noop, getByteTimeDomainData: _noop, getFloatFrequencyData: _noop, getFloatTimeDomainData: _noop }); }
        createBiquadFilter() { return Object.assign(_node(this), { type: 'lowpass', frequency: _param(350), Q: _param(1), getFrequencyResponse: _noop }); }
        createDelay() { return Object.assign(_node(this), { delayTime: _param(0) }); }
        createDynamicsCompressor() { return Object.assign(_node(this), { threshold: _param(-24), knee: _param(30), ratio: _param(12), attack: _param(0.003), release: _param(0.25), reduction: 0 }); }
        createPanner() { return Object.assign(_node(this), { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 1, maxDistance: 10000, rolloffFactor: 1, coneInnerAngle: 360, coneOuterAngle: 360, coneOuterGain: 0, positionX: _param(0), positionY: _param(0), positionZ: _param(0), setPosition: _noop, setOrientation: _noop, setVelocity: _noop }); }
        createStereoPanner() { return Object.assign(_node(this), { pan: _param(0) }); }
        createWaveShaper() { return Object.assign(_node(this), { curve: null, oversample: 'none' }); }
        createConvolver() { return Object.assign(_node(this), { buffer: null, normalize: true }); }
        createScriptProcessor() { return Object.assign(_node(this), { bufferSize: 4096, onaudioprocess: null }); }
        createChannelMerger() { return _node(this); }
        createChannelSplitter() { return _node(this); }
        createMediaElementSource(el) { return Object.assign(_node(this), { mediaElement: el }); }
        createMediaStreamSource() { return _node(this); }
        createPeriodicWave(real, imag) { return { real, imag }; }
      };
      for (const name of ['GainNode', 'AnalyserNode', 'OscillatorNode', 'AudioDestinationNode', 'AudioListener',
                          'BiquadFilterNode', 'ChannelMergerNode', 'ChannelSplitterNode', 'ConvolverNode', 'DelayNode',
                          'DynamicsCompressorNode', 'MediaElementAudioSourceNode', 'MediaStreamAudioSourceNode',
                          'PannerNode', 'PeriodicWave', 'ScriptProcessorNode', 'StereoPannerNode', 'WaveShaperNode']) {
        _class(name);
      }
    } catch (e) { /* best-effort */ }
  }

  // canvas / image / svg geometry
  _class('Path2D', null, class {
    moveTo() {} lineTo() {} bezierCurveTo() {} quadraticCurveTo() {} closePath() {}
    arc() {} arcTo() {} ellipse() {} rect() {} addPath() {}
  });
  _class('ImageBitmap', null, class { constructor() { this.width = 0; this.height = 0; } close() {} });
  _class('ImageBitmapRenderingContext');
  _class('SVGMatrix', null, class {
    constructor() { this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0; }
    multiply() { return this; } translate() { return this; } scale() { return this; } scaleNonUniform() { return this; }
    rotate() { return this; } rotateFromVector() { return this; } flipX() { return this; } flipY() { return this; }
    skewX() { return this; } skewY() { return this; }
  });
  _class('SVGPoint', null, class { constructor() { this.x = 0; this.y = 0; } matrixTransform() { return new window.SVGMatrix(); } });
  _class('SVGRect', null, class { constructor() { this.x = 0; this.y = 0; this.width = 0; this.height = 0; } });
  for (const name of ['SVGAnimatedNumberList', 'SVGLengthList', 'SVGNumberList', 'SVGAnimatedLengthList']) {
    _class(name, null, class {
      constructor() { this.numberOfItems = 0; }
      getItem() { return null; } initialize() { return null; } appendItem() { return null; }
      insertItemBefore() { return null; } replaceItem() { return null; } removeItem() { return null; } clear() {}
    });
  }
  if (typeof window.DOMQuad === 'undefined' && typeof window.DOMRect === 'function') {
    try {
      const _P = window.DOMPoint || class { constructor() { this.x = 0; this.y = 0; this.z = 0; this.w = 1; } };
      window.DOMQuad = class {
        constructor(p1, p2, p3, p4) { this.p1 = p1 || new _P(); this.p2 = p2 || new _P(); this.p3 = p3 || new _P(); this.p4 = p4 || new _P(); }
        getBounds() { return new window.DOMRect(0, 0, 0, 0); }
        toJSON() { return { p1: this.p1, p2: this.p2, p3: this.p3, p4: this.p4 }; }
      };
    } catch (e) { /* read-only */ }
  }

  // trusted types (passthrough policy — no real CSP enforcement)
  if (typeof window.trustedTypes === 'undefined') {
    try {
      const _pass = s => String(s == null ? '' : s);
      window.TrustedTypePolicy = window.TrustedTypePolicy || class { constructor(name) { this.name = name; } };
      window.TrustedTypePolicyFactory = window.TrustedTypePolicyFactory || class {};
      window.trustedTypes = {
        createPolicy: (name, policy = {}) => Object.assign(
          { createHTML: _pass, createScript: _pass, createScriptURL: _pass }, policy, { name: String(name) }),
        defaultPolicy: null,
        getAttributeType: () => null, getExposedType: () => null,
      };
    } catch (e) { /* read-only */ }
  }

  // speech synthesis
  if (typeof window.speechSynthesis === 'undefined') {
    try {
      window.SpeechSynthesisUtterance = window.SpeechSynthesisUtterance || class {
        constructor(text = '') {
          this.text = String(text); this.lang = ''; this.voice = null; this.volume = 1; this.rate = 1; this.pitch = 1;
          this.onstart = this.onend = this.onerror = this.onmark = this.onpause = this.onresume = this.onboundary = null;
        }
      };
      window.SpeechSynthesisVoice = window.SpeechSynthesisVoice || class {};
      window.SpeechSynthesis = window.SpeechSynthesis || class {};
      window.speechSynthesis = Object.assign(_listenerObj(), {
        speaking: false, pending: false, paused: false, onvoiceschanged: null,
        getVoices: () => [], speak: _noop, cancel: _noop, pause: _noop, resume: _noop,
      });
    } catch (e) { /* read-only */ }
  }

  // navigator.* sub-APIs (feature-detected by most scripts)
  _define(navigator, 'pdfViewerEnabled', true);
  _define(navigator, 'vendorSub', ''); _define(navigator, 'productSub', '20030107');
  _define(navigator, 'vibrate', () => false);
  _define(navigator, 'getGamepads', () => [null, null, null, null]);
  _define(navigator, 'connection', _api({ onchange: null, effectiveType: '4g', rtt: 50, downlink: 10, saveData: false }));
  _define(navigator, 'mediaDevices', _api({
    ondevicechange: null, getSupportedConstraints: () => ({}), enumerateDevices: async () => [],
    getUserMedia: () => _deny('NotAllowedError', 'Permission denied'),
    getDisplayMedia: () => _deny('NotAllowedError', 'Permission denied'),
  }));
  _define(navigator, 'clipboard', _api({
    readText: () => _deny('NotAllowedError', 'Clipboard read denied'), writeText: async () => {},
    read: () => _deny('NotAllowedError', 'Clipboard read denied'),
    write: () => _deny('NotAllowedError', 'Clipboard write denied'),
  }));
  _define(navigator, 'serviceWorker', _api({
    controller: null, onmessage: null, onmessageerror: null, oncontrollerchange: null,
    ready: new Promise(() => {}), // never resolves without SW support
    register: () => _deny('NotSupportedError', 'Service workers not supported'),
    getRegistration: async () => undefined, getRegistrations: async () => [], startMessages: _noop,
  }));
  _define(navigator, 'credentials', _api({
    get: async () => null, create: async () => null, store: async () => null, preventSilentAccess: _asyncNoop,
  }));
  _define(navigator, 'wakeLock', { request: () => _deny('NotSupportedError', 'Wake Lock not supported') });
  _define(navigator, 'keyboard', { getLayoutMap: async () => ({ get: () => null }), lock: _asyncNoop, unlock: _noop });
  for (const name of ['serial', 'usb', 'bluetooth', 'hid']) {
    _define(navigator, name, _api({
      getDevices: async () => [],
      requestDevice: () => _deny('NotFoundError', 'No device selected'),
      requestPort: () => _deny('NotFoundError', 'No device selected'),
    }));
  }
  _define(navigator, 'xr', _api({
    isSessionSupported: async () => false, requestSession: () => _deny('NotSupportedError', 'WebXR not supported'),
    ondevicechange: null,
  }));
  _define(navigator, 'scheduling', { isInputPending: () => false });
  _define(navigator, 'ink', { requestInk: () => _deny('NotSupportedError', 'Ink not supported') });
  _define(navigator, 'presentation', { defaultRequest: null, receiver: null });
  _define(navigator, 'virtualKeyboard', _api({
    show: _noop, hide: _noop, overlaysContent: false,
    boundingRect: { x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0 },
  }));
  _define(navigator, 'windowControlsOverlay', _api({
    visible: false, getTitlebarAreaRect: () => new (window.DOMRect || Object)(0, 0, 0, 0),
  }));
  _define(navigator, 'locks', {
    request: async (name, mode, cb) => (typeof mode === 'function' ? mode() : typeof cb === 'function' ? cb() : undefined),
    query: async () => ({ held: [], pending: [] }),
  });
  _define(navigator, 'mediaSession', {
    metadata: null, playbackState: 'none', setActionHandler: _noop, setPositionState: _noop, setCurrentTime: _noop,
    setDuration: _noop, play: _noop, pause: _noop, skipBackward: _noop, skipForward: _noop, seekBackward: _noop,
    seekForward: _noop, seekTo: _noop, setCameraActiveToggle: _noop,
  });
  _define(navigator, 'mimeTypes', { length: 0, item: () => null, namedItem: () => null, [Symbol.iterator]: function* () {} });
  _define(navigator, 'share', () => _deny('AbortError', 'Share not supported'));
  _define(navigator, 'canShare', () => false);

  // document.* helpers
  if (typeof document.execCommand !== 'function') { try { document.execCommand = () => false; } catch (e) { /* read-only */ } }
  if (typeof document.queryCommandSupported !== 'function') { try { document.queryCommandSupported = () => false; } catch (e) { /* read-only */ } }
  if (typeof document.queryCommandEnabled !== 'function') { try { document.queryCommandEnabled = () => false; } catch (e) { /* read-only */ } }
  if (typeof document.caretRangeFromPoint !== 'function') { try { document.caretRangeFromPoint = () => null; } catch (e) { /* read-only */ } }
  if (typeof document.exitPointerLock !== 'function') { try { document.exitPointerLock = _noop; } catch (e) { /* read-only */ } }
  if (typeof document.hasStorageAccess !== 'function') { try { document.hasStorageAccess = () => Promise.resolve(false); } catch (e) { /* read-only */ } }
  if (typeof document.requestStorageAccess !== 'function') { try { document.requestStorageAccess = () => Promise.resolve(); } catch (e) { /* read-only */ } }
  _define(document, 'designMode', 'off');
  _define(document, 'featurePolicy', {
    allowedFeatures: () => new Set(), allowsFeature: () => false, features: () => [], getAllowlistForFeature: () => [],
  });
  try {
    if (location.ancestorOrigins === undefined) Object.defineProperty(location, 'ancestorOrigins', {
      value: { length: 0, item: () => null, contains: () => false, [Symbol.iterator]: function* () {} },
      configurable: true,
    });
  } catch (e) { /* location may be unforgeable */ }

  // on* handler properties: bridge assignments to addEventListener so
  // `window.onclick = fn` actually fires (Lightpanda declares none of them)
  for (const ev of ['beforeunload', 'blur', 'error', 'focus', 'hashchange', 'keydown', 'keyup', 'load', 'message',
                    'mousewheel', 'offline', 'online', 'pagehide', 'pageshow', 'popstate', 'resize', 'scroll', 'unload',
                    'storage', 'beforeprint', 'afterprint', 'languagechange', 'messageerror', 'wheel', 'click', 'auxclick',
                    'dblclick', 'contextmenu', 'mousedown', 'mouseup', 'mousemove', 'pointerdown', 'pointerup',
                    'pointermove', 'pointercancel', 'pointerenter', 'pointerleave', 'pointerover', 'pointerout',
                    'gotpointercapture', 'lostpointercapture', 'animationstart', 'animationend', 'animationiteration',
                    'transitionstart', 'transitionend', 'transitionrun', 'transitioncancel', 'cancel', 'close', 'input',
                    'invalid', 'reset', 'search', 'drag', 'dragend', 'dragenter', 'dragleave', 'dragover', 'dragstart',
                    'drop', 'copy', 'cut', 'paste', 'select', 'selectionchange', 'selectstart', 'securitypolicyviolation',
                    'visibilitychange', 'scrollend', 'scrollsnapchange', 'scrollsnapchanging', 'touchstart', 'touchend',
                    'touchmove', 'touchcancel', 'orientationchange', 'dragexit', 'fullscreenchange', 'fullscreenerror',
                    'contentvisibilityautostatechange']) {
    const prop = 'on' + ev;
    let _fn = null;
    try {
      // Native on* accessors exist in Lightpanda but their setter does not
      // register the handler (engine bug) — replace them with a working bridge.
      delete window[prop];
    } catch (e) { /* keep native property */ }
    try {
      Object.defineProperty(window, prop, {
        configurable: true,
        get() { return _fn; },
        set(fn) {
          if (typeof _fn === 'function') { try { window.removeEventListener(ev, _fn); } catch (e) { /* noop */ } }
          _fn = fn || null;
          if (typeof fn === 'function') { try { window.addEventListener(ev, fn); } catch (e) { /* noop */ } }
        },
      });
    } catch (e) { try { window[prop] = null; } catch (e2) { /* read-only */ } }
  }
} catch (e) { /* shims are best-effort */ }

let logContent;

document.addEventListener("DOMContentLoaded", () => {
  const logStorage = document.querySelector(".log");
  logContent = document.querySelector(".log-content") || logStorage;
});

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
    // Re-injection acts as a clickable handle: re-show the hidden panel.
    try { window.g4fDebug.show && window.g4fDebug.show(); } catch (e) { /* noop */ }
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
    (logContent || logEl).appendChild(line);
    (logContent || logEl).scrollTop = (logContent || logEl).scrollHeight;
    if (!logContent) panel.style.display = 'block';
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

  // Capture console log/info (warn/error arrive via the ErrorTracker stream).
['log', 'info', 'warn', 'error'].forEach((method) => {
  const originalMethod = console[method];
  console[method] = new Proxy(originalMethod, {
    apply(target, thisArg, args) {
        const result = Reflect.apply(target, thisArg, args);
        try {
            const msg = args.map(a => 
            a && a.message 
                ? `${typeof a}: ${a.message}` 
                : JSON.stringify(typeof a === 'object' ? Object.fromEntries(Object.entries(a).map(([k, v]) => [k, String(v)])) : a)
            ).join(' ');

            logged.push(msg);
            addLog(`[${method.toUpperCase()}] ${msg}`, 'log');
        } catch (e) {
            // Fail-silent catch wrapper block so hooks never crash your application thread
        }
        return result;
    }
  });
});

  logNavigationData();

  // Expose API for external control
  const hide = () => {
    logEl.innerHTML = '';
    panel.style.display = 'none';
    // also hide error lines rendered outside the panel (e.g. .log-content)
    document.querySelectorAll('.g4f-debug-error').forEach(el => { el.style.display = 'none'; });
  };
  window.g4fDebug = {
    clear: hide,
    hide,
    show: () => { panel.style.display = 'block'; },
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