@echo off
cd /d "%~dp0"
where pyw >nul 2>nul && (start "" pyw -3 notice_board.py) || (start "" pythonw notice_board.py)
