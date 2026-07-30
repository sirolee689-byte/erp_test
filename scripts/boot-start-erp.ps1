# ERP boot: free port 29, then start Node production server
$ErrorActionPreference = 'Continue'

$root = 'E:\ERP_TEST'
$nodeExe = Join-Path $root '.tools\node\node.exe'
$logDir = Join-Path $root 'logs'
$logFile = Join-Path $logDir 'boot-start.log'

function Write-BootLog {
  param([string]$Message)
  $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
  try {
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    Add-Content -Path $logFile -Value $line -Encoding UTF8
  } catch {}
}

Write-BootLog '=== boot-start-erp begin ==='

if (-not (Test-Path $nodeExe)) {
  Write-BootLog "ERROR: node not found: $nodeExe"
  exit 1
}

try {
  $listen = Get-NetTCPConnection -LocalPort 29 -State Listen -ErrorAction SilentlyContinue
  if ($listen) {
    # 若是 Node 已在听，直接跳过；若是 IIS，先停再启
    $owners = @($listen | ForEach-Object { $_.OwningProcess } | Select-Object -Unique)
    $isNode = $false
    foreach ($pid in $owners) {
      try {
        $p = Get-Process -Id $pid -ErrorAction SilentlyContinue
        if ($p -and $p.ProcessName -match 'node') { $isNode = $true }
      } catch {}
    }
    if ($isNode) {
      Write-BootLog 'SKIP: port 29 already listening (node)'
      exit 0
    }
    Write-BootLog "WARN: port 29 held by non-node pid=$($owners -join ',')"
  }
} catch {
  Write-BootLog "WARN: port check failed: $($_.Exception.Message)"
}

$appcmd = Join-Path $env:windir 'system32\inetsrv\appcmd.exe'
if (Test-Path $appcmd) {
  try {
    & $appcmd stop site /site.name:Ministock 2>&1 | ForEach-Object { Write-BootLog "appcmd: $_" }
  } catch {
    Write-BootLog "WARN: stop Ministock failed: $($_.Exception.Message)"
  }
}

Start-Sleep -Seconds 2

$stdoutLog = Join-Path $logDir 'erp-server.log'
$stderrLog = Join-Path $logDir 'erp-server.err.log'

try {
  $proc = Start-Process -FilePath $nodeExe -ArgumentList 'server\index.js' -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog -PassThru
  Write-BootLog "STARTED node pid=$($proc.Id) port=29"
  exit 0
} catch {
  Write-BootLog "ERROR: start failed: $($_.Exception.Message)"
  exit 1
}
