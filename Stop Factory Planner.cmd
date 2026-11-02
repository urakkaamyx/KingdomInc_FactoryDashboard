@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop.ps1"
if errorlevel 1 (
  echo.
  echo Factory Planner could not stop its recorded dashboard server.
  pause
  exit /b 1
)
