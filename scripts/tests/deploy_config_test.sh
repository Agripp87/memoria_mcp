#!/usr/bin/env bash
# Checks for the deploy templates and docker-compose.yml. GitHub event
# semantics and Cloud Run traffic cannot run here, so the workflow example is
# checked statically for the guards each review finding needed; the parts
# that are code (should-deploy.sh, the compose environment) are run.
# Run: bash scripts/tests/deploy_config_test.sh
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fail=0
check() { # check <label> <condition...>
  local label="$1"; shift
  if "$@"; then echo "ok - $label"; else echo "FAIL - $label"; fail=1; fi
}
has() { grep -qF -- "$2" "$REPO_ROOT/$1"; }

WF=deploy/gcp/github-deploy.yml.example
CB=deploy/gcp/cloudbuild.yaml

# ── Only a push to main of this repository deploys ──
# workflow_run's `branches: [main]` also matches a fork PR's own `main`
# branch, and the job runs with this repository's secrets.
check "deploy gate: triggering event is a push" has "$WF" "github.event.workflow_run.event == 'push'"
check "deploy gate: triggering repository is this one" \
  has "$WF" "github.event.workflow_run.head_repository.full_name == github.repository"
check "deploy gate: CLI credentials file kept out of the build upload" has .gcloudignore "gha-creds-*.json"
check "deploy gate: .gcloudignore still applies .gitignore" has .gcloudignore "#!include:.gitignore"

# ── Only the tip of main deploys ──
check "tip check: full history checked out" has "$WF" "fetch-depth: 0"
check "tip check: workflow runs should-deploy.sh" has "$WF" "deploy/gcp/should-deploy.sh"
SD="$REPO_ROOT/deploy/gcp/should-deploy.sh"
G="$TMP/sd"
git init -q "$G"
git -C "$G" config user.email t@t; git -C "$G" config user.name t
git -C "$G" commit -q --allow-empty -m A; A="$(git -C "$G" rev-parse HEAD)"
git -C "$G" commit -q --allow-empty -m B; B="$(git -C "$G" rev-parse HEAD)"
sd() { (cd "$G" && bash "$SD" "$@" >/dev/null 2>&1); echo $?; }
check "should-deploy: an older commit than the tip is skipped" test "$(sd "$A" "$B")" = 1
check "should-deploy: the tip deploys" test "$(sd "$B" "$B")" = 0
check "should-deploy: a descendant of the reference deploys" test "$(sd "$B" "$A")" = 0
git -C "$G" checkout -q --orphan other; git -C "$G" commit -q --allow-empty -m C
C="$(git -C "$G" rev-parse HEAD)"
check "should-deploy: unrelated history is skipped" test "$(sd "$C" "$B")" = 1
check "should-deploy: an unknown commit is an error" test "$(sd 0123456789abcdef0123456789abcdef01234567 "$B")" = 2

# ── A rollback does not pin traffic for every later deploy ──
DEPLOY_LINE="$(grep -n '^      - "deploy"$' "$REPO_ROOT/$CB" | head -1 | cut -d: -f1)"
LATEST_LINE="$(grep -n -- '--to-latest' "$REPO_ROOT/$CB" | head -1 | cut -d: -f1)"
check "traffic: cloudbuild routes to the latest revision after deploying" \
  test -n "$DEPLOY_LINE" -a -n "$LATEST_LINE" -a "${LATEST_LINE:-0}" -gt "${DEPLOY_LINE:-0}"
check "traffic: rollback only when the smoke step failed" \
  grep -qE "^ +if: failure\(\) && steps\.smoke\.outcome == 'failure'" "$REPO_ROOT/$WF"
check "traffic: the smoke step has the id the rollback names" grep -qE '^ +id: smoke$' "$REPO_ROOT/$WF"
check "traffic: smoke test checks the latest revision serves" has "$WF" "status.latestReadyRevisionName"

# ── docker compose passes the documented settings into the container ──
# Compose reads .env only to fill in placeholders, so a variable reaches the
# container only if docker-compose.yml lists it.
if docker compose version >/dev/null 2>&1; then
  mkdir -p "$TMP/compose"
  cp "$REPO_ROOT/docker-compose.yml" "$TMP/compose/"
  {
    echo "MEMORIA_API_KEY=k"; echo "MEMORIA_OAUTH_CLIENT_SECRET=s"; echo "MEMORIA_ENCRYPTION_KEY=e"
    echo "MEMORIA_PUBLIC_URL=http://localhost:3100"
    echo "MEMORIA_AUTHORIZE_REQUIRE_APPROVAL=true"; echo "MEMORIA_EMBEDDINGS=hash"
  } > "$TMP/compose/.env"
  ENV_JSON="$(docker compose --project-directory "$TMP/compose" -f "$TMP/compose/docker-compose.yml" \
    config --format json 2>/dev/null | jq -c '.services.memoria.environment')"
  check "compose: approval gate reaches the container" \
    test "$(jq -r '.MEMORIA_AUTHORIZE_REQUIRE_APPROVAL' <<<"$ENV_JSON")" = true
  check "compose: embedding provider reaches the container" \
    test "$(jq -r '.MEMORIA_EMBEDDINGS' <<<"$ENV_JSON")" = hash
  # Every setting .env.example offers, set or commented out, is forwarded,
  # except the two compose or the image handles itself.
  missing=""
  while IFS= read -r key; do
    case "$key" in HOST_BIND|MEMORIA_DIR) continue ;; esac
    jq -e --arg k "$key" 'has($k)' <<<"$ENV_JSON" >/dev/null || missing="$missing $key"
  done < <(sed -nE 's/^#? ?([A-Z][A-Z0-9_]*)=.*/\1/p' "$REPO_ROOT/.env.example")
  check "compose: every .env.example setting is forwarded (missing:${missing:- none})" test -z "$missing"
else
  echo "skip - docker compose not available"
fi

if [ "$fail" -eq 0 ]; then echo "all deploy config tests passed"; else echo "FAILURES"; exit 1; fi
