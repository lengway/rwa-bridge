#!/usr/bin/env bash
# Deploys the committed HEAD to plain.lengway.me.
# Layout on the server:
#   /home/plain/releases/<sha>   one folder per release (built in place)
#   /home/plain/shared           .env.local and the ledger (DEMO_LEDGER_PATH), shared by all releases
#   /home/plain/app              symlink to the live release (systemd unit plain-web runs it on 127.0.0.1:3200)
# Usage: scripts/deploy.sh [ssh-host]   (default host alias: stapp)
set -euo pipefail

HOST="${1:-stapp}"
cd "$(dirname "$0")/.."

if [ -n "$(git status --porcelain)" ]; then
  echo "Uncommitted changes are not deployed; only HEAD is shipped." >&2
fi

SHA="$(git rev-parse --short HEAD)"
RELEASE="/home/plain/releases/$SHA"
echo "Deploying $SHA to $HOST:$RELEASE"

git archive --format=tar HEAD | ssh "$HOST" "rm -rf '$RELEASE' && mkdir -p '$RELEASE' && tar -x -C '$RELEASE'"

ssh "$HOST" bash -s <<EOF
set -euo pipefail
cd "$RELEASE"
ln -sf /home/plain/shared/.env.local .env.local
grep -q '^DEMO_LEDGER_PATH=' /home/plain/shared/.env.local || echo 'DEMO_LEDGER_PATH=/home/plain/shared/.demo-ledger.json' >> /home/plain/shared/.env.local
chown -R plain:plain "$RELEASE" /home/plain/shared
sudo -u plain -H bash -c 'npm ci --no-audit --no-fund --loglevel=error && NEXT_TELEMETRY_DISABLED=1 npm run build'
ln -sfn "$RELEASE" /home/plain/app.next && mv -T /home/plain/app.next /home/plain/app
systemctl enable --now plain-web >/dev/null 2>&1 || true
systemctl restart plain-web
sleep 4
systemctl is-active plain-web
curl -s -o /dev/null -w "local http %{http_code}\n" http://127.0.0.1:3200/
# keep the 5 newest releases
ls -1dt /home/plain/releases/* | tail -n +6 | xargs -r rm -rf
EOF

echo "Done: https://plain.lengway.me"
