#!/usr/bin/env bash
# Starts EpubAI locally: backend on :3000, frontend on :5173.
# Ctrl+C stops both. Installs dependencies on first run if needed.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

if [ ! -f "$ROOT_DIR/.env" ]; then
  echo "Fehlt: $ROOT_DIR/.env (DATABASE_URL, R2_*, AUTH_SECRET_OTP, ...) - Server kann ohne nicht starten." >&2
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
    kill "$pid" 2>/dev/null || true
  done
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
