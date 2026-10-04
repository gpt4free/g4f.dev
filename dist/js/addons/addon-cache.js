/* ================================================================== *
 * Addon: IndexedDB Cache
 *
 * Persistent cache for providers and models using IndexedDB.
 * Falls back to localStorage when IndexedDB is unavailable.
 * ================================================================== */

(function () {
    'use strict';

    ChatAddons.register({
        id: 'builtin:cache',
        name: 'IndexedDB Cache',
        version: '1.0.0',
        description: 'Persistent cache for providers and models using IndexedDB with localStorage fallback.',
        author: 'g4f',
        builtin: true,
        permissions: ['storage:indexeddb', 'storage:local'],

        load() {
            return (async () => {
                await initCache();
            })();
        }
    });
})();

// ------------------------------------------------------------------
// IndexedDB Cache Implementation
// ------------------------------------------------------------------
const CACHE_DB_NAME = 'g4f_cache';
const CACHE_DB_VERSION = 1;
const CACHE_STORE = 'cache';

const PROVIDERS_CACHE_KEY = 'providers';
const PROVIDERS_CACHE_TTL = 60 * 60 * 1000; // 1 hour

const MODELS_CACHE_PREFIX = 'models:';
const MODELS_CACHE_TTL = 60 * 60 * 1000; // 1 hour

let idbReady = null;
let idbAvailable = false;

// Initialize IndexedDB
async function initIDB() {
    if (idbReady) return idbReady;
    
    idbReady = new Promise((resolve) => {
        if (typeof indexedDB === 'undefined') {
            console.debug('IndexedDB not available, using localStorage fallback');
            idbAvailable = false;
            resolve(null);
            return;
        }
        
        try {
            const req = indexedDB.open(CACHE_DB_NAME, CACHE_DB_VERSION);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(CACHE_STORE)) {
                    db.createObjectStore(CACHE_STORE);
                }
            };
            req.onsuccess = () => {
                idbAvailable = true;
                resolve(req.result);
            };
            req.onerror = () => {
                console.warn('IndexedDB open failed, using localStorage fallback');
                idbAvailable = false;
                resolve(null);
            };
        } catch (e) {
            console.warn('IndexedDB error, using localStorage fallback:', e);
            idbAvailable = false;
            resolve(null);
        }
    });
    
    return idbReady;
}

// Get value from IndexedDB
async function idbGet(key) {
    const db = await initIDB();
    if (!db) return null;
    
    return new Promise((resolve) => {
        try {
            const tx = db.transaction(CACHE_STORE, 'readonly');
            const req = tx.objectStore(CACHE_STORE).get(key);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => resolve(null);
        } catch (e) {
            resolve(null);
        }
    });
}

// Set value in IndexedDB
async function idbSet(key, value) {
    const db = await initIDB();
    if (!db) return false;
    
    return new Promise((resolve) => {
        try {
            const tx = db.transaction(CACHE_STORE, 'readwrite');
            tx.objectStore(CACHE_STORE).put(value, key);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => resolve(false);
        } catch (e) {
            resolve(false);
        }
    });
}

// Clear IndexedDB
async function idbClear() {
    const db = await initIDB();
    if (!db) return false;
    
    return new Promise((resolve) => {
        try {
            const tx = db.transaction(CACHE_STORE, 'readwrite');
            tx.objectStore(CACHE_STORE).clear();
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => resolve(false);
        } catch (e) {
            resolve(false);
        }
    });
}

// ------------------------------------------------------------------
// Unified Cache API (IndexedDB with localStorage fallback)
// ------------------------------------------------------------------

// Generic cache entry structure: { data, expires, version }
function createCacheEntry(data, ttl) {
    return {
        data,
        expires: Date.now() + (ttl || PROVIDERS_CACHE_TTL),
        version: 1
    };
}

