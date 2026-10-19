#!/bin/bash
# Starts the whole stack in Docker and opens one GNOME Terminal window with a
# live log tab per app (+ one tab for the infra containers).
# Usage:
#   ./scripts/run-all.sh          build + start everything, open the log window
#   ./scripts/run-all.sh logs     only open the log window (stack already running)
#   ./scripts/run-all.sh down     stop the stack (data volumes are kept)
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

APPS=(api-gateway auth-service staff-service patient-service appointment-service
  medical-record-service billing-service file-service notification-history-service
  configurations-service)
INFRA="postgres kafka kafka-init kafka-ui redis minio mailpit"

# One tab's command: follow the logs; when the stream ends (container
# stopped/recreated) wait for Enter and attach again instead of closing the tab.
tab_cmd() {
  local services=$1
  echo "cd '$ROOT'; while true; do docker compose logs -f --tail=100 $services; echo; read -rp '── log stream ended — Enter to reattach, Ctrl+C to close ── ' _; done"
}

open_log_window() {
  if ! command -v gnome-terminal >/dev/null || [ -z "$DISPLAY$WAYLAND_DISPLAY" ]; then
    echo "gnome-terminal / desktop session not found — showing logs here instead."
    exec docker compose logs -f --tail=100
  fi

  local args=(--window --title="gateway" --command="bash -c \"$(tab_cmd api-gateway)\"")
  for app in "${APPS[@]:1}"; do
    args+=(--tab --title="${app%-service}" --command="bash -c \"$(tab_cmd "$app")\"")
  done
  args+=(--tab --title="infra" --command="bash -c \"$(tab_cmd "$INFRA")\"")

  # --command/--title are deprecated in newer gnome-terminal but still work;
  # silence the warnings
  gnome-terminal "${args[@]}" 2>/dev/null
}

wait_for_gateway() {
  echo -n "Waiting for the gateway"
  for _ in $(seq 1 90); do
    if curl -sf localhost:3000/api/v1/health >/dev/null; then
      echo " ✓"
      echo "All services are up → http://localhost:3000/api/v1/health"
      return
    fi
    echo -n "."
    sleep 2
  done
  echo
  echo "Gateway is not healthy yet — check the log tabs (or: docker compose ps)."
}

case "${1:-up}" in
  up)
    docker compose up -d --build
    open_log_window
    wait_for_gateway
    ;;
  logs)
    open_log_window
    ;;
  down)
    docker compose down
    ;;
  *)
    echo "Usage: $0 [up|logs|down]"
    exit 1
    ;;
esac
