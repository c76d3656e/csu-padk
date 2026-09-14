@echo off
title CSU Padk - Standalone Service
cd /d "%~dp0"

echo.
echo   ==========================================
echo     CSU Padk  .  Standalone Service
echo   ==========================================
echo.

rem -- 1) dependencies --
if not exist "node_modules" (
  echo   [1/3] First run. Installing dependencies, about 1 minute...
  call npm install --no-audit --no-fund
  if errorlevel 1 goto fail
) else (
  echo   [1/3] Dependencies OK
)

rem -- 2) build output --
if not exist "dist\index.html" (
  echo   [2/3] Building frontend...
  call npm run build
  if errorlevel 1 goto fail
) else (
  echo   [2/3] Build artifacts OK
)

rem -- 3) start --
echo   [3/3] Starting server...
echo.
echo   URL    http://localhost:5173/
echo   Phone  same WiFi, use this PC's LAN IP with :5173
echo.
echo   The service keeps running. Close this window to stop it.
echo.

start "" http://localhost:5173/
node server.mjs

echo.
echo   Service stopped.
pause
goto :eof

:fail
echo.
echo   FAILED. See the output above.
pause
