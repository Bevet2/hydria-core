param(
  [string]$Model = "",
  [string]$OllamaHost = "",
  [string]$ModelsDir = ""
)

$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$envPath = Join-Path $projectRoot ".env"
$configPath = Join-Path $projectRoot "models\local\config\model.json"

function Get-EnvValue {
  param(
    [string]$Path,
    [string]$Name
  )

  if (-not (Test-Path $Path)) {
    return $null
  }

  $line = Get-Content -Path $Path | Where-Object { $_ -match "^$Name=" } | Select-Object -First 1
  if (-not $line) {
    return $null
  }

  return $line.Substring($Name.Length + 1)
}

if (-not $Model) {
  $Model = Get-EnvValue -Path $envPath -Name "LOCAL_MODEL_NAME"
}
if (-not $Model) {
  $Model = "qwen2.5:3b"
}

if (-not $OllamaHost) {
  $hostFromEnv = Get-EnvValue -Path $envPath -Name "OLLAMA_PROJECT_HOST"
  $OllamaHost = if ($hostFromEnv) { $hostFromEnv } else { "127.0.0.1:11435" }
}

if (-not $ModelsDir) {
  $modelsDirFromEnv = Get-EnvValue -Path $envPath -Name "OLLAMA_PROJECT_MODELS_DIR"
  $ModelsDir = if ($modelsDirFromEnv) { $modelsDirFromEnv } else { "F:/hydria-arena/models/local/ollama-store" }
}

$baseUrl = if ($OllamaHost -match '^https?://') { $OllamaHost } else { "http://$OllamaHost" }
$ollamaCommand = Get-Command ollama -ErrorAction Stop

New-Item -ItemType Directory -Force -Path $ModelsDir | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path $configPath -Parent) | Out-Null

function Test-OllamaEndpoint {
  try {
    Invoke-RestMethod -Method Get -Uri "$baseUrl/api/tags" -TimeoutSec 3 | Out-Null
    return $true
  } catch {
    return $false
  }
}

if (-not (Test-OllamaEndpoint)) {
  $processInfo = New-Object System.Diagnostics.ProcessStartInfo
  $processInfo.FileName = $ollamaCommand.Source
  $processInfo.Arguments = "serve"
  $processInfo.UseShellExecute = $false
  $processInfo.CreateNoWindow = $true
  $processInfo.EnvironmentVariables["OLLAMA_HOST"] = $OllamaHost
  $processInfo.EnvironmentVariables["OLLAMA_MODELS"] = $ModelsDir
  $processInfo.EnvironmentVariables["OLLAMA_API_KEY"] = "ollama-local"
  [System.Diagnostics.Process]::Start($processInfo) | Out-Null

  $ready = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Seconds 1
    if (Test-OllamaEndpoint) {
      $ready = $true
      break
    }
  }

  if (-not $ready) {
    throw "Dedicated Ollama endpoint did not start on $baseUrl"
  }
}

$env:OLLAMA_HOST = $OllamaHost
$env:OLLAMA_MODELS = $ModelsDir
$env:OLLAMA_API_KEY = "ollama-local"

Write-Output "Pulling $Model into $ModelsDir through $baseUrl"
& $ollamaCommand.Source pull $Model

$payload = @{
  model = $Model
  prompt = "Reply with OK."
  stream = $false
} | ConvertTo-Json

$test = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/generate" -ContentType "application/json" -Body $payload

$config = @{
  provider = "ollama"
  runtimeModel = $Model
  upstreamModel = "Qwen/Qwen2.5-3B-Instruct"
  host = $OllamaHost
  baseUrl = $baseUrl
  modelsDir = $ModelsDir
  role = "local student model"
  lastSetupAt = (Get-Date).ToString("o")
  healthcheck = ($test.response | ForEach-Object { $_.ToString().Trim() })
} | ConvertTo-Json -Depth 4

Set-Content -Path $configPath -Value $config -Encoding UTF8
Write-Output "Local model setup completed for $Model at $baseUrl"
