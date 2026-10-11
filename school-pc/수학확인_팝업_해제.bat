@echo off
rem  Remove the math-check popup schedule created by the setup file.
schtasks /delete /tn "ClassroomMathPopup" /f
schtasks /delete /tn "ClassroomMathPopupLogon" /f 2>nul
if exist "%~dp0open_math_popup.bat" del "%~dp0open_math_popup.bat"
echo.
echo  Removed. The popup will no longer open automatically.
echo.
pause
