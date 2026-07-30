# 生产环境启动（便携 Node + 29 端口）
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root
$nodeDir = Join-Path $root '.tools\node'
if (Test-Path (Join-Path $nodeDir 'node.exe')) {
  $env:Path = "$nodeDir;$env:Path"
}
npm run start
