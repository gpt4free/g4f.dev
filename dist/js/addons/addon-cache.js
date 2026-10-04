/* ================================================================== *
 * Addon: IndexedDB Cache
 *
 * Persistent cache for providers and models using IndexedDB.
 * ================================================================== */

(function () {
    'use strict';

    ChatAddons.register({
        id: 'builtin:cache',
        name: 'IndexedDB Cache',
        version: '1.1.0',
        description: 'Persistent cache for providers, models and servers using IndexedDB with stale-while-revalidate.',
        author: 'g4f',
        builtin: true,
        permissions: ['storage:indexeddb'],

        load() {
            return (async () => {
                await initIDB();
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

const CORE_PROVIDERS_CACHE_KEY = 'core_providers';
const CORE_PROVIDERS_CACHE_TTL = 60 * 60 * 1000; // 1 hour

const SERVERS_CACHE_KEY = 'servers';
const SERVERS_CACHE_TTL = 60 * 60 * 1000; // 1 hour

let idbReady = null;
let idbAvailable = false;

// Initialize IndexedDB
async function initIDB() {
    if (idbReady) return idbReady;
    
    idbReady = new Promise((resolve) => {
        if (typeof indexedDB === 'undefined') {
            console.debug('IndexedDB not available, cache disabled');
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
                console.warn('IndexedDB open failed, cache disabled');
                idbAvailable = false;
                resolve(null);
            };
        } catch (e) {
            console.warn('IndexedDB error, cache disabled:', e);
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
// Unified Cache API (IndexedDB only — no localStorage, it has a ~5MB
// quota and throws QuotaExceededError on big provider+model lists)
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
    return entry && entry.data !== undefined && entry.data !== null;
}

function isCacheEntryFresh(entry) {
    return isCacheEntryValid(entry) && entry.expires > Date.now();
}

// Get from IndexedDB.
// With allowStale, expired entries are still served — used as a fallback
// when the network fails so the UI never renders empty.
async function cacheGet(key, allowStale = false) {
    const entry = await idbGet(key);
    if (allowStale ? isCacheEntryValid(entry) : isCacheEntryFresh(entry)) {
        return entry.data;
    }
    return null;
}

// Set in cache (IndexedDB only)
async function cacheSet(key, data, ttl) {
    const entry = createCacheEntry(data, ttl);
    await idbSet(key, entry);
    return true;
}

// Stale-while-revalidate: serve fresh cache, fetch on miss, and fall
// back to stale (expired) cache when the fetch fails — so consumers
// always get data as long as any cached copy exists.
async function cacheFetch(key, fetcher, ttl) {
    const cached = await cacheGet(key);
    if (cached !== null) return cached;
    try {
        const data = await fetcher();
        cacheSet(key, data, ttl);
        return data;
    } catch (e) {
        const stale = await cacheGet(key, true);
        if (stale !== null) {
            console.warn('Cache: fetch failed for', key, '— serving stale cache:', e);
            return stale;
        }
        throw e;
    }
}

// ------------------------------------------------------------------
// Stale-While-Revalidate (SWR)
// ------------------------------------------------------------------
// Global loading pattern for providers / models / servers:
//   1. Stale:    serve the cached copy immediately (even when expired)
//                so the UI renders instantly.
//   2. Revalidate: fetch fresh data in the background, refresh the cache
//                and notify subscribers via the 'cache:update' event.
// Revalidations are single-flight per key: concurrent callers share one
// network request.

const inflightRevalidations = new Map(); // key -> Promise

function cacheNotify(key, data) {
    try {
        window.dispatchEvent(new CustomEvent('cache:update', { detail: { key, data } }));
    } catch (e) {}
}

// Subscribe to fresh-data updates. Pass a key to filter, or null for all.
// Returns an unsubscribe function.
function cacheOnUpdate(key, callback) {
    const handler = (event) => {
        const detail = event.detail || {};
        if (key === null || detail.key === key) callback(detail.data, detail.key);
    };
    window.addEventListener('cache:update', handler);
    return () => window.removeEventListener('cache:update', handler);
}

// Fetch fresh data for a key, refresh the cache and notify subscribers.
// Errors propagate to the caller (after the inflight entry is cleared).
function revalidate(key, fetcher, ttl) {
    if (inflightRevalidations.has(key)) {
        return inflightRevalidations.get(key);
    }
    const promise = (async () => {
        try {
            const fresh = await fetcher();
            if (fresh !== null && fresh !== undefined) {
                await cacheSet(key, fresh, ttl);
                cacheNotify(key, fresh);
            }
            return fresh;
        } finally {
            inflightRevalidations.delete(key);
        }
    })();
    inflightRevalidations.set(key, promise);
    return promise;
}

// Stale-while-revalidate entry point:
//   cacheSWR(key, fetcher, ttl, onUpdate)
// Calls onUpdate(cached) immediately with the (possibly stale) cached
// value, then again with fresh data when revalidation changes it.
// Resolves with the stale value when a cache exists, otherwise blocks
// on the fetch (errors propagate to the caller).
async function cacheSWR(key, fetcher, ttl, onUpdate) {
    // 1. Stale: serve whatever is cached right away.
    const cached = await cacheGet(key, true);
    if (cached !== null && typeof onUpdate === 'function') {
        onUpdate(cached);
    }

    // 2. Revalidate in the background; re-render when fresh data differs.
    if (cached !== null) {
        let off = null;
        if (typeof onUpdate === 'function') {
            const staleJson = JSON.stringify(cached);
            off = cacheOnUpdate(key, (data) => {
                if (JSON.stringify(data) !== staleJson) onUpdate(data);
            });
        }
        try {
            await revalidate(key, fetcher, ttl);
        } catch (e) {
            console.warn('Cache: revalidate failed for', key, e);
        } finally {
            if (off) off();
        }
        return cached;
    }

    // Nothing cached at all: block on the fetch and deliver the fresh
    // data to the subscriber (errors propagate so callers can show them).
    const fresh = await revalidate(key, fetcher, ttl);
    if (fresh !== null && fresh !== undefined && typeof onUpdate === 'function') {
        onUpdate(fresh);
    }
    return fresh;
}

// Remove from cache
async function cacheRemove(key) {
    const db = await initIDB();
    if (db) {
        try {
            const tx = db.transaction(CACHE_STORE, 'readwrite');
            tx.objectStore(CACHE_STORE).delete(key);
        } catch (e) {}
    }
}

// Providers Cache
// ------------------------------------------------------------------
async function getCachedProviders(allowStale = false) {
    return await cacheGet(PROVIDERS_CACHE_KEY, allowStale);
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

async function getCachedModels(provider, allowStale = false) {
    const key = getModelsCacheKey(provider);
    return await cacheGet(key, allowStale);
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
// Core Providers Cache (/backend-api/v2/providers)
// ------------------------------------------------------------------
async function getCachedCoreProviders(allowStale = false) {
    return await cacheGet(CORE_PROVIDERS_CACHE_KEY, allowStale);
}

async function setCachedCoreProviders(providers) {
    return await cacheSet(CORE_PROVIDERS_CACHE_KEY, providers, CORE_PROVIDERS_CACHE_TTL);
}

async function clearCachedCoreProviders() {
    return await cacheRemove(CORE_PROVIDERS_CACHE_KEY);
}

// ------------------------------------------------------------------
// Custom Servers Cache (g4f.space/custom/api/servers, merged)
// ------------------------------------------------------------------
async function getCachedServers(allowStale = false) {
    return await cacheGet(SERVERS_CACHE_KEY, allowStale);
}

async function setCachedServers(servers) {
    return await cacheSet(SERVERS_CACHE_KEY, servers, SERVERS_CACHE_TTL);
}

async function clearCachedServers() {
    return await cacheRemove(SERVERS_CACHE_KEY);
}

// ------------------------------------------------------------------
// Export cache functions to window for use by other addons
// ------------------------------------------------------------------
window.cache = {
    init: initIDB,
    get: cacheGet,
    set: cacheSet,
    fetch: cacheFetch,
    swr: cacheSWR,
    onUpdate: cacheOnUpdate,
    remove: cacheRemove,
    clear: idbClear,
    providers: {
        get: (allowStale) => cacheGet(PROVIDERS_CACHE_KEY, allowStale),
        set: setCachedProviders,
        fetch: (fetcher) => cacheFetch(PROVIDERS_CACHE_KEY, fetcher, PROVIDERS_CACHE_TTL),
        swr: (fetcher, onUpdate) => cacheSWR(PROVIDERS_CACHE_KEY, fetcher, PROVIDERS_CACHE_TTL, onUpdate),
        clear: clearCachedProviders
    },
    coreProviders: {
        get: (allowStale) => cacheGet(CORE_PROVIDERS_CACHE_KEY, allowStale),
        set: setCachedCoreProviders,
        fetch: (fetcher) => cacheFetch(CORE_PROVIDERS_CACHE_KEY, fetcher, CORE_PROVIDERS_CACHE_TTL),
        swr: (fetcher, onUpdate) => cacheSWR(CORE_PROVIDERS_CACHE_KEY, fetcher, CORE_PROVIDERS_CACHE_TTL, onUpdate),
        clear: clearCachedCoreProviders
    },
    models: {
        get: (provider, allowStale) => cacheGet(getModelsCacheKey(provider), allowStale),
        set: setCachedModels,
        fetch: (provider, fetcher) => cacheFetch(getModelsCacheKey(provider), fetcher, MODELS_CACHE_TTL),
        swr: (provider, fetcher, onUpdate) => cacheSWR(getModelsCacheKey(provider), fetcher, MODELS_CACHE_TTL, onUpdate),
        key: getModelsCacheKey,
        clear: clearCachedModels
    },
    servers: {
        get: (allowStale) => cacheGet(SERVERS_CACHE_KEY, allowStale),
        set: setCachedServers,
        fetch: (fetcher) => cacheFetch(SERVERS_CACHE_KEY, fetcher, SERVERS_CACHE_TTL),
        swr: (fetcher, onUpdate) => cacheSWR(SERVERS_CACHE_KEY, fetcher, SERVERS_CACHE_TTL, onUpdate),
        clear: clearCachedServers
    },
    isIDBAvailable: () => idbAvailable
};

// Initialize on load
initIDB();

// Export for module system.
// Do NOT export fetch/get/set/providers/models at the top level:
// v2.js spreads default exports onto window, which would clobber
// window.fetch, window.providers, window.models, etc.
// The full API is exposed via window.cache (set above).
export default { cache: window.cache };