#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

if ! command -v python3 &>/dev/null; then
  echo "python3 не найден"
  exit 1
fi

if [[ ! -d .venv ]]; then
  echo "Создаю виртуальное окружение…"
  python3 -m venv .venv
fi

# shellcheck source=/dev/null
source .venv/bin/activate
pip install -q -r requirements.txt

echo "API: http://127.0.0.1:8000"
exec uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
