# Запуск backend + frontend для разработки (аналог run-dev.sh)
$ErrorActionPreference = "Stop"

function Find-Python {
    $candidates = @(
        @{ Exe = "py"; Args = @("-3") },
        @{ Exe = "python"; Args = @() },
        @{ Exe = "python3"; Args = @() }
    )
    foreach ($candidate in $candidates) {
        if (-not (Get-Command $candidate.Exe -ErrorAction SilentlyContinue)) {
            continue
        }
        $checkArgs = $candidate.Args + @(
            "-c",
            "import sys; raise SystemExit(0 if sys.version_info >= (3, 9) else 1)"
        )
        & $candidate.Exe @checkArgs 2>$null
        if ($LASTEXITCODE -eq 0) {
            return $candidate
        }
    }
    return $null
}

function Invoke-Python {
    param(
        [Parameter(Mandatory = $true)]
        $Python,
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]]$ScriptArgs
    )
    & $Python.Exe @($Python.Args + $ScriptArgs)
    if ($LASTEXITCODE -ne 0) {
        throw "Команда Python завершилась с кодом $LASTEXITCODE"
    }
}

function Show-MissingPythonHelp {
    Write-Host ""
    Write-Host "Python 3.9+ не найден в PATH." -ForegroundColor Red
    Write-Host ""
    Write-Host "Установите Python одним из способов:"
    Write-Host "  1. Сайт: https://www.python.org/downloads/"
    Write-Host "     При установке включите «Add python.exe to PATH»."
    Write-Host "  2. Через winget (в терминале от администратора):"
    Write-Host "     winget install Python.Python.3.12"
    Write-Host "  3. Microsoft Store: найдите «Python 3.12»."
    Write-Host ""
    Write-Host "После установки закройте и снова откройте терминал, затем запустите run-dev.bat"
    Write-Host ""
}

function Show-MissingNodeHelp {
    Write-Host ""
    Write-Host "npm (Node.js) не найден в PATH." -ForegroundColor Red
    Write-Host ""
    Write-Host "Установите Node.js:"
    Write-Host "  1. Сайт: https://nodejs.org/ (LTS)"
    Write-Host "  2. Через winget:"
    Write-Host "     winget install OpenJS.NodeJS.LTS"
    Write-Host ""
    Write-Host "После установки перезапустите терминал и снова запустите run-dev.bat"
    Write-Host ""
}

$root = $PSScriptRoot
Set-Location $root

if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "Создан .env — заполните TRACKER_OAUTH_TOKEN и TRACKER_ORG_ID"
}

$python = Find-Python
if (-not $python) {
    Show-MissingPythonHelp
    exit 1
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Show-MissingNodeHelp
    exit 1
}

$backendDir = Join-Path $root "backend"
$venvPython = Join-Path $backendDir ".venv\Scripts\python.exe"
$venvPip = Join-Path $backendDir ".venv\Scripts\pip.exe"

if (-not (Test-Path $venvPython)) {
    Write-Host "Создаю виртуальное окружение…"
    Push-Location $backendDir
    try {
        Invoke-Python $python "-m", "venv", ".venv"
    }
    finally {
        Pop-Location
    }
}

& $venvPip install -q -r (Join-Path $backendDir "requirements.txt")

Write-Host "Backend: http://127.0.0.1:8000"
$backendProc = Start-Process `
    -FilePath $venvPython `
    -ArgumentList "-m", "uvicorn", "app.main:app", "--reload", "--host", "127.0.0.1", "--port", "8000" `
    -WorkingDirectory $backendDir `
    -PassThru `
    -NoNewWindow

function Stop-Backend {
    if ($null -eq $backendProc -or $backendProc.HasExited) {
        return
    }
    Write-Host ""
    Write-Host "Останавливаю backend…"
    # uvicorn --reload поднимает дочерний процесс
    taskkill /PID $backendProc.Id /T /F 2>$null | Out-Null
}

try {
    Start-Sleep -Seconds 2

    $frontendDir = Join-Path $root "frontend"
    Set-Location $frontendDir
    if (-not (Test-Path "node_modules")) {
        Write-Host "npm install…"
        npm install
    }

    Write-Host "Frontend: http://localhost:5173"
    Write-Host "OAuth-токен: http://localhost:5173/oauth/start (или http://127.0.0.1:8000/oauth/start)"
    Write-Host "Ctrl+C — остановить оба процесса"
    npm run dev
}
finally {
    Stop-Backend
}
