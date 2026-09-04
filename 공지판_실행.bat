@echo off
cd /d "%~dp0"
where pyw >nul 2>nul
if %errorlevel%==0 (
  start "" pyw notice_board.py
  exit /b
)
where pythonw >nul 2>nul
if %errorlevel%==0 (
  start "" pythonw notice_board.py
  exit /b
)
echo.
echo [ERROR] Python not found. Install Python from python.org (check "Add to PATH").
echo.
pause
