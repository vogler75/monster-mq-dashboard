<#
.SYNOPSIS
    Build script for MonsterMQ Dashboard (Web & Desktop) - Windows PowerShell

.DESCRIPTION
    Builds MonsterMQ Dashboard assets: Web (dist) and Electron desktop packages
    (Windows NSIS setup and macOS DMG).

.PARAMETER Web
    Build web dashboard assets (dist\). Alias: -b

.PARAMETER Desktop
    Build all desktop apps (Windows NSIS & macOS DMG). Alias: -d

.PARAMETER Win
    Build Windows desktop NSIS setup only. Alias: -w

.PARAMETER Mac
    Build macOS desktop DMG app only. Alias: -m

.PARAMETER All
    Build web bundle and all desktop packages. Alias: -a

.PARAMETER Clean
    Clean dist\ and dist-desktop\ directories. Alias: -c

.PARAMETER Help
    Show this help message. Alias: -h
#>

[CmdletBinding()]
param(
    [Alias("b")]
    [switch]$Web,

    [Alias("d")]
    [switch]$Desktop,

    [Alias("w")]
    [switch]$Win,

    [Alias("m")]
    [switch]$Mac,

    [Alias("a")]
    [switch]$All,

    [Alias("c")]
    [switch]$Clean,

    [Alias("h", "?")]
    [switch]$Help,

    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ExtraArgs
)

$ErrorActionPreference = "Stop"

function Show-Usage {
    param([int]$ExitCode = 0)
    Write-Host "Usage: build.ps1 [options]"
    Write-Host ""
    Write-Host "Options:"
    Write-Host "  --web, -b          Build web dashboard assets (dist\)"
    Write-Host "  --desktop, -d      Build all desktop apps (Windows NSIS & macOS DMG)"
    Write-Host "  --win, -w          Build Windows desktop NSIS setup only"
    Write-Host "  --mac, -m          Build macOS desktop DMG app only"
    Write-Host "  --all, -a          Build web bundle and all desktop packages"
    Write-Host "  --clean, -c        Clean dist\ and dist-desktop\ directories"
    Write-Host "  -h, --help         Show this help message"
    Write-Host ""
    Write-Host "Examples:"
    Write-Host "  .\build.ps1 --web           # Build web dashboard assets"
    Write-Host "  .\build.ps1 --all           # Build web assets and all desktop packages"
    Write-Host "  .\build.ps1 --win           # Build Windows desktop application"
    Write-Host "  .\build.ps1 --mac           # Build macOS desktop application"
    Write-Host ""
    exit $ExitCode
}

# If no parameters and no arguments passed
if (-not ($Web -or $Desktop -or $Win -or $Mac -or $All -or $Clean -or $Help) -and (-not $ExtraArgs -or $ExtraArgs.Count -eq 0)) {
    Show-Usage 0
}

# Parse any additional GNU-style or unrecognized arguments passed via ExtraArgs
if ($ExtraArgs) {
    foreach ($arg in $ExtraArgs) {
        switch -Regex ($arg) {
            '^(-b|--?web|web)$'         { $Web = $true }
            '^(-d|--?desktop|desktop)$' { $Desktop = $true }
            '^(-w|--?win|win)$'         { $Win = $true }
            '^(-m|--?mac|mac)$'         { $Mac = $true }
            '^(-a|--?all|all)$'         { $All = $true }
            '^(-c|--?clean|clean)$'     { $Clean = $true }
            '^(-h|--?help|help|-\?)$'   { $Help = $true }
            default {
                [Console]::Error.WriteLine("Unknown option: $arg")
                Show-Usage 1
            }
        }
    }
}

if ($Help) {
    Show-Usage 0
}

$BuildWeb = $false
$BuildWin = $false
$BuildMac = $false

if ($All) {
    $BuildWeb = $true
    $BuildWin = $true
    $BuildMac = $true
} else {
    if ($Web) { $BuildWeb = $true }
    if ($Desktop) {
        $BuildWin = $true
        $BuildMac = $true
    }
    if ($Win) { $BuildWin = $true }
    if ($Mac) { $BuildMac = $true }
}

