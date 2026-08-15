@echo off
cd /d "%~dp0"
:: Run Cyrene companion via local electron
.\node_modules\electron\dist\electron.exe .
pause
