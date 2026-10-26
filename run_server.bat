@echo off
title CGPA Management System Server
color 0A

echo ========================================================
echo   Starting CGPA Management System Server (v2.0)...
echo ========================================================
echo.

:: 1. Free port 3000 by killing any stuck previous node process
echo Checking for previous server on port 3000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000') do (
    taskkill /f /pid %%a >nul 2>&1
)

echo Port 3000 is clean!
echo Starting node server.js...
echo.

:: 2. Launch browser automatically after 1 second
start http://localhost:3000

:: 3. Run node server
node server.js

pause
