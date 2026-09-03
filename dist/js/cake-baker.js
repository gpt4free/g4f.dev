/**
 * G4F Cake Baker — Client-side proof-of-work module
 *
 * Auto-runs when the user opens g4f.dev/chat or g4f.dev/members.html.
 * Fetches a batch of UUIDs from the cake worker, computes the salted
 * SHA-256 hash in a background Web Worker until the digest meets the
 * difficulty target, then submits the baked cake back to the worker.
 *
 * Each accepted cake grants 0.05¢ credit to the user's account, bound
 * to the IP that baked it.
 *
 * Usage:
 *   <script type="module" src="dist/js/cake-baker.js?v={{ v }}" defer></script>
 *
 * The module exposes a small API on window.G4FCakeBaker for debugging:
 *   - status(): returns { baked, submitted, accepted, credits, running }
 *   - start(): manually start baking
 *   - stop(): stop baking
 */
(function () {
    "use strict";

    // Configuration -------------------------------------------------------
    const CAKE_ENDPOINT = "https://g4f.space/cake"; // same-origin via route
    const BATCH_SIZE = 20;         // UUIDs fetched per request (server caps at 50)
    const POLL_INTERVAL_MS = 15000; // base re-fetch interval when queue empty
    const STORAGE_KEY = "g4f_cake_baker";
    const HEARTBEAT_KEY = "g4f_cake_heartbeat";
    const SETTINGS_KEY = "g4f_cake_settings"; // persisted user controls
    const STATUS_KEY = "g4f_cake_status";     // cross-tab status sync fallback
    const THROTTLE_MAX_MS = 120000;           // throttle slider max (0 = no wait)

    // Adaptive throttling ------------------------------------------------
    // As the user bakes more cakes today, we slow down to avoid hammering
    // the server and to leave CPU for others. The interval scales linearly
    // with the fraction of the daily limit already consumed, up to a cap.
    const THROTTLE_CAP_MS = 60000;   // never wait longer than this between batches
    const THROTTLE_SOFT_AT = 0.5;     // begin backing off once 50% of daily limit reached
    const THROTTLE_HARD_AT = 0.9;    // near the limit, wait the full cap

    // Base wait between batch fetches. Uses the user's throttle setting
    // (0 = fetch again immediately); adaptive backing-off still applies
    // on top of it when the daily limit is approached.
    function throttleBase() {
        return settings ? settings.throttleMs : POLL_INTERVAL_MS;
    }

    function computePollInterval() {
        const limit = state.limitPerDay || 100;
        const baked = state.dailyBaked || 0;
        const base = throttleBase();
        if (limit <= 0 || baked <= 0) return base;
        const frac = baked / limit;
        if (frac < THROTTLE_SOFT_AT) return base;
        if (frac >= THROTTLE_HARD_AT) return THROTTLE_CAP_MS;
        // linear interpolation between soft and hard thresholds
        const t = (frac - THROTTLE_SOFT_AT) / (THROTTLE_HARD_AT - THROTTLE_SOFT_AT);
        return Math.round(base + t * (THROTTLE_CAP_MS - base));
    }

    // State ---------------------------------------------------------------
    const state = {
        running: false,
        queue: [],          // pending UUIDs to bake
        inFlight: 0,        // number of UUIDs currently being baked
        baked: 0,           // cakes baked locally this session
        submitted: 0,       // cakes submitted to server
        accepted: 0,        // cakes accepted by server
        credits: 0,         // total cents credited this session
        workers: [],        // pool of Web Workers for hashing
        timer: null,        // poll timer
        difficulty: 4,      // default; updated from server
        salt: null,         // per-session salt; updated from server
        dailyBaked: 0,      // cakes baked by this IP today (from server)
        limitPerDay: 100,   // server-imposed daily limit (from server)
        dailyLimitReached: false,   // server returned 429 daily_limit_reached
        dailyLimitRetryAt: 0,       // epoch ms when Retry-After elapses
        workerRates: {},            // workerId -> last reported h/s
        hashRate: 0,                // aggregated hash rate across all workers (h/s)
        rateTimer: null,           // interval that refreshes the #input-count display
        gpuSupported: false,       // WebGPU adapter detected
        gpuMode: false,            // currently using GPU worker
        gpuName: "",               // detected GPU adapter name
        gpuInitError: "",          // error message if GPU init failed
        lastStatusTs: 0,           // ts of last applied cross-tab status snapshot
    };

    // User settings -------------------------------------------------------
    // Persistent, user-adjustable knobs: on/off, worker count, throttle.
    // Edited live from the floating control panel injected into the page.
    const MAX_WORKERS = Math.min(Math.max(navigator.hardwareConcurrency || 4, 2), 16);
    const DEFAULT_WORKERS = Math.ceil(Math.min(Math.max(navigator.hardwareConcurrency || 4, 2), 8) / 2);

    function clampInt(value, min, max, fallback) {
        value = parseInt(value, 10);
        if (isNaN(value)) return fallback;
        return Math.min(Math.max(value, min), max);
    }

    // Safe storage wrappers ------------------------------------------------
    // Some mobile browsers (iOS Safari private mode, several in-app browsers)
    // throw on ANY localStorage access. That used to crash acquireLock()
    // inside start(), so baking silently never began on phones. Fall back to
    // an in-memory store so the lock, settings and progress still work for
    // the lifetime of the tab.
    const memoryStore = new Map();
    function storageGet(key) {
        try {
            return localStorage.getItem(key);
        } catch (err) {
            return memoryStore.has(key) ? memoryStore.get(key) : null;
        }
    }
    function storageSet(key, value) {
        try {
            localStorage.setItem(key, value);
        } catch (err) {
            memoryStore.set(key, value);
        }
    }
    function storageRemove(key) {
        try {
            localStorage.removeItem(key);
        } catch (err) {
            memoryStore.delete(key);
        }
    }

    function loadSettings() {
        let saved = {};
        try {
            saved = JSON.parse(storageGet(SETTINGS_KEY) || "{}") || {};
        } catch (err) {
            saved = {};
        }
        return {
            enabled: saved.enabled !== false,
            workers: clampInt(saved.workers, 1, MAX_WORKERS, DEFAULT_WORKERS),
            throttleMs: clampInt(saved.throttleMs, 0, THROTTLE_MAX_MS, POLL_INTERVAL_MS),
            useGPU: saved.useGPU === true, // default false until GPU detected
            pos:
                saved.pos &&
                typeof saved.pos.x === "number" &&
                typeof saved.pos.y === "number"
                    ? { x: saved.pos.x, y: saved.pos.y }
                    : null,
        };
    }

    const settings = loadSettings();

    function saveSettings() {
        storageSet(SETTINGS_KEY, JSON.stringify(settings));
    }

    // Persistence ---------------------------------------------------------
    function loadState() {
        try {
            const saved = JSON.parse(storageGet(STORAGE_KEY) || "{}");
            return {
                baked: saved.baked || 0,
                submitted: saved.submitted || 0,
                accepted: saved.accepted || 0,
                credits: saved.credits || 0,
                lastDay: saved.lastDay || new Date().toISOString().slice(0, 10),
            };
        } catch {
            return { baked: 0, submitted: 0, accepted: 0, credits: 0, lastDay: new Date().toISOString().slice(0, 10) };
        }
    }

    function saveState() {
        const today = new Date().toISOString().slice(0, 10);
        const saved = loadState();
        if (saved.lastDay !== today) {
            saved.baked = 0;
            saved.submitted = 0;
            saved.accepted = 0;
            saved.credits = 0;
            saved.lastDay = today;
        }
        saved.baked += state.baked;
        saved.submitted += state.submitted;
        saved.accepted += state.accepted;
        saved.credits += state.credits;
        // reset session counters after persisting
        state.baked = 0;
        state.submitted = 0;
        state.accepted = 0;
        state.credits = 0;
        storageSet(STORAGE_KEY, JSON.stringify(saved));
    }

    // Heartbeat: only one tab bakes at a time -----------------------------
    function acquireLock() {
        const now = Date.now();
        const existing = parseInt(storageGet(HEARTBEAT_KEY) || "0", 10);
        if (existing && now - existing < 30000) {
            // another tab is baking
            return false;
        }
        storageSet(HEARTBEAT_KEY, String(now));
        return true;
    }

    function refreshLock() {
        if (state.running) {
            storageSet(HEARTBEAT_KEY, String(Date.now()));
            // piggy-back a status broadcast on each lock refresh so idle
            // tabs keep their credits/daily counters fresh even when no
            // bake was accepted since the last snapshot.
            publishStatus();
        }
    }

    // Cross-tab status sync ------------------------------------------------
    // Only the tab holding the bake lock talks to /cake/status. Every other
    // tab receives the latest snapshot via BroadcastChannel postMessage
    // (with a localStorage + storage-event fallback for browsers without
    // BroadcastChannel) so credits and daily counters stay in sync.
    const STATUS_MSG = "g4f-cake-status";
    const STATUS_REQ = "g4f-cake-status-request";
    let statusChannel = null;
    try {
        if (typeof BroadcastChannel !== "undefined") {
            statusChannel = new BroadcastChannel("g4f_cake_baker");
            statusChannel.onmessage = (e) => handleStatusMessage(e.data);
        }
    } catch (err) {
        statusChannel = null;
    }
    // storage-event fallback: fires in *other* tabs when the leader writes
    // the snapshot (BroadcastChannel covers the rest).
    window.addEventListener("storage", (e) => {
        if (e.key === STATUS_KEY && e.newValue) {
            try {
                handleStatusMessage(JSON.parse(e.newValue));
            } catch (err) { /* malformed snapshot */ }
        }
    });

    function publishStatus() {
        const snapshot = {
            type: STATUS_MSG,
            credits: state.credits,
            dailyBaked: state.dailyBaked,
            limitPerDay: state.limitPerDay,
            difficulty: state.difficulty,
            salt: state.salt,
            running: state.running,
            ts: Date.now(),
        };
        if (statusChannel) {
            statusChannel.postMessage(snapshot);
        } else {
            // fallback: write to localStorage; the storage event delivers
            // the snapshot to every other open tab.
            storageSet(STATUS_KEY, JSON.stringify(snapshot));
        }
    }

    function applyStatusSnapshot(snap) {
        if (!snap || typeof snap !== "object") return;
        // ignore our own storage-event echo and stale snapshots
        if (snap.ts && snap.ts <= (state.lastStatusTs || 0)) return;
        state.lastStatusTs = snap.ts || 0;
        if (typeof snap.credits === "number") state.credits = snap.credits;
        if (typeof snap.dailyBaked === "number") state.dailyBaked = snap.dailyBaked;
        if (typeof snap.limitPerDay === "number") state.limitPerDay = snap.limitPerDay;
        if (typeof snap.difficulty === "number" && snap.difficulty) state.difficulty = snap.difficulty;
        if (snap.salt) state.salt = snap.salt;
        updatePanelStatus();
    }

    function handleStatusMessage(msg) {
        if (!msg || typeof msg !== "object") return;
        if (msg.type === STATUS_MSG) {
            applyStatusSnapshot(msg);
        } else if (msg.type === STATUS_REQ) {
            // another tab wants the latest status; reply if we have one.
            // Only the baking tab answers so N tabs don't stampede.
            if (state.running) publishStatus();
        }
    }

    // Ask the baking tab for a fresh status snapshot (used on boot and
    // when a tab starts listening after the last broadcast).
    function requestStatus() {
        if (statusChannel) {
            statusChannel.postMessage({ type: STATUS_REQ });
        } else {
            // fallback: read the last persisted snapshot directly
            try {
                const saved = JSON.parse(storageGet(STATUS_KEY) || "null");
                if (saved) applyStatusSnapshot(saved);
            } catch (err) { /* no snapshot yet */ }
        }
    }

    // WGSL SHA-256 compute shader -----------------------------------------
    // Runs on the GPU via WebGPU compute pipelines. Each workgroup item
    // computes SHA-256("uuid:salt:nonce") for a range of nonces and checks
    // the leading zero bits against the difficulty target. Found nonces
    // are written atomically to the output buffer.
    const WGSL_SHA256 = `
const K: array<u32, 64> = array<u32, 64>(
    0x428a2f98u, 0x71374491u, 0xb5c0fbcfu, 0xe9b5dba5u, 0x3956c25bu, 0x59f111f1u,
    0x923f82a4u, 0xab1c5ed5u, 0xd807aa98u, 0x12835b01u, 0x243185beu, 0x550c7dc3u,
    0x72be5d74u, 0x80deb1feu, 0x9bdc06a7u, 0xc19bf174u, 0xe49b69c1u, 0xefbe4786u,
    0x0fc19dc6u, 0x240ca1ccu, 0x2de92c6fu, 0x4a7484aau, 0x5cb0a9dcu, 0x76f988dau,
    0x983e5152u, 0xa831c66du, 0xb00327c8u, 0xbf597fc7u, 0xc6e00bf3u, 0xd5a79147u,
    0x06ca6351u, 0x14292967u, 0x27b70a85u, 0x2e1b2138u, 0x4d2c6dfcu, 0x53380d13u,
    0x650a7354u, 0x766a0abbu, 0x81c2c92eu, 0x92722c85u, 0xa2bfe8a1u, 0xa81a664bu,
    0xc24b8b70u, 0xc76c51a3u, 0xd192e819u, 0xd6990624u, 0xf40e3585u, 0x106aa070u,
    0x19a4c116u, 0x1e376c08u, 0x2748774cu, 0x34b0bcb5u, 0x391c0cb3u, 0x4ed8aa4au,
    0x5b9cca4fu, 0x682e6ff3u, 0x748f82eeu, 0x78a5636fu, 0x84c87814u, 0x8cc70208u,
    0x90befffau, 0xa4506cebu, 0xbef9a3f7u, 0xc67178f2u
);

fn rotr(x: u32, n: u32) -> u32 {
    return (x >> n) | (x << (32u - n));
}

fn sha256_transform(state: ptr<function, array<u32, 8>>, block: ptr<function, array<u32, 16>>) {
    var w: array<u32, 64>;
    for (var i = 0u; i < 16u; i = i + 1u) {
        w[i] = (*block)[i];
    }
    for (var i = 16u; i < 64u; i = i + 1u) {
        let s0 = rotr(w[i - 15u], 7u) ^ rotr(w[i - 15u], 18u) ^ (w[i - 15u] >> 3u);
        let s1 = rotr(w[i - 2u], 17u) ^ rotr(w[i - 2u], 19u) ^ (w[i - 2u] >> 10u);
        w[i] = w[i - 16u] + s0 + w[i - 7u] + s1;
    }

    var a = (*state)[0]; var b = (*state)[1]; var c = (*state)[2]; var d = (*state)[3];
    var e = (*state)[4]; var f = (*state)[5]; var g = (*state)[6]; var h = (*state)[7];

    for (var i = 0u; i < 64u; i = i + 1u) {
        let S1 = rotr(e, 6u) ^ rotr(e, 11u) ^ rotr(e, 25u);
        let ch = (e & f) ^ ((~e) & g);
        let temp1 = h + S1 + ch + K[i] + w[i];
        let S0 = rotr(a, 2u) ^ rotr(a, 13u) ^ rotr(a, 22u);
        let maj = (a & b) ^ (a & c) ^ (b & c);
        let temp2 = S0 + maj;

        h = g; g = f; f = e; e = d + temp1; d = c; c = b; b = a; a = temp1 + temp2;
    }
    (*state)[0] = (*state)[0] + a; (*state)[1] = (*state)[1] + b;
    (*state)[2] = (*state)[2] + c; (*state)[3] = (*state)[3] + d;
    (*state)[4] = (*state)[4] + e; (*state)[5] = (*state)[5] + f;
    (*state)[6] = (*state)[6] + g; (*state)[7] = (*state)[7] + h;
}

fn set_byte(arr: ptr<function, array<u32, 32>>, i: u32, val: u32) {
    let word_idx = i / 4u;
    let byte_idx = i % 4u;
    let shift = (3u - byte_idx) * 8u;
    (*arr)[word_idx] = ((*arr)[word_idx] & ~(0xFFu << shift)) | ((val & 0xFFu) << shift);
}

struct FoundData {
    count: atomic<u32>,
    nonces: array<u32, 16>,
    hashes: array<u32, 128>,  // 16 results × 8 words
};

struct Params {
    prefix_len: u32,
    nonce_start: u32,
    num_hashes: u32,
    digits: u32,
    num_blocks: u32,
    difficulty: u32,
};

@group(0) @binding(0) var<storage, read> prefix: array<u32>;
@group(0) @binding(1) var<uniform> params: Params;
@group(0) @binding(2) var<storage, read_write> found: FoundData;

@compute @workgroup_size(64)
fn sha256_batch(@builtin(global_invocation_id) gid: vec3<u32>) {
    let idx = gid.x;
    if (idx >= params.num_hashes) {
        return;
    }

    let nonce = params.nonce_start + idx;
    var msg: array<u32, 32> = array<u32, 32>(0u,0u,0u,0u,0u,0u,0u,0u,0u,0u,0u,0u,0u,0u,0u,0u,0u,0u,0u,0u,0u,0u,0u,0u,0u,0u,0u,0u,0u,0u,0u,0u);

    // Copy prefix bytes from storage buffer (packed as u32s, big-endian)
    for (var i = 0u; i < params.prefix_len; i = i + 1u) {
        let word = prefix[i / 4u];
        let byte_val = (word >> ((3u - (i % 4u)) * 8u)) & 0xFFu;
        set_byte(&msg, i, byte_val);
    }

    let total_len = params.prefix_len + params.digits;
    var tmp = nonce;
    for (var i = 0u; i < params.digits; i = i + 1u) {
        set_byte(&msg, total_len - 1u - i, 0x30u + (tmp % 10u));
        tmp = tmp / 10u;
    }

    // Padding byte 0x80
    set_byte(&msg, total_len, 0x80u);

    // Length in bits (big-endian, last 8 bytes).
    // bit_len always fits in a u32 (messages are <= 128 bytes), so only
    // the low 4 bytes are encoded and the high 4 stay zero (msg is
    // zero-initialized). Shifting a u32 by >= 32 is undefined in WGSL
    // and gets masked to shift % 32 on GPUs, corrupting the length.
    let padded_len = params.num_blocks * 64u;
    let bit_len = total_len * 8u;
    for (var i = 0u; i < 4u; i = i + 1u) {
        set_byte(&msg, padded_len - 1u - i, (bit_len >> (8u * i)) & 0xFFu);
    }

    var state: array<u32, 8> = array<u32, 8>(
        0x6a09e667u, 0xbb67ae85u, 0x3c6ef372u, 0xa54ff53au,
        0x510e527fu, 0x9b05688cu, 0x1f83d9abu, 0x5be0cd19u
    );

    for (var b = 0u; b < params.num_blocks; b = b + 1u) {
        var block: array<u32, 16>;
        for (var i = 0u; i < 16u; i = i + 1u) {
            block[i] = msg[b * 16u + i];
        }
        sha256_transform(&state, &block);
    }

    // Count leading zero bits
    var zero_bits = 0u;
    var done = false;
    for (var i = 0u; i < 8u; i = i + 1u) {
        if (done) { break; }
        let word = state[i];
        if (word == 0u) {
            zero_bits = zero_bits + 32u;
        } else {
            zero_bits = zero_bits + countLeadingZeros(word);
            done = true;
        }
    }

    if (zero_bits >= params.difficulty) {
        let pos = atomicAdd(&found.count, 1u);
        if (pos < 16u) {
            found.nonces[pos] = nonce;
            for (var i = 0u; i < 8u; i = i + 1u) {
                found.hashes[pos * 8u + i] = state[i];
            }
        }
    }
}
`;

    // GPU Worker source ---------------------------------------------------
    // A Web Worker that uses WebGPU compute shaders for massively parallel
    // SHA-256 hashing. Falls back to crypto.subtle.digest if WebGPU is
    // unavailable in the worker context. The GPU processes tens of
    // thousands of nonces per dispatch, compared to ~2048 per async tick
    // with SubtleCrypto, yielding 50-200x throughput on capable GPUs.
    const GPU_WORKER_SOURCE = `
        const WGSL_SHA256 = ${JSON.stringify(WGSL_SHA256)};

        const encoder = new TextEncoder();
        const hexChars = "0123456789abcdef";

        function toHex(words) {
            let out = "";
            for (let i = 0; i < words.length; i++) {
                const w = words[i];
                out += hexChars[(w >>> 28) & 0xf] + hexChars[(w >>> 24) & 0xf];
                out += hexChars[(w >>> 20) & 0xf] + hexChars[(w >>> 16) & 0xf];
                out += hexChars[(w >>> 12) & 0xf] + hexChars[(w >>> 8) & 0xf];
                out += hexChars[(w >>> 4) & 0xf] + hexChars[w & 0xf];
            }
            return out;
        }

        function leadingZeroBitsHex(hex) {
            let bits = 0;
            for (let i = 0; i < hex.length; i++) {
                const nibble = hex.charCodeAt(i);
                if (nibble === 48) {
                    bits += 4;
                } else {
                    bits += Math.clz32(nibble - (nibble <= 57 ? 48 : 87)) - 28;
                    break;
                }
            }
            return bits;
        }

        let gpuDevice = null;
        let gpuPipeline = null;
        let gpuBindGroupLayout = null;
        let gpuInitFailed = false;
        let gpuInitError = "";

        async function initGPU() {
            if (gpuDevice || gpuInitFailed) return gpuDevice;
            try {
                if (!navigator.gpu) {
                    gpuInitFailed = true;
                    gpuInitError = "WebGPU not supported in this browser";
                    return null;
                }
                const adapter = await navigator.gpu.requestAdapter({
                    powerPreference: "high-performance",
                });
                if (!adapter) {
                    gpuInitFailed = true;
                    gpuInitError = "No GPU adapter available";
                    return null;
                }
                gpuDevice = await adapter.requestDevice();
                const module = gpuDevice.createShaderModule({ code: WGSL_SHA256 });

                // introspect the bind group layout from the shader
                gpuBindGroupLayout = gpuDevice.createBindGroupLayout({
                    entries: [
                        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
                        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
                        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
                    ],
                });
                const pipelineLayout = gpuDevice.createPipelineLayout({
                    bindGroupLayouts: [gpuBindGroupLayout],
                });
                gpuPipeline = gpuDevice.createComputePipeline({
                    layout: pipelineLayout,
                    compute: { module, entryPoint: "sha256_batch" },
                });
                self.postMessage({ type: "gpu-ready", gpuName: adapter.info?.description || "GPU" });
                return gpuDevice;
            } catch (err) {
                gpuInitFailed = true;
                gpuInitError = err.message || String(err);
                self.postMessage({ type: "gpu-failed", error: gpuInitError });
                return null;
            }
        }

        function computeBlocks(prefixLen, digits) {
            const totalLen = prefixLen + digits;
            const paddedLen = Math.ceil((totalLen + 9) / 64) * 64;
            return paddedLen / 64;
        }

        async function hashBatchGPU(uuid, salt, nonceStart, difficulty, batchSize) {
            if (!gpuDevice) {
                const dev = await initGPU();
                if (!dev) return null;
            }

            const prefixStr = uuid + ":" + salt + ":";
            const prefixBytes = encoder.encode(prefixStr);
            const prefixLen = prefixBytes.length;

            // Match the Python logic: all nonces in a batch must have the
            // same digit width. Cap at the next power-of-10 boundary.
            const digits = String(nonceStart).length;
            const nextBoundary = digits >= 20 ? 10n ** 20n : 10 ** digits;
            const maxNonce = 0xFFFFFFFF;
            const actualBatch = Math.min(batchSize, Number(nextBoundary) - nonceStart, maxNonce - nonceStart + 1);
            const numBlocks = computeBlocks(prefixLen, digits);

            // prefix storage buffer — pack bytes into u32s (big-endian) to
            // match the WGSL shader's get_byte extraction order.
            const prefixU32Len = Math.ceil(prefixLen / 4);
            const prefixU32 = new Uint32Array(prefixU32Len);
            for (let i = 0; i < prefixLen; i++) {
                const wordIdx = i >> 2;
                const shift = (3 - (i & 3)) * 8;
                prefixU32[wordIdx] |= prefixBytes[i] << shift;
            }
            const prefixBuf = gpuDevice.createBuffer({
                size: prefixU32Len * 4,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            });
            gpuDevice.queue.writeBuffer(prefixBuf, 0, prefixU32);

            // params uniform buffer (6 × u32 = 24 bytes, round to 32)
            const paramsBuf = gpuDevice.createBuffer({
                size: 32,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });
            const paramsData = new Uint32Array(8);
            paramsData[0] = prefixLen;
            paramsData[1] = nonceStart;
            paramsData[2] = actualBatch;
            paramsData[3] = digits;
            paramsData[4] = numBlocks;
            paramsData[5] = difficulty;
            gpuDevice.queue.writeBuffer(paramsBuf, 0, paramsData);

            // found buffer: count(4) + nonces(16×4=64) + hashes(128×4=512) = 580 bytes, round to 1024
            const foundBuf = gpuDevice.createBuffer({
                size: 1024,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
            });
            const foundStaging = gpuDevice.createBuffer({
                size: 1024,
                usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
            });

            const bindGroup = gpuDevice.createBindGroup({
                layout: gpuBindGroupLayout,
                entries: [
                    { binding: 0, resource: { buffer: prefixBuf } },
                    { binding: 1, resource: { buffer: paramsBuf } },
                    { binding: 2, resource: { buffer: foundBuf } },
                ],
            });

            const commandEncoder = gpuDevice.createCommandEncoder();
            const pass = commandEncoder.beginComputePass();
            pass.setPipeline(gpuPipeline);
            pass.setBindGroup(0, bindGroup);
            const workgroupSize = 64;
            const groups = Math.ceil(actualBatch / workgroupSize);
            pass.dispatchWorkgroups(groups);
            pass.end();
            commandEncoder.copyBufferToBuffer(foundBuf, 0, foundStaging, 0, 1024);
            gpuDevice.queue.submit([commandEncoder.finish()]);

            await foundStaging.mapAsync(GPUMapMode.READ);
            const foundData = new Uint32Array(foundStaging.getMappedRange().slice(0));
            foundStaging.unmap();

            prefixBuf.destroy();
            paramsBuf.destroy();
            foundBuf.destroy();
            foundStaging.destroy();

            const foundCount = Math.min(foundData[0], 16);
            if (foundCount > 0) {
                const nonce = foundData[1]; // first found nonce (offset 1 = nonces[0])
                // Buffer layout: count(1) + nonces(16) + hashes(16×8=128 flat u32s)
                // First result's hash starts at offset 17.
                const words = new Uint32Array(8);
                for (let i = 0; i < 8; i++) {
                    words[i] = foundData[17 + i];
                }
                const hexHash = toHex(words);
                return { nonce, hash: hexHash, processed: actualBatch };
            }

            return { nonce: null, hash: null, processed: actualBatch };
        }

        // CPU fallback using crypto.subtle.digest (same as the original worker)
        async function hashBatchCPU(uuid, salt, nonceStart, difficulty, batchSize) {
            const digits = String(nonceStart).length;
            const nextBoundary = digits >= 20 ? 10n ** 20n : 10 ** digits;
            const actualBatch = Math.min(batchSize, Number(nextBoundary) - nonceStart);
            const promises = new Array(actualBatch);
            for (let i = 0; i < actualBatch; i++) {
                const input = uuid + ":" + salt + ":" + (nonceStart + i);
                promises[i] = crypto.subtle.digest("SHA-256", encoder.encode(input));
            }
            const digests = await Promise.all(promises);
            for (let i = 0; i < actualBatch; i++) {
                const bytes = new Uint8Array(digests[i]);
                let hex = "";
                for (let j = 0; j < bytes.length; j++) {
                    hex += hexChars[bytes[j] >> 4] + hexChars[bytes[j] & 0xf];
                }
                if (leadingZeroBitsHex(hex) >= difficulty) {
                    return { nonce: nonceStart + i, hash: hex, processed: actualBatch };
                }
            }
            return { nonce: null, hash: null, processed: actualBatch };
        }

        self.onmessage = async function (e) {
            const { uuid, salt, difficulty, workerId, useGPU, batchSize } = e.data;
            let nonce = 0;
            let scanned = 0;
            const startedAt = performance.now();
            let lastLogAt = startedAt;
            let lastScanned = 0;

            const gpuBatch = batchSize || 65536;
            const cpuBatch = 2048;

            while (true) {
                let result;
                if (useGPU && !gpuInitFailed) {
                    result = await hashBatchGPU(uuid, salt, nonce, difficulty, gpuBatch);
                    if (result === null) {
                        // GPU init failed, fall back to CPU
                        self.postMessage({ type: "gpu-failed", error: gpuInitError });
                        result = await hashBatchCPU(uuid, salt, nonce, difficulty, cpuBatch);
                    }
                } else {
                    result = await hashBatchCPU(uuid, salt, nonce, difficulty, cpuBatch);
                }

                if (result.nonce !== null) {
                    // Safety net: re-verify GPU results with SubtleCrypto
                    // before submitting. Guards against any shader bug
                    // producing difficulty-meeting but invalid digests.
                    if (useGPU && !gpuInitFailed) {
                        const verifyInput = uuid + ":" + salt + ":" + result.nonce;
                        const verifyDigest = await crypto.subtle.digest(
                            "SHA-256", encoder.encode(verifyInput)
                        );
                        const verifyBytes = new Uint8Array(verifyDigest);
                        let verifyHex = "";
                        for (let j = 0; j < verifyBytes.length; j++) {
                            verifyHex += hexChars[verifyBytes[j] >> 4] + hexChars[verifyBytes[j] & 0xf];
                        }
                        if (verifyHex !== result.hash) {
                            console.warn(
                                "[G4FCakeBaker] GPU hash mismatch, discarding result" +
                                " nonce=" + result.nonce +
                                " gpu=" + result.hash.slice(0, 16) +
                                " real=" + verifyHex.slice(0, 16)
                            );
                            scanned += result.processed;
                            nonce += result.processed;
                            continue;
                        }
                    }
                    const elapsed = (performance.now() - startedAt) / 1000;
                    const rate = scanned > 0 ? (scanned / elapsed).toFixed(0) : "?";
                    console.log(
                        "%c[G4FCakeBaker] hash found%c " +
                        "worker=" + workerId + " nonce=" + result.nonce +
                        " hash=" + result.hash.slice(0, 16) + "\\u2026" +
                        " scanned=" + scanned + " rate=" + rate + " h/s" +
                        (useGPU ? " [GPU]" : " [CPU]") +
                        " elapsed=" + elapsed.toFixed(2) + "s",
                        "color:#4ade80;font-weight:bold", "color:inherit"
                    );
                    self.postMessage({
                        uuid, salt, nonce: result.nonce, hash: result.hash,
                        ok: true, workerId,
                    });
                    break;
                }

                scanned += result.processed;
                nonce += result.processed;

                const now = performance.now();
                const dt = (now - lastLogAt) / 1000;
                if (dt >= 2) {
                    const rate = ((scanned - lastScanned) / dt).toFixed(0);
                    self.postMessage({ type: "progress", nonce, workerId, scanned, rate: Number(rate) });
                    lastLogAt = now;
                    lastScanned = scanned;
                }
            }
        };
    `;

    // Web Worker for hashing ----------------------------------------------
    // Uses the browser's native, hardware-accelerated crypto.subtle.digest
    // (10-50x faster than a pure-JS SHA-256) and processes many nonces per
    // async tick to amortize the promise overhead. Each worker runs on its
    // own thread, so we spawn several (one per logical core) for parallelism.
    const WORKER_SOURCE = `
        const encoder = new TextEncoder();
        const hexChars = "0123456789abcdef";

        // Convert an ArrayBuffer to a lowercase hex string without per-byte
        // string concatenation (faster than map+padStart).
        function toHex(buf) {
            const bytes = new Uint8Array(buf);
            let out = "";
            for (let i = 0; i < bytes.length; i++) {
                out += hexChars[bytes[i] >> 4] + hexChars[bytes[i] & 0x0f];
            }
            return out;
        }

        // Count leading zero bits in a hex digest (matches the server's check).
        function leadingZeroBits(hex) {
            let bits = 0;
            for (let i = 0; i < hex.length; i++) {
                const nibble = hex.charCodeAt(i);
                if (nibble === 48) { // '0'
                    bits += 4;
                } else {
                    bits += Math.clz32(nibble - (nibble <= 57 ? 48 : 87)) - 28;
                    break;
                }
            }
            return bits;
        }

        self.onmessage = async function (e) {
            const { uuid, salt, difficulty, workerId } = e.data;
            // Each worker bakes its own UUID starting at nonce 0.
            let nonce = 0;
            const batchSize = 2048; // nonces per async tick
            let scanned = 0;
            const startTime = Date.now();
            const startedAt = performance.now();
            let lastLogAt = startedAt;
            let lastScanned = 0;

            while (true) {
                let found = false;
                // Hash a batch of nonces in parallel using native SubtleCrypto.
                const promises = new Array(batchSize);
                for (let i = 0; i < batchSize; i++) {
                    const input = uuid + ":" + salt + ":" + nonce;
                    promises[i] = crypto.subtle.digest("SHA-256", encoder.encode(input));
                    nonce += 1;
                }
                const digests = await Promise.all(promises);
                for (let i = 0; i < batchSize; i++) {
                    const hex = toHex(digests[i]);
                    if (leadingZeroBits(hex) >= difficulty) {
                        const foundNonce = nonce - batchSize + i;
                        const elapsed = (performance.now() - startedAt) / 1000;
                        const rate = scanned > 0 ? (scanned / elapsed).toFixed(0) : "?";
                        console.log(
                            "%c[G4FCakeBaker] hash found%c " +
                            "worker=" + workerId + " nonce=" + foundNonce +
                            " zeros=" + leadingZeroBits(hex) + "/" + difficulty +
                            " hash=" + hex.slice(0, 16) + "\u2026" +
                            " scanned=" + scanned + " rate=" + rate + " h/s" +
                            " elapsed=" + elapsed.toFixed(2) + "s",
                            "color:#4ade80;font-weight:bold", "color:inherit"
                        );
                        self.postMessage({
                            uuid, salt, nonce: foundNonce, hash: hex,
                            ok: true, workerId,
                        });
                        found = true;
                        break;
                    }
                }
                if (found) break;
                scanned += batchSize;
                // yield to keep the worker thread responsive and report progress
                if (scanned % 16384 === 0) {
                    const now = performance.now();
                    const dt = (now - lastLogAt) / 1000;
                    if (dt >= 2) {
                        const rate = ((scanned - lastScanned) / dt).toFixed(0);
                        console.log(
                            "%c[G4FCakeBaker] hashing%c " +
                            "worker=" + workerId + " scanned=" + scanned +
                            " rate=" + rate + " h/s" +
                            " difficulty=" + difficulty,
                            "color:#60a5fa", "color:inherit"
                        );
                        lastLogAt = now;
                        lastScanned = scanned;
                        self.postMessage({ type: "progress", nonce, workerId, scanned, rate: Number(rate) });
                    } else {
                        self.postMessage({ type: "progress", nonce, workerId, scanned });
                    }
                }
            }
        };
    `;

    // Parallel hashing workers are now user-configurable via the control
    // panel (settings.workers), bounded by MAX_WORKERS/DEFAULT_WORKERS
    // defined in the settings section above.

    function createWorker(workerId) {
        const source = state.gpuMode ? GPU_WORKER_SOURCE : WORKER_SOURCE;
        const blob = new Blob([source], { type: "application/javascript" });
        const url = URL.createObjectURL(blob);
        const w = new Worker(url);
        w.workerId = workerId;
        w.busy = false;
        w.busyAt = 0;   // timestamp when the worker was last handed a UUID
        w.idleAt = 0;   // timestamp when it last finished its job
        w.onmessage = (e) => {
            const data = e.data;
            if (data.type === "gpu-ready") {
                state.gpuName = data.gpuName || "GPU";
                console.log(
                    "%c[G4FCakeBaker] GPU ready%c " + state.gpuName,
                    "color:#a78bfa;font-weight:bold", "color:inherit"
                );
                updatePanelStatus();
                return;
            }
            if (data.type === "gpu-failed") {
                console.warn("[G4FCakeBaker] GPU init failed:", data.error);
                state.gpuInitError = data.error;
                // Auto-fallback to CPU mode for this worker
                if (state.gpuMode) {
                    console.info("[G4FCakeBaker] Falling back to CPU workers");
                    state.gpuMode = false;
                    syncControlPanel();
                }
                return;
            }
            if (data.type === "progress") {
                // periodically refresh lock so other tabs don't take over
                refreshLock();
                if (typeof data.rate === "number" && data.rate > 0) {
                    state.workerRates[data.workerId] = data.rate;
                }
                console.log(
                    "%c[G4FCakeBaker] hashing%c " +
                    "worker=" + data.workerId + " scanned=" + data.scanned +
                    " rate=" + (data.rate ? (data.rate / 1000).toFixed(1) + "k h/s" : "?") +
                    " nonce=" + data.nonce,
                    "color:#60a5fa;font-weight:bold", "color:inherit"
                );
                return;
            }
            if (data.type === "request") {
                // worker finished its UUID and is asking for more work
                w.busy = false;
                w.idleAt = Date.now();
                state.inFlight = Math.max(0, state.inFlight - 1);
                bakeNext();
                return;
            }
            if (data.ok) {
                w.busy = false;
                w.idleAt = Date.now();
                state.inFlight = Math.max(0, state.inFlight - 1);
                state.baked += 1;
                console.log(
                    "%c[G4FCakeBaker] baked%c " +
                    "worker=" + data.workerId + " nonce=" + data.nonce +
                    " hash=" + (data.hash || "").slice(0, 24) + "\u2026" +
                    " baked=" + state.baked + " inFlight=" + state.inFlight,
                    "color:#4ade80;font-weight:bold", "color:inherit"
                );
                submitCake(data);
                // dispatch more work to this (now idle) worker and others
                bakeNext();
            }
        };
        w.onerror = (err) => {
            console.warn("[G4FCakeBaker] worker error", err);
            w.busy = false;
            w.idleAt = Date.now();
            state.inFlight = Math.max(0, state.inFlight - 1);
            // fallback: retry after delay
            setTimeout(bakeNext, 5000);
        };
        return w;
    }

    // Aggregate per-worker hash rates into a single h/s figure and render
    // it into the chat's #input-count element (the token-count display).
    // When the baker is idle or stopped, the element is cleared so the
    // normal token/word count can take over.
    function formatHashRate(hps) {
        if (!hps || hps <= 0) return null;
        if (hps >= 1e6) return (hps / 1e6).toFixed(2) + "M h/s";
        if (hps >= 1e3) return (hps / 1e3).toFixed(1) + "k h/s";
        return Math.round(hps) + " h/s";
    }

    // Effective throughput over a rolling window. The raw per-worker h/s
    // measures how fast a worker hashes *while it has work*, but the baker
    // idles between UUID batches (throttle + adaptive backoff), so the raw
    // number stays flat no matter how high the throttle is set. Scaling by
    // the duty cycle — the fraction of the window the workers were actually
    // hashing — makes the displayed h/s drop as the throttle is raised.
    const RATE_WINDOW_MS = 10000;
    function effectiveHashRate() {
        const workers = state.workers || [];
        if (!workers.length) return 0;
        const now = Date.now();
        const start = now - RATE_WINDOW_MS;
        let total = 0;
        for (const w of workers) {
            // Active time within the window: from dispatch (busyAt) until
            // either now (still hashing) or completion (idleAt).
            let activeMs;
            if (w.busy && w.busyAt) {
                activeMs = now - Math.max(w.busyAt, start);
            } else if (w.busyAt && w.idleAt) {
                activeMs = Math.max(0, Math.min(w.idleAt, now) - Math.max(w.busyAt, start));
            } else {
                activeMs = 0; // fresh worker, never handed a UUID yet
            }
            const duty = Math.min(1, activeMs / RATE_WINDOW_MS);
            total += (state.workerRates[w.workerId] || 0) * duty;
        }
        return total;
    }

    function updateHashRate() {
        // Sum the last-reported h/s of every *live* worker only, so rates
        // from terminated or re-spawned workers never leak into the total,
        // then scale by the duty cycle so throttle pauses are reflected.
        state.hashRate = effectiveHashRate();
        updatePanelStatus();
    }

    // Detect WebGPU availability in the main thread. Workers will also
    // attempt their own init; this just controls whether we spawn GPU or
    // CPU workers and what the UI shows.
    async function detectGPU() {
        if (state.gpuSupported) return true;
        try {
            if (!navigator.gpu) {
                state.gpuSupported = false;
                return false;
            }
            const adapter = await navigator.gpu.requestAdapter({
                powerPreference: "high-performance",
            });
            if (adapter) {
                state.gpuSupported = true;
                state.gpuName = adapter.info?.description || "GPU";
                console.info("[G4FCakeBaker] WebGPU detected:", state.gpuName);
                return true;
            }
        } catch (err) {
            console.info("[G4FCakeBaker] WebGPU detection failed:", err);
        }
        state.gpuSupported = false;
        return false;
    }

    // Lazily create the worker pool (shared across all UUIDs), sized to the
    // user's configured worker count.
    function ensureWorkers() {
        resizeWorkers(settings.workers);
        return state.workers;
    }

    // Grow or shrink the pool to match the configured count. When a busy
    // worker is terminated its in-flight slot is released so the dispatch
    // loop doesn't stall waiting for a message that will never arrive.
    function resizeWorkers(count) {
        count = clampInt(count, 1, MAX_WORKERS, DEFAULT_WORKERS);
        settings.workers = count;
        if (!state.workers) state.workers = [];
        while (state.workers.length < count) {
            state.workers.push(createWorker(state.workers.length));
        }
        while (state.workers.length > count) {
            const w = state.workers.pop();
            if (w.busy) state.inFlight = Math.max(0, state.inFlight - 1);
            try {
                w.terminate();
            } catch (err) {
                /* already dead */
            }
            delete state.workerRates[w.workerId];
        }
        return state.workers;
    }

    // Build auth headers (sends the user's JWT when available so baked
    // cakes are credited to the authenticated account, not just the IP).
    function authHeaders(extra = {}) {
        const headers = { ...extra };
        const token =
            storageGet("g4f_session") ||
            storageGet("g4f_token") ||
            storageGet("jwt");
        if (token) headers["Authorization"] = `Bearer ${token}`;
        return headers;
    }

    // Fetch UUIDs from server --------------------------------------------
    async function fetchBatch() {
        try {
            const res = await fetch(`${CAKE_ENDPOINT}/issue?n=${BATCH_SIZE}`, {
                credentials: "include",
                headers: authHeaders(),
            });
            if (!res.ok) {
                // The server returns 429 with Retry-After once the per-IP
                // daily cake limit is reached. Stop hammering /cake/issue
                // every poll cycle — schedule a single retry after the
                // server's hint (default 1h) and idle the baker meanwhile.
                if (res.status === 429) {
                    const retryAfter = Number(res.headers.get("Retry-After")) || 3600;
                    state.dailyLimitReached = true;
                    state.dailyLimitRetryAt = Date.now() + retryAfter * 1000;
                    console.info(
                        `[G4FCakeBaker] daily limit reached; retrying in ${retryAfter}s`
                    );
                    updatePanelStatus();
                } else {
                    console.warn("[G4FCakeBaker] issue failed", res.status);
                }
                return false;
            }
            // A successful issue clears any prior daily-limit backoff.
            state.dailyLimitReached = false;
            state.dailyLimitRetryAt = 0;
            updatePanelStatus();
            const data = await res.json();
            if (data.difficulty) state.difficulty = data.difficulty;
            if (data.salt) state.salt = data.salt;
            if (typeof data.baked_today === "number") state.dailyBaked = data.baked_today;
            if (typeof data.limit_per_day === "number") state.limitPerDay = data.limit_per_day;
            if (data.uuids && data.uuids.length) {
                state.queue.push(...data.uuids);
            }
            updatePanelStatus();
            return true;
        } catch (err) {
            console.warn("[G4FCakeBaker] issue error", err);
            return false;
        }
    }

    // Read fresh status from /cake/status --------------------------------
    // Called after each accepted bake so the UI reflects the authoritative
    // server-side credit + daily-baked counters on every bake cycle. The
    // result is broadcast to all other tabs via publishStatus().
    async function fetchStatus() {
        try {
            const res = await fetch(`${CAKE_ENDPOINT}/status`, {
                credentials: "include",
                headers: authHeaders(),
            });
            if (!res.ok) return null;
            const data = await res.json();
            if (typeof data.credit_cents === "number") state.credits = data.credit_cents;
            if (typeof data.baked_today === "number") state.dailyBaked = data.baked_today;
            if (typeof data.limit_per_day === "number") state.limitPerDay = data.limit_per_day;
            updatePanelStatus();
            publishStatus();
            return data;
        } catch (err) {
            console.warn("[G4FCakeBaker] status error", err);
            return null;
        }
    }

    // Submit a baked cake -------------------------------------------------
    async function submitCake(cake) {
        state.submitted += 1;
        try {
            let user = {};
            try {
                user = JSON.parse(storageGet("g4f_user") || "{}");
            } catch (err) {
                console.warn("[G4FCakeBaker] parse user error", err);
            }
            const res = await fetch(`${CAKE_ENDPOINT}/bake`, {
                method: "POST",
                credentials: "include",
                headers: authHeaders({
                    "Content-Type": "application/json",
                    "X-User": user.username || user.id,
                }),
                body: JSON.stringify({
                    uuid: cake.uuid,
                    salt: cake.salt,
                    nonce: cake.nonce,
                    hash: cake.hash,
                }),
            });
            const data = await res.json();
            if (res.ok && data.ok) {
                state.accepted += 1;
                state.credits += data.credit || 5; // in cents (0.05¢ = 5 hundredths)
                if (data.difficulty) state.difficulty = data.difficulty;
                if (data.salt) state.salt = data.salt;

                if (typeof data.baked_today === "number") state.dailyBaked = data.baked_today;
                if (typeof data.limit_per_day === "number") state.limitPerDay = data.limit_per_day;

                console.log(
                    "%c[G4FCakeBaker] accepted%c " +
                    "credit=" + (data.credit ?? 5) +
                    " total=" + (data.total_credits ?? "?") +
                    " accepted=" + state.accepted + " credits=" + state.credits,
                    "color:#22c55e;font-weight:bold", "color:inherit"
                );
                // Read authoritative status on each bake so the UI credits
                // counter stays in sync with the server.
                const status = await fetchStatus();
                // notify UI with fresh status (fallback to bake response)
                window.dispatchEvent(new CustomEvent("g4f:cake:accepted", {
                    detail: {
                        credit: data.credit,
                        total: status ? status.credit_cents : data.total_credits,
                        baked_today: status ? status.baked_today : data.baked_today,
                    },
                }));
            } else if (data.rotate) {
                // salt rotated; re-fetch
                if (data.salt) state.salt = data.salt;
                if (data.difficulty) state.difficulty = data.difficulty;
                console.log(
                    "%c[G4FCakeBaker] rotated%c " +
                    "salt changed, re-fetching difficulty=" + state.difficulty,
                    "color:#f59e0b;font-weight:bold", "color:inherit"
                );
            } else {
                console.warn(
                    "%c[G4FCakeBaker] rejected%c " +
                    "status=" + res.status + " reason=" + (data.error || JSON.stringify(data)),
                    "color:#ef4444;font-weight:bold", "color:inherit"
                );
            }
        } catch (err) {
            console.warn("[G4FCakeBaker] submit error", err);
        }
    }

    // Dispatch UUIDs from the queue to idle workers in parallel. Each worker
    // bakes one UUID at a time; when it finishes it asks for more work via a
    // { type: "request" } message, which calls back into this function.
    function bakeNext() {
        if (!state.running) return;
        const pool = ensureWorkers();
        // Refill the queue when it runs low.
        if (state.queue.length === 0) {
            if (state.inFlight === 0 && !state.timer) {
                // When the server has told us the daily limit is reached,
                // don't poll on the short adaptive interval — wait until the
                // server's Retry-After elapses before asking for more work.
                let delay = computePollInterval();
                if (state.dailyLimitReached && state.dailyLimitRetryAt) {
                    delay = Math.max(delay, state.dailyLimitRetryAt - Date.now());
                    if (delay <= 0) {
                        // Retry-After elapsed — clear the flag and let the
                        // next fetchBatch re-arm it if still limited.
                        state.dailyLimitReached = false;
                        state.dailyLimitRetryAt = 0;
                        updatePanelStatus();
                        delay = computePollInterval();
                    }
                }
                state.timer = setTimeout(async () => {
                    state.timer = null;
                    await fetchBatch();
                    bakeNext();
                }, delay);
            }
            return;
        }
        // Hand a UUID to every idle worker.
        for (const w of pool) {
            if (w.busy) continue;
            if (state.queue.length === 0) break;
            const uuid = state.queue.shift();
            w.busy = true;
            w.busyAt = Date.now();
            w.idleAt = 0;
            state.inFlight += 1;
            w.postMessage({
                uuid,
                salt: state.salt || "g4f-default-salt",
                difficulty: state.difficulty || 4,
                workerId: w.workerId,
                useGPU: state.gpuMode,
                batchSize: state.gpuMode ? 65536 : 2048,
            });
        }
    }

    // Settings controls ---------------------------------------------------
    function setWorkers(count) {
        resizeWorkers(count);
        saveSettings();
        syncControlPanel();
        bakeNext(); // dispatch queued UUIDs to any newly spawned workers
    }

    function setGPUMode(on) {
        if (on && !state.gpuSupported) {
            console.warn("[G4FCakeBaker] GPU mode requested but WebGPU not available");
            return;
        }
        const changed = state.gpuMode !== !!on;
        state.gpuMode = !!on;
        settings.useGPU = state.gpuMode;
        saveSettings();
        if (changed && state.workers && state.workers.length) {
            // Recreate workers with the new source (GPU vs CPU)
            const oldCount = state.workers.length;
            for (const w of state.workers) {
                if (w.busy) state.inFlight = Math.max(0, state.inFlight - 1);
                try { w.terminate(); } catch (err) { /* dead */ }
            }
            state.workers = [];
            state.workerRates = {};
            resizeWorkers(oldCount);
        }
        syncControlPanel();
        bakeNext();
    }

    function setThrottle(ms) {
        settings.throttleMs = clampInt(ms, 0, THROTTLE_MAX_MS, POLL_INTERVAL_MS);
        saveSettings();
        syncControlPanel();
    }

    function setEnabled(on) {
        settings.enabled = !!on;
        saveSettings();
        if (settings.enabled) {
            start();
        } else {
            stop();
        }
        syncControlPanel();
    }

    function getSettings() {
        return {
            enabled: settings.enabled,
            workers: settings.workers,
            throttleMs: settings.throttleMs,
            useGPU: state.gpuMode,
            gpuSupported: state.gpuSupported,
            gpuName: state.gpuName,
        };
    }

    // Control panel UI ----------------------------------------------------
    // Small floating widget injected into the page so the user can pause
    // baking, pick how many workers to run, and set a manual throttle.
    let panelEl = null;
    const PANEL_CSS = `
        #g4f-cake-panel {
            position: fixed; right: 16px; bottom: 16px; z-index: 2147483000;
            font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
            color-scheme: dark;
        }
        #g4f-cake-panel .g4f-cake-card {
            width: 224px; padding: 10px 12px;
            background: rgba(15, 17, 23, 0.95);
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 12px; color: #e5e7eb;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
            backdrop-filter: blur(8px);
            user-select: none;
            transition: border-radius 0.2s, padding 0.2s, width 0.2s;
        }
        #g4f-cake-panel.g4f-cake-dragging .g4f-cake-card {
            transition: none; opacity: 0.9;
        }
        #g4f-cake-panel .g4f-cake-head {
            display: flex; align-items: center; justify-content: space-between;
            margin-bottom: 8px;
            cursor: grab;
            touch-action: none;          /* drag on touch instead of scrolling */
            -webkit-user-select: none; user-select: none;
        }
        #g4f-cake-panel.g4f-cake-dragging .g4f-cake-head { cursor: grabbing; }
        #g4f-cake-panel .g4f-cake-title {
            font-weight: 600; font-size: 11px; letter-spacing: 0.06em;
            text-transform: uppercase; color: #9ca3af;
        }
        #g4f-cake-panel .g4f-cake-toggle {
            border: 0; border-radius: 999px; padding: 3px 12px;
            font-size: 11px; font-weight: 700; cursor: pointer;
            letter-spacing: 0.04em; transition: background 0.15s, color 0.15s;
        }
        #g4f-cake-panel .g4f-cake-toggle.on {
            background: rgba(34, 197, 94, 0.18); color: #4ade80;
        }
        #g4f-cake-panel .g4f-cake-toggle.off {
            background: rgba(239, 68, 68, 0.18); color: #f87171;
        }
        #g4f-cake-panel .g4f-cake-row { margin: 7px 0; }
        #g4f-cake-panel .g4f-cake-row label {
            display: flex; align-items: center; justify-content: space-between;
            font-size: 11px; color: #d1d5db; margin-bottom: 3px;
        }
        #g4f-cake-panel .g4f-cake-val {
            font-variant-numeric: tabular-nums; color: #a1a1aa;
            font-size: 10px; background: rgba(255, 255, 255, 0.06);
            border-radius: 4px; padding: 1px 5px;
        }
        #g4f-cake-panel input[type="range"] {
            width: 100%; height: 4px; margin: 0; cursor: pointer;
            accent-color: #22c55e;
        }
        #g4f-cake-panel .g4f-cake-status {
            font-size: 10px; color: #6b7280; margin-top: 8px;
            display: flex; justify-content: space-between; gap: 6px;
            overflow: hidden; white-space: nowrap;
        }
        /* Daily limit banner — shown while the server returns 429 */
        #g4f-cake-panel .g4f-cake-limit {
            display: flex; align-items: center; gap: 6px;
            margin-top: 8px; padding: 5px 8px;
            font-size: 10px; line-height: 1.35; color: #fbbf24;
            background: rgba(251, 191, 36, 0.1);
            border: 1px solid rgba(251, 191, 36, 0.3);
            border-radius: 6px;
            overflow: hidden;
        }
        #g4f-cake-panel .g4f-cake-limit[hidden] { display: none; }
        #g4f-cake-panel .g4f-cake-limit-icon { flex: 0 0 auto; }
        #g4f-cake-panel.minimized .g4f-cake-limit { display: none; }
        /* Minimized pill — collapsed when baking is off */
        #g4f-cake-panel.minimized .g4f-cake-card {
            width: auto; min-width: 0; padding: 5px 10px;
            border-radius: 999px;
            transition: border-radius 0.2s, padding 0.2s, width 0.2s;
        }
        #g4f-cake-panel.minimized .g4f-cake-head { margin-bottom: 0; }
        #g4f-cake-panel.minimized .g4f-cake-row,
        #g4f-cake-panel.minimized .g4f-cake-status { display: none; }
        /* GPU toggle row */
        #g4f-cake-panel .g4f-cake-gpu-row {
            display: flex; align-items: center; justify-content: space-between;
            margin: 7px 0; padding: 5px 8px;
            font-size: 11px; color: #d1d5db;
            background: rgba(167, 139, 250, 0.08);
            border: 1px solid rgba(167, 139, 250, 0.2);
            border-radius: 6px;
        }
        #g4f-cake-panel .g4f-cake-gpu-row.disabled {
            opacity: 0.5; cursor: not-allowed;
        }
        #g4f-cake-panel .g4f-cake-gpu-label {
            display: flex; align-items: center; gap: 5px;
        }
        #g4f-cake-panel .g4f-cake-gpu-badge {
            font-size: 9px; font-weight: 700; padding: 1px 5px;
            border-radius: 4px; letter-spacing: 0.04em;
        }
        #g4f-cake-panel .g4f-cake-gpu-badge.on {
            background: rgba(167, 139, 250, 0.25); color: #a78bfa;
        }
        #g4f-cake-panel .g4f-cake-gpu-badge.off {
            background: rgba(156, 163, 175, 0.15); color: #9ca3af;
        }
        #g4f-cake-panel .g4f-cake-gpu-badge.na {
            background: rgba(239, 68, 68, 0.15); color: #f87171;
        }
        #g4f-cake-panel .g4f-cake-gpu-switch {
            position: relative; width: 32px; height: 18px;
            background: rgba(255, 255, 255, 0.12); border-radius: 999px;
            cursor: pointer; transition: background 0.15s; flex-shrink: 0;
        }
        #g4f-cake-panel .g4f-cake-gpu-switch.on {
            background: rgba(167, 139, 250, 0.4);
        }
        #g4f-cake-panel .g4f-cake-gpu-switch::after {
            content: ""; position: absolute; top: 2px; left: 2px;
            width: 14px; height: 14px; border-radius: 50%;
            background: #e5e7eb; transition: transform 0.15s;
        }
        #g4f-cake-panel .g4f-cake-gpu-switch.on::after {
            transform: translateX(14px); background: #a78bfa;
        }
        #g4f-cake-panel.minimized .g4f-cake-gpu-row { display: none; }
    `;

    function ensureControlPanel() {
        if (panelEl && panelEl.isConnected) return panelEl;
        if (document.getElementById("g4f-cake-panel")) {
            panelEl = document.getElementById("g4f-cake-panel");
            if (settings.pos) applyPanelPosition(settings.pos.x, settings.pos.y);
            makePanelDraggable();
            return panelEl;
        }
        const style = document.createElement("style");
        style.textContent = PANEL_CSS;
        document.head.appendChild(style);

        panelEl = document.createElement("div");
        panelEl.id = "g4f-cake-panel";
        panelEl.innerHTML = `
            <div class="g4f-cake-card">
                <div class="g4f-cake-head">
                    <span class="g4f-cake-title">Cake Baker</span>
                    <button class="g4f-cake-toggle" type="button">ON</button>
                </div>
                <div class="g4f-cake-row">
                    <label>Workers <span class="g4f-cake-val" data-role="workers-val"></span></label>
                    <input type="range" data-role="workers" min="1" max="${MAX_WORKERS}" step="1">
                </div>
                <div class="g4f-cake-row">
                    <label>Throttle <span class="g4f-cake-val" data-role="throttle-val"></span></label>
                    <input type="range" data-role="throttle" min="0" max="${THROTTLE_MAX_MS / 1000}" step="1">
                </div>
                <div class="g4f-cake-gpu-row" data-role="gpu-row">
                    <span class="g4f-cake-gpu-label">
                        GPU
                        <span class="g4f-cake-gpu-badge off" data-role="gpu-badge">CPU</span>
                    </span>
                    <div class="g4f-cake-gpu-switch" data-role="gpu-switch"></div>
                </div>
                <div class="g4f-cake-status">
                    <span data-role="status-state"></span>
                    <span data-role="status-rate"></span>
                </div>
                <div class="g4f-cake-limit" data-role="daily-limit" hidden>
                    <span class="g4f-cake-limit-icon">⚠</span>
                    <span data-role="daily-limit-text"></span>
                </div>
            </div>`;
        document.body.appendChild(panelEl);

        const toggle = panelEl.querySelector(".g4f-cake-toggle");
        const workersSlider = panelEl.querySelector('input[data-role="workers"]');
        const throttleSlider = panelEl.querySelector('input[data-role="throttle"]');

        toggle.addEventListener("click", () => setEnabled(!settings.enabled));
        // Apply the worker count on release; just preview the value while
        // dragging so we don't spawn/terminate threads on every tick.
        workersSlider.addEventListener("input", () => {
            const val = panelEl.querySelector('[data-role="workers-val"]');
            if (val) val.textContent = workersSlider.value + "×";
        });
        workersSlider.addEventListener("change", () => {
            setWorkers(parseInt(workersSlider.value, 10) || 1);
        });
        throttleSlider.addEventListener("input", () => {
            const secs = parseInt(throttleSlider.value, 10) || 0;
            const val = panelEl.querySelector('[data-role="throttle-val"]');
            if (val) val.textContent = secs + "s";
            setThrottle(secs * 1000);
        });

        // GPU toggle switch
        const gpuSwitch = panelEl.querySelector('[data-role="gpu-switch"]');
        if (gpuSwitch) {
            gpuSwitch.addEventListener("click", () => {
                if (!state.gpuSupported) return;
                setGPUMode(!state.gpuMode);
            });
        }

        // Restore a previously dragged position (default is bottom-right).
        if (settings.pos) {
            applyPanelPosition(settings.pos.x, settings.pos.y);
        }
        makePanelDraggable();

        syncControlPanel();
        return panelEl;
    }

    // Drag and drop --------------------------------------------------------
    // The whole header is the grab handle (the ON/OFF toggle is excluded).
    // Pointer Events unify mouse and touch so the same code works on
    // desktops and phones; touch-action: none on the head stops the page
    // from scrolling/zooming while dragging.
    let dragState = null;

    function applyPanelPosition(x, y) {
        if (!panelEl) return;
        panelEl.style.right = "auto";
        panelEl.style.bottom = "auto";
        panelEl.style.left = Math.round(x) + "px";
        panelEl.style.top = Math.round(y) + "px";
    }

    function clampPanelPos(x, y) {
        if (!panelEl) return { x, y };
        const w = panelEl.offsetWidth;
        const h = panelEl.offsetHeight;
        const margin = 8;
        const maxX = Math.max(margin, window.innerWidth - w - margin);
        const maxY = Math.max(margin, window.innerHeight - h - margin);
        return {
            x: Math.min(Math.max(x, margin), maxX),
            y: Math.min(Math.max(y, margin), maxY),
        };
    }

    function savePanelPos() {
        if (!panelEl) return;
        const rect = panelEl.getBoundingClientRect();
        const pos = clampPanelPos(rect.left, rect.top);
        applyPanelPosition(pos.x, pos.y);
        settings.pos = pos;
        saveSettings();
    }

    function onPanelPointerDown(e) {
        // Left button / any touch; ignore the ON/OFF toggle and inputs.
        if (typeof e.button === "number" && e.button !== 0) return;
        if (e.target.closest(".g4f-cake-toggle")) return;
        if (e.target.closest("input, select, textarea, a, button")) return;
        const rect = panelEl.getBoundingClientRect();
        applyPanelPosition(rect.left, rect.top);
        dragState = {
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            left: rect.left,
            top: rect.top,
        };
        panelEl.classList.add("g4f-cake-dragging");
        try { panelEl.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        e.preventDefault();
    }

    function onPanelPointerMove(e) {
        if (!dragState || e.pointerId !== dragState.pointerId) return;
        const pos = clampPanelPos(
            dragState.left + (e.clientX - dragState.startX),
            dragState.top + (e.clientY - dragState.startY)
        );
        applyPanelPosition(pos.x, pos.y);
        e.preventDefault();
    }

    function onPanelPointerUp(e) {
        if (!dragState || e.pointerId !== dragState.pointerId) return;
        panelEl.classList.remove("g4f-cake-dragging");
        try { panelEl.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        dragState = null;
        savePanelPos();
    }

    function makePanelDraggable() {
        if (!panelEl || panelEl.dataset.dragReady) return;
        panelEl.dataset.dragReady = "1";
        const head = panelEl.querySelector(".g4f-cake-head");
        if (!head) return;
        head.addEventListener("pointerdown", onPanelPointerDown);
        // move/up on the window so the drag keeps tracking even if the
        // pointer leaves the small panel (pointer capture makes this work
        // even when the events are retargeted to the panel element).
        window.addEventListener("pointermove", onPanelPointerMove);
        window.addEventListener("pointerup", onPanelPointerUp);
        window.addEventListener("pointercancel", onPanelPointerUp);
        // Re-clamp after rotation/resize so the panel never ends up off-screen.
        window.addEventListener("resize", () => {
            if (panelEl && settings.pos) {
                const pos = clampPanelPos(settings.pos.x, settings.pos.y);
                applyPanelPosition(pos.x, pos.y);
                settings.pos = pos;
            }
        });
    }

    function syncControlPanel() {
        if (!panelEl) return;
        const toggle = panelEl.querySelector(".g4f-cake-toggle");
        const workersSlider = panelEl.querySelector('input[data-role="workers"]');
        const throttleSlider = panelEl.querySelector('input[data-role="throttle"]');
        const workersVal = panelEl.querySelector('[data-role="workers-val"]');
        const throttleVal = panelEl.querySelector('[data-role="throttle-val"]');

        // Collapse to a small pill while off; expand when re-enabled.
        panelEl.classList.toggle("minimized", !settings.enabled);

        if (toggle) {
            toggle.textContent = settings.enabled ? "ON" : "OFF";
            toggle.classList.toggle("on", settings.enabled);
            toggle.classList.toggle("off", !settings.enabled);
        }
        if (workersSlider) workersSlider.value = String(settings.workers);
        if (workersVal) workersVal.textContent = settings.workers + "×";
        if (throttleSlider) throttleSlider.value = String(Math.round(settings.throttleMs / 1000));
        if (throttleVal) throttleVal.textContent = Math.round(settings.throttleMs / 1000) + "s";

        // GPU toggle state
        const gpuSwitch = panelEl.querySelector('[data-role="gpu-switch"]');
        const gpuBadge = panelEl.querySelector('[data-role="gpu-badge"]');
        const gpuRow = panelEl.querySelector('[data-role="gpu-row"]');
        if (gpuSwitch) {
            gpuSwitch.classList.toggle("on", state.gpuMode);
        }
        if (gpuBadge) {
            gpuBadge.classList.remove("on", "off", "na");
            if (!state.gpuSupported) {
                gpuBadge.textContent = "N/A";
                gpuBadge.classList.add("na");
            } else if (state.gpuMode) {
                gpuBadge.textContent = state.gpuName ? state.gpuName.slice(0, 12) : "GPU";
                gpuBadge.classList.add("on");
            } else {
                gpuBadge.textContent = "CPU";
                gpuBadge.classList.add("off");
            }
        }
        if (gpuRow) {
            gpuRow.classList.toggle("disabled", !state.gpuSupported);
        }

        updatePanelStatus();
    }

    function updatePanelStatus() {
        if (!panelEl) return;
        const stateEl = panelEl.querySelector('[data-role="status-state"]');
        const rateEl = panelEl.querySelector('[data-role="status-rate"]');
        if (stateEl) {
            const mode = state.gpuMode ? "● baking [GPU]" : "● baking";
            stateEl.textContent = state.running ? mode : "○ idle";
        }
        if (rateEl) {
            rateEl.textContent = formatHashRate(state.hashRate) || "";
        }

        // Daily limit banner ------------------------------------------------
        const limitEl = panelEl.querySelector('[data-role="daily-limit"]');
        const limitText = panelEl.querySelector('[data-role="daily-limit-text"]');
        if (!limitEl || !limitText) return;
        if (state.running && state.dailyLimitReached && state.dailyLimitRetryAt) {
            const remaining = Math.max(
                0,
                Math.ceil((state.dailyLimitRetryAt - Date.now()) / 1000)
            );
            limitEl.hidden = false;
            if (remaining > 0) {
                const limit = state.limitPerDay || 0;
                const baked = state.dailyBaked || 0;
                const count = limit && baked ? ` (${baked}/${limit})` : "";
                limitText.textContent =
                    "Daily limit reached" + count + " — retry in " + fmtDuration(remaining);
            } else {
                limitText.textContent = "Daily limit reached — waiting for server…";
            }
        } else {
            limitEl.hidden = true;
        }
    }

    // "5m 03s" style countdown helper.
    function fmtDuration(totalSeconds) {
        const m = Math.floor(totalSeconds / 60);
        const s = Math.round(totalSeconds % 60);
        if (m >= 60) {
            const h = Math.floor(m / 60);
            return `${h}h ${String(m % 60).padStart(2, "0")}m`;
        }
        if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
        return `${s}s`;
    }

    // Public API ----------------------------------------------------------
    function start() {
        if (state.running) return;
        if (!acquireLock()) {
            // another tab is already baking; retry in 30s
            setTimeout(start, 30000);
            return;
        }
        state.running = true;
        const saved = loadState();
        state.baked = 0;
        state.submitted = 0;
        state.accepted = 0;
        state.credits = 0;
        // initial fetch then bake
        fetchBatch().then(() => bakeNext());
        // lock refresh interval
        state.lockInterval = setInterval(refreshLock, 10000);
        // refresh the #input-count hash-rate display every 2s
        if (!state.rateTimer) {
            state.rateTimer = setInterval(updateHashRate, 2000);
            updateHashRate();
        }
        // persist on unload
        window.addEventListener("beforeunload", () => {
            saveState();
            storageRemove(HEARTBEAT_KEY);
        });
        // persist periodically
        setInterval(saveState, 60000);
        console.info("[G4FCakeBaker] started — baking cakes in background");
    }

    function stop() {
        state.running = false;
        if (state.timer) {
            clearTimeout(state.timer);
            state.timer = null;
        }
        if (state.lockInterval) {
            clearInterval(state.lockInterval);
            state.lockInterval = null;
        }
        if (state.rateTimer) {
            clearInterval(state.rateTimer);
            state.rateTimer = null;
        }
        state.workerRates = {};
        state.hashRate = 0;
        updateHashRate();
        if (state.workers && state.workers.length) {
            for (const w of state.workers) w.terminate();
            state.workers = [];
        }
        state.inFlight = 0;
        state.gpuInitError = "";
        storageRemove(HEARTBEAT_KEY);
        saveState();
    }

    function status() {
        const saved = loadState();
        return {
            running: state.running,
            queue: state.queue.length,
            inFlight: state.inFlight || 0,
            workers: (state.workers || []).length,
            session: {
                baked: state.baked,
                submitted: state.submitted,
                accepted: state.accepted,
                credits: state.credits,
            },
            total: saved,
        };
    }

    window.G4FCakeBaker = { start, stop, status, setWorkers, setThrottle, setEnabled, setGPUMode, getSettings };

    // Auto-start on chat and members pages --------------------------------
    // Matches both the production routes (/chat, /members) and the local
    // dev server, which serves the chat GUI at "/" and members at
    // "/members.html". We also fall back to a feature-detection check
    // (presence of the chat app container) so the baker starts even on
    // pages served under unexpected paths.
    const path = window.location.pathname;
    const host = window.location.hostname;
    const isLocalDev = host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0";
    const pathMatch =
        path.startsWith("/chat/") ||
        path.startsWith("/playground/") ||
        path === "/members" ||
        path === "/members.html";
    // On the local dev server the chat GUI lives at "/" — start there too.
    const rootMatch = isLocalDev && (path === "/" || path === "/index.html");
    // Feature detection: the chat page mounts <main class="chat-container">
    // and the members page mounts <main class="main-container">. The
    // LLMPlayground SPA (llmplayground.net) mounts <div id="app-content">.
    // Only used as a fallback when the path alone doesn't match (e.g. local
    // dev at "/").
    const featureMatch = !!(
        document.querySelector("main.chat-container") ||
        document.querySelector("main.main-container") ||
        document.getElementById("chatBody") ||
        document.getElementById("statCredits") ||
        document.getElementById("app-content")
    );

    // Allow opting out via <body data-cake-baker="off">.
    const optedOut = document.body && document.body.dataset.cakeBaker === "off";

    const shouldAutoStart = !optedOut && (pathMatch || rootMatch || featureMatch);

    if (shouldAutoStart) {
        // wait for page load, then show the control panel and (unless the
        // user disabled baking) auto-start.
        const boot = async () => {
            ensureControlPanel();
            // Detect WebGPU and auto-enable if the user hasn't explicitly
            // turned it off before. GPU workers are 50-200x faster than
            // CPU SubtleCrypto workers on capable hardware.
            const hasGPU = await detectGPU();
            if (hasGPU && settings.useGPU !== false) {
                state.gpuMode = true;
            }
            syncControlPanel();
            if (settings.enabled) start();
            // If another tab is already baking, pull its latest status
            // snapshot so this tab's panel shows current credits without
            // fetching /cake/status itself.
            requestStatus();
        };
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", () => setTimeout(boot, 2000));
        } else {
            setTimeout(boot, 2000);
        }
    }
})();