@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\uvicorn.exe" (
    python -m venv .venv
    call .venv\Scripts\pip install -r requirements.txt
)
echo API: http://127.0.0.1:8000
.venv\Scripts\uvicorn.exe app.main:app --reload --host 127.0.0.1 --port 8000
