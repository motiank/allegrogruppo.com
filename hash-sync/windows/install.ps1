# Installs the Hashavshevet sync in this folder. Started by install.cmd. Safe to run again (it keeps .env).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
Write-Host "Hashavshevet sync - install in $root"
Write-Host ""

# 1. Node.js 18 or newer
$node = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host "Node.js was not found. Install the LTS version from https://nodejs.org and run install.cmd again." -ForegroundColor Red
  exit 1
}
$version = (& node -v).TrimStart('v')
if ([int]$version.Split('.')[0] -lt 18) {
  Write-Host "Node.js $version is too old. Install version 18 or newer from https://nodejs.org and run install.cmd again." -ForegroundColor Red
  exit 1
}
Write-Host "Node.js $version at $($node.Source)"
# The scheduled task runs as SYSTEM, which may not have node in its PATH, so the .cmd files read the path from here.
Set-Content -Path (Join-Path $root 'node-path.txt') -Value $node.Source -NoNewline

# 2. The packages (mssql, mysql2, dotenv), exactly the versions of package-lock.json
$npmCommand = if (Test-Path (Join-Path $root 'package-lock.json')) { 'ci' } else { 'install' }
Write-Host "Installing the packages (npm $npmCommand)..."
& npm $npmCommand --omit=dev --no-audit --no-fund
if ($LASTEXITCODE -ne 0) {
  Write-Host "npm $npmCommand failed. Check the internet connection and run install.cmd again." -ForegroundColor Red
  exit 1
}

# 3. The settings file
$envFile = Join-Path $root '.env'
if (-not (Test-Path $envFile)) {
  Copy-Item (Join-Path $root '.env.example') $envFile
  Write-Host ""
  Write-Host "Notepad now opens the settings file (.env)." -ForegroundColor Yellow
  Write-Host "Fill in the SQL Server password and database name, and the MySQL host, user and password." -ForegroundColor Yellow
  Write-Host "Save the file and close Notepad to continue." -ForegroundColor Yellow
  Start-Process notepad.exe -ArgumentList "`"$envFile`"" -Wait
} else {
  Write-Host "Keeping the existing .env"
}

# 4. Check both connections
Write-Host ""
Write-Host "Checking the connections..."
& node src\check.js --production
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "Open .env in Notepad, fix the settings, then run check.cmd." -ForegroundColor Yellow
  exit 1
}
Write-Host ""
Write-Host "Installed. Next: sync-now.cmd runs the first sync. schedule.cmd creates the nightly task." -ForegroundColor Green