Push-Location $PSScriptRoot
try {

if ($Clean) {
    Write-Host "Cleaning output directories..."
    if (Test-Path "dist") {
        Remove-Item -Recurse -Force "dist"
    }
    if (Test-Path "dist-desktop") {
        Remove-Item -Recurse -Force "dist-desktop"
    }
    Write-Host "Clean complete."
}

if (-not $BuildWeb -and -not $BuildWin -and -not $BuildMac) {
    exit 0
}

Write-Host "=== Building MonsterMQ Dashboard ==="

$versionFile = $null
if (Test-Path "version.txt") {
    $versionFile = "version.txt"
} elseif (Test-Path "..\version.txt") {
    $versionFile = "..\version.txt"
}

if ($versionFile) {
    $rawVersion = (Get-Content $versionFile -TotalCount 1).Trim()
    $brokerVersion = $rawVersion.Split('+')[0].Trim()
    if ($brokerVersion) {
        Write-Host "Syncing version from ${versionFile}: $brokerVersion"
        & npm version $brokerVersion --no-git-tag-version --allow-same-version *> $null
    }
}

Write-Host "Installing npm dependencies..."
& npm install
if ($LASTEXITCODE -ne 0) {
    [Console]::Error.WriteLine("=== Build Failed ===")
    exit 1
}

Write-Host "Building web dashboard assets..."
& npm run build
if ($LASTEXITCODE -ne 0) {
    [Console]::Error.WriteLine("=== Build Failed ===")
    exit 1
}
Write-Host "Web dashboard built in dist\"

if ($BuildWin -or $BuildMac) {
    Write-Host "=== Packaging MonsterMQ Desktop App ==="
    if (-not (Test-Path "icons")) {
        New-Item -ItemType Directory -Force -Path "icons" | Out-Null
    }
    if (-not (Test-Path "icons\icon.png")) {
        if (Test-Path "appicon.png") {
            Copy-Item -Force "appicon.png" "icons\icon.png"
        } elseif (Test-Path "appicon-option1.png") {
            Copy-Item -Force "appicon-option1.png" "icons\icon.png"
        }
    }

    $builderArgs = @("--x64", "--arm64", "--publish", "never")
    if ($BuildWin) { $builderArgs += "--win" }
    if ($BuildMac) { $builderArgs += "--mac" }

    Write-Host "Running electron-builder with flags: $($builderArgs -join ' ')"
    & npx electron-builder @builderArgs
    if ($LASTEXITCODE -ne 0) {
        [Console]::Error.WriteLine("=== Build Failed ===")
        exit 1
    }

    if ($BuildMac) {
        if (Test-Path "dist-desktop\MonsterMQ-Dashboard-x64.dmg") {
            Move-Item -Force "dist-desktop\MonsterMQ-Dashboard-x64.dmg" "dist-desktop\MonsterMQ-Dashboard-mac-x64.dmg"
        }
        if (Test-Path "dist-desktop\MonsterMQ-Dashboard-arm64.dmg") {
            Move-Item -Force "dist-desktop\MonsterMQ-Dashboard-arm64.dmg" "dist-desktop\MonsterMQ-Dashboard-mac-arm64.dmg"
        }
    }

    if ($BuildWin) {
        if (Test-Path "dist-desktop\MonsterMQ-Dashboard Setup.exe") {
            Move-Item -Force "dist-desktop\MonsterMQ-Dashboard Setup.exe" "dist-desktop\MonsterMQ-Dashboard-win-x64-setup.exe"
        }
        if (Test-Path "dist-desktop\MonsterMQ-Dashboard Setup arm64.exe") {
            Move-Item -Force "dist-desktop\MonsterMQ-Dashboard Setup arm64.exe" "dist-desktop\MonsterMQ-Dashboard-win-arm64-setup.exe"
        }
    }

    Write-Host "Desktop packages are located in dist-desktop\"
}

    Write-Host "=== Build Complete ==="
    exit 0
} finally {
    Pop-Location
}
