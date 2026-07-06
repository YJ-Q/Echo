@echo off
setlocal
set "ROOT=%~dp0"
set "NODE_HOME=%ROOT%.runtime\node-v22.23.1-win-x64"
if not exist "%NODE_HOME%\node.exe" (
  echo Node 22 runtime not found at "%NODE_HOME%".
  exit /b 1
)
set "PATH=%NODE_HOME%;%ROOT%node_modules\.bin;%PATH%"
cd /d "%ROOT%"
"%NODE_HOME%\npm.cmd" run desktop
