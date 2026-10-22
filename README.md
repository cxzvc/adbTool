# ADB Desk

[![Public source checks](https://github.com/cxzvc/adbTool/actions/workflows/public-ci.yml/badge.svg?branch=main)](https://github.com/cxzvc/adbTool/actions/workflows/public-ci.yml?query=branch%3Amain)
[![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-43853d)](https://nodejs.org/)
[![Windows](https://img.shields.io/badge/platform-Windows-0078d4)](SUPPORT.md)

Android 기기의 파일·앱·로그·상태 정보를 PC의 웹 화면에서 관리하는 도구입니다. Android 공통 기능과 선택형 제조사 확장을 분리하며, 기본 설치는 삼성 자료 없이 공통 기능만 실행합니다.

An Android device management web UI powered by a local Node.js server and ADB. Common features work without the optional Samsung extension. Windows is the currently supported host platform.

[빠른 시작](#설치와-실행) · [주요 기능](#주요-기능) · [지원 범위](SUPPORT.md) · [자주 묻는 질문](#자주-묻는-질문) · [오류 제보](https://github.com/cxzvc/adbTool/issues/new/choose) · [기여 안내](CONTRIBUTING.md)

현재 공식 실행 대상은 Windows입니다. 다른 운영체제와 실제 검증하지 않은 기기 조합은 [지원 범위](SUPPORT.md)를 확인해 주세요. 코드 분석, 현재 조회 성공, 변경 권한, 실제 적용 효과는 서로 다른 정보로 표시합니다.

공통 기능·제조사 확장·로컬 자료를 분리했습니다. 실제 브라우저 125%·200% 확대 검증은 보류 항목이며, 자세한 검증 범위와 근거는 [검증 기록](docs/PUBLIC-RELEASE.md)을 확인해 주세요.

## 주요 기능

| 분야 | 제공 기능 | 범위·조건 |
| --- | --- | --- |
| 연결 관리 | USB·무선 ADB 기기 목록, 페어링·연결, 포트 포워딩 | PC의 ADB와 폰의 연결 승인이 필요합니다. |
| 파일 관리 | 폴더 탐색, 업로드·다운로드, 이름 변경·복사·이동·삭제 | ADB가 접근할 수 있는 경로를 대상으로 합니다. |
| 앱 관리 | APK 설치·백업, 앱 목록·설명, 권한·AppOps, 활성화·삭제 | 시스템 앱과 내부 데이터는 기기 정책에 따라 제한됩니다. |
| 화면·소리 | 화면 보기·조작, 캡처·녹화, 지원 기기의 소리 전송 | Android 버전·코덱·기기 지원 조건에 따라 달라집니다. |
| 상태·진단 | CPU·RAM·배터리·저장소 그래프, 프로세스·시스템 진단 | 수집할 수 없는 값은 제한 이유와 함께 표시합니다. |
| 네트워크·로그 | Wi-Fi·블루투스·IP 정보, 로그 필터·저장 | 보호된 네트워크 정보와 로그 버퍼에는 추가 권한이 필요할 수 있습니다. |
| 설정·사용자 | 설정 조회, 지원되는 설정 변경, 사용자·프로필 관리 | 지원 여부와 현재 권한을 확인하며, 내부 제어의 실제 효과는 별도입니다. |
| 선택형 확장 | 삼성 설정 설명과 빌드별 검증 자료 | 기본 비활성화이며, 해당 제조사와 기능 조건이 맞을 때만 제공합니다. |

## 설치와 실행

[Git](https://git-scm.com/downloads), [Node.js 20 이상과 npm](https://nodejs.org/), 기기 연결을 위한 [Android SDK Platform-Tools의 ADB](https://developer.android.com/tools/releases/platform-tools)가 필요합니다. CI는 Node.js 22에서 실행합니다. Git을 사용하지 않으려면 GitHub의 **Code → Download ZIP**으로 소스를 받아 압축을 풀고 해당 폴더에서 `npm ci`부터 실행할 수 있습니다.

```powershell
git clone https://github.com/cxzvc/adbTool.git
cd adbTool
npm ci
npm start
```

실행 후 `http://127.0.0.1:4387`을 엽니다. Windows에서는 `시작.cmd`와 `종료.cmd`도 사용할 수 있습니다.

ADB가 없어도 웹 서버는 시작되어 설치 안내를 표시합니다. 기기를 연결하지 않은 상태는 서버 오류나 기능 실행 성공으로 표시하지 않습니다.

### 처음 연결하기

1. 웹의 연결 화면에서 ADB 설치·검색 상태를 확인합니다. ADB를 찾지 못하면 아래의 `ADB_PATH` 예시처럼 설치 위치를 지정합니다.
2. USB 연결은 폰에서 USB 디버깅을 허용하고, 이 PC의 연결 승인 요청을 확인합니다. Windows에서 기기가 보이지 않으면 제조사의 USB 드라이버도 확인합니다.
3. 무선 연결은 이를 지원하는 폰에서 무선 디버깅을 사용합니다. 처음에는 **페어링 코드로 기기 페어링**에 표시된 주소·포트와 코드를 웹의 페어링 화면에 입력합니다. 페어링 포트와 일반 연결 포트는 다를 수 있습니다.
4. 연결된 기기를 선택하고 원하는 탭을 엽니다. 삼성 확장은 필요한 경우에만 PC의 확장 설정에서 활성화합니다.

이 프로젝트는 PC에서 실행하는 로컬 서버 방식입니다. GitHub 페이지 자체가 기기를 연결하는 서비스는 아니며, 브라우저만으로 ADB를 대체하는 WebUSB 방식도 아닙니다.

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

## 자주 묻는 질문

**갤럭시가 아니어도 사용할 수 있나요?**

공통 기능은 삼성 자료나 특정 모델·일련번호 없이 실행됩니다. 개별 기능의 사용 가능 여부는 연결한 기기의 Android 버전·명령 지원·현재 권한에 따라 판단합니다. 삼성 확장은 다른 제조사의 기기에 적용하지 않습니다.

**루팅이 필요한가요?**

일반 파일·앱·로그·상태 조회 등 공통 기능에 루팅을 일괄 요구하지 않습니다. 보호된 앱 데이터와 일부 시스템 기능은 추가 권한 또는 루팅이 필요할 수 있으며, 해당 화면에서 제한 이유와 가능한 대체 조회를 안내합니다.

**연결된 기기가 없거나 연결이 끊겼다고 나옵니다.**

케이블·연결 승인 또는 무선 연결 주소를 확인한 뒤 다시 조회해 주세요. 무선 디버깅의 포트는 재연결 시 달라질 수 있습니다. 서비스가 검색됐다는 사실만으로 페어링이나 ADB 연결이 완료된 것은 아닙니다.

**포트가 사용 중이라 서버가 켜지지 않습니다.**

다른 서버가 같은 포트를 사용 중인지 확인하거나 PowerShell에서 `$env:PORT = '4388'`을 지정한 뒤 `npm start`를 실행해 주세요. 이 경우 브라우저에서도 변경한 포트로 접속합니다.

**‘권한 제한’이나 ‘실제 효과 미확인’은 무슨 뜻인가요?**

권한 제한은 현재 ADB로 접근하거나 변경할 수 없다는 뜻입니다. 실제 효과 미확인은 코드 분석이나 저장값 조회만으로 폰의 실제 동작까지 확인하지 못했다는 뜻입니다. 설정값 저장 성공을 실제 적용 성공으로 표시하지 않습니다.

**오류를 어디에 제보하나요?**

[오류·기능 요청 양식](https://github.com/cxzvc/adbTool/issues/new/choose)을 이용해 주세요. 사용 버전, PC·Android 버전, 문제가 발생한 탭과 재현 순서를 적으면 확인에 도움이 됩니다. 일련번호·IP·계정·전체 앱 목록·백업은 올리지 말고, 화면이나 로그에서도 개인 정보를 가려 주세요.

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

기여 방법은 [CONTRIBUTING.md](CONTRIBUTING.md)를 참고해 주세요.
