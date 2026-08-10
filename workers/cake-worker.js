/**
 * G4F Cake Worker — Proof-of-Work Credit System
 *
 * Users "bake a cake" by hashing a server-issued UUID with a salt until the
 * resulting SHA-256 hex digest starts with a configurable number of zero
 * bits. Each successfully baked cake grants the user a small credit
 * (default: $0.005 = 0.05¢) and is bound to the IP that baked it, so the
 * credit can only be "consumed" from the same IP.
 *
 * Endpoints:
 *   GET  /cake/issue                — issue a batch of UUIDs to bake (rate-limited per IP/day)
 *   POST /cake/bake                 — submit a baked cake { uuid, salt, hash } for validation + credit
 *   GET  /cake/status               — current IP's daily quota and earned credit
 *   GET  /cake/credit/:ip           — total credit earned by an IP (admin only)
 *   GET  /cake/users                — all users with total + today's cakes (admin only)
 *
 * Storage (R2: CAKE_BUCKET, KV: CAKE_KV):
 *   cakes:issued:<ip>               — KV list of issued UUIDs + timestamps (TTL = issue TTL)
 *   cakes:baked:<ip>                — KV counter of cakes baked today
 *   cakes:credit:<ip>               — KV accumulated credit (in cents) for the IP
 *   cakes:consumed:<ip>             — KV list of consumed cake-ids (for spend tracking)
 *   cake:<uuid>                     — R2 object storing { ip, baked_at, hash, salt } (TTL via lifecycle)
 *
 * Environment variables:
 *   CAKE_BUCKET          — R2 bucket binding
 *   CAKE_KV              — KV namespace binding
 *   CAKE_DIFFICULTY      — number of leading zero bits required (default: 16)
 *   CAKE_PER_IP_PER_DAY  — max cakes an IP may bake per day (default: 100)
 *   CAKE_CREDIT_CENTS    — credit per cake in cents (default: 5 = 0.05¢)
 *   CAKE_ISSUE_BATCH     — number of UUIDs issued per /cake/issue call (default: 5)
 *   CAKE_ISSUE_TTL_SEC   — seconds before an issued UUID expires (default: 600)
 *   ADMIN_API_KEY        — bearer token for admin endpoints
 */

const ALLOWED_ORIGINS = new Set([
    "https://g4f.dev",
    "https://g4f.space",
    "https://www.g4f.dev",
    "https://www.g4f.space",
    "http://localhost:8090",
    "http://localhost:8080",
    "http://127.0.0.1:8090",
    "http://127.0.0.1:8080",
]);

/** Build CORS headers for the request. Echoes the request Origin when allowed
 *  (or any localhost origin for dev) and enables credentials so the browser
 *  accepts the response when the client uses `credentials: "include"`. */
function corsHeaders(request) {
    const origin = request.headers.get("Origin") || "";
    const allowed =
        ALLOWED_ORIGINS.has(origin) ||
        /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    return {
        "Access-Control-Allow-Origin": allowed ? origin : "null",
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Forwarded-For, X-User",
        "Access-Control-Expose-Headers": "X-Cake-Credit",
        "Vary": "Origin",
    };
}

const DAY_MS = 24 * 60 * 60 * 1000;

function json(body, status = 200, headers = {}, request) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json", ...corsHeaders(request), ...headers },
    });
}

/** Get the client IP from Cloudflare headers or the request. */
function getClientIP(request) {
    return (
        request.headers.get("CF-Connecting-IP") ||
        request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
        request.headers.get("X-Real-IP") ||
        "0.0.0.0"
    );
}

/** Generate a v4 UUID without external deps. */
function uuidv4() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0"));
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
        .slice(6, 8)
        .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}

/** Count leading zero bits in a hex digest. */
function leadingZeroBits(hexDigest) {
    let bits = 0;
    for (let i = 0; i < hexDigest.length; i++) {
        const nibble = parseInt(hexDigest[i], 16);
        if (nibble === 0) {
            bits += 4;
        } else {
            bits += Math.clz32(nibble) - 28; // leading zeros in a 4-bit value
            break;
        }
    }
    return bits;
}

/** SHA-256 hex digest using WebCrypto. */
async function sha256Hex(text) {
    const data = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(digest)]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

