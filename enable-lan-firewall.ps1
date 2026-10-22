$ErrorActionPreference = 'Stop'
$nodeCommand = Get-Command node -ErrorAction Stop
$startupJson = & $nodeCommand.Source (Join-Path $PSScriptRoot 'tools/read-startup-config.mjs')
if ($LASTEXITCODE -ne 0) { throw '로컬 실행 설정을 읽지 못했습니다.' }
$appConfig = $startupJson | ConvertFrom-Json
if (-not $appConfig.lanEnabled) { throw 'LAN 접속은 기본으로 꺼져 있습니다. 로컬 설정에서 명시적으로 활성화한 뒤 이 스크립트를 실행하세요.' }
$appPort = [int]$appConfig.port
$ruleName = "ADB Desk LAN TCP $appPort"
if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $appPort -RemoteAddress LocalSubnet -Profile Any | Out-Null
}
Write-Host "ADB Desk LAN access: TCP $appPort allowed from LocalSubnet."
Write-Host '접속할 PC 주소는 웹 화면의 접속 안내에서 확인하세요.'
Read-Host 'Press Enter to close'
