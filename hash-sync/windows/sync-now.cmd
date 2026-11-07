@echo off
rem Runs the sync now, by hand, and shows the log while it runs.
cd /d "%~dp0"
if not exist logs mkdir logs
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM"') do set "YM=%%i"
echo. >> "logs\sync-%YM%.log"
echo The sync runs now. The first run copies everything and can take a long time.
echo A second window shows the log (logs\sync-%YM%.log). Close it when the sync is finished.
start "Hashavshevet sync - log" powershell -NoProfile -Command "Get-Content -Path 'logs\sync-%YM%.log' -Wait -Tail 20"
call "%~dp0run-sync.cmd" %*
set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" (echo Finished: the copy matches Hashavshevet.) else (echo FAILED with exit code %RC%. Read the log.)
pause