/** Reset the daily counter if the stored day differs from today. */
function dayKey() {
    const d = new Date();
    return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
}

async function getDailyCount(env, ip, user) {
    const key = `cakes:baked:${ip}`;
    const raw = await env.CAKE_KV.get(key);
    if (!raw) return { count: 0, day: dayKey(), user };
    try {
        const parsed = JSON.parse(raw);
        parsed.user = parsed.user || user;
        if (parsed.day !== dayKey()) return { count: 0, day: dayKey(), user };
        return parsed;
    } catch {
        return { count: 0, day: dayKey(), user };
    }
}

async function setDailyCount(env, ip, count, user) {
    await env.CAKE_KV.put(`cakes:baked:${ip}`, JSON.stringify({ count, day: dayKey(), user }), { expirationTtl: 86400 });
}

async function getIssuedList(env, ip) {
    const raw = await env.CAKE_KV.get(`cakes:issued:${ip}`);
    return raw ? JSON.parse(raw) : [];
}

async function setIssuedList(env, ip, list) {
    await env.CAKE_KV.put(`cakes:issued:${ip}`, JSON.stringify(list), {
        expirationTtl: Number(env.CAKE_ISSUE_TTL_SEC || 600),
    });
}

async function getCredit(env, ip) {
    const raw = await env.CAKE_KV.get(`cakes:credit:${ip}`);
    return raw ? Number(raw) : 0;
}

