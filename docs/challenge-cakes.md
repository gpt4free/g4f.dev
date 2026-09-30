# Challenge Cakes — earn cake credit with the browser LanguageModel

An alternative to proof-of-work hashing (`/cake/bake`): instead of burning CPU on
hash loops, the client solves small AI tasks locally with Chrome's built-in
`LanguageModel` (Gemini Nano / Prompt API). It is typically **faster** to the
first cakes, since one solved challenge credits more than one PoW bake.

```
Client                          Worker (/challenge)                    KV (CAKE_KV)
  │  GET /challenge/issue?lang=de-DE  │                                   │
  │──────────────────────────────────▶│ create payload, AES-GCM seal      │
  │  ◀── {id, ciphertext, iv, kind} ──│ store challenge:<id> (TTL 300s)   │
  │                                   │──────────────────────────────────▶│
  │  decrypt with CHALLENGE_SECRET    │                                   │
  │  session.prompt(payload.prompt)   │   (local Gemini Nano, offline)    │
  │  seal(answer)                     │                                   │
  │  POST /challenge/solve            │                                   │
  │──────────────────────────────────▶│ unseal, validate, burn challenge  │
  │  ◀──────── {token (JWT), credit_cents} ───▶│ mark solved, dedup hash  │
  │  POST /challenge/redeem {token}   │                                   │
  │──────────────────────────────────▶│ verify HS256, IP-bound, replay    │
  │                                   │   proxy → cake worker /cake/redeem│
  │  ◀──────── {credited, total_credits} ────│ cakes:credit:<ip> += cents │
```

