# MENTORS dev-stand — one-command deploy trigger from the laptop.
# Runs the server-side deploy.sh over the Tailscale SSH alias (mentors-vps).
# Usage:  pwsh scripts/deploy.ps1
$ErrorActionPreference = "Stop"

$Remote = "mentors-vps"
$AppDir = "/opt/mentors"

Write-Host "→ Deploying MENTORS dev-stand via $Remote ..." -ForegroundColor Cyan
ssh -o BatchMode=yes $Remote "cd $AppDir && bash deploy.sh"
if ($LASTEXITCODE -ne 0) {
  throw "Deploy failed (ssh/deploy.sh exit $LASTEXITCODE)"
}
Write-Host "✓ Deploy finished. https://dev.62-113-108-135.sslip.io" -ForegroundColor Green
