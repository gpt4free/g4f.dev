# g4f.space Cloudflare Workers

This directory contains the Cloudflare Worker sources and Wrangler
configurations that power **`g4f.space`**. The API worker and the Puter,
Pollinations, and Ollama provider workers can all live on `g4f.space` at the
same time, either as path prefixes on the main host or on dedicated
subdomains.

The default deployment is a single Worker (`api`) with
`workers/g4f-space-router.js` as its entry point. It imports all four modules
and dispatches requests by host and path, so deploying from the repository root
covers everything:

```bash
npx wrangler deploy
```

The separate configs below are still used for split deployments.

| Module | Source | Split config | Same-host route | Subdomain route |
| --- | --- | --- | --- | --- |
| API / OpenAI-compatible API | `api-worker.js` | `wrangler-custom.toml` | `g4f.space/*`, `api.g4f.space/*` | — |
| Puter | `puter-worker.js` | `wrangler-puter.toml` | `g4f.space/api/puter/*` | `puter.g4f.space/*` |
| Pollinations | `pollinations.js` | `wrangler-pollinations.toml` | `g4f.space/api/pollinations/*` | `pollinations.g4f.space/*` |
| Ollama | `ollama.js` | `wrangler-ollama.toml` | `g4f.space/api/ollama/*` | `ollama.g4f.space/*` |

Every public request goes through the API worker first. It authenticates the
caller, applies API keys, rate limits, the anonymous credit gate, and usage
tracking, and only then invokes the matching provider module. The router hands
the provider modules to the API worker through `env.PROVIDER_WORKERS`, so
provider calls stay in the same isolate (no service binding, no network hop,
and no recursion). Provider subdomain requests are rewritten to the equivalent
`/api/<provider>` path before reaching the API worker, so they get exactly the
same limits as the shared-host path.

Each provider module also strips its `/api/<provider>` mount prefix at the edge
of its `fetch` handler, which keeps it usable in split deployments.

## Resulting endpoints

All of these are OpenAI-compatible (`GET /models`, `POST /chat/completions`):

```text
https://g4f.space/v1                     API worker (auth/model routing)
https://g4f.space/api/puter              API worker -> Puter module
https://g4f.space/api/pollinations       API worker -> Pollinations module
https://g4f.space/api/ollama             API worker -> Ollama module

https://puter.g4f.space                  API worker -> Puter module
https://pollinations.g4f.space           API worker -> Pollinations module
https://ollama.g4f.space                 API worker -> Ollama module
```

```bash
curl https://g4f.space/api/ollama/models
curl https://g4f.space/api/puter/models
curl https://g4f.space/api/pollinations/models

curl https://g4f.space/api/ollama/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"gpt-oss:120b","messages":[{"role":"user","content":"Hello"}]}'
```

The JS client in `dist/js/` uses these paths through
`dist/js/providers.json`. `https://g4f.space/v1` remains the default endpoint.

## First-time setup

1. **Install Wrangler** (the deploy script falls back to `npx`):

   ```bash
   npm install -g wrangler
   wrangler login
   # or export CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=...
   ```

2. **Create the shared resources** referenced by the root `wrangler.toml`:

   ```bash
   wrangler kv namespace create MEMBERS_KV
   wrangler kv namespace create CAKE_KV
   wrangler r2 bucket create g4f-members
   wrangler d1 create errors_db
   wrangler d1 create usage_db
   ```

   Put the returned IDs into `wrangler.toml`. `CAKE_KV` is optional: leave the
   binding commented out if you do not deploy the cake worker; the API worker
   handles a missing binding gracefully.

3. **Custom domains / DNS**: the root `wrangler.toml` attaches `g4f.space`,
   `www`, `api`, `puter`, `pollinations`, and `ollama` as **custom domains**,
   matching the existing g4f.space deployment. Wrangler creates the proxied
   DNS records and certificates for those hostnames.

   If a hostname already has a conflicting proxied DNS record, either remove
   that record or use a path route with `zone_name = "g4f.space"` instead.
   Routes only take effect when the hostname resolves through Cloudflare in the
   same zone.

4. **Set the secrets** for the workers that need them:

   ```bash
   wrangler secret put OLLAMA_API_KEY        --config wrangler-ollama.toml
   wrangler secret put POLLINATIONS_API_KEY  --config wrangler-pollinations.toml

   # API worker only — set the ones you actually use:
   wrangler secret put API_KEY_SALT          --config wrangler-custom.toml
   wrangler secret put PASS_API_KEY           --config wrangler-custom.toml
   wrangler secret put AUDIO_API_KEY          --config wrangler-custom.toml
   wrangler secret put YDC_API_KEY            --config wrangler-custom.toml
   ```

   Puter does **not** use a secret: callers send their own Puter token as
   `Authorization: Bearer <token>` (or `x-api-key`).

