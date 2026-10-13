# Registra la tarea programada FarmaciaSync (al inicio de sesion).
# Requiere que C:\farmacia-sync\iniciar-farmacia-sync.ps1 exista.
$ErrorActionPreference = 'Stop'
$ps1 = 'C:\farmacia-sync\iniciar-farmacia-sync.ps1'
if (-not (Test-Path $ps1)) {
  Write-Error "No existe $ps1 - copia iniciar-farmacia-sync.ps1 a C:\farmacia-sync primero."
  exit 1
}

Unregister-ScheduledTask -TaskName 'FarmaciaSync' -Confirm:$false -ErrorAction SilentlyContinue

$arg     = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\farmacia-sync\iniciar-farmacia-sync.ps1"'
$action  = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arg
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask -TaskName 'FarmaciaSync' -Action $action -Trigger $trigger -Settings $settings `
  -Description 'farmacia-sync: servidor + consumidor TPV -> Supabase' | Out-Null

Write-Host 'Tarea FarmaciaSync registrada (al iniciar sesion).'
Write-Host 'Arrancar ahora:  Start-ScheduledTask -TaskName FarmaciaSync'
