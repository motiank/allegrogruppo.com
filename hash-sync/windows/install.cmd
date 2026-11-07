@echo off
rem Installs the Hashavshevet sync: checks Node.js, installs the packages, creates .env and checks the connections.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
echo.
pause