5. **Deploy from the repository root**:

   ```bash
   npx wrangler deploy
   ```

   The root `wrangler.toml` points at `workers/g4f-space-router.js`, which
   imports the API, Puter, Pollinations, and Ollama modules and dispatches by
   host and path. One command deploys all four roles, and the configuration
   has no `[assets]` section, so Wrangler no longer tries to upload the site
   (which caused `Asset too large`).

   Preview the bundle without uploading:

   ```bash
   npx wrangler deploy --dry-run
   ```

   To deploy providers as separate Workers instead, use the split configs and
   the helper script (see [Split deployment](#split-deployment)). Do not run
   both variants against the same route patterns at the same time.

## Split deployment

The root `wrangler.toml` deploys one Worker that serves all four roles. If you
need independent Workers (different limits, logs, or rollout cadence), deploy
the configs in this directory instead:

```bash
./workers/deploy-g4f-space.sh --list
./workers/deploy-g4f-space.sh --dry-run
./workers/deploy-g4f-space.sh puter
./workers/deploy-g4f-space.sh pollinations
./workers/deploy-g4f-space.sh ollama
./workers/deploy-g4f-space.sh api
```

In split mode the provider routes (`g4f.space/api/puter/*`,
`puter.g4f.space/*`, and so on) must be attached to their own Workers. The
root router must not own those routes at the same time. Remove the old routes
from whichever Worker currently owns them before switching modes.

## Configuration reference

### API worker — `wrangler-custom.toml`

| Binding | Type | Purpose |
| --- | --- | --- |
| `MEMBERS_KV` | KV | Sessions, API keys, public server index |
| `CAKE_KV` | KV (optional) | Baked cake credits for anonymous users |
| `MEMBERS_BUCKET` | R2 | User profiles and conversation data |
| `USAGE_DB` | D1 | `usage_logs` (14-day retention) |
| `ERRORS_DB` | D1 | `error_logs` (30-day retention) |
| `PUTER_WORKER_URL` | var | Base URL used when `/v1` routes to Puter |
| `POLLINATIONS_WORKER_URL` | var | Base URL used for Pollinations model checks |

The scheduled trigger runs every 15 minutes to refresh the public server
index; hourly runs also prune the D1 tables.

### Pollinations worker — `wrangler-pollinations.toml`

| Variable | Default | Purpose |
| --- | --- | --- |
| `POLLINATIONS_API_KEY` | unset | Optional key for the premium `gen.pollinations.ai` endpoints |
| `RATE_LIMIT_PER_MINUTE` | `30` | Per-IP request cap per 60 seconds (`0` disables) |

### Ollama worker — `wrangler-ollama.toml`

| Variable | Default | Purpose |
| --- | --- | --- |
| `OLLAMA_API_KEY` | unset | Anonymous fallback key for `ollama.com` |

Callers may always override the fallback key with
`Authorization: Bearer <their-key>`.

## Troubleshooting

### `✘ [ERROR] Asset too large`

Running `npx wrangler deploy` from the repository root without a root config
made Wrangler auto-detect a static site and set `assets.directory = "."`. The
upload then failed on `.git` (the pack file is >100 MiB) and
`assets/core*/package/dist/**/ffmpeg-core.wasm` (>25 MiB each), which exceed
Cloudflare's 25 MiB per-file limit.

The root `wrangler.toml` now provides `main`, so Wrangler deploys the router
Worker instead of the static site. The repository also ships `.assetsignore`
files (root and `workers/`) as a safety net. Keep using:

```bash
npx wrangler deploy
```

Do not run `wrangler deploy --assets .` from the repository root.

### `error code: 522` / `522` from a provider

522 means Cloudflare could not complete the connection to the origin. In this
setup it usually means a provider URL pointed back into the same Worker, so
the request looped and timed out. The current code prevents that:

- the router passes provider modules to the API worker via
  `env.PROVIDER_WORKERS`
- the API worker calls those modules in-process
- a second pass through the router returns `508 {"type":"routing_loop"}`
- provider `521`/`522`/`523`/`524` responses become a JSON
  `502`/`504` with `type: "upstream_unreachable"`, `provider`, and
  `retry_after` instead of the HTML Cloudflare page
- the JS client maps these statuses to a readable message and includes
  `521`-`524` in its fallback retry list

If 522 still appears, the deployed Worker is older than the source. Redeploy
and confirm:

```bash
npx wrangler deploy
curl -i https://pollinations.g4f.space/
```

`/` must return the health JSON, not an HTML 522 page.

### `A route with this pattern already exists`

A route can point at only one Worker. Remove the old route from the previous
Worker (`wrangler routes list`, or the Cloudflare dashboard) before deploying:
the provider routes must belong to `puter`, `pollinations`, and `ollama`, and
the catch-all `g4f.space/*` route to `api`.

## Local development

```bash
cd workers
wrangler dev --config wrangler-puter.toml
wrangler dev --config wrangler-pollinations.toml
wrangler dev --config wrangler-ollama.toml
```

The API worker needs at least `MEMBERS_KV` for auth. For a binding-free smoke
test of the provider workers, run `wrangler dev --config <config> --local`.
