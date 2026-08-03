param(
    [Parameter(Mandatory = $true)]
    [string]$TargetPath,
    [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
$resolved = [System.IO.Path]::GetFullPath($TargetPath)
if (-not [System.IO.File]::Exists($resolved)) {
    throw "Legacy dining source was not found: $resolved"
}

$encoding = [System.Text.Encoding]::GetEncoding(936)
$content = [System.IO.File]::ReadAllText($resolved, $encoding)
$replacements = @(
    @{
        Old = "select * from UB_ERP_Dining_meal where  uid='" + '"&userid&"' + "' and dis_dtime='" + '"&fmtdate(date())&"' + "' and dis_lx='" + '"&lx&"' + "' order by id "
        New = "select * from UB_ERP_Dining_meal where uid='" + '"&userid&"' + "' and dis_dtime='" + '"&fmtdate(date())&"' + "' and dis_lx='" + '"&lx&"' + "' and del='0' and pass='1' order by id "
    },
    @{
        Old = "select * from UB_ERP_Dining_meal where  uid='" + '"&rs("uid")&"' + "'  and dis_dtime='" + '"&fmtdate(date())&"' + "' and dis_lx='" + '"&lx&"' + "' "
        New = "select * from UB_ERP_Dining_meal where uid='" + '"&rs("uid")&"' + "' and dis_dtime='" + '"&fmtdate(date())&"' + "' and dis_lx='" + '"&lx&"' + "' and del='0' and pass='1' "
    }
)

foreach ($item in $replacements) {
    if (-not $content.Contains($item.Old)) {
        throw 'Legacy dining queries did not match. No file was changed.'
    }
}

if ($CheckOnly) {
    Write-Host "Compatibility patch check passed. No file was changed: $resolved"
    exit 0
}

$backupPath = "$resolved.codex-backup"
if (-not [System.IO.File]::Exists($backupPath)) {
    [System.IO.File]::Copy($resolved, $backupPath)
}

foreach ($item in $replacements) {
    $content = $content.Replace($item.Old, $item.New)
}
[System.IO.File]::WriteAllText($resolved, $content, $encoding)

Write-Host "Compatibility patch applied: $resolved"
Write-Host "Original source backup: $backupPath"
