@echo off
title TUNEL DE CAPTURA - NO CERRAR

echo ===============================
echo   INICIANDO SISTEMA DE CAPTURA
echo ===============================

set PATH=%~dp0node;%PATH%

echo.
echo Iniciando servidor...
start "" /b node prueba.js

echo Esperando servidor en puerto 7000...

:waitloop
timeout /t 2 > nul
netstat -an | find ":2000" > nul
if errorlevel 1 goto waitloop

echo Servidor listo!

echo.
echo Creando tunel Cloudflared...
cloudflared.exe tunnel --url http://localhost:7000

pause