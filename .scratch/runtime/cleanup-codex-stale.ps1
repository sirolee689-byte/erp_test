param(
  [switch]$WhatIfOnly
)

$ErrorActionPreference = 'Stop'

$targets = New-Object System.Collections.Generic.HashSet[int]

$all = Get-CimInstance Win32_Process

$stdioCodex = $all | Where-Object {
  $_.Name -eq 'codex.exe' -and
  $_.CommandLine -like '*OpenAI\Codex*' -and
  $_.CommandLine -like '*app-server --listen stdio*'
}

foreach ($proc in $stdioCodex) {
  [void]$targets.Add([int]$proc.ProcessId)

  $parent = $all | Where-Object { $_.ProcessId -eq $proc.ParentProcessId } | Select-Object -First 1
  if ($parent -and $parent.Name -eq 'node_repl.exe' -and $parent.CommandLine -like '*OpenAI\Codex*') {
    [void]$targets.Add([int]$parent.ProcessId)
  }
}

if ($targets.Count -eq 0) {
  Write-Host 'No stale Codex stdio child processes found.'
  exit 0
}

Write-Host 'Stale Codex child processes:'
$all |
  Where-Object { $targets.Contains([int]$_.ProcessId) } |
  Select-Object ProcessId, ParentProcessId, Name, CreationDate, CommandLine |
  Format-Table -AutoSize

if ($WhatIfOnly) {
  Write-Host 'WhatIfOnly set; no processes were stopped.'
  exit 0
}

foreach ($targetPid in $targets) {
  try {
    Stop-Process -Id $targetPid -Force -ErrorAction Stop
    Write-Host "Stopped PID $targetPid"
  } catch {
    Write-Warning "Could not stop PID ${targetPid}: $($_.Exception.Message)"
  }
}
