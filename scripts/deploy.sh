#!/usr/bin/env bash
# Deploys committed main through GitHub to plain.lengway.me.
#
# The VPS checkout lives at /home/plain/worktrees/rwa-bridge and uses a
# read-only GitHub deploy key. /home/plain/app is atomically repointed to that
# checkout after a successful build.
# Usage: scripts/deploy.sh [ssh-host]   (default host alias: stapp)
set -euo pipefail

HOST="${1:-stapp}"
BRANCH="main"
WORKTREE="/home/plain/worktrees/rwa-bridge"
cd "$(dirname "$0")/.."

if [ -n "$(git status --porcelain)" ]; then
  echo "Uncommitted changes are not deployed; only HEAD is pushed." >&2
fi

SHA="$(git rev-parse --short HEAD)"
echo "Pushing $SHA to origin/$BRANCH"
git push origin "HEAD:refs/heads/$BRANCH"

echo "Deploying origin/$BRANCH to $HOST:$WORKTREE"
ssh "$HOST" "
set -euo pipefail
sudo -u plain -H env GIT_TERMINAL_PROMPT=0 git -C '$WORKTREE' pull --ff-only origin '$BRANCH'
ln -sfn /home/plain/shared/.env.local '$WORKTREE/.env.local'
grep -q '^DEMO_LEDGER_PATH=' /home/plain/shared/.env.local || echo 'DEMO_LEDGER_PATH=/home/plain/shared/.demo-ledger.json' >> /home/plain/shared/.env.local
sudo -u plain -H bash -lc 'cd \"$WORKTREE\" && npx -y npm@11 ci --no-audit --no-fund --loglevel=error && NEXT_TELEMETRY_DISABLED=1 npm run build'
ln -sfn '$WORKTREE' /home/plain/app.next
mv -T /home/plain/app.next /home/plain/app
systemctl enable --now plain-web >/dev/null 2>&1 || true
systemctl restart plain-web
sleep 4
systemctl is-active plain-web
curl -fsS -o /dev/null -w "local http %{http_code}\n" http://127.0.0.1:3200/
"

echo "Done: https://plain.lengway.me"
