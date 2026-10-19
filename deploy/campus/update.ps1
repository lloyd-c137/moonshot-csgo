param([Parameter(Mandatory = $true)][string]$ReleaseZip)
$ErrorActionPreference = 'Stop'
$root = 'D:\moonshot-campus'
$app = Join-Path $root 'app'
$data = Join-Path $root 'data'
$backup = Join-Path (Join-Path $root 'backups') (Get-Date -Format 'yyyyMMdd-HHmmss')
$staging = Join-Path $root 'staging'
$task = 'MoonshotCampusServer'
Stop-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue
for ($i = 0; $i -lt 30; $i++) {
    try { if ((Get-ScheduledTask -TaskName $task).State -ne 'Running') { break } } catch { break }
    Start-Sleep -Seconds 1
}
try { if ((Get-ScheduledTask -TaskName $task).State -eq 'Running') { throw '服务器仍在运行，拒绝开始更新。' } } catch { if ($_.Exception.Message -like '服务器仍在运行*') { throw } }
try {
    New-Item -ItemType Directory -Path $backup -Force | Out-Null
    Copy-Item (Join-Path $data 'campus.sqlite*') $backup -Force -ErrorAction SilentlyContinue
    if (Test-Path (Join-Path $data 'avatars')) { Copy-Item (Join-Path $data 'avatars') $backup -Recurse -Force }
    $stage = Join-Path $staging ('update-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $stage | Out-Null
    Expand-Archive -LiteralPath (Resolve-Path $ReleaseZip).Path -DestinationPath $stage -Force
    foreach ($item in @('dist', 'dist-server', 'deploy')) {
        $target = Join-Path $app $item
        if (Test-Path $target) { Remove-Item $target -Recurse -Force }
        Copy-Item (Join-Path $stage $item) $target -Recurse -Force
    }
    Remove-Item $stage -Recurse -Force
    Start-ScheduledTask -TaskName $task
    $port = 8000
    try { $cfg = Get-Content (Join-Path $app 'config.json') -Raw | ConvertFrom-Json; $port = [int]$cfg.PORT } catch {}
    $healthy = $false
    for ($i = 0; $i -lt 30; $i++) {
        try { if ((Invoke-WebRequest -Uri "http://127.0.0.1:$port/health" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200) { $healthy = $true; break } } catch {}
        Start-Sleep -Seconds 1
    }
    if (-not $healthy) { throw '更新后健康检查未通过；数据备份保存在 ' + $backup }
    Write-Host "更新成功；数据备份：$backup"
}
finally {
    try { Start-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue } catch {}
}
