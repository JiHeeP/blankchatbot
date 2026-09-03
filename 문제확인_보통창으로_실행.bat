@echo off
cd /d "%~dp0"
where py >nul 2>nul && (py -3 notice_board.py --window) || (python notice_board.py --window)
pause
