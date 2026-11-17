@echo off
REM Thin wrapper so the script can be launched by double-click.
REM All logic lives in start.ps1 - see the comment block there.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
if errorlevel 1 pause
