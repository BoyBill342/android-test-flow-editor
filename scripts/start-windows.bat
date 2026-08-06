@echo off
setlocal EnableExtensions EnableDelayedExpansion

cd /d "%~dp0\.."
set "ROOT_DIR=%cd%"
set "BACKEND_DIR=%ROOT_DIR%\backend"
set "FRONTEND_DIR=%ROOT_DIR%\frontend"
set "BACKEND_VENV_PY=%BACKEND_DIR%\.venv\Scripts\python.exe"
set "BACKEND_VENV_PIP=%BACKEND_DIR%\.venv\Scripts\pip.exe"
set "BACKEND_DEPS_MARKER=%BACKEND_DIR%\.venv\.deps_installed"
set "FLAGS_FILE=%ROOT_DIR%\scripts\start-windows.flags.txt"

set "BACKEND_HOST=127.0.0.1"
set "BACKEND_PORT=8000"
set "FRONTEND_HOST=127.0.0.1"
set "FRONTEND_PORT=5173"
set "FRONTEND_API_BASE="
set "OPEN_BROWSER=1"
set "FORCE_INSTALL=0"
set "REBUILD_VENV=0"
set "ENABLE_LOGIN=0"

if exist "%FLAGS_FILE%" (
  for /f "usebackq eol=# tokens=1,* delims==" %%A in ("%FLAGS_FILE%") do (
    if /I "%%~A"=="BACKEND_HOST" set "BACKEND_HOST=%%~B"
    if /I "%%~A"=="BACKEND_PORT" set "BACKEND_PORT=%%~B"
    if /I "%%~A"=="FRONTEND_HOST" set "FRONTEND_HOST=%%~B"
    if /I "%%~A"=="FRONTEND_PORT" set "FRONTEND_PORT=%%~B"
    if /I "%%~A"=="FRONTEND_API_BASE" set "FRONTEND_API_BASE=%%~B"
    if /I "%%~A"=="OPEN_BROWSER" set "OPEN_BROWSER=%%~B"
    if /I "%%~A"=="FORCE_INSTALL" set "FORCE_INSTALL=%%~B"
    if /I "%%~A"=="REBUILD_VENV" set "REBUILD_VENV=%%~B"
    if /I "%%~A"=="ENABLE_LOGIN" set "ENABLE_LOGIN=%%~B"
  )
)

if /I "%~1"=="--install" set "FORCE_INSTALL=1"
if /I "%~1"=="--rebuild-venv" set "REBUILD_VENV=1"

if "%FRONTEND_API_BASE%"=="" set "FRONTEND_API_BASE=http://%BACKEND_HOST%:%BACKEND_PORT%/api"
if /I not "%OPEN_BROWSER%"=="0" set "OPEN_BROWSER=1"

set "BROWSER_HOST=%FRONTEND_HOST%"
if "%BROWSER_HOST%"=="0.0.0.0" set "BROWSER_HOST=127.0.0.1"

echo Using flags file: %FLAGS_FILE%
echo Backend: %BACKEND_HOST%:%BACKEND_PORT%
echo Frontend: %FRONTEND_HOST%:%FRONTEND_PORT%
echo API base for frontend: %FRONTEND_API_BASE%
if "%ENABLE_LOGIN%"=="1" (
  if "%LOGIN_USERNAME%"=="" (
    echo ERROR: ENABLE_LOGIN=1 requires LOGIN_USERNAME in process environment.
    exit /b 1
  )
  if "%LOGIN_PASSWORD%"=="" (
    echo ERROR: ENABLE_LOGIN=1 requires LOGIN_PASSWORD in process environment.
    exit /b 1
  )
)

echo [1/7] Checking required tools...
where python >nul 2>nul
if errorlevel 1 (
  echo ERROR: Python is not installed or not in PATH.
  echo Install Python 3.10+ and retry.
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo ERROR: npm is not installed or not in PATH.
  echo Install Node.js 18+ and retry.
  exit /b 1
)

where adb >nul 2>nul
if errorlevel 1 (
  echo WARNING: adb is not in PATH. Device features will not work until adb is available.
)

