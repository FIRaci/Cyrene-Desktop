@echo off
title Cyrene Voice Server (Hugging Face GPT-SoVITS)
cd /d "%~dp0"
echo ======================================================================
echo  Starting Cyrene Desktop Voice Server (Port 9880)
echo  Model: Hugging Face HSR-Cyrene-GPT-SoVITS
echo ======================================================================
python scripts\cyrene_tts.py
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Voice server exited with error code %ERRORLEVEL%.
    pause
)
