param(
  [switch]$WhatIfOnly
)

$ErrorActionPreference = 'Stop'

$patterns = @(
  '*OpenAI.Codex_*',
  '*AppData\Local\OpenAI\Codex*'
)

$processes = Get-CimInstance Win32_Process | Where-Object {
  $cmd = $_.CommandLine
  if ([string]::IsNullOrWhiteSpace($cmd)) {
    return $false
  }

  foreach ($pattern in $patterns) {
    if ($cmd -like $pattern) {
      return $true
    }
  }

  return $false
}

if (-not $processes) {
  Write-Host 'No Codex app processes found.'
  exit 0
}

Write-Host 'Codex app processes to stop:'
$processes |
  Select-Object ProcessId, ParentProcessId, Name, CreationDate, CommandLine |
  Sort-Object CreationDate |
  Format-Table -AutoSize

if ($WhatIfOnly) {
  Write-Host 'WhatIfOnly set; no processes were stopped.'
  exit 0
}

$ids = $processes | Select-Object -ExpandProperty ProcessId -Unique

foreach ($targetPid in $ids) {
  try {
    Stop-Process -Id $targetPid -Force -ErrorAction Stop
    Write-Host "Stopped PID $targetPid"
  } catch {
    Write-Warning "Could not stop PID ${targetPid}: $($_.Exception.Message)"
  }
}

Write-Host 'Codex app processes stopped. Reopen Codex from the Start menu.'
