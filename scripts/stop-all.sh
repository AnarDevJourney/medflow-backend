#!/bin/bash
# Stops the whole Docker stack started by ./scripts/run-all.sh and closes its
# log window. Data volumes (postgres, kafka, redis, minio) are kept.
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Log tabs opened by run-all.sh run "bash -c cd '<root>'; while true; do docker compose logs …".
# Ending that loop closes the tab (and the window once all tabs are gone).
pids=$(pgrep -f "^bash -c cd '$ROOT'; while true; do docker compose logs" || true)
if [ -n "$pids" ]; then
  echo "Closing log window…"
  kill $pids 2>/dev/null || true
fi

docker compose down
echo "Stack stopped (data kept). Start again with ./scripts/run-all.sh"
