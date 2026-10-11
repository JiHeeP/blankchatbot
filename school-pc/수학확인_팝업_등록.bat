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

rem remove a trailing slash
if "%SITE:~-1%"=="/" set SITE=%SITE:~0,-1%

rem the launcher that opens the small window (Edge is installed on every Windows 10/11 PC)
> "%~dp0open_math_popup.bat" echo @echo off
>> "%~dp0open_math_popup.bat" echo start "" msedge --app="%SITE%/?popup=1" --window-size=560,520 --window-position=40,40

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
echo  Test it now: double-click  open_math_popup.bat  in this folder.
echo  Keep this folder where it is. If you move it, run this file again.
echo.
pause
