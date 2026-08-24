@echo off
setlocal
cd /d "%~dp0"

set "VENV_PY=%CD%\.venv\Scripts\python.exe"

if not exist "%VENV_PY%" (
    echo Creating the local Python environment...
    where py >nul 2>nul
    if not errorlevel 1 (
        py -3 -m venv ".venv"
    ) else (
        where python >nul 2>nul
        if errorlevel 1 (
            echo Python 3 was not found. Install Python 3.11 or newer and try again.
            pause
            exit /b 1
        )
        python -m venv ".venv"
    )
    if errorlevel 1 (
        echo Could not create the Python environment.
        pause
        exit /b 1
    )
)

"%VENV_PY%" -c "import fastapi, uvicorn, sqlalchemy, dotenv, multipart, openpyxl" >nul 2>nul
if errorlevel 1 (
    echo Installing backend dependencies...
    "%VENV_PY%" -m pip install -r "backend\requirements.txt"
    if errorlevel 1 (
        echo Backend dependency installation failed.
        pause
        exit /b 1
    )
)

rem echo Importing workbook data into SQLite (safe to run repeatedly)...
rem "%VENV_PY%" "backend\migrate.py"
rem if errorlevel 1 (
rem     echo Workbook migration failed.
rem     pause
rem     exit /b 1
rem )

echo Starting the backend at http://127.0.0.1:8000 ...
cd /d "%~dp0backend"
"%VENV_PY%" -m uvicorn server:app --host 127.0.0.1 --port 8000
