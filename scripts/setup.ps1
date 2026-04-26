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
    return ($major -ge 20)
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
    Write-WinnowSetup "ERROR: Node.js is still missing or below v20 after install."
    Write-WinnowSetup "Close this window, open a new PowerShell, and run this script again."
    exit 1
}

Write-WinnowSetup "Using node $(node -v)"

Install-WingetPackage -Id "Git.Git" -DisplayName "Git for Windows"

function Ensure-CursorAgentCli {
    Refresh-PathFromRegistry
    $agentRoot = Join-Path $env:LOCALAPPDATA "cursor-agent"
    if (Get-Command cursor-agent -ErrorAction SilentlyContinue) {
        Write-WinnowSetup "cursor-agent already on PATH."
        return
    }
    $agentExe = Join-Path $agentRoot "cursor-agent.exe"
    if (Test-Path $agentExe) {
        if ($env:PATH -notlike "*${agentRoot}*") {
            $env:Path = "${agentRoot};$env:Path"
        }
        Write-WinnowSetup "cursor-agent found at $agentExe (added to PATH for this session)."
        return
    }
    Write-WinnowSetup "Installing Cursor Agent CLI (cursor-agent) from cursor.com…"
    $script = (Invoke-WebRequest -Uri "https://cursor.com/install?win32=true" -UseBasicParsing).Content
    Invoke-Expression $script
    Refresh-PathFromRegistry
    if (-not (Get-Command cursor-agent -ErrorAction SilentlyContinue) -and (Test-Path $agentExe)) {
        $env:Path = "${agentRoot};$env:Path"
    }
    if (Get-Command cursor-agent -ErrorAction SilentlyContinue) {
        Write-WinnowSetup "cursor-agent is available."
        return
    }
    Write-WinnowSetup "WARNING: cursor-agent not on PATH after install. Open a new PowerShell or add $agentRoot to your user PATH."
}

Ensure-CursorAgentCli

Write-WinnowSetup "Optional tools (ranger, htop) are not installed automatically on Windows."
Write-WinnowSetup "Use WSL, Scoop, or custom pane commands if you need those binaries."

Write-WinnowSetup "Installing npm dependencies..."
npm install

Write-WinnowSetup "Building TypeScript (dist/)..."
npm run build

Write-WinnowSetup "Rebuilding node-pty for this machine..."
npm rebuild node-pty --build-from-source

Write-WinnowSetup "Setup complete. Next: sign in to the Cursor Agent CLI if prompted (see https://cursor.com/docs/cli/overview), then run npm run doctor or npm run ui."