// Accepts any non-null data (arrays, objects, primitives).
function isCacheEntryValid(entry) {
    return entry && entry.expires > Date.now()
        && entry.data !== undefined && entry.data !== null;
}

// Get from cache (tries IndexedDB first, falls back to localStorage)
async function cacheGet(key, ttl) {
    // Try IndexedDB first
    if (idbAvailable) {
        const entry = await idbGet(key);
        if (isCacheEntryValid(entry)) {
            return entry.data;
        }
    }
    
    // Fallback to localStorage
    try {
        const stored = appStorage.getItem(key);
        if (stored) {
            const entry = JSON.parse(stored);
            if (isCacheEntryValid(entry)) {
                return entry.data;
            }
        }
    } catch (e) {
        // Ignore parse errors
    }
    
    return null;
}

// Set in cache (writes to IndexedDB, mirrors to localStorage as fallback)
async function cacheSet(key, data, ttl) {
    const entry = createCacheEntry(data, ttl);
    
    // Write to IndexedDB
    if (idbAvailable) {
        await idbSet(key, entry);
    }
    
    // Mirror to localStorage as fallback. Large payloads are only mirrored
    // when IndexedDB is unavailable — localStorage has ~5MB quotas and
    // throws QuotaExceededError on big provider+model lists.
    try {
        const json = JSON.stringify(entry);
        if (!idbAvailable || json.length < 1024 * 1024) {
            appStorage.setItem(key, json);
        }
    } catch (e) {
        console.warn('localStorage cache write failed:', e);
    }
    
    return true;
}

// Remove from cache
async function cacheRemove(key) {
    if (idbAvailable) {
        const db = await initIDB();
        if (db) {
            try {
                const tx = db.transaction(CACHE_STORE, 'readwrite');
                tx.objectStore(CACHE_STORE).delete(key);
            } catch (e) {}
        }
    }
    
    try {
        appStorage.removeItem(key);
    } catch (e) {}
}

// ------------------------------------------------------------------
// Providers Cache
// ------------------------------------------------------------------
async function getCachedProviders() {
    return await cacheGet(PROVIDERS_CACHE_KEY, PROVIDERS_CACHE_TTL);
}

async function setCachedProviders(providers) {
    return await cacheSet(PROVIDERS_CACHE_KEY, providers, PROVIDERS_CACHE_TTL);
}

async function clearCachedProviders() {
    return await cacheRemove(PROVIDERS_CACHE_KEY);
}

// ------------------------------------------------------------------
// Models Cache (per provider)
// ------------------------------------------------------------------
function getModelsCacheKey(provider) {
    return MODELS_CACHE_PREFIX + provider;
}

async function getCachedModels(provider) {
    const key = getModelsCacheKey(provider);
    return await cacheGet(key, MODELS_CACHE_TTL);
}

async function setCachedModels(provider, models) {
    const key = getModelsCacheKey(provider);
    return await cacheSet(key, models, MODELS_CACHE_TTL);
}

async function clearCachedModels(provider) {
    const key = getModelsCacheKey(provider);
    return await cacheRemove(key);
}

// ------------------------------------------------------------------
// Export cache functions to window for use by other addons
// ------------------------------------------------------------------
window.cache = {
    init: initIDB,
    get: cacheGet,
    set: cacheSet,
    remove: cacheRemove,
    clear: idbClear,
    providers: {
        get: getCachedProviders,
        set: setCachedProviders,
        clear: clearCachedProviders
    },
    models: {
        get: getCachedModels,
        set: setCachedModels,
        clear: clearCachedModels
    },
    isIDBAvailable: () => idbAvailable
};

// Initialize on load
initIDB();

// Export for module system
export default {
    init: initIDB,
    get: cacheGet,
    set: cacheSet,
    remove: cacheRemove,
    providers: {
        get: getCachedProviders,
        set: setCachedProviders,
        clear: clearCachedProviders
    },
    models: {
        get: getCachedModels,
        set: setCachedModels,
        clear: clearCachedModels
    }
};