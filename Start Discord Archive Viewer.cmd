@echo off
setlocal
title Discord Archive Viewer
cd /d "%~dp0"

where node.exe >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Discord Archive Viewer needs Node.js 22 or newer.
  echo  Install it from https://nodejs.org and then double-click this file again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\vite\package.json" (
  echo.
  echo  Preparing Discord Archive Viewer for its first run...
  echo  This can take a minute and only needs to happen once.
  echo.
  call npm.cmd install
  if errorlevel 1 (
    echo.
    echo  Setup did not finish. Check your internet connection and try again.
    echo.
    pause
    exit /b 1
  )
)

powershell.exe -NoProfile -Command "try { $page = Invoke-WebRequest -UseBasicParsing 'http://localhost:5173/' -TimeoutSec 2; if ($page.Content -match 'Discord Archive Viewer') { exit 0 } } catch {}; exit 1" >nul 2>nul
if not errorlevel 1 (
  start "" "http://localhost:5173/"
  exit /b 0
)

echo.
echo  Starting Discord Archive Viewer...
echo  Your browser will open automatically. Keep this window open while using the viewer.
echo  Close this window when you are finished.
echo.

start "" /min powershell.exe -NoProfile -WindowStyle Hidden -Command "$deadline = (Get-Date).AddSeconds(60); while ((Get-Date) -lt $deadline) { try { $page = Invoke-WebRequest -UseBasicParsing 'http://localhost:5173/' -TimeoutSec 2; if ($page.Content -match 'Discord Archive Viewer') { Start-Process 'http://localhost:5173/'; exit 0 } } catch {}; Start-Sleep -Milliseconds 500 }"
call npm.cmd run dev

echo.
echo  Discord Archive Viewer has stopped.
pause
