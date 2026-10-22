$ErrorActionPreference = 'Stop'
$nodeCommand = Get-Command node -ErrorAction Stop
$startupJson = & $nodeCommand.Source (Join-Path $PSScriptRoot 'tools/read-startup-config.mjs')
if ($LASTEXITCODE -ne 0) { throw '로컬 실행 설정을 읽지 못했습니다.' }
$appConfig = $startupJson | ConvertFrom-Json
$appPort = [int]$appConfig.port
$entryPath = Join-Path $PSScriptRoot 'server.mjs'
$listeners = @(Get-NetTCPConnection -LocalPort $appPort -State Listen -ErrorAction SilentlyContinue)
$stopped = $false
foreach ($listener in $listeners) {
    $appProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
    if ($appProcess.Name -eq 'node.exe' -and $appProcess.CommandLine -and $appProcess.CommandLine.IndexOf($entryPath, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
        Stop-Process -Id $listener.OwningProcess
        $stopped = $true
    }
}
if ($stopped) { Write-Output 'ADB Desk stopped. Your ADB server remains running.' }
else { Write-Output 'No matching ADB Desk process was found.' }
