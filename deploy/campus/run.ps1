$ErrorActionPreference = 'Continue'
$root = 'D:\moonshot-campus'
$app = Join-Path $root 'app'
$node = Join-Path $root 'node\node.exe'
$logDir = Join-Path $root 'logs'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
Set-Location $app
while ($true) {
    $log = Join-Path $logDir ('server-' + (Get-Date -Format 'yyyy-MM-dd') + '.log')
    Add-Content -Path $log -Value ("[{0}] Moonshot campus server starting" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')) -Encoding UTF8
    & $node (Join-Path $app 'dist-server\campus-server.mjs') *>> $log
    $code = $LASTEXITCODE
    Add-Content -Path $log -Value ("[{0}] Server exited with code {1}; restarting in 5 seconds" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $code) -Encoding UTF8
    Start-Sleep -Seconds 5
}
