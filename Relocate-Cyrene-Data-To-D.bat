@echo off
chcp 65001 >nul
echo ===================================================================
echo     CYRENE DESKTOP: RELOCATE DATA ^& DATABASE TO DRIVE D
echo ===================================================================
echo.
echo Target Location: D:\CyreneData
echo.

set "SOURCE=%APPDATA%\live2d-cyrene"
set "TARGET=D:\CyreneData"

if not exist "D:\" (
    echo [ERROR] Drive D does not exist! Please check your disk drives.
    pause
    exit /b 1
)

echo [1/4] Closing any running Cyrene Desktop instances...
taskkill /F /IM electron.exe /FI "WINDOWTITLE eq Cyrene*" 2>nul
taskkill /F /IM "Cyrene.exe" 2>nul
timeout /t 2 /nobreak >nul

echo [2/4] Ensuring D:\CyreneData exists...
if not exist "%TARGET%" mkdir "%TARGET%"

echo [3/4] Migrating existing database and user data from Drive C to Drive D...
if exist "%SOURCE%" (
    rem Check if it is already a junction
    fsutil reparsepoint query "%SOURCE%" >nul 2>&1
    if errorlevel 1 (
        echo Copying files to D:\CyreneData...
        robocopy "%SOURCE%" "%TARGET%" /E /MOVE /R:2 /W:1 /NP
        echo Removing old C: folder...
        rmdir /S /Q "%SOURCE%" 2>nul
    ) else (
        echo [INFO] %SOURCE% is already a Directory Junction to Drive D!
    )
)

echo [4/4] Creating NTFS Directory Junction (mklink /J)...
if not exist "%SOURCE%" (
    mklink /J "%SOURCE%" "%TARGET%"
    if errorlevel 1 (
        echo [WARN] Could not create junction automatically. Try running this script as Administrator.
    ) else (
        echo [SUCCESS] Successfully linked %SOURCE% -^> %TARGET%!
    )
) else (
    echo [INFO] Link is already active.
)

echo.
echo ===================================================================
echo   COMPLETED! All Cyrene vector DBs, memory, chats, and caches
echo   are now 100%% stored physically on Drive D!
echo ===================================================================
echo.
pause
