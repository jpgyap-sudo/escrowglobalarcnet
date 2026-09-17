@echo off
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
 echo Install Node.js 22.13 or newer before running the local server.
 pause
 exit /b 1
)
echo Open http://127.0.0.1:4173 after the server starts.
echo This is a local sandbox. Never enter private keys or real customer data.
node server.mjs
pause
