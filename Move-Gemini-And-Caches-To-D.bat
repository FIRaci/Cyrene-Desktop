@echo off
chcp 65001 >nul
echo ===================================================================
echo     FREE DRIVE C: RELOCATE DEV CACHES ^& .GEMINI TO DRIVE D
echo ===================================================================
echo.
echo This script moves developer cache folders from C:\Users\%USERNAME%
echo to D:\ and creates transparent NTFS Directory Junctions (mklink /J).
echo Windows and Antigravity IDE will continue to work identically without errors!
echo.
echo Folders eligible to move:
echo   - C:\Users\%USERNAME%\.gradle  (~8.55 GB)
echo   - C:\Users\%USERNAME%\.cache   (~2.12 GB)
echo   - C:\Users\%USERNAME%\.m2      (~1.37 GB)
echo   - C:\Users\%USERNAME%\.gemini  (~4.72 GB)
echo.

set "USERDIR=C:\Users\%USERNAME%"

if not exist "D:\" (
    echo [ERROR] Drive D not detected!
    pause
    exit /b 1
)

:: --- 1. Move .gradle ---
if exist "%USERDIR%\.gradle" (
    dir /A:L "%USERDIR%" 2>nul | findstr /I /C:".gradle" >nul
    if errorlevel 1 (
        echo [1/4] Moving .gradle (~8.5 GB) to D:\.gradle ...
        if not exist "D:\.gradle" mkdir "D:\.gradle"
        robocopy "%USERDIR%\.gradle" "D:\.gradle" /E /MOVE /R:2 /W:1 /NP
        rmdir /S /Q "%USERDIR%\.gradle" 2>nul
        mklink /J "%USERDIR%\.gradle" "D:\.gradle"
    ) else (
        echo [1/4] .gradle is already linked to Drive D.
    )
) else (
    echo [1/4] .gradle folder does not exist. Skipping.
)

:: --- 2. Move .cache ---
if exist "%USERDIR%\.cache" (
    dir /A:L "%USERDIR%" 2>nul | findstr /I /C:".cache" >nul
    if errorlevel 1 (
        echo [2/4] Moving .cache (~2.1 GB) to D:\.cache ...
        if not exist "D:\.cache" mkdir "D:\.cache"
        robocopy "%USERDIR%\.cache" "D:\.cache" /E /MOVE /R:2 /W:1 /NP
        rmdir /S /Q "%USERDIR%\.cache" 2>nul
        mklink /J "%USERDIR%\.cache" "D:\.cache"
    ) else (
        echo [2/4] .cache is already linked to Drive D.
    )
) else (
    echo [2/4] .cache folder does not exist. Skipping.
)

:: --- 3. Move .m2 ---
if exist "%USERDIR%\.m2" (
    dir /A:L "%USERDIR%" 2>nul | findstr /I /C:".m2" >nul
    if errorlevel 1 (
        echo [3/4] Moving .m2 (~1.4 GB) to D:\.m2 ...
        if not exist "D:\.m2" mkdir "D:\.m2"
        robocopy "%USERDIR%\.m2" "D:\.m2" /E /MOVE /R:2 /W:1 /NP
        rmdir /S /Q "%USERDIR%\.m2" 2>nul
        mklink /J "%USERDIR%\.m2" "D:\.m2"
    ) else (
        echo [3/4] .m2 is already linked to Drive D.
    )
) else (
    echo [3/4] .m2 folder does not exist. Skipping.
)

:: --- 4. Move .gemini ---
if exist "%USERDIR%\.gemini" (
    dir /A:L "%USERDIR%" 2>nul | findstr /I /C:".gemini" >nul
    if errorlevel 1 (
        echo [4/4] Checking .gemini (~4.7 GB) ...
        tasklist /FI "IMAGENAME eq Antigravity IDE.exe" 2>nul | findstr /I "Antigravity" >nul
        if not errorlevel 1 (
            echo [WARNING] Antigravity IDE is currently running!
            echo           Please close Antigravity IDE completely to move .gemini cleanly.
        ) else (
            echo Moving .gemini to D:\.gemini ...
            if not exist "D:\.gemini" mkdir "D:\.gemini"
            robocopy "%USERDIR%\.gemini" "D:\.gemini" /E /MOVE /R:2 /W:1 /NP
            rmdir /S /Q "%USERDIR%\.gemini" 2>nul
            mklink /J "%USERDIR%\.gemini" "D:\.gemini"
        )
    ) else (
        echo [4/4] .gemini is already linked to Drive D.
    )
) else (
    echo [4/4] .gemini folder does not exist. Skipping.
)

echo.
echo ===================================================================
echo   COMPLETED! Check your Drive C free space now!
echo ===================================================================
echo.
pause
