#!/usr/bin/env bash
# Останавливает типичные dev-процессы проекта (backend :8000, vite :5173+)
set -euo pipefail

PORTS=(8000 5173 5174 5175 5176)
killed=0

for port in "${PORTS[@]}"; do
  pids=$(lsof -ti :"$port" 2>/dev/null || true)
  if [[ -n "$pids" ]]; then
    echo "Порт $port: завершаю PID $pids"
    echo "$pids" | xargs kill -9 2>/dev/null || true
    killed=1
  fi
done

if [[ "$killed" -eq 0 ]]; then
  echo "Порты ${PORTS[*]} уже свободны."
else
  sleep 0.5
  echo "Готово. Запуск: ./run-dev.sh"
fi
