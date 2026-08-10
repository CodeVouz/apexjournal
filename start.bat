@echo off
title Apex Journal - MT5 Live Trading Journal
cd /d "%~dp0"
echo.
echo   Starting MT5 bridge (it launches the MT5 terminal itself)...
start "MT5 Bridge" /min python mt5_bridge.py
timeout /t 3 /nobreak >nul
echo   Starting web server on http://localhost:3000 ...
echo.
node server/index.js
