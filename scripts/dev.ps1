$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$envPath = Join-Path $projectRoot ".env"

if (-not (Test-Path $envPath)) {
  Write-Output "No .env found. Syncing OpenRouter key from existing Hydria config."
  & (Join-Path $PSScriptRoot "sync-openrouter-key.ps1")
}

Push-Location $projectRoot
try {
  if (-not (Test-Path (Join-Path $projectRoot "node_modules"))) {
    & npm install
  }
  & npm run dev
} finally {
  Pop-Location
}
