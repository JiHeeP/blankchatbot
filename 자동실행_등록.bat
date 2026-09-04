@echo off
cd /d "%~dp0"
where py >nul 2>nul && (py notice_board.py --autostart) || (python notice_board.py --autostart)
pause
