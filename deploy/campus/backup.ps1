$ErrorActionPreference = 'Stop'
$root = 'D:\moonshot-campus'
$app = Join-Path $root 'app'
$data = Join-Path $root 'data'
$backupRoot = Join-Path $root 'backups'
$task = 'MoonshotCampusServer'
$wasRunning = $false
try { $wasRunning = (Get-ScheduledTask -TaskName $task).State -eq 'Running' } catch {}
if ($wasRunning) {
    Stop-ScheduledTask -TaskName $task
    for ($i = 0; $i -lt 30; $i++) {
        try { if ((Get-ScheduledTask -TaskName $task).State -ne 'Running') { break } } catch { break }
        Start-Sleep -Seconds 1
    }
    try { if ((Get-ScheduledTask -TaskName $task).State -eq 'Running') { throw '服务器仍在运行，拒绝复制可能不一致的 SQLite 文件。' } } catch { if ($_.Exception.Message -like '服务器仍在运行*') { throw } }
}
try {
    $target = Join-Path $backupRoot (Get-Date -Format 'yyyyMMdd-HHmmss')
    New-Item -ItemType Directory -Path $target -Force | Out-Null
    Copy-Item (Join-Path $data 'campus.sqlite*') $target -Force -ErrorAction SilentlyContinue
    if (Test-Path (Join-Path $data 'avatars')) { Copy-Item (Join-Path $data 'avatars') $target -Recurse -Force }
    $old = Get-ChildItem $backupRoot -Directory | Sort-Object Name -Descending | Select-Object -Skip 14
    foreach ($directory in $old) { Remove-Item $directory.FullName -Recurse -Force }
    Write-Host "备份完成：$target"
}
finally {
    if ($wasRunning) { Start-ScheduledTask -TaskName $task }
}
