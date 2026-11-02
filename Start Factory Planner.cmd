@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
if errorlevel 1 (
  echo.
  echo Factory Planner could not start. See README.md or the error above.
  pause
  exit /b 1
)