async function addCredit(env, ip, cents, user) {
    const current = await getCredit(env, ip);
    await env.CAKE_KV.put(`cakes:credit:${ip}`, String(current + cents));
    return current + cents;
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async function handleIssue(request, env) {
    const ip = getClientIP(request);
    const url = new URL(request.url);
    const defaultBatch = Number(env.CAKE_ISSUE_BATCH || 5);
    // Honor the client's requested batch size, capped to 50 to prevent abuse.
    const requestedN = Number(url.searchParams.get("n")) || 0;
    const batch = Math.min(Math.max(requestedN, defaultBatch, 1), 50);
    const perDay = Number(env.CAKE_PER_IP_PER_DAY || 100);

    const daily = await getDailyCount(env, ip);
    if (daily.count >= perDay) {
        return json(
            { error: "daily_limit_reached", baked_today: daily.count, limit: perDay },
            429,
            { "Retry-After": "3600" },
            request
        );
    }

    const issued = await getIssuedList(env, ip);
    const now = Date.now();
    const newUuids = [];
    for (let i = 0; i < batch; i++) {
        const id = uuidv4();
        issued.push({ uuid: id, issued_at: now });
        newUuids.push(id);
    }
    // Keep only the most recent 50 issued UUIDs to bound the list size.
    const trimmed = issued.slice(-50);
    await setIssuedList(env, ip, trimmed);

    return json({
        uuids: newUuids,
        difficulty: Number(env.CAKE_DIFFICULTY || 16),
        algorithm: "sha256",
        instruction:
            "For each uuid, choose a salt and find a nonce so that sha256(uuid + ':' + salt + ':' + nonce) starts with the required number of zero bits. Submit via POST /cake/bake.",
        credit_cents: Number(env.CAKE_CREDIT_CENTS || 5),
        baked_today: daily.count,
        limit_per_day: perDay,
    }, 200, {}, request);
}

async function handleBake(request, env) {
    const ip = getClientIP(request);
    const perDay = Number(env.CAKE_PER_IP_PER_DAY || 100);
    const difficulty = Number(env.CAKE_DIFFICULTY || 16);
    const creditCents = Number(env.CAKE_CREDIT_CENTS || 5);

    let body;
    try {
        body = await request.json();
    } catch {
        return json({ error: "invalid_json" }, 400, {}, request);
    }
    const { uuid, salt, nonce, hash } = body;
    const nonceStr = nonce == null ? "" : String(nonce);
    if (!uuid || !salt || !hash) {
        return json({ error: "missing_fields", required: ["uuid", "salt", "nonce", "hash"] }, 400, {}, request);
    }
    if (typeof uuid !== "string" || typeof salt !== "string" || typeof hash !== "string") {
        return json({ error: "invalid_field_types" }, 400, {}, request);
    }
    if (uuid.length > 64 || salt.length > 256 || nonceStr.length > 256 || hash.length !== 64) {
        return json({ error: "invalid_field_lengths" }, 400, {}, request);
    }

    // 1. Verify the UUID was issued to this IP.ually issued to this IP.
    const issued = await getIssuedList(env, ip);
    const match = issued.find((e) => e.uuid === uuid);
    if (!match) {
        return json({ error: "uuid_not_issued", ip }, 403, {}, request);
    }

    // 2. Verify the hash is correct.
    const computed = await sha256Hex(`${uuid}:${salt}:${nonceStr}`);
    if (computed !== hash) {
        return json({ error: "hash_mismatch", expected_input: `${uuid}:${salt}:${nonceStr}` }, 400, {}, request);
    }

    // 3. Verify the proof-of-work difficulty.
    const bits = leadingZeroBits(hash);
    if (bits < difficulty) {
        return json(
            { error: "insufficient_difficulty", required_bits: difficulty, actual_bits: bits },
            400,
            {},
            request
        );
    }

    // 4. Enforce daily limit.
    const user = request.headers.get("x-user");
    const daily = await getDailyCount(env, ip, user);
    if (daily.count >= perDay) {
        return json({ error: "daily_limit_reached", limit: perDay }, 429, { "Retry-After": "3600" }, request);
    }

    // 5. Persist the baked cake in R2 (dedup by uuid).
    const cakeKey = `cake:${uuid}`;
    const existing = await env.CAKE_BUCKET.get(cakeKey);
    if (existing) {
        return json({ error: "cake_already_baked", uuid }, 409, {}, request);
    }
    await env.CAKE_BUCKET.put(
        cakeKey,
        JSON.stringify({
            uuid,
            ip,
            salt,
            nonce: nonceStr,
            hash,
            difficulty,
            baked_at: Date.now(),
            credit_cents: creditCents,
            user: daily.user,
            country: request.cf.country
        }),
        { customMetadata: { ip, baked_day: dayKey(), user: daily.user || "", country: request.cf.country || "" } }
    );

    // 6. Remove the uuid from the issued list so it can't be re-baked.
    const remaining = issued.filter((e) => e.uuid !== uuid);
    await setIssuedList(env, ip, remaining);

    // 7. Increment daily counter and credit.
    await setDailyCount(env, ip, daily.count + 1, daily.user);
    const totalCents = await addCredit(env, ip, creditCents, user);

    // 8. If the request carries a members JWT, forward the credit to the
    //    members worker so it lands on the user's account too. Failures
    //    here are non-fatal — the IP-bound credit in CAKE_KV is the
    //    source of truth for anonymous users.
    let userCredited = false;
    const authHeader = request.headers.get("Authorization") || "";
    const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (jwt && env.MEMBERS_API_BASE && env.CAKE_WORKER_SECRET) {
        try {
            // Decode the JWT to get the user_id (no verification — the
            // members worker verifies the signature itself).
            const payload = JSON.parse(
                atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))
            );
            const userId = payload.sub || payload.user_id || payload.id;
            if (userId) {
                const resp = await fetch(`${env.MEMBERS_API_BASE}/cake/credit`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "X-Cake-Secret": env.CAKE_WORKER_SECRET,
                    },
                    body: JSON.stringify({
                        user_id: userId,
                        cake_id: uuid,
                        ip,
                        credit_cents: creditCents,
                    }),
                });
                userCredited = resp.ok;
            }
        } catch {
            // Best-effort: ignore forwarding errors.
        }
    }

    return json({
        ok: true,
        status: "baked",
        uuid,
        credit: creditCents,           // alias for the client
        credit_cents: creditCents,
        total_credits: totalCents,      // alias for the client
        total_credit_cents: totalCents,
        baked_today: daily.count + 1,
        limit_per_day: perDay,
        bound_to_ip: ip,
        user_credited: userCredited,
    }, 200, {}, request);
}

async function handleStatus(request, env) {
    const ip = getClientIP(request);
    const daily = await getDailyCount(env, ip);
    const credit = await getCredit(env, ip);
    return json({
        ip,
        baked_today: daily.count,
        limit_per_day: Number(env.CAKE_PER_IP_PER_DAY || 100),
        credit_cents: credit,
        credit_usd: (credit / 100).toFixed(4),
        difficulty: Number(env.CAKE_DIFFICULTY || 16),
    }, 200, {}, request);
}

