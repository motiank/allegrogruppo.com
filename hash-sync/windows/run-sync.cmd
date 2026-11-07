@echo off
rem One sync run: load, then verify. Task Scheduler runs this file every night; sync-now.cmd runs it by hand.
rem The output goes to logs\sync-YYYY-MM.log. Exit code 0 = the copy matches Hashavshevet row by row.
rem One folder = one Hashavshevet company. For another company, install a second copy of the folder and change these two lines.
set "COMPANY=pastalina"
set "COMPANY_NAME=Pastalina"

cd /d "%~dp0"
set "NODE=node"
if exist "%~dp0node-path.txt" set /p NODE=<"%~dp0node-path.txt"
if not exist logs mkdir logs
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM"') do set "YM=%%i"
"%NODE%" src\sync.js --company %COMPANY% --name %COMPANY_NAME% --production %* >> "logs\sync-%YM%.log" 2>&1
exit /b %ERRORLEVEL%
