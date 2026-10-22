param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$nodeCommand = Get-Command node -ErrorAction Stop
$startupJson = & $nodeCommand.Source (Join-Path $PSScriptRoot 'tools/read-startup-config.mjs')
if ($LASTEXITCODE -ne 0) { throw '로컬 실행 설정을 읽지 못했습니다.' }
$appConfig = $startupJson | ConvertFrom-Json
$appPort = [int]$appConfig.port
$appUrl = "http://127.0.0.1:$appPort"
$isRunning = $false
try {
    $health = Invoke-RestMethod -Uri "$appUrl/api/health" -TimeoutSec 2
    if ($health.app -eq 'adb-desk') { $isRunning = $true }
} catch {}
if (-not $isRunning) {
    $entryPath = Join-Path $PSScriptRoot 'server.mjs'
    $runtimePath = Join-Path $appConfig.localRoot 'logs'
    New-Item -ItemType Directory -Path $runtimePath -Force | Out-Null
    $child = Start-Process -FilePath $nodeCommand.Source -ArgumentList @('"' + $entryPath + '"') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimePath 'server.log') -RedirectStandardError (Join-Path $runtimePath 'error.log')
    for ($attempt = 0; $attempt -lt 50; $attempt++) {
        Start-Sleep -Milliseconds 150
        if ($child.HasExited) { throw "ADB Desk stopped. Check $runtimePath\error.log" }
        try {
            $health = Invoke-RestMethod -Uri "$appUrl/api/health" -TimeoutSec 1
            if ($health.app -eq 'adb-desk') { $isRunning = $true; break }
        } catch {}
    }
    if (-not $isRunning) { throw "ADB Desk did not become ready. Check $runtimePath\error.log" }
}
Write-Output "ADB Desk is running: $appUrl"
if (-not $NoBrowser) { Start-Process $appUrl }
