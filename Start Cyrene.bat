@echo off
cd /d "%~dp0"
:: Chạy Cyrene siêu nhẹ bằng local electron
.\node_modules\electron\dist\electron.exe .
pause
