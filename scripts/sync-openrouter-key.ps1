param(
  [string]$TargetEnv = ""
)

$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if (-not $TargetEnv) {
  $TargetEnv = Join-Path $projectRoot ".env"
}

$envExample = Join-Path $projectRoot ".env.example"
if (-not (Test-Path $envExample)) {
  throw ".env.example not found in $projectRoot"
}

$workspaceParent = Split-Path $projectRoot -Parent
$candidateSources = @()

if ($env:HYDRIA_ENV_SOURCE) {
  $candidateSources += $env:HYDRIA_ENV_SOURCE
}

$candidateSources += @(
  (Join-Path $projectRoot ".env"),
  (Join-Path $workspaceParent "hydria\backend\.env"),
  (Join-Path $workspaceParent "hydria\.env"),
  (Join-Path $workspaceParent "hydria-studio\backend\.env"),
  (Join-Path $workspaceParent "hydria-studio\.env")
) | Where-Object { $_ }

$candidateSources = $candidateSources |
  Where-Object { Test-Path $_ } |
  Select-Object -Unique

$sourcePath = $null
$openRouterKey = $env:OPENROUTER_API_KEY

if ($openRouterKey) {
  $sourcePath = "process env OPENROUTER_API_KEY"
}

if ($candidateSources.Count -eq 0) {
  if (-not $openRouterKey) {
    throw "No obvious Hydria .env source file found. Set OPENROUTER_API_KEY or HYDRIA_ENV_SOURCE, or place a sibling hydria/hydria-studio repo next to this repo."
  }
}

if (-not $openRouterKey) {
  foreach ($candidate in $candidateSources) {
    $line = Get-Content -Path $candidate | Where-Object { $_ -match '^OPENROUTER_API_KEY=' } | Select-Object -First 1
    if ($line) {
      $sourcePath = $candidate
      $openRouterKey = $line.Substring("OPENROUTER_API_KEY=".Length)
      break
    }
  }
}

if (-not $openRouterKey) {
  throw "OPENROUTER_API_KEY not found in candidate config files. Set OPENROUTER_API_KEY directly or point HYDRIA_ENV_SOURCE to a valid .env file."
}

$templateLines = if (Test-Path $TargetEnv) {
  Get-Content -Path $TargetEnv
} else {
  Get-Content -Path $envExample
}

$resultLines = @()
$replaced = $false

foreach ($line in $templateLines) {
  if ($line -match '^OPENROUTER_API_KEY=') {
    $resultLines += "OPENROUTER_API_KEY=$openRouterKey"
    $replaced = $true
  } else {
    $resultLines += $line
  }
}

if (-not $replaced) {
  $resultLines += "OPENROUTER_API_KEY=$openRouterKey"
}

Set-Content -Path $TargetEnv -Value $resultLines -Encoding UTF8

$masked = if ($openRouterKey.Length -ge 8) {
  "{0}...{1}" -f $openRouterKey.Substring(0, 4), $openRouterKey.Substring($openRouterKey.Length - 4)
} else {
  "****"
}

Write-Output "OpenRouter key synced to $TargetEnv from $sourcePath (masked: $masked)"
