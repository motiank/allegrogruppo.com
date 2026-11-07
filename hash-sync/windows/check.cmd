@echo off
rem Checks the settings in .env: connects to the SQL Server and to the MySQL server. Changes nothing.
cd /d "%~dp0"
set "NODE=node"
if exist "%~dp0node-path.txt" set /p NODE=<"%~dp0node-path.txt"
"%NODE%" src\check.js --production
echo.
pause
