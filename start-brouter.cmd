@echo off
REM Double-click me to start the local BRouter routing server.
REM Leave this window open while you use the app -- closing it stops routing.
cd /d "%~dp0"
set "PATH=%LOCALAPPDATA%\jdk-portable\bin;%LOCALAPPDATA%\nodejs-portable;%PATH%"
echo Working directory: %CD%
echo.
echo Your LAN addresses (use one of these in .env, NOT localhost):
ipconfig | findstr /C:"IPv4 Address"
echo.
echo   EXPO_PUBLIC_BROUTER_URL=http://YOUR-IP:17777/brouter
echo.
echo Starting BRouter on port 17777 -- Ctrl+C to stop.
echo.
call npm run brouter
pause
