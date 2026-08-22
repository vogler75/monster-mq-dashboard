@echo off
setlocal enabledelayedexpansion

REM Build script for MonsterMQ Dashboard (Web & Desktop) - Windows Batch
cd /d "%~dp0"

set BUILD_WEB=false
set BUILD_MAC=false
set BUILD_WIN=false
set BUILD_ALL=false
set CLEAN=false
set EXPLICIT_TARGET=false

if "%~1"=="" goto usage

:parse_args
if "%~1"=="" goto after_args

if /i "%~1"=="--web" (
    set BUILD_WEB=true
    set EXPLICIT_TARGET=true
)
if /i "%~1"=="-b" (
    set BUILD_WEB=true
    set EXPLICIT_TARGET=true
)
if /i "%~1"=="web" (
    set BUILD_WEB=true
    set EXPLICIT_TARGET=true
)

if /i "%~1"=="--desktop" (
    set BUILD_WIN=true
    set BUILD_MAC=true
    set EXPLICIT_TARGET=true
)
if /i "%~1"=="-d" (
    set BUILD_WIN=true
    set BUILD_MAC=true
    set EXPLICIT_TARGET=true
)
if /i "%~1"=="desktop" (
    set BUILD_WIN=true
    set BUILD_MAC=true
    set EXPLICIT_TARGET=true
)

if /i "%~1"=="--win" (
    set BUILD_WIN=true
    set EXPLICIT_TARGET=true
)
if /i "%~1"=="-w" (
    set BUILD_WIN=true
    set EXPLICIT_TARGET=true
)
if /i "%~1"=="win" (
    set BUILD_WIN=true
    set EXPLICIT_TARGET=true
)

if /i "%~1"=="--mac" (
    set BUILD_MAC=true
    set EXPLICIT_TARGET=true
)
if /i "%~1"=="-m" (
    set BUILD_MAC=true
    set EXPLICIT_TARGET=true
)
if /i "%~1"=="mac" (
    set BUILD_MAC=true
    set EXPLICIT_TARGET=true
)

if /i "%~1"=="--all" (
    set BUILD_WEB=true
    set BUILD_WIN=true
    set BUILD_MAC=true
    set BUILD_ALL=true
    set EXPLICIT_TARGET=true
)
if /i "%~1"=="-a" (
    set BUILD_WEB=true
    set BUILD_WIN=true
    set BUILD_MAC=true
    set BUILD_ALL=true
    set EXPLICIT_TARGET=true
)
if /i "%~1"=="all" (
    set BUILD_WEB=true
    set BUILD_WIN=true
    set BUILD_MAC=true
    set BUILD_ALL=true
    set EXPLICIT_TARGET=true
)

if /i "%~1"=="--clean" (
    set CLEAN=true
)
if /i "%~1"=="-c" (
    set CLEAN=true
)
if /i "%~1"=="clean" (
    set CLEAN=true
)

if /i "%~1"=="-h" goto usage
if /i "%~1"=="--help" goto usage
if /i "%~1"=="help" goto usage

shift
goto parse_args

:usage
echo Usage: %~nx0 [options]
echo.
echo Options:
echo   --web, -b          Build web dashboard assets (dist\)
echo   --desktop, -d      Build all desktop apps (Windows NSIS & macOS DMG)
echo   --win, -w          Build Windows desktop NSIS setup only
echo   --mac, -m          Build macOS desktop DMG app only
echo   --all, -a          Build web bundle and all desktop packages
echo   --clean, -c        Clean dist\ and dist-desktop\ directories
echo   -h, --help         Show this help message
echo.
echo Examples:
echo   %~nx0 --web           REM Build web dashboard assets
echo   %~nx0 --all           REM Build web assets and all desktop packages
echo   %~nx0 --win           REM Build Windows desktop application
echo   %~nx0 --mac           REM Build macOS desktop application
echo.
exit /b 0

:after_args

if "%CLEAN%"=="true" (
    echo Cleaning output directories...
    if exist "dist" rmdir /s /q "dist"
    if exist "dist-desktop" rmdir /s /q "dist-desktop"
    echo Clean complete.
)

if "%BUILD_WEB%"=="false" if "%BUILD_WIN%"=="false" if "%BUILD_MAC%"=="false" (
    exit /b 0
)

echo === Building MonsterMQ Dashboard ===

set "VERSION_FILE="
if exist "version.txt" set "VERSION_FILE=version.txt"
if not defined VERSION_FILE if exist "..\version.txt" set "VERSION_FILE=..\version.txt"

if defined VERSION_FILE (
    set /p RAW_BROKER_VERSION=<"!VERSION_FILE!"
    for /f "tokens=1 delims=+" %%a in ("!RAW_BROKER_VERSION!") do set "BROKER_VERSION=%%a"
    if defined BROKER_VERSION (
        echo Syncing version from !VERSION_FILE!: !BROKER_VERSION!
        call npm version !BROKER_VERSION! --no-git-tag-version --allow-same-version >nul 2>&1
    )
)

echo Installing npm dependencies...
call npm install
if errorlevel 1 goto error

echo Building web dashboard assets...
call npm run build
if errorlevel 1 goto error
echo Web dashboard built in dist\

if "%BUILD_WIN%"=="true" goto build_desktop
if "%BUILD_MAC%"=="true" goto build_desktop
goto finish

:build_desktop
echo === Packaging MonsterMQ Desktop App ===
if not exist "icons" mkdir icons
if not exist "icons\icon.png" (
    if exist "appicon.png" (
        copy /Y "appicon.png" "icons\icon.png" >nul
    ) else if exist "appicon-option1.png" (
        copy /Y "appicon-option1.png" "icons\icon.png" >nul
    )
)

set BUILD_FLAGS=--x64 --arm64 --publish never
if "%BUILD_WIN%"=="true" set BUILD_FLAGS=!BUILD_FLAGS! --win
if "%BUILD_MAC%"=="true" set BUILD_FLAGS=!BUILD_FLAGS! --mac

echo Running electron-builder with flags: !BUILD_FLAGS!
call npx electron-builder !BUILD_FLAGS!
if errorlevel 1 goto error

if "%BUILD_MAC%"=="true" (
    if exist "dist-desktop\MonsterMQ-Dashboard-x64.dmg" (
        ren "dist-desktop\MonsterMQ-Dashboard-x64.dmg" "MonsterMQ-Dashboard-mac-x64.dmg"
    )
    if exist "dist-desktop\MonsterMQ-Dashboard-arm64.dmg" (
        ren "dist-desktop\MonsterMQ-Dashboard-arm64.dmg" "MonsterMQ-Dashboard-mac-arm64.dmg"
    )
)

if "%BUILD_WIN%"=="true" (
    if exist "dist-desktop\MonsterMQ-Dashboard Setup.exe" (
        ren "dist-desktop\MonsterMQ-Dashboard Setup.exe" "MonsterMQ-Dashboard-win-x64-setup.exe"
    )
    if exist "dist-desktop\MonsterMQ-Dashboard Setup arm64.exe" (
        ren "dist-desktop\MonsterMQ-Dashboard Setup arm64.exe" "MonsterMQ-Dashboard-win-arm64-setup.exe"
    )
)

echo Desktop packages are located in dist-desktop\

:finish
echo === Build Complete ===
exit /b 0

:error
echo === Build Failed ===
exit /b 1
