# Запуск backend + frontend для разработки (два окна терминала вручную или через Start-Process)
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "Создан .env — заполните TRACKER_OAUTH_TOKEN и TRACKER_ORG_ID"
}

$backend = Start-Process -PassThru -WorkingDirectory "$root\backend" -ArgumentList @(
    "-NoProfile", "-Command",
    "python -m venv .venv 2>`$null; .\.venv\Scripts\Activate.ps1; pip install -q -r requirements.txt; uvicorn app.main:app --reload --host 127.0.0.1 --port 8000"
) -WindowStyle Normal

Start-Sleep -Seconds 2
Set-Location "$root\frontend"
if (-not (Test-Path "node_modules")) { npm install }
npm run dev
