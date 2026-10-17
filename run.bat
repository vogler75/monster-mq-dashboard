@echo off
REM Start the Vite dev server, listening on all interfaces so the dashboard is
REM reachable from other machines (http://<this-host>:5173). Windows version
REM of run.sh.
REM
REM Note the "--" before the flags: "npm run dev --host" does NOT work, because
REM npm consumes --host as one of its own options instead of forwarding it to
REM Vite. Everything after "--" is passed through.
REM
REM Usage:
REM   run.bat                           expose on all interfaces, port 5173
REM   run.bat -b                        build dashboard before running dev server
REM   run.bat --port 8080               ...on a different port
REM   run.bat --local                   localhost only (Vite's default)
REM   set VITE_LOCAL_GRAPHQL_TARGET=http://broker-host:4000 ^& run.bat
REM                                     proxy /graphql to a specific broker

setlocal enabledelayedexpansion

cd /d "%~dp0"

set "BUILD=false"
set "EXPOSE=true"
set "ARGS="

:parse_args
if "%~1"=="" goto :done_parse
if "%~1"=="-b"      (set "BUILD=true"   & shift & goto :parse_args)
if "%~1"=="--build" (set "BUILD=true"   & shift & goto :parse_args)
if "%~1"=="--local" (set "EXPOSE=false" & shift & goto :parse_args)
set "ARGS=!ARGS! %1"
shift
goto :parse_args
:done_parse

if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
    if errorlevel 1 exit /b 1
)

if "!BUILD!"=="true" (
    echo Building dashboard...
    call npm run build
    if errorlevel 1 exit /b 1
)

if "!EXPOSE!"=="true" (
    set "ARGS=--host!ARGS!"
    REM Vite refuses requests whose Host header it does not recognise
    REM (DNS-rebinding protection), which breaks access by hostname even when
    REM --host is set. vite.config.js reads this to relax that check while we
    REM are deliberately exposing the dev server.
    set "VITE_EXPOSE=1"
)

call npm run dev -- !ARGS!
exit /b %errorlevel%
