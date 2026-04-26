#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-WinnowSetup {
    param([string]$Message)
    Write-Host "[winnow-setup] $Message"
}

function Refresh-PathFromRegistry {
    $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $user = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($machine -and $user) {
        $env:Path = "$machine;$user"
    }
    elseif ($machine) { $env:Path = $machine }
    elseif ($user) { $env:Path = $user }
}

function Test-NodeSupported {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        return $false
    }
    $major = [int](node -p "process.versions.node.split('.')[0]")
    return ($major -ge 20 -and $major -lt 23)
}

function Test-WingetAvailable {
    return [bool](Get-Command winget -ErrorAction SilentlyContinue)
}

function Test-WingetPackageInstalled {
    param([string]$Id)
    winget list -e --id $Id 2>$null | Out-Null
    return ($LASTEXITCODE -eq 0)
}

function Install-WingetPackage {
    param(
        [string]$Id,
        [string]$DisplayName
    )
    if (Test-WingetPackageInstalled -Id $Id) {
        Write-WinnowSetup "$DisplayName already installed (winget id $Id)."
        return
    }
    Write-WinnowSetup "Installing $DisplayName via winget ($Id)..."
    winget install -e --id $Id --accept-source-agreements --accept-package-agreements --disable-interactivity
    Refresh-PathFromRegistry
}

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $ProjectRoot

Write-WinnowSetup "Starting Windows setup (repo: $ProjectRoot)..."

if (-not (Test-WingetAvailable)) {
    Write-WinnowSetup "ERROR: winget not found. Install App Installer / Windows Package Manager, then rerun."
    exit 1
}

if (-not (Test-NodeSupported)) {
    Install-WingetPackage -Id "OpenJS.NodeJS.LTS" -DisplayName "Node.js LTS"
    Refresh-PathFromRegistry
}

if (-not (Test-NodeSupported)) {
    Write-WinnowSetup "ERROR: Node.js is still missing or not in PATH after install."
    Write-WinnowSetup "Close this window, open a new PowerShell, and run this script again."
    exit 1
}

Write-WinnowSetup "Using node $(node -v)"

Install-WingetPackage -Id "Git.Git" -DisplayName "Git for Windows"
Install-WingetPackage -Id "Anysphere.Cursor" -DisplayName "Cursor"

Write-WinnowSetup "Optional tools (ranger, htop, netwatch) are not installed automatically on Windows."
Write-WinnowSetup "Use WSL, Scoop, or custom pane commands if you need those binaries."

Write-WinnowSetup "Installing npm dependencies..."
npm install

Write-WinnowSetup "Building TypeScript (dist/)..."
npm run build

Write-WinnowSetup "Rebuilding node-pty for this machine..."
npm rebuild node-pty --build-from-source

Write-WinnowSetup "Setup complete. Next: open Cursor once to finish login, then run npm run ui or npm run doctor."
