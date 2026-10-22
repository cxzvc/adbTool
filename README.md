# ADB Desk

Android 기기의 파일·앱·로그·상태 정보를 PC의 웹 화면에서 관리하는 도구입니다. Android 공통 기능과 선택형 제조사 확장을 분리하며, 기본 설치는 삼성 자료 없이 공통 기능만 실행합니다.

현재 공식 실행 대상은 Windows입니다. 다른 운영체제와 실제 검증하지 않은 기기 조합은 [지원 범위](SUPPORT.md)를 확인해 주세요. 코드 분석, 현재 조회 성공, 변경 권한, 실제 적용 효과는 서로 다른 정보로 표시합니다.

2026-10-21 기준으로 공통 기능·제조사 확장·개인 자료 분리와 합의한 개발·검증 작업을 완료했습니다. 실제 브라우저 125%·200% 확대 검증과 자체 코드 라이선스 결정은 별도 보류 항목입니다. 공개 배포 준비 완료를 뜻하지 않으며, 자세한 완료 범위와 근거는 [공개 준비 기록](docs/PUBLIC-RELEASE.md)을 확인해 주세요.

## 설치와 실행

Node.js 20 이상과 npm이 필요합니다. 기기에 연결하려면 Android SDK Platform-Tools의 ADB도 필요합니다. CI는 Node.js 22에서 실행합니다.

```powershell
git clone https://github.com/cxzvc/adbTool.git
cd adbTool
npm ci
npm start
```

실행 후 `http://127.0.0.1:4387`을 엽니다. Windows에서는 `시작.cmd`와 `종료.cmd`도 사용할 수 있습니다.

ADB가 없어도 웹 서버는 시작되어 설치 안내를 표시합니다. 기기를 연결하지 않은 상태는 서버 오류나 기능 실행 성공으로 표시하지 않습니다.

## 개인 설정

공개 기본 설정은 `config.example.json`에 있습니다. 개인 설정은 Git에서 제외되는 `.local/config.json`에 저장합니다. 신규 설치는 로컬 접속만 허용하고 제조사 확장은 활성화하지 않습니다.

```powershell
New-Item -ItemType Directory -Path .local -Force
if (-not (Test-Path .local/config.json)) { Copy-Item config.example.json .local/config.json }
```

ADB는 `ADB_PATH`, 개인 설정의 `adbPath`, Android SDK 위치, PATH 등에서 찾습니다. 필요한 경우 이 PC에 설치된 ADB의 실제 경로를 지정할 수 있습니다.

```powershell
$env:ADB_PATH = 'C:\Android\platform-tools\adb.exe'
npm start
```

`ADB_DESK_HOME`으로 로컬 데이터 영역을, `ADB_DESK_CONFIG`로 개인 설정 파일을 지정할 수 있습니다. `PORT`는 서버 포트를 지정합니다. 설정을 바꾼 뒤에는 서버를 다시 시작해 주세요. LAN 접속은 개인 설정에서 명시적으로 활성화할 때만 사용합니다.

`ADB_DESK_CONFIG`에 지정한 파일은 존재해야 합니다. 경로가 잘못됐거나 이전 버전의 `config.json`만 남아 있으면 기본값으로 조용히 실행하지 않고 수정·이전 방법을 안내합니다.

## 제조사 확장

기본 공통 기능은 제조사 확장이나 One UI 자료를 필요로 하지 않습니다. 삼성 확장은 PC의 확장 설정에서 선택할 수 있으며, 활성화하더라도 삼성 기기와 해당 기능의 조건이 맞을 때만 메뉴가 표시됩니다.

확장을 활성화하는 것만으로 폰 설정이나 권한은 변경되지 않습니다. 내부 설정의 코드 사용처가 확인돼 있어도 현재 권한이나 실제 적용 효과는 별도일 수 있습니다. 이전 빌드의 자료는 현재 빌드 지원을 보장하지 않습니다.

삼성 확장을 제외한 소스에서도 서버와 공통 조회 기능이 실행되는지는 `tools/verify-clean-install.mjs`와 공통 기능 테스트로 검증합니다.

## 로컬 데이터

개인 설정, 작업 기록, 앱 목록 캐시, 백업, 녹화와 임시 파일은 `.local` 아래에서 관리합니다. 기존 버전에서 이전할 때는 안내된 마이그레이션 도구를 사용해 보존 여부를 확인해 주세요. 폴더를 직접 삭제하면 복원에 필요한 원본 기록을 잃을 수 있습니다.

기존 버전의 자료를 옮길 때는 서버를 종료한 뒤 먼저 이전 대상을 확인합니다. 두 번째 명령은 실제로 로컬 자료를 옮기고 파일 해시를 검증합니다. 이미 새 위치에 자료가 있으면 덮어쓰지 않습니다.

```powershell
node tools/migrate-local-data.mjs
node tools/migrate-local-data.mjs --apply
```

공개 배포에는 `.local`, 개인 설정, 백업, 기록, 캐시, `node_modules`를 포함하지 않습니다. 기존 로컬 데이터는 Git 제외 대상이 되지만 자동으로 삭제하지 않습니다.

## 검증과 공개용 내보내기

```powershell
npm test
node tools/check-public.mjs
node tools/export-public.mjs --out ..\adb-desk-public
node tools/verify-clean-install.mjs
```

내보내기는 허용 목록에 있는 소스·공개 데이터·테스트·문서만 새 폴더에 복사하며 원본을 삭제하거나 기존 대상 폴더를 덮어쓰지 않습니다. 새 설치 검증은 임시 복사본에서 `npm ci`를 실행한 뒤, 제조사 확장 비활성 상태와 삼성 확장을 물리적으로 제외한 상태의 서버·공통 기능을 확인합니다. 실제 ADB 연결은 차단합니다.

Git 저장소에서 공개할 변경을 준비할 때는 `node tools/check-public.mjs --tracked`도 실행해 주세요. 작업 폴더 내용뿐 아니라 Git에 저장할 준비가 된 파일 내용과 아직 추적하지 않는 파일 후보도 검사합니다. 내보내기는 개인 자료 검사에 실패하면 해당 자료를 복사하지 않습니다.

자동 테스트는 실제 브라우저의 글자 잘림·배율·클릭 위치나 실기기 변경 효과를 대신하지 않습니다. 상세 검증 기준은 [공개 준비 문서](docs/PUBLIC-RELEASE.md)에 있습니다.

## 라이선스와 외부 자료

**자체 코드의 공개 라이선스는 아직 결정하지 않았습니다.** 공개 준비 도구는 이 상태를 `licenseDecision: pending`, `publicReady: false`로 보고합니다. 기능 검증 통과만으로 공개 준비 완료를 선언하지 않습니다.

외부 코드·실행 파일·설명 데이터에는 각각의 라이선스가 적용됩니다. UAD-NG와 트래커 서명 데이터의 GPL 고지를 포함해 [외부 자료 목록](THIRD-PARTY-FEATURES.md), `vendor`의 고지문, `data/licenses`의 출처와 라이선스를 보존합니다. 확인되지 않은 개인 분석 원본이나 펌웨어 추출물을 공개 자료에 포함하지 않습니다.

기여 방법은 [CONTRIBUTING.md](CONTRIBUTING.md)를 참고해 주세요.
