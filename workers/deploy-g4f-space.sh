#!/usr/bin/env bash
#
# Split-worker deployment for g4f.space.
#
# The normal deployment is a single Worker and does not need this script:
#
#   npx wrangler deploy        # from the repository root
#
# Use this script only when you want one Cloudflare Worker per provider. It
# deploys the configs in this directory and therefore attaches the provider
# routes to separate Workers. Do not use it while the root router owns the
# same routes.
#
# Usage:
#   ./deploy-g4f-space.sh                 # deploy all workers
#   ./deploy-g4f-space.sh api             # deploy one worker
#   ./deploy-g4f-space.sh --dry-run       # bundle all workers without uploading
#   ./deploy-g4f-space.sh --list          # list worker names
#
# Prerequisites:
#   - Node.js 18+
#   - CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment, or a
#     prior `wrangler login`
#   - The g4f.space zone active in the same Cloudflare account
#   - Proxied DNS records for puter/pollinations/ollama/api subdomains (for the
#     subdomain routes) and the KV/R2/D1 resources referenced by the configs
#
# Set WRANGLER to use a specific binary, e.g. WRANGLER=wrangler ./deploy-g4f-space.sh

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

ORDER=(puter pollinations ollama api)
declare -A CONFIGS=(
  [puter]="wrangler-puter.toml"
  [pollinations]="wrangler-pollinations.toml"
  [ollama]="wrangler-ollama.toml"
  [api]="wrangler-custom.toml"
)

usage() {
  sed -n '3,26p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

if command -v wrangler >/dev/null 2>&1; then
  WRANGLER_CMD=(wrangler)
elif [[ -n "${WRANGLER:-}" ]]; then
  # shellcheck disable=SC2206
  WRANGLER_CMD=(${WRANGLER})
else
  WRANGLER_CMD=(npx --yes wrangler@latest)
fi

dry_run=0
target="all"
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=1 ;;
    --list)
      for w in "${ORDER[@]}"; do echo "$w  ${CONFIGS[$w]}"; done
      exit 0
      ;;
    -h|--help) usage; exit 0 ;;
    all|api|puter|pollinations|ollama) target="$arg" ;;
    *)
      echo "Unknown argument: $arg" >&2
      usage >&2
      exit 2
      ;;
  esac
done

deploy_one() {
  local worker="$1"
  local config="${CONFIGS[$worker]}"
  if [[ ! -f "$config" ]]; then
    echo "Missing config: $config" >&2
    exit 1
  fi
  echo "==> Deploying ${worker} (${config})"
  if (( dry_run )); then
    "${WRANGLER_CMD[@]}" deploy --dry-run --config "$config"
  else
    "${WRANGLER_CMD[@]}" deploy --config "$config"
  fi
}

if [[ "$target" == "all" ]]; then
  for worker in "${ORDER[@]}"; do deploy_one "$worker"; done
else
  deploy_one "$target"
fi

echo
echo "Done. Verify the public endpoints:"
echo "  curl -fsS https://g4f.space/v1/models"
echo "  curl -fsS https://g4f.space/api/puter/models"
echo "  curl -fsS https://g4f.space/api/pollinations/models"
echo "  curl -fsS https://g4f.space/api/ollama/models"
