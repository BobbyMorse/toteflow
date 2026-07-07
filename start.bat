@echo off
title ToteFlow
cd /d "%~dp0"

echo.
echo  ToteFlow dev server
echo  ---------------------------------------------
echo  Killing any old server on port 3000...

for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":3000 " ^| findstr "LISTENING"') do (
    echo  Killing PID %%P
    taskkill /F /PID %%P >nul 2>&1
)

echo.
echo  URL:  http://localhost:3000
echo  Stop: Ctrl+C  (then Y to confirm)
echo.

start "" /min cmd /c "timeout /t 6 >nul && start http://localhost:3000/stats"

call npm run dev
pause
