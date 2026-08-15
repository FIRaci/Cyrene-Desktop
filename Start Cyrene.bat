@echo off
cd /d "%~dp0"
:: ─────────────────────────────────────────────────────────────────
::  Cyrene Desktop Launcher
:: ─────────────────────────────────────────────────────────────────
:: Optional: start TTS voice server first (requires Python + setup)
:: Run "python cyrene_tts.py" in a separate window before launching.
:: Cyrene will speak via GPT-SoVITS voice if the TTS server is running.
::
:: For DevTools (debug mode), run:
::   set CYRENE_DEVTOOLS=1
::   .\node_modules\electron\dist\electron.exe .
:: ─────────────────────────────────────────────────────────────────
.\node_modules\electron\dist\electron.exe .
pause
