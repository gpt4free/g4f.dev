# AGENTS.md

This file is the shared context file and status ledger for the **g4f.dev**
repository. Read it before changing code. The automatic development pipeline
from the companion `gpt4free/gpt4free` checkout uses it as its task queue and
run log.

## Project

**g4f.dev** is the static website, documentation, playground, and browser
distribution for GPT4Free. It is deployed with GitHub Pages and includes the
official JavaScript client under `dist/js/`.

The automatic pipeline lives in the `gpt4free` checkout. Configure it there in
`dev-pipeline.json`; this repository only owns its task board and project notes.

## Working agreement

- Read the task board at the bottom of this file before starting.
- Keep changes focused and preserve the static-site deployment model.
- When behaviour or public API changes, update the matching Markdown docs and
  generated HTML where the repository keeps both.
- Do not add paid services, private API keys, or server-side requirements for
  features that are advertised as browser-only.
- Do not edit the `DEV-PIPELINE:STATE` or `DEV-PIPELINE:BOARD` blocks by hand.
  The pipeline updates them after each run.

## Repository map

| Path | Purpose |
| --- | --- |
| `*.html` | Public pages: home, chat, browser, agent, community, playground |
| `docs/` | Markdown and generated HTML documentation |
| `dist/js/` | Browser JavaScript client and worker bundles |
| `api/` | Static API metadata and hosted endpoint helpers |
| `apps/` | Companion web apps and demos |
| `scripts/check-js.mjs` | JavaScript syntax check used by CI |
| `.github/workflows/static.yml` | GitHub Pages build/deploy workflow |

## Commands

```bash
# JavaScript syntax check (also run by GitHub Actions)
npm run check:js

# Local static preview
python3 -m http.server 8000

# Repository whitespace check
git diff --check
```

The pipeline should run `npm run check:js` plus `git diff --check` for changes
in this repository. Configure that in the `g4f.dev` project entry of the
`gpt4free` checkout's `dev-pipeline.json`.

## Development pipeline status

The blocks below are maintained automatically. Do not edit them by hand.

<!-- DEV-PIPELINE:STATE:BEGIN -->
```json
{
  "schema": 1,
  "project": "g4f.dev",
  "updated": "2026-10-31T04:16:47Z",
  "tasks": [
    {
      "id": "G4FD-001",
      "project": "g4f.dev",
      "priority": "P1",
      "status": "done",
      "title": "Initialize the g4f.dev automatic development status",
      "acceptance": "AGENTS.md exists, is discoverable by agents, and bin/dev-pipeline status lists this task.",
      "created": "2026-10-31T04:16:47Z",
      "updated": "2026-10-31T04:16:47Z",
      "attempts": 0,
      "last_model": null,
      "notes": "Created by the gpt4free automatic development pipeline."
    },
    {
      "id": "G4FD-002",
      "project": "g4f.dev",
      "priority": "P3",
      "status": "pending",
      "title": "Run existing JS smoke tests in GitHub Actions",
      "acceptance": "static.yml runs the dist/js smoke tests (node --test) and the workflow passes.",
      "created": "2026-10-31T04:16:47Z",
      "updated": "2026-10-31T04:16:47Z",
      "attempts": 0,
      "last_model": null,
      "notes": ""
    }
  ],
  "models": {},
  "runs": []
}
```
<!-- DEV-PIPELINE:STATE:END -->

<!-- DEV-PIPELINE:BOARD:BEGIN -->

### Task board

| ID | Project | Priority | Status | Task | Acceptance | Updated |
| --- | --- | --- | --- | --- | --- | --- |
| G4FD-001 | g4f.dev | P1 | done | Initialize the g4f.dev automatic development status | AGENTS.md exists, is discoverable by agents, and bin/dev-pipeline status lists this task. | 2026-10-31T04:16:47Z |
| G4FD-002 | g4f.dev | P3 | pending | Run existing JS smoke tests in GitHub Actions | static.yml runs the dist/js smoke tests (node --test) and the workflow passes. | 2026-10-31T04:16:47Z |

### Free model health

_No model health snapshot yet. Run `bin/dev-pipeline models --refresh`._

### Recent runs

_No pipeline runs recorded yet._

<!-- DEV-PIPELINE:BOARD:END -->
