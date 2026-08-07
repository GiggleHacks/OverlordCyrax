# deploy-ratbox.ps1 — build + deploy Overlord 3.0.24 to root@ratbox. v1.3.1
# Steps: rollback tag -> source transfer -> docker build -> recreate -> health.
# v1.1.0: exclude Overlord-Desktop (5.6 GB Electron artifacts, unused by server image)
# v1.3.0: PS 5.1 mangles binary native-to-native pipes; ship a local .tar.gz via scp instead
$ErrorActionPreference = "Stop"
$DEPLOY_SCRIPT_VERSION = "1.3.1"
$VERSION = "3.0.24"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$deploy = "/tmp/overlord-deploy-$VERSION-$stamp"
$rollbackTag = "overlord-rollback:pre-$VERSION-$stamp"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

function Log([string]$msg) {
  $line = "{0} {1}" -f (Get-Date -Format "HH:mm:ss"), $msg
  Write-Output $line
}

Log "deploy-ratbox.ps1 v$DEPLOY_SCRIPT_VERSION starting (stamp=$stamp)"

# 1. Record live state and tag a rollback image
Log "[1/5] recording live image + rollback tag $rollbackTag"
$liveImage = (ssh root@ratbox "docker inspect overlord-server --format '{{.Image}}'").Trim()
Log "      live image: $liveImage"
ssh root@ratbox "docker tag $liveImage $rollbackTag"
if ($LASTEXITCODE -ne 0) { throw "rollback tag failed" }

# 2. Transfer source tree (local archive -> scp -> remote extract)
Log "[2/5] transferring source to ${deploy}"
$payload = Join-Path $env:TEMP "overlord-$VERSION-$stamp.tar.gz"
$remotePayload = "/tmp/overlord-$VERSION-$stamp.tar.gz"
Push-Location $root
try {
  tar -czf $payload --exclude=.git --exclude=tools/vlog-transfer --exclude=.docker-cache --exclude=Overlord-Desktop --exclude=Overlord-Server/node_modules --exclude=Overlord-Server/dist .
  if ($LASTEXITCODE -ne 0) { throw "local archive failed" }
} finally {
  Pop-Location
}
$sizeMB = [Math]::Round((Get-Item $payload).Length / 1MB, 1)
Log "      local archive: $sizeMB MB -> scp to ratbox"
scp $payload "root@ratbox:$remotePayload"
if ($LASTEXITCODE -ne 0) { throw "scp failed" }
ssh root@ratbox "mkdir -p $deploy && tar -xzf $remotePayload -C $deploy && rm -f $remotePayload"
if ($LASTEXITCODE -ne 0) { throw "remote extract failed" }
Remove-Item $payload -Force -ErrorAction SilentlyContinue

# 3. Build (no cache) — the long step
Log "[3/5] docker compose build --no-cache overlord-server (long step)"
ssh root@ratbox "cd $deploy && docker compose -p overlord build --no-cache overlord-server"
if ($LASTEXITCODE -ne 0) { throw "build failed" }

# 4. Recreate container
Log "[4/5] recreating overlord-server"
ssh root@ratbox "cd $deploy && docker compose -p overlord up -d overlord-server"
if ($LASTEXITCODE -ne 0) { throw "up failed" }

# 5. Health + version verification
Log "[5/5] verifying health + version"
Start-Sleep -Seconds 10
$state = (ssh root@ratbox "docker inspect overlord-server --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}'").Trim()
Log "      container state: $state"
$version = (ssh root@ratbox "curl -ks https://127.0.0.1:5173/api/version").Trim()
Log "      /api/version: $version"
ssh root@ratbox "docker logs --tail 30 overlord-server 2>&1"
if ($version -notmatch [regex]::Escape($VERSION)) { throw "version mismatch: expected $VERSION, got '$version' (rollback: docker tag $rollbackTag ghcr.io/vxaboveground/overlord:latest && cd $deploy && docker compose -p overlord up -d overlord-server)" }

Log "DEPLOY_OK $VERSION healthy=$state rollback=$rollbackTag"
