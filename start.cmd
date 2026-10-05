@echo off
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Please install Node.js 22.19.0 or newer.
  pause
  exit /b 1
)
node scripts\launch.mjs
if errorlevel 1 (
  pause
  exit /b 1
)
