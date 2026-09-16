@echo off
REM Double-click me AFTER start-brouter.cmd is already running.
REM
REM Publishes the local BRouter (port 17777) through a Cloudflare quick tunnel,
REM because this machine's Wi-Fi is a "Public" network with no inbound rule for
REM 17777 -- so the phone cannot reach it directly. The tunnel dials OUT, which
REM needs no firewall change and no admin rights.
REM
REM !! The URL CHANGES every time this restarts. Copy the
REM    https://<something>.trycloudflare.com line it prints into .env as:
REM      EXPO_PUBLIC_BROUTER_URL=https://<that-host>/brouter
REM    then restart Expo (it only reads .env at startup).
cd /d "%~dp0"
echo Checking BRouter is up on 17777...
curl.exe -s -o NUL -w "  local BRouter -> HTTP %%{http_code}\n" "http://127.0.0.1:17777/brouter?lonlats=7.96,46.59|7.98,46.62&profile=hiking-beta&alternativeidx=0&format=geojson"
echo.
echo If that was not 200, start start-brouter.cmd first and leave it open.
echo.
echo Starting tunnel -- copy the trycloudflare.com URL below into .env
echo.
brouter\cloudflared.exe tunnel --url http://127.0.0.1:17777 --no-autoupdate
pause
