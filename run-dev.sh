#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Создан .env — заполните TRACKER_OAUTH_TOKEN и TRACKER_ORG_ID"
fi

if ! command -v python3 &>/dev/null; then
  echo "python3 не найден. Установите Python 3.9+ (например: brew install python@3.12)"
  exit 1
fi

if ! command -v npm &>/dev/null; then
  echo "npm не найден. Установите Node.js (например: brew install node)"
  exit 1
fi

BACKEND_DIR="$ROOT/backend"
cd "$BACKEND_DIR"

if [[ ! -d .venv ]]; then
  echo "Создаю виртуальное окружение…"
  python3 -m venv .venv
fi

# shellcheck source=/dev/null
source .venv/bin/activate
pip install -q -r requirements.txt

echo "Backend: http://127.0.0.1:8000"
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000 &
BACKEND_PID=$!

cleanup() {
  echo
  echo "Останавливаю backend…"
  kill "$BACKEND_PID" 2>/dev/null || true
  wait "$BACKEND_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

sleep 2

cd "$ROOT/frontend"
if [[ ! -d node_modules ]]; then
  echo "npm install…"
  npm install
fi

echo "Frontend: http://localhost:5173"
echo "OAuth-токен: http://localhost:5173/oauth/start (или http://127.0.0.1:8000/oauth/start)"
echo "Ctrl+C — остановить оба процесса"
npm run dev
