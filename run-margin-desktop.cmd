@echo off
setlocal
set "ROOT=%~dp0"
set "NODE_HOME=%ROOT%.runtime\node-v22.23.1-win-x64"
if exist "%NODE_HOME%\npm.cmd" (
  set "PATH=%NODE_HOME%;%ROOT%node_modules\.bin;%PATH%"
  set "NPM_CMD=%NODE_HOME%\npm.cmd"
) else (
  where npm.cmd >nul 2>nul
  if errorlevel 1 (
    echo npm was not found. Install Node.js or place the bundled runtime in "%NODE_HOME%".
    exit /b 1
  )
  set "PATH=%ROOT%node_modules\.bin;%PATH%"
  set "NPM_CMD=npm.cmd"
)
cd /d "%ROOT%"
call "%NPM_CMD%" run desktop