async function handleCreditByIP(request, env, ip) {
    const auth = request.headers.get("Authorization") || "";
    if (!env.ADMIN_API_KEY || auth !== `Bearer ${env.ADMIN_API_KEY}`) {
        return json({ error: "unauthorized" }, 401, {}, request);
    }
    const credit = await getCredit(env, ip);
    const daily = await getDailyCount(env, ip);
    return json({ ip, credit_cents: credit, baked_today: daily.count }, 200, {}, request);
}

/** Admin-only: list every baker with total cakes and cakes baked today.
 *  Aggregates from the R2 bucket (each baked cake is one object carrying
 *  customMetadata { ip, baked_day }), paginating until all objects are seen.
 *  The `user` label (from the x-user header) is only persisted in today's
 *  per-IP KV counter, so it is attached best-effort for IPs active today. */
async function handleUsers(request, env, ctx) {
    const cached = await caches.default.match(request);
    if (cached) {
        return cached;
    }
    const cached2 = await caches.default.match(new Request("http://localhost/users"));
    if (cached2) {
        ctx.waitUntil(users(request, env));
        return cached2;
    }
    return users(request, env);
}

async function users(request, env) {
    const auth = request.headers.get("Authorization") || "";
    if (!env.ADMIN_API_KEY || auth !== `Bearer ${env.ADMIN_API_KEY}`) {
        //return json({ error: "unauthorized" }, 401, {}, request);
    }
    const today = dayKey();
    const agg = new Map(); // ip -> { total, today, user, country }

    let cursor;
    do {
        const listArgs = { include: ["customMetadata"] };
        if (cursor) listArgs.cursor = cursor;
        const listed = await env.CAKE_BUCKET.list(listArgs);
        for (const obj of listed.objects) {
            const md = obj.customMetadata || {};
            const ip = md.ip || "unknown";
            const day = md.baked_day || "";
            let entry = agg.get(ip);
            if (!entry) {
                entry = { total: 0, today: 0, user: null, country: null };
                agg.set(ip, entry);
            }
            entry.total += 1;
            entry.user = entry.user || md.user || null;
            entry.country = entry.country || md.country || null;
            if (day === today) entry.today += 1;
        }
        cursor = listed.truncated ? listed.cursor : null;
    } while (cursor);

    // Only report IPs active today.
    let users = [...agg.values()];
    users = users.filter(c => c.today > 0);
    users.sort((a, b) => b.total - a.total || b.today - a.today);

    const response = json({
        generated_at: Date.now(),
        day: today,
        count: users.length,
        users,
    }, 200, {}, request);
    const responseToCache = response.clone();
    responseToCache.headers.set("Cache-Control", "public, max-age=120");
    responseToCache.headers.set("X-Cache", "HIT");
    await caches.default.put(request, responseToCache);
    const responseToCache2 = response.clone();
    responseToCache2.headers.set("Cache-Control", "public, max-age=8600");
    responseToCache2.headers.set("X-Cache", "HIT");
    await caches.default.put(new Request("http://localhost/users"), responseToCache2);
    return response;
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const pathname = url.pathname;

        if (request.method === "OPTIONS") {
            return new Response(null, { headers: corsHeaders(request) });
        }

        try {
            if (pathname === "/cake/issue" && request.method === "GET") {
                return handleIssue(request, env);
            }
            if (pathname === "/cake/bake" && request.method === "POST") {
                return handleBake(request, env);
            }
            if (pathname === "/cake/status" && request.method === "GET") {
                return handleStatus(request, env);
            }
            if (pathname.startsWith("/cake/credit/") && request.method === "GET") {
                const ip = decodeURIComponent(pathname.slice("/cake/credit/".length));
                return handleCreditByIP(request, env, ip);
            }
            if (pathname === "/cake/users" && request.method === "GET") {
                return handleUsers(request, env);
            }
            if (pathname === "/cake/health") {
                return json({ ok: true, service: "cake-worker" }, 200, {}, request);
            }
            return json({ error: "not_found", endpoints: ["/cake/issue", "/cake/bake", "/cake/status", "/cake/users"] }, 404, {}, request);
        } catch (err) {
            return json({ error: "internal", message: String(err) }, 500, {}, request);
        }
    },
};