# Registra (o actualiza) la tarea de Windows que lee los correos nuevos de Bancolombia y RappiCard
# cada 10 minutos y los guarda en Supabase (features/productive/finance/sync_job.py).
#
# Uso (PowerShell, sin permisos de administrador):
#   powershell -ExecutionPolicy Bypass -File scripts\register_finance_sync_task.ps1
#
# Corre sin ventana (pythonw), solo con la sesion iniciada. Log: data\finance_sync.log
# Para quitarla:  Unregister-ScheduledTask -TaskName "IronHabitTracker-FinanceSync" -Confirm:$false

$root = Split-Path -Parent $PSScriptRoot
$pythonw = Join-Path $root ".venv\Scripts\pythonw.exe"
if (-not (Test-Path $pythonw)) { throw "No existe $pythonw (crea el entorno virtual primero)." }

$action = New-ScheduledTaskAction -Execute $pythonw -Argument "-m features.productive.finance.sync_job" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes 10) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 5)

Register-ScheduledTask -TaskName "IronHabitTracker-FinanceSync" -Action $action -Trigger $trigger -Settings $settings `
    -Description "Lee correos nuevos de Bancolombia y RappiCard y los guarda en Supabase (Finance Tracker)." -Force | Out-Null

"Tarea IronHabitTracker-FinanceSync registrada: cada 10 minutos."
