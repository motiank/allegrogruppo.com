@echo off
rem Creates the Windows task that runs the sync every night. Asks for administrator rights.
rem   schedule.cmd            every day at 02:00
rem   schedule.cmd 03:30      every day at another time
rem   schedule.cmd /remove    removes the task
set "ARGS="
if /i "%~1"=="/remove" (set "ARGS=-Remove") else if not "%~1"=="" (set "ARGS=-Time %~1")
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile -ExecutionPolicy Bypass -NoExit -File \"%~dp0schedule.ps1\" %ARGS%'"
