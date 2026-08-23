[CmdletBinding()]
param(
  [ValidateRange(1, 65535)]
  [int]$Port = 8787
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSCommandPath
$ServerFile = Join-Path $ProjectRoot 'server.mjs'
$LogDirectory = Join-Path $ProjectRoot 'data\logs'

if (-not (Test-Path -LiteralPath $ServerFile -PathType Leaf)) {
  throw "Nitros server entrypoint was not found: $ServerFile"
}

$NodePath = (Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source)
if (-not $NodePath) {
  $NitrosUserProfile = [Environment]::GetFolderPath('UserProfile')
  $CodexRuntimeRoot = Join-Path $NitrosUserProfile '.cache\codex-runtimes'
  if (Test-Path -LiteralPath $CodexRuntimeRoot) {
    $NodePath = Get-ChildItem -LiteralPath $CodexRuntimeRoot -Recurse -Filter node.exe -File -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTimeUtc -Descending |
      Select-Object -First 1 -ExpandProperty FullName
  }
}
if (-not $NodePath) {
  throw 'Node.js was not found. Install a supported Node.js runtime or add node.exe to PATH before starting the Nitros test server.'
}

New-Item -ItemType Directory -Path $LogDirectory -Force | Out-Null
$LogFile = Join-Path $LogDirectory ("nitros-server-{0:yyyyMMdd}.log" -f (Get-Date))
$env:PORT = [string]$Port
Set-Location -LiteralPath $ProjectRoot
"[{0:o}] Starting Nitros test server on 127.0.0.1:{1} with {2}" -f (Get-Date).ToUniversalTime(), $Port, $NodePath | Tee-Object -FilePath $LogFile -Append
& $NodePath $ServerFile 2>&1 | Tee-Object -FilePath $LogFile -Append
exit $LASTEXITCODE
