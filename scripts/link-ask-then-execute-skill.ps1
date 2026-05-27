# Junction: .cursor/skills/ask-then-execute -> .agents/skills/ask-then-execute
# Run from repo root: npm run link:skill:ask-then-execute

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$target = Join-Path $repoRoot '.agents\skills\ask-then-execute'
$link = Join-Path $repoRoot '.cursor\skills\ask-then-execute'

if (-not (Test-Path -LiteralPath $target)) {
  throw "Missing source: $target"
}

$skillsParent = Join-Path $repoRoot '.cursor\skills'
if (-not (Test-Path -LiteralPath $skillsParent)) {
  New-Item -ItemType Directory -Path $skillsParent -Force | Out-Null
}

if (Test-Path -LiteralPath $link) {
  $item = Get-Item -LiteralPath $link -Force
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
    Write-Host "Removing existing junction: $link"
    cmd /c "rmdir `"$link`""
    if ($LASTEXITCODE -ne 0) {
      throw "rmdir junction failed (exit $LASTEXITCODE)"
    }
  }
  else {
    Write-Host "Removing plain directory before junction: $link"
    Remove-Item -LiteralPath $link -Recurse -Force
  }
}

$result = cmd /c "mklink /J `"$link`" `"$target`""
if ($LASTEXITCODE -ne 0) {
  throw "mklink failed (exit $LASTEXITCODE): $result"
}

Write-Host $result
Write-Host "Done. Edit only: $target"