The same infrastructure powers **community UI translations** and the
**community follow-ups pool**: solved batch challenges translate the chat UI
snippets, solved followup challenges feed a per-language pool of follow-up
questions, and both are served back to every visitor — see
[Community UI translations](#community-ui-translations) and
[Community follow-ups](#community-follow-ups).

## Endpoints

| Method | Path                  | Description |
|--------|-----------------------|-------------|
| GET    | `/challenge/issue?lang=<lang>&kind=followup\|translation\|translations\|any` | Returns an encrypted challenge. The plaintext prompt is **never** sent in cleartext. |
| POST   | `/challenge/solve`    | Body: `{id, ciphertext, iv, language}` (answer sealed with AES-GCM). Returns `{token, credit_cents}`. |
| POST   | `/challenge/redeem`   | Body: `{token}` (or `Authorization: Bearer <token>`). Proxy — verifies locally, then credits via the cake worker's `POST /cake/redeem` (`CAKE_WORKER_URL`). |
| GET    | `/challenge/translations?lang=<lang>` | Serves the community translation store for the UI (`Cache-Control: max-age=300`). |
| GET    | `/challenge/followups?lang=<lang>&count=<n>` | Serves random follow-up questions from the community pool (`Cache-Control: max-age=60`; 404 `{error: "no_followups"}` when empty). |
| GET    | `/challenge/status`   | Current IP's `solved_today`, `credit_cents`, limits. |
| GET    | `/challenge/health`   | Liveness probe. |

Challenge kinds:

- **followup** — "Ask 3 first-person follow-up questions about `<random topic>`",
  answer `{"q": ["...", "...", "..."]}` (2–8 questions, 3–500 chars each).
- **translation** — translate a random English snippet, answer `{"text": "..."}`
  (5–2000 chars, must differ from the source).
- **translations** — batch mode: translate up to `TRANSLATIONS_BATCH` real UI
  snippets from the catalog, answer `{"translations": {"<source>": "<translation>"}}`.
  The sealed items are plain strings, led by the section headline as translation
  context. Snippets that already have a community translation are skipped; if
  none are left, the issue returns `{error: "all_translated"}`.

## Community UI translations

Each page ships a snippet catalog grouped by section headline
(`dist/js/snippets/<page>.json` — `chat`, `index`, `home`,
`members`, `manifesto`). The worker fetches and merges all catalogs:

```json
{
  "_meta": {"comment": "headline: [texts] — headline is the translation context"},
  "Message Input": ["Send", "Attach file", "Type a message…"],
  "Settings":      ["Appearance", "Language"]
}
```

The flow closes a loop where clients earn cakes for translating the UI they
use, and every visitor benefits:

1. `GET /challenge/issue?kind=translations&lang=de-DE` samples untranslated
   snippets from the raw catalog and seals them (headline first, as context)
   into the challenge.
2. The client's local `LanguageModel` translates the batch; the sealed answer
   is validated server-side and earns a JWT.
3. Redeeming the JWT credits the ledger. The store is fed **directly in
   `/challenge/solve`** — a valid `translations` answer is merged into the
   per-language store at solve time (no separate submit endpoint, failures
   are non-fatal).
4. `framework.translateAll()` fetches `GET /challenge/translations?lang=…`
   first and reuses those community translations before asking the local model
   for anything still missing.

Submissions are filtered (non-empty strings, must differ from the source,
≤100 entries, `en` excluded) and merged into the per-language store.

## Community follow-ups

Solved **followup** challenges feed a per-language pool of follow-up
questions (`challenge:followups:<lang>`, TTL 30 days, max 100 topics —
re-solving the same topic refreshes its entry):

- `GET /challenge/followups?lang=de-DE&count=3` picks a random topic from the
  pool and returns up to `count` (1–8, default 3) shuffled questions:
  `{ok: true, language, topic, q: ["…", "…", "…"]}`.
- The chat UI uses these to pre-seed the "follow-up questions" suggestions
  shown under a response, before falling back to generating them locally.
- An empty pool returns `404 {error: "no_followups", language}`.

## Security model

- **Sealing**: AES-256-GCM, key = `SHA-256(CHALLENGE_SECRET)`, random 12-byte IV,
  base64url ciphertext. The client needs the secret to decrypt — it is shipped
  in the page (`window.G4F_CHALLENGE_SECRET`), so this is obfuscation against
  casual scrapers, not secrecy from a determined attacker. Server-side answer
  validation is the real gate.
- **JWT**: HS256 signed with `CHALLENGE_JWT_SECRET`, TTL 600s, payload
  `{sub: "challenge:<ip>", kind, language, credit_cents, challenge_id}`.
  Bound to the solver's IP; redeeming from another IP returns 403.
- **Replay protection**: challenges burn on solve (`challenge:<id>` deleted,
  answer-hash dedup with daily TTL); tokens get a `challenge:redeemed:<hash>`
  KV marker (TTL 900s > token TTL) checked before crediting.
- **Rate limits**: `CHALLENGE_PER_IP_PER_DAY` issues per IP (default 100),
  `CHALLENGE_MAX_PER_DAY` global (default 150).

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `CAKE_KV` | — | KV namespace (shared with the cake worker). On Vercel: Upstash REST credentials. |
| `CHALLENGE_SECRET` | — | AES sealing key material (required). |
| `CHALLENGE_JWT_SECRET` | — | HS256 signing secret (required). |
| `CAKE_CREDIT_CENTS` | `5` | Credit per solved challenge (0.05¢). |
| `CHALLENGE_PER_IP_PER_DAY` | `100` | Per-IP issue limit. |
| `CHALLENGE_MAX_PER_DAY` | `150` | Global issue limit. |
| `CHALLENGE_TTL_SEC` | `300` | Challenge validity after issue. |
| `CAKE_WORKER_URL` | `https://g4f.space/cake` | Cake worker base URL the redeem proxy forwards to. |
| `SNIPPETS_URL` | `/dist/js/snippets/chat.context.json` | Overrides all snippet catalogs with a single URL (cached 1h). By default the worker loads every per-page catalog (`chat`, `index`, `home`, `members`, `manifesto`) and merges them. |
| `TRANSLATIONS_BATCH` | `8` | Snippets per translations challenge. |
| `ADMIN_API_KEY` | — | Optional, for admin endpoints. |

## KV keys (all in `CAKE_KV`)

| Key | TTL | Purpose |
|-----|-----|---------|
| `challenge:<id>` | 300s | Sealed challenge record (kind, language, issued_at). |
| `challenge:seen:<hash>` | 24h | Answer dedup — same answer never double-credits. |
| `challenge:rate:<ip>` | 24h | Per-IP issue counter. |
| `challenge:solved:<ip>` | 24h | Per-IP solve counter (shown in `/status`). |
| `challenge:redeemed:<hash>` | 900s | Token replay marker (written by both workers — the cake worker computes the identical hash for `/cake/redeem`). |
| `challenge:translations:<lang>` | 365d | Community translation store per base language, served to the UI. |
| `challenge:followups:<lang>` | 30d | Community follow-up pool per base language (`[{topic, q, at}]`, max 100 topics), served via `/challenge/followups`. |
| `cakes:credit:<ip>` | — | **Shared cake ledger** — same key `cake-worker.js` writes on PoW bakes and `api-worker.js` reads for anonymous usage gating. |

## Deployment

**Vercel** (this repo): `api/challenge.js` adapts the Cloudflare-style worker
(`workers/challenge-worker.js`) to the edge runtime — same pattern as
`api/worker.js`. Routing is in `vercel.json`:

```json
{"source": "/challenge", "destination": "/api/challenge?path=/challenge"},
{"source": "/challenge/:path*", "destination": "/api/challenge?path=/challenge/:path*"}
```

Set `CHALLENGE_SECRET` and `CHALLENGE_JWT_SECRET` in the Vercel project env
vars, plus the Upstash REST vars used for `CAKE_KV` (same as the other workers).

**Cloudflare** (optional): deploy `workers/challenge-worker.js` with a wrangler
config binding `CAKE_KV`, mirroring `wrangler-cake.toml`.

## Client integration

`dist/js/challenge-client.js` exposes `window.G4FChallenge`:

```js
G4FChallenge.isSupported();          // LanguageModel available?
G4FChallenge.solveOnce();            // one full issue→solve→redeem round
G4FChallenge.start();                // polling loop (5s interval, max 50 rounds)
G4FChallenge.stop();
G4FChallenge.status();
```

- Auto-starts on chat/members pages (same detection as `cake-baker.js`);
  opt out with `<body data-challenge-client="off">`.
- On successful redeem it dispatches
  `window.dispatchEvent(new CustomEvent("g4f:cake:accepted", {detail: {...}}))`,
  which `addon-baked-credits.js` already listens for — no extra wiring needed.
- For `translations` challenges the answer is donated to the community store
  automatically in `/challenge/solve` (failures are non-fatal); `followup`
  answers feed the follow-ups pool the same way.
- Stops polling on 429 (rate limit) or when `LanguageModel` is unavailable
  (non-Chrome browsers simply fall back to PoW baking).

## Smoke test

```bash
cd g4f.dev
node dist/js/challenge-client.smoke.test.cjs
```

51 checks covering: issue (encrypted, no plaintext leak), client-side decrypt
via the real client code path, solve, token issuance, replay rejection,
redeem + ledger credit (both via the `/challenge/redeem` proxy and directly
on the cake worker's `/cake/redeem`, sharing one in-memory KV), double-redeem
rejection, tampered-token rejection, invalid-answer rejection, status
reporting — the follow-ups round (solve feeds the pool, `/challenge/followups`
serves shuffled questions, `count` respected, empty pool 404) — plus the full
translations round: batch issue from the raw catalog (headline-led string
items), solve with store feeding, serving via
`GET /challenge/translations?lang=…`, skip-already-translated on the next
batch, and rejection of the `en` store.
