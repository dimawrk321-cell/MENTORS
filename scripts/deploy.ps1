# MENTORS dev-stand - one-command deploy trigger from the laptop.
# Runs the server-side deploy.sh over the Tailscale SSH alias (mentors-vps).
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1
#
# NB: no `$ErrorActionPreference = "Stop"` here on purpose - docker/ssh write
# normal build progress to stderr, which Windows PowerShell 5.1 would otherwise
# turn into a terminating error. Success is judged by $LASTEXITCODE instead.

$Remote = "mentors-vps"
$AppDir = "/opt/mentors"

Write-Host "-> Deploying MENTORS dev-stand via $Remote ..." -ForegroundColor Cyan
& ssh -o BatchMode=yes $Remote "cd $AppDir && bash deploy.sh"
$code = $LASTEXITCODE

if ($code -ne 0) {
  Write-Host "Deploy FAILED (ssh/deploy.sh exit $code)" -ForegroundColor Red
  exit $code
}
Write-Host "OK: Deploy finished. https://dev.155-212-211-251.sslip.io" -ForegroundColor Green
