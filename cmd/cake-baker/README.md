# cake-baker

A Go port of the g4f.dev cake baker. It performs the same proof-of-work
protocol as the browser-side `dist/js/cake-baker.js` against the
`cake-worker` Cloudflare Worker:

1. `GET  {endpoint}/issue?n={batch}` → `{ uuids, difficulty, ... }`
2. For each uuid, brute-force a nonce so that
   `sha256(uuid + ":" + salt + ":" + nonce)` has at least `difficulty`
   leading zero bits.
3. `POST {endpoint}/bake {uuid, salt, nonce, hash}`
   → `{ ok, credit_cents, baked_today, ... }`
4. `GET  {endpoint}/status` → `{ credit, baked_today, ... }`

The baker runs continuously, refetching batches and baking them in
parallel across multiple goroutines until the daily limit is reached
or the process is interrupted.

## Build

```bash
make build           # current platform → dist/cake-baker-<os>-<arch>
make all             # cross-compile all targets into dist/
make run ARGS="-workers 8"
make vet
make fmt
make test
make clean
```

Override `GOOS`/`GOARCH` for a single build:

```bash
make build GOOS=linux GOARCH=arm64
```

Cross-compile targets produced by `make all`:

- `linux/amd64`, `linux/arm64`
- `darwin/amd64`, `darwin/arm64`
- `windows/amd64`, `windows/arm64`
- `freebsd/amd64`

Each binary is accompanied by a `.sha256` checksum.

## Usage

```bash
# Continuous baking with defaults.
./cake-baker

# Bake a single batch and exit.
./cake-baker -once

# One-shot status check.
./cake-baker status
./cake-baker status https://g4f.space/cake

# Print version.
./cake-baker -version

# Custom settings.
./cake-baker \
  -endpoint https://g4f.space/cake \
  -batch 20 \
  -workers 8 \
  -difficulty 16 \
  -interval 5000
```

### Flags

| Flag         | Default                  | Description                                          |
|--------------|--------------------------|------------------------------------------------------|
| `-endpoint`  | `https://g4f.space/cake`  | cake worker endpoint                                 |
| `-batch`     | `20`                     | number of UUIDs to request per issue                 |
| `-workers`   | `4`                      | parallel hashing goroutines                          |
| `-difficulty`| `16`                     | fallback leading-zero-bits target (worker overrides) |
| `-interval`  | `5000`                   | base poll interval between batches (ms)              |
| `-once`      | `false`                  | bake a single batch and exit                        |
| `-version`   | `false`                  | print version and exit                               |

### Subcommands

| Subcommand  | Description                                      |
|-------------|--------------------------------------------------|
| `status`    | one-shot status check (optional endpoint arg)    |

## Adaptive throttle

Between batches the baker sleeps for an interval that scales linearly
with daily progress:

- below 50% of the daily limit → `-interval` ms
- between 50% and 90% → linear scale up to 60 s
- at or above 90% → 60 s

When the daily limit is reached, the baker sleeps for 10 minutes before
retrying.

## Signal handling

`SIGINT` and `SIGTERM` trigger a graceful shutdown: in-flight batches
finish their current UUID, the loop exits, and the process stops.