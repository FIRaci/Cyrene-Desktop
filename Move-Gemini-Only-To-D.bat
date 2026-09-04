@echo off
chcp 65001 >nul
title Move .gemini to Drive D (NTFS Junction)
echo ===================================================================
echo     RELOCATE .GEMINI TO DRIVE D (RECOVER ~4.71 GB ON DRIVE C)
echo ===================================================================
echo.

set "USERDIR=C:\Users\%USERNAME%"

if not exist "D:\" (
    echo [ERROR] Drive D not detected!
    pause
    exit /b 1
)

:: Check if already linked
powershell -NoProfile -Command "$item = Get-Item -LiteralPath '%USERDIR%\.gemini' -Force -ErrorAction SilentlyContinue; if ($item -and $item.LinkType -eq 'Junction') { exit 0 } else { exit 1 }"
if %ERRORLEVEL% equ 0 (
    echo [INFO] C:\Users\%USERNAME%\.gemini is ALREADY linked to Drive D!
    powershell -NoProfile -Command "Get-Item '%USERDIR%\.gemini' | Select-Object Name, LinkType, Target | Format-Table -AutoSize"
    echo.
    pause
    exit /b 0
)

:: Check if Antigravity IDE is still running
echo [1/3] Checking for running Antigravity IDE processes...
tasklist /FI "IMAGENAME eq Antigravity IDE.exe" 2>nul | findstr /I "Antigravity" >nul
if not errorlevel 1 (
    echo.
    echo [WARNING] Antigravity IDE is currently RUNNING!
    echo Please close Antigravity IDE window completely, then press any key to continue.
    echo.
    pause
    tasklist /FI "IMAGENAME eq Antigravity IDE.exe" 2>nul | findstr /I "Antigravity" >nul
    if not errorlevel 1 (
        echo [ERROR] Antigravity IDE is still running. Please close it first.
        pause
        exit /b 1
    )
)

echo [2/3] Moving .gemini (~4.71 GB) to D:\.gemini ...
if not exist "D:\.gemini" mkdir "D:\.gemini"
robocopy "%USERDIR%\.gemini" "D:\.gemini" /E /MOVE /R:2 /W:1 /NP
set "ROBO_RC=%ERRORLEVEL%"

if %ROBO_RC% gtr 7 (
    echo [ERROR] Robocopy failed with code %ROBO_RC%. Some files might be locked.
    pause
    exit /b 1
)

echo [3/3] Creating transparent NTFS Directory Junction...
rmdir /S /Q "%USERDIR%\.gemini" 2>nul
mklink /J "%USERDIR%\.gemini" "D:\.gemini"

echo.
echo Verification:
powershell -NoProfile -Command "Get-Item '%USERDIR%\.gemini' | Select-Object Name, LinkType, Target | Format-Table -AutoSize"
powershell -NoProfile -Command "Get-PSDrive C, D | Select-Object Root, @{Name='FreeGB';Expression={[math]::Round($_.Free/1GB,2)}} | Format-Table -AutoSize"

echo ===================================================================
echo   COMPLETED! .gemini is now safely located on Drive D!
echo   You can reopen Antigravity IDE now.
echo ===================================================================
echo.
pause
