@echo off
cd /d "%~dp0"
:: ─────────────────────────────────────────────────────────────────
::  Cyrene Desktop Launcher — Unified TypeScript Runtime
:: ─────────────────────────────────────────────────────────────────
:: package.json selects the single supported Electron entry.
::
:: Optional: start TTS voice server first (requires Python + setup)
::   python cyrene_tts.py   (in a separate terminal window)
::
:: For DevTools (debug mode):
::   set CYRENE_DEVTOOLS=1 && .\node_modules\electron\dist\electron.exe . --user-data-dir="%~dp0data"
:: ─────────────────────────────────────────────────────────────────
.\node_modules\electron\dist\electron.exe . --user-data-dir="%~dp0data"
pause
