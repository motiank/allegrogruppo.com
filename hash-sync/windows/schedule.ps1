# Creates (or removes) the Windows task "Hashavshevet sync". Started by schedule.cmd with administrator rights.
param([string]$Time = '02:00', [switch]$Remove)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$name = 'Hashavshevet sync'

if ($Remove) {
  Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "The task '$name' was removed. You can close this window."
  exit 0
}

# SYSTEM runs the task also when nobody is logged in, and needs no password.
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"`"$root\run-sync.cmd`"`"" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Daily -At $Time
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Hours 12)
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
  -Description "Copies Hashavshevet into allegro_finance (hash-sync). Log: $root\logs" -Force | Out-Null

Write-Host "The task '$name' runs every day at $Time (also when nobody is logged in)."
Write-Host "You can see it in Task Scheduler (taskschd.msc) and run it there with 'Run'. The log is in $root\logs."
Write-Host "You can close this window."
