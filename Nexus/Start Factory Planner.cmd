@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0_Mods\FactoryDashboard\start.ps1"
if errorlevel 1 (
  echo.
  echo Factory Planner could not start. See Factory Planner README.txt.
  pause
  exit /b 1
)
