@echo off
rem  Register a weekday 08:30 popup that opens the math-check screen in a small window.
rem  (File contents are plain English on purpose: Korean text breaks old cmd windows.)
setlocal
cd /d "%~dp0"
echo.
echo  === Math check popup: setup ===
echo.
echo  Type the address of your class site, then press Enter.
echo  Example: https://myclass.vercel.app
echo.
set /p SITE=Site address:
if "%SITE%"=="" (
  echo No address typed. Nothing was changed.
  pause
  exit /b 1
)

rem keep only the site address: drop anything after # or ? (for example /#check), add https:// if missing
for /f "tokens=1 delims=#?" %%a in ("%SITE%") do set SITE=%%a
echo %SITE%| findstr /i /b "http" >nul || set SITE=https://%SITE%
if "%SITE:~-1%"=="/" set SITE=%SITE:~0,-1%

echo.
echo  Where should the popup always appear on the screen?
echo    1 = top right (default)
echo    2 = bottom right
echo    3 = top left
echo    4 = bottom left
echo    5 = center
set /p CH=Number 1-5: 
set POS=tr
if "%CH%"=="2" set POS=br
if "%CH%"=="3" set POS=tl
if "%CH%"=="4" set POS=bl
if "%CH%"=="5" set POS=c

rem the launcher that opens the small window (Edge is installed on every Windows 10/11 PC)
rem the page itself moves the window to the chosen corner every time, so the spot never drifts
> "%~dp0open_math_popup.bat" echo @echo off
>> "%~dp0open_math_popup.bat" echo start "" msedge --app="%SITE%/?popup=1&pos=%POS%" --window-size=560,620

schtasks /create /tn "ClassroomMathPopup" /tr "\"%~dp0open_math_popup.bat\"" /sc weekly /d MON,TUE,WED,THU,FRI /st 08:30 /f
if errorlevel 1 (
  echo.
  echo Could not create the scheduled task. Take a screenshot of this window.
  pause
  exit /b 1
)

echo.
set /p LOGON=Also open the popup every time you log in to Windows? (y/n):
if /i "%LOGON%"=="y" schtasks /create /tn "ClassroomMathPopupLogon" /tr "\"%~dp0open_math_popup.bat\"" /sc onlogon /delay 0001:00 /f

echo.
echo  Done. The popup opens every weekday at 08:30 (the PC must be on and logged in).
echo  Address used: %SITE%
echo  Position: %POS%  (tr=top right, br=bottom right, tl=top left, bl=bottom left, c=center)
echo  Keep this folder where it is. If you move it, run this file again.
echo.
set /p NOW=Open the popup now to check it? (y/n): 
if /i "%NOW%"=="y" start "" "%~dp0open_math_popup.bat"
echo.
pause
