<#
.SYNOPSIS
    Start the Vite dev server for MonsterMQ Dashboard.

.DESCRIPTION
    Starts the Vite dev server, listening on all interfaces so the dashboard is
    reachable from other machines (http://<this-host>:5173).

.PARAMETER Build
    Build dashboard before running dev server (-b, --build).

.PARAMETER Local
    Localhost only (Vite's default).

.PARAMETER Help
    Show this help message (-h, --help).
#>

[CmdletBinding()]
param(
    [Alias("b")]
    [switch]$Build,

    [switch]$Local,

    [Alias("h", "?")]
    [switch]$Help,

    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ExtraArgs
)

function Show-Help {
    Write-Host "Usage: .\run.ps1 [options] [-- <vite-options>]"
    Write-Host ""
    Write-Host "Options:"
    Write-Host "  -b, --build     Build dashboard before running dev server"
    Write-Host "  --local         Localhost only (Vite's default)"
    Write-Host "  -h, --help      Show this help message"
    Write-Host ""
    Write-Host "Examples:"
    Write-Host "  .\run.ps1                           # expose on all interfaces, port 5173"
    Write-Host "  .\run.ps1 -b                        # build dashboard before running dev server"
    Write-Host "  .\run.ps1 --port 8080               # ...on a different port"
    Write-Host "  .\run.ps1 --local                   # localhost only"
    Write-Host '  $env:VITE_LOCAL_GRAPHQL_TARGET="http://broker-host:4000"; .\run.ps1'
    Write-Host ""
    exit 0
}

$Expose = $true
$ForwardArgs = [System.Collections.Generic.List[string]]::new()

if ($ExtraArgs) {
    foreach ($arg in $ExtraArgs) {
        switch ($arg) {
            "-b"      { $Build = $true }
            "--build" { $Build = $true }
            "--local" { $Local = $true }
            "-h"      { Show-Help }
            "--help"  { Show-Help }
            "-?"      { Show-Help }
            default   { $ForwardArgs.Add($arg) }
        }
    }
}

if ($Help) {
    Show-Help
}

if ($Local) {
    $Expose = $false
}

Push-Location $PSScriptRoot
try {
    if (-not (Test-Path "node_modules")) {
        Write-Host "Installing dependencies..."
        & npm install
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }

    if ($Build) {
        Write-Host "Building dashboard..."
        & npm run build
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }

    $ViteArgs = [System.Collections.Generic.List[string]]::new()
    if ($Expose) {
        $ViteArgs.Add("--host")
        # Vite refuses requests whose Host header it does not recognise
        # (DNS-rebinding protection), which breaks access by hostname even when
        # --host is set. vite.config.js reads this to relax that check while we
        # are deliberately exposing the dev server.
        $env:VITE_EXPOSE = "1"
    }

    foreach ($a in $ForwardArgs) {
        $ViteArgs.Add($a)
    }

    & npm run dev -- @ViteArgs
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
