#!/usr/bin/env bash
# Starts EpubAI locally: backend on :3000, frontend on :5173.
# Ctrl+C stops both. Installs dependencies on first run if needed.

set -euo pipefail
# Job control: each backgrounded job below gets its own process group, with
# the job's PID as the group leader. That lets cleanup() below signal the
# whole group (parent PID negated) in one shot - `npm run dev` doesn't
# reliably forward TERM to its child (vite/tsx watch), so killing only the
# `npm` PID used to leave the actual dev server orphaned and holding the port.
set -m

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

if [ ! -f "$ROOT_DIR/.env" ]; then
  echo "Fehlt: $ROOT_DIR/.env (DATABASE_URL, R2_*, RESEND_API_KEY, AUTH_FROM_EMAIL, ...) - Server kann ohne nicht starten." >&2
  exit 1
fi

if [ ! -d "$BACKEND_DIR/node_modules" ]; then
  echo "==> Installiere Backend-Abhängigkeiten..."
  (cd "$BACKEND_DIR" && npm install)
fi

if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
  echo "==> Installiere Frontend-Abhängigkeiten..."
  (cd "$FRONTEND_DIR" && npm install)
fi

PIDS=()

cleanup() {
  trap - EXIT INT TERM
  echo ""
  echo "==> Stoppe Server..."
  for pid in "${PIDS[@]}"; do
    kill -TERM "-$pid" 2>/dev/null || true
  done
  # Give them a few seconds to shut down cleanly before forcing it.
  for _ in 1 2 3 4 5; do
    any_alive=false
    for pid in "${PIDS[@]}"; do
      kill -0 "$pid" 2>/dev/null && any_alive=true
    done
    "$any_alive" || break
    sleep 1
  done
  for pid in "${PIDS[@]}"; do
    kill -KILL "-$pid" 2>/dev/null || true
  done
  # Last resort: whatever still holds our ports (e.g. a stray process from an
  # earlier, uncleanly-stopped run) gets force-killed directly, so the next
  # start never fails with "port already in use".
  local stragglers
  stragglers="$(lsof -ti:3000,5173 2>/dev/null || true)"
  if [ -n "$stragglers" ]; then
    echo "$stragglers" | xargs kill -KILL 2>/dev/null || true
  fi
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "==> Starte Backend (Port 3000)..."
(cd "$BACKEND_DIR" && npm run dev) &
PIDS+=("$!")

echo "==> Starte Frontend (Port 5173)..."
(cd "$FRONTEND_DIR" && npm run dev) &
PIDS+=("$!")

sleep 2
echo ""
echo "EpubAI läuft:"
echo "  Backend:  http://localhost:3000"
echo "  Frontend: http://localhost:5173"
echo ""
echo "Strg+C zum Beenden."

wait
