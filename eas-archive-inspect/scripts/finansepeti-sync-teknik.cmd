@echo off
setlocal EnableDelayedExpansion
set "SRC="
for /r "%USERPROFILE%\OneDrive\Desktop" %%S in (teknik-sinyal.js) do (
  set "SRC=%%S"
  goto :have_src
)
:have_src
if not defined SRC (
  echo [finansepeti] teknik-sinyal.js Desktop altinda bulunamadi.
  exit /b 1
)
for /d /r "%USERPROFILE%\OneDrive\Desktop" %%D in (mobileapp) do (
  if exist "%%D\package.json" (
    if exist "%%D\src\screens\AnalizlerScreen.tsx" (
      if not exist "%%D\src\lib" mkdir "%%D\src\lib"
      copy /Y "!SRC!" "%%D\src\lib\teknikSinyalEngine.js" >nul
      echo [finansepeti] OK %%D\src\lib\teknikSinyalEngine.js
    )
  )
)
endlocal
