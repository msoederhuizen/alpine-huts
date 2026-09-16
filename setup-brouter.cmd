@echo off
REM Double-click me, or run from any directory.
REM %~dp0 is this file's own folder, so the working directory is always the
REM project root -- npm scripts fail with ENOENT if run from C:\Windows\System32,
REM which is where PowerShell opens when started as administrator.
cd /d "%~dp0"
set "PATH=%LOCALAPPDATA%\jdk-portable\bin;%LOCALAPPDATA%\nodejs-portable;%PATH%"
echo Working directory: %CD%
echo.
call npm run setup-brouter
echo.
pause
