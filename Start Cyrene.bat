@echo off
cd /d "%~dp0"
:: ─────────────────────────────────────────────────────────────────
::  Cyrene Desktop Launcher — Layer A (Live2D Companion)
:: ─────────────────────────────────────────────────────────────────
:: NOTE: package.json "main" points to Layer B (TypeScript agent).
::       We must pass main.js explicitly to run the companion UI.
::
:: Optional: start TTS voice server first (requires Python + setup)
::   python cyrene_tts.py   (in a separate terminal window)
::
:: For DevTools (debug mode):
::   set CYRENE_DEVTOOLS=1 && .\node_modules\electron\dist\electron.exe main.js
:: ─────────────────────────────────────────────────────────────────
.\node_modules\electron\dist\electron.exe main.js
pause
