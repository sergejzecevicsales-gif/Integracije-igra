@echo off
chcp 65001 >nul
title TRZISTE UZIVO - server
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   GRESKA: Node.js nije instaliran.
  echo   Instaliraj ga sa https://nodejs.org  ^(LTS verzija^) pa pokreni ovu datoteku ponovo.
  echo.
  pause
  exit /b 1
)

echo.
echo   Pokrecem TRZISTE UZIVO...
echo   Projektor ce se otvoriti sam. Ako ne - otvori http://localhost:4000/screen
echo   Telefoni se spajaju na adresu koja pise na ekranu.
echo   (Ako je port 4000 zauzet, server javi drugi port u konzoli.)
echo.
node server.js --open
pause