if not exist "%BACKEND_DIR%\requirements.txt" (
  echo ERROR: Missing backend\requirements.txt
  exit /b 1
)

if not exist "%FRONTEND_DIR%\package.json" (
  echo ERROR: Missing frontend\package.json
  exit /b 1
)

echo [2/7] Preparing backend virtual environment...
if "%REBUILD_VENV%"=="1" (
  echo Rebuild venv mode enabled.
  if exist "%BACKEND_DIR%\.venv" rmdir /s /q "%BACKEND_DIR%\.venv"
)

if not exist "%BACKEND_VENV_PY%" (
  python -m venv "%BACKEND_DIR%\.venv"
  if errorlevel 1 (
    echo ERROR: Failed to create backend virtual environment.
    exit /b 1
  )
)

"%BACKEND_VENV_PY%" -c "import sys; print(sys.executable)" >nul 2>nul
if errorlevel 1 (
  echo WARNING: backend virtual environment python check failed. Rebuilding .venv...
  if exist "%BACKEND_DIR%\.venv" rmdir /s /q "%BACKEND_DIR%\.venv"
  python -m venv "%BACKEND_DIR%\.venv"
  if errorlevel 1 (
    echo ERROR: Failed to rebuild backend virtual environment.
    exit /b 1
  )
)

if not exist "%BACKEND_VENV_PIP%" (
  echo ERROR: Missing backend virtual environment pip executable.
  echo Delete backend\.venv and rerun this script.
  exit /b 1
)

echo [3/7] Installing backend dependencies...
if "%FORCE_INSTALL%"=="1" (
  echo Force install mode enabled.
  "%BACKEND_VENV_PIP%" install -r "%BACKEND_DIR%\requirements.txt"
  if errorlevel 1 (
    echo ERROR: Failed to install backend dependencies.
    exit /b 1
  )
  type nul > "%BACKEND_DEPS_MARKER%"
) else (
  if not exist "%BACKEND_DEPS_MARKER%" (
    "%BACKEND_VENV_PIP%" install -r "%BACKEND_DIR%\requirements.txt"
    if errorlevel 1 (
      echo ERROR: Failed to install backend dependencies.
      exit /b 1
    )
    type nul > "%BACKEND_DEPS_MARKER%"
  ) else (
    echo Backend dependencies already installed. Use --install to reinstall.
  )
)

echo [4/7] Installing frontend dependencies if needed...
if not exist "%FRONTEND_DIR%\node_modules" (
  call npm --prefix "%FRONTEND_DIR%" install
  if errorlevel 1 (
    echo ERROR: Failed to install frontend dependencies.
    exit /b 1
  )
) else (
  echo Frontend dependencies already present.
)

echo [5/7] Starting backend server in new window...
start "Android Test Flow Editor Backend" cmd /k "title Android Test Flow Editor Backend && cd /d ""%BACKEND_DIR%"" && call "".venv\Scripts\activate.bat"" && set ENABLE_LOGIN=%ENABLE_LOGIN% && set LOGIN_USERNAME=%LOGIN_USERNAME% && set LOGIN_PASSWORD=%LOGIN_PASSWORD% && python -m uvicorn app.main:app --host %BACKEND_HOST% --port %BACKEND_PORT% --reload"

echo [6/7] Starting frontend server in new window...
start "Android Test Flow Editor Frontend" cmd /k "title Android Test Flow Editor Frontend && cd /d ""%FRONTEND_DIR%"" && set VITE_API_BASE=%FRONTEND_API_BASE% && npm run dev -- --host %FRONTEND_HOST% --port %FRONTEND_PORT%"

echo [7/7] Opening browser...
if "%OPEN_BROWSER%"=="1" (
  timeout /t 3 >nul
  start "" "http://%BROWSER_HOST%:%FRONTEND_PORT%"
) else (
  echo Browser auto-open disabled by OPEN_BROWSER=0
)

echo.
echo Android Test Flow Editor started.
echo Use scripts\stop-windows.bat to close both server windows.

exit /b 0
