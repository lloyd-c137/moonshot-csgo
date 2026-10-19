$ErrorActionPreference = 'Continue'
Unregister-ScheduledTask -TaskName 'MoonshotCampusServer' -Confirm:$false
Unregister-ScheduledTask -TaskName 'MoonshotCampusDailyBackup' -Confirm:$false
Write-Host '已删除计划任务；D:\moonshot-campus 下的数据和文件均保留。'
