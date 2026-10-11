#!/usr/bin/env bash
# Build and verify committed HEAD in a separate VPS worktree, then activate it.
# Does not publish to GitHub, overwrite the old worktree, or edit shared secrets.
# Usage: scripts/deploy.sh [ssh-host] (default: stapp)
set -euo pipefail

HOST="${1:-stapp}"
cd "$(dirname "$0")/.."
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "Refusing deployment: tracked changes must be committed and validated." >&2
  exit 1
fi
SHA="$(git rev-parse HEAD)"
echo "Sending committed release $SHA to $HOST"
git push --receive-pack="sudo -u plain -H git-receive-pack" \
  "$HOST:/home/plain/repos/rwa-bridge.git" "HEAD:refs/heads/releases/$SHA"

ssh -o BatchMode=yes -o ConnectTimeout=15 "$HOST" bash -s -- "$SHA" <<'REMOTE'
set -euo pipefail
SHA="$1"
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || exit 1
REPO="/home/plain/repos/rwa-bridge.git"
RELEASE="/home/plain/releases/$SHA"
APP="/home/plain/app"
ENV="/home/plain/shared/.env.local"
UNIT="plain-preflight-${SHA:0:12}"
PREVIOUS="$(readlink -f "$APP")"
ACTIVATED=false

cleanup() {
  result=$?
  trap - EXIT
  systemctl stop "$UNIT" >/dev/null 2>&1 || true
  if [ "$result" -ne 0 ] && [ "$ACTIVATED" = true ]; then
    echo "Release verification failed; restoring $PREVIOUS" >&2
    ln -s "$PREVIOUS" "$APP.rollback.$SHA"
    mv -Tf "$APP.rollback.$SHA" "$APP"
    systemctl restart plain-web
  fi
  exit "$result"
}
trap cleanup EXIT

test -L "$APP"
test -d "$PREVIOUS"
sudo -u plain test -r "$ENV"
# Persistent ledger placement is required; never silently rewrite shared config.
python3 - "$ENV" <<'PY'
import sys, re
from pathlib import Path
values = dict(line.split('=', 1) for line in Path(sys.argv[1]).read_text().splitlines()
              if '=' in line and not line.lstrip().startswith('#'))
ledger = values.get('DEMO_LEDGER_PATH', '').strip().strip('"').strip("'")
if not ledger.startswith('/home/plain/shared/'):
    raise SystemExit('DEMO_LEDGER_PATH must point to persistent /home/plain/shared storage.')
key = values.get('NEXT_PUBLIC_CROSSMINT_API_KEY', '').strip().strip('"').strip("'")
if not re.fullmatch(r'ck_staging_[A-Za-z0-9_-]+', key):
    raise SystemExit('A staging Crossmint client key is required; refusing Mainnet wallet configuration.')
PY
if [ -d "$RELEASE" ]; then
  test "$(sudo -u plain -H git -C "$RELEASE" rev-parse HEAD)" = "$SHA"
  test -z "$(sudo -u plain -H git -C "$RELEASE" status --porcelain --untracked-files=no)"
else
  sudo -u plain -H git --git-dir="$REPO" worktree add --detach "$RELEASE" "$SHA"
fi
ln -sfn "$ENV" "$RELEASE/.env.local"
sudo -u plain -H bash -s -- "$RELEASE" <<'BUILD'
set -euo pipefail
cd "$1"
# The repository lockfile uses npm 11 peer resolution. Debian's system npm 9
# incorrectly reports missing React 18 peers; do not rewrite the lockfile.
npx --yes npm@11.19.1 ci --no-audit --no-fund --loglevel=error
npm run lint
npm run typecheck
npm test
NEXT_TELEMETRY_DISABLED=1 npm run build
BUILD

# A distinct transient unit makes cleanup deterministic without touching any
# existing process. An occupied preflight port fails closed before activation.
if ss -H -ltn 'sport = :3202' | grep -q .; then
  echo "Preflight port 3202 is already occupied; refusing to touch it." >&2
  exit 1
fi
systemd-run --unit="$UNIT" --collect --property=User=plain \
  --property="WorkingDirectory=$RELEASE" \
  /usr/bin/node node_modules/next/dist/bin/next start -p 3202 -H 127.0.0.1
curl --retry 20 --retry-connrefused --retry-delay 1 --max-time 60 --silent --show-error \
  --fail http://127.0.0.1:3202/manifest.webmanifest >/dev/null
systemctl is-active --quiet "$UNIT"
sudo -u plain -H bash -c 'cd "$1" && node scripts/release-smoke.mjs http://127.0.0.1:3202' _ "$RELEASE"
systemctl stop "$UNIT"

ln -s "$RELEASE" "$APP.next.$SHA"
mv -Tf "$APP.next.$SHA" "$APP"
ACTIVATED=true
systemctl restart plain-web
curl --retry 20 --retry-connrefused --retry-delay 1 --max-time 60 --silent --show-error \
  --fail http://127.0.0.1:3200/manifest.webmanifest >/dev/null
systemctl is-active --quiet plain-web
sudo -u plain -H bash -c 'cd "$1" && node scripts/release-smoke.mjs http://127.0.0.1:3200' _ "$RELEASE"
echo "Activated $SHA; previous release retained at $PREVIOUS"
REMOTE
echo "Done. Verify the public app separately: https://plain.lengway.me"
