$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
if (-not $env:TELEGRAM_BOT_TOKEN) {
  Write-Warning "TELEGRAM_BOT_TOKEN is not set; transfer will run but no completion DM will be sent."
}
python server.py
