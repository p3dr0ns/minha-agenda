@echo off
setlocal

cd /d "%~dp0"
title Minha Agenda

set "NODE_EXE=%~dp0.tools\node\node.exe"

if not exist "%NODE_EXE%" (
    echo Nao foi possivel encontrar o Node.js em:
    echo %NODE_EXE%
    echo.
    echo Instale o Node.js ou restaure a pasta .tools do projeto.
    pause
    exit /b 1
)

echo Iniciando a Minha Agenda...
start "Servidor da Minha Agenda" /min "%NODE_EXE%" "%~dp0server.js"

timeout /t 2 /nobreak >nul
start "" "http://localhost:3000"

echo.
echo Agenda aberta no navegador.
echo Esta janela pode ser fechada.
timeout /t 3 /nobreak >nul
