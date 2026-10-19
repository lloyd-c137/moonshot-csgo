param(
    [Parameter(Mandatory = $true)][string]$ReleaseZip,
    [int]$Port = 8000,
    [string]$AllowedOrigins = '172.10.17.186,localhost,127.0.0.1'
)
$ErrorActionPreference = 'Stop'
$root = 'D:\moonshot-campus'
$app = Join-Path $root 'app'
$nodeDir = Join-Path $root 'node'
$data = Join-Path $root 'data'
$logs = Join-Path $root 'logs'
$backups = Join-Path $root 'backups'
$staging = Join-Path $root 'staging'
foreach ($directory in @($root, $app, $nodeDir, $data, $logs, $backups, $staging)) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }

$nodeExe = Join-Path $nodeDir 'node.exe'
if (-not (Test-Path $nodeExe)) {
    $nodeZip = Get-ChildItem -Path @($PSScriptRoot, $root, (Get-Location).Path) -Filter 'node-v22*-win-x64.zip' -File -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $nodeZip) {
        Write-Host '未找到离线 Node 22 zip，正在查询 Node.js 22 LTS 下载地址。'
        $index = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json'
        $version = $index | Where-Object { $_.version -like 'v22.*' } | Select-Object -First 1
        if (-not $version) { throw '无法取得 Node.js 22 版本列表。' }
        $zipName = "node-$($version.version)-win-x64.zip"
        $download = Join-Path $staging $zipName
        Invoke-WebRequest -Uri "https://nodejs.org/dist/$($version.version)/$zipName" -OutFile $download
        $nodeZip = Get-Item $download
    }
    $nodeStage = Join-Path $staging ('node-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $nodeStage | Out-Null
    Expand-Archive -LiteralPath $nodeZip.FullName -DestinationPath $nodeStage -Force
    $nodeRoot = Get-ChildItem $nodeStage -Directory | Select-Object -First 1
    Copy-Item (Join-Path $nodeRoot.FullName '*') $nodeDir -Recurse -Force
    Remove-Item $nodeStage -Recurse -Force
    if ($nodeZip.FullName.StartsWith($staging, [System.StringComparison]::OrdinalIgnoreCase)) { Remove-Item $nodeZip.FullName -Force }
}

$release = (Resolve-Path $ReleaseZip).Path
$stage = Join-Path $staging ('release-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage | Out-Null
Expand-Archive -LiteralPath $release -DestinationPath $stage -Force
Copy-Item (Join-Path $stage '*') $app -Recurse -Force
Remove-Item $stage -Recurse -Force
$config = [ordered]@{
    PORT = $Port
    HOST = '0.0.0.0'
    DATA_DIR = $data
    DIST_DIR = (Join-Path $app 'dist')
    ALLOWED_ORIGINS = $AllowedOrigins
}
$json = $config | ConvertTo-Json
[System.IO.File]::WriteAllText((Join-Path $app 'config.json'), $json, [System.Text.UTF8Encoding]::new($false))

$task = 'MoonshotCampusServer'
$run = Join-Path $app 'deploy\campus\run.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$run`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -RestartInterval (New-TimeSpan -Minutes 1) -RestartCount 999 -StartWhenAvailable
Register-ScheduledTask -TaskName $task -Action $action -Trigger $trigger -Settings $settings -Description 'Moonshot 校内游戏服务器' -Force | Out-Null
$backupAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $app 'deploy\campus\backup.ps1')`""
$backupTrigger = New-ScheduledTaskTrigger -Daily -At '03:30'
Register-ScheduledTask -TaskName 'MoonshotCampusDailyBackup' -Action $backupAction -Trigger $backupTrigger -Settings (New-ScheduledTaskSettingsSet -StartWhenAvailable) -Description 'Moonshot 校内数据备份' -Force | Out-Null
Start-ScheduledTask -TaskName $task
Write-Host "安装完成。服务端口：$Port；数据目录：$data；日志目录：$logs"
