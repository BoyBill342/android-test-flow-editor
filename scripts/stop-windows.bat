@echo off
setlocal

cd /d "%~dp0\.."
set "ROOT_DIR=%cd%"
set "FRONTEND_DIR=%ROOT_DIR%\frontend"
set "BACKEND_DIR=%ROOT_DIR%\backend"
set "FLAGS_FILE=%ROOT_DIR%\scripts\start-windows.flags.txt"

set "BACKEND_HOST=127.0.0.1"
set "BACKEND_PORT=8000"
set "FRONTEND_HOST=127.0.0.1"
set "FRONTEND_PORT=5173"

if exist "%FLAGS_FILE%" (
	for /f "usebackq eol=# tokens=1,* delims==" %%A in ("%FLAGS_FILE%") do (
		if /I "%%~A"=="BACKEND_HOST" set "BACKEND_HOST=%%~B"
		if /I "%%~A"=="BACKEND_PORT" set "BACKEND_PORT=%%~B"
		if /I "%%~A"=="FRONTEND_HOST" set "FRONTEND_HOST=%%~B"
		if /I "%%~A"=="FRONTEND_PORT" set "FRONTEND_PORT=%%~B"
	)
)

echo Stopping Android Test Flow Editor windows...

taskkill /FI "WINDOWTITLE eq Android Test Flow Editor Backend*" /T /F >nul 2>nul
taskkill /FI "WINDOWTITLE eq Android Test Flow Editor Frontend*" /T /F >nul 2>nul
taskkill /FI "WINDOWTITLE eq ADB Editor Backend*" /T /F >nul 2>nul
taskkill /FI "WINDOWTITLE eq ADB Editor Frontend*" /T /F >nul 2>nul

echo Stopping launcher cmd windows by command line...
powershell -NoProfile -Command "$b=%BACKEND_PORT%; $f=%FRONTEND_PORT%; $cmds = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'cmd.exe' -and (($_.CommandLine -match ('python -m uvicorn app.main:app --host .* --port ' + $b + ' --reload')) -or ($_.CommandLine -match ('npm run dev -- --host .* --port ' + $f))) }; $cmds | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>nul

echo Stopping node/vite processes for this workspace...
powershell -NoProfile -Command "$f=[regex]::Escape('%FRONTEND_DIR%'); Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'vite' -and $_.CommandLine -match $f } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>nul

echo Stopping processes on ports %BACKEND_PORT% and %FRONTEND_PORT%...
powershell -NoProfile -Command "$ports=@(%BACKEND_PORT%,%FRONTEND_PORT%) | Sort-Object -Unique; Get-NetTCPConnection -State Listen -LocalPort $ports -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { if ($_ -ne 0) { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }" >nul 2>nul

echo Done.
exit /b 0
