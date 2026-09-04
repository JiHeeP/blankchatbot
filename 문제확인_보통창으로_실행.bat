@echo off
cd /d "%~dp0"
echo Running in a normal window. Errors will show below.
echo.
where py >nul 2>nul && (py notice_board.py --window) || (python notice_board.py --window)
echo.
echo Exit code: %errorlevel%
pause
