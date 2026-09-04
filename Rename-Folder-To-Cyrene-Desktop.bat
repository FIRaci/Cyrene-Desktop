@echo off
chcp 65001 >nul
echo ===================================================================
echo     RENAME WORKSPACE: D:\Cyrene Test -^> D:\Cyrene-Desktop
echo ===================================================================
echo.
echo [IMPORTANT] Please ensure you are ready to close Antigravity IDE
echo and any open terminals before proceeding.
echo.
pause

set "OLD_DIR=D:\Cyrene Test"
set "NEW_DIR=D:\Cyrene-Desktop"

if not exist "%OLD_DIR%" (
    if exist "%NEW_DIR%" (
        echo [INFO] Folder is already named %NEW_DIR%!
    ) else (
        echo [ERROR] Could not find %OLD_DIR%.
    )
    pause
    exit /b 0
)

echo.
echo [1/3] Terminating any lingering processes holding files in %OLD_DIR% ...
taskkill /F /IM "Antigravity IDE.exe" 2>nul
taskkill /F /IM electron.exe 2>nul
taskkill /F /IM node.exe 2>nul
taskkill /F /IM git.exe 2>nul
timeout /t 2 /nobreak >nul

echo [2/3] Changing working directory outside %OLD_DIR% to unlock folder ...
cd /d "D:\"

echo [3/3] Renaming %OLD_DIR% to Cyrene-Desktop ...
rename "%OLD_DIR%" "Cyrene-Desktop"

if errorlevel 1 (
    echo.
    echo [ERROR] Rename failed!
    echo A process (such as a terminal, VS Code, or Antigravity IDE) is still locking the directory.
    echo Please open Task Manager, end any running "Antigravity IDE", "node", or "terminal" tasks, then run this file again.
) else (
    echo.
    echo ===================================================================
    echo [SUCCESS] Folder successfully renamed to: %NEW_DIR%
    echo You can now open %NEW_DIR% in Antigravity IDE!
    echo ===================================================================
)

echo.
pause
