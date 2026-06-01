# Запуск API из каталога backend (важно для импорта app.*)
Set-Location $PSScriptRoot

if (-not (Test-Path ".\.venv\Scripts\python.exe")) {
    Write-Host "Создаю виртуальное окружение..."
    python -m venv .venv
    .\.venv\Scripts\pip install -r requirements.txt
}

Write-Host "API: http://127.0.0.1:8000"
.\.venv\Scripts\uvicorn.exe app.main:app --reload --host 127.0.0.1 --port 8000
