(() => {
  const permissionNames={
    DUMP:'시스템 서비스 진단 정보 조회',READ_LOGS:'다른 앱의 시스템 로그 조회',PACKAGE_USAGE_STATS:'앱 사용 정보·저장 공간 통계 조회',
    INTERACT_ACROSS_USERS:'다른 사용자·프로필 정보 접근',INTERACT_ACROSS_USERS_FULL:'다른 사용자·프로필에 대한 전체 접근',
    WRITE_SECURE_SETTINGS:'보호된 시스템 설정 접근·변경',WRITE_SETTINGS:'시스템 설정 변경',MANAGE_USERS:'사용자·프로필 관리',
    MANAGE_APP_OPS_MODES:'앱별 기능 접근 정책 변경',GET_APP_OPS_STATS:'앱별 기능 접근 기록 조회',
    ACCESS_FINE_LOCATION:'정확한 위치 접근',ACCESS_COARSE_LOCATION:'대략적인 위치 접근',
    BLUETOOTH_CONNECT:'블루투스 기기 연결 정보 접근',BLUETOOTH_SCAN:'주변 블루투스 검색 정보 접근',
    ACCESS_WIFI_STATE:'Wi-Fi 상태 조회',NETWORK_STACK:'시스템 네트워크 서비스 접근',CONNECTIVITY_INTERNAL:'내부 네트워크 서비스 접근',
    READ_NETWORK_USAGE_HISTORY:'앱별 네트워크 사용 통계 조회',READ_PRIVILEGED_PHONE_STATE:'보호된 이동통신·단말 정보 조회',
    READ_PHONE_STATE:'이동통신 상태 조회',CAPTURE_VIDEO_OUTPUT:'시스템 화면 영상 접근',CAPTURE_AUDIO_OUTPUT:'시스템 오디오 접근',
    CAMERA:'카메라 접근',RECORD_AUDIO:'마이크 녹음 접근',READ_EXTERNAL_STORAGE:'공유 저장소 읽기',MANAGE_EXTERNAL_STORAGE:'공유 저장소의 광범위한 파일 접근'
  };
  const subject={files:'파일·폴더',settings:'설정',logs:'로그',network:'네트워크 정보',diagnostics:'기기 진단',debug:'웹 디버깅 대상',terminal:'기기 셸',mirror:'화면·소리 연결',apps:'앱 정보',history:'PC 작업 기록',workbench:'기기 정보',connection:'ADB 연결'};
  const asText=value=>String(value?.rawError??value?.message??value?.error??value??'').slice(0,24000);
  const hasKorean=value=>/[가-힣]/.test(value);
  const isTechnicalText=value=>/\b(?:[\w$]+\.)*[\w$]*(?:Error|Exception)\b|\b(?:ERR_[A-Z0-9_]+|INSTALL_FAILED_[A-Z0-9_]+)\b/.test(asText(value));
  function isFailureText(value){return /(?:Permission (?:Denial|denied)|SecurityException|Security exception|(?:requires?|missing|does not have)\s+(?:android\.)?permission|blocked by mode|avc:\s*denied|Operation not permitted|Read-only file system|adbd cannot|INSTALL_FAILED_|unknown (?:command|option)|can't find service|cannot find service|Failed to fetch|NetworkError|ECONN(?:REFUSED|RESET)|EACCES|EPERM|ENOENT|TypeError|ReferenceError|SyntaxError|Cannot read propert|Unexpected token|device.*(?:offline|not found)|(?:기기|대상).{0,20}(?:연결되어 있지|연결되지 않았|온라인 상태가 아닙)|unauthorized|timed? out|timeout|not supported|unsupported)/i.test(asText(value));}
  function explain(value,options={}){
    const context=typeof options==='string'?{context:options}:options||{},action=String(context.action||context.route||'');
    const fromAction=/^(?:file|folder)-|^diagnostic-files$/.test(action)?'files':/^settings-/.test(action)?'settings':/^logs-/.test(action)?'logs':/^(?:app|package|permission)/.test(action)?'apps':/^(?:connection|ports)-/.test(action)?'connection':/^diagnostic-|^display-|^input-displays$/.test(action)?'diagnostics':'workbench';
    const kind=!context.context||context.context==='workbench'?fromAction:context.context,rawError=asText(value),target=subject[kind]||subject.workbench;
    if(value&&typeof value==='object'&&value.reasonKo)return {code:value.code||'provided',titleKo:value.titleKo||target+' 조회 제한',reasonKo:value.reasonKo,requiredAccessKo:value.requiredAccessKo||'',alternativesKo:value.alternativesKo||'',rawError,recognized:true};
    const permissions=[...new Set([...rawError.matchAll(/\bandroid\.permission\.([A-Z][A-Z0-9_]+)\b/g)].map(m=>m[1]))];
    for(const name of Object.keys(permissionNames))if(new RegExp('\\b'+name+'\\b').test(rawError)&&!permissions.includes(name))permissions.push(name);
    const requested=permissions.map(name=>`${permissionNames[name]||'기기가 지정한 시스템 접근'} (${name})`).join(', ');
    let code='unknown',titleKo=target+' 요청을 완료하지 못했습니다',reasonKo='',requiredAccessKo='',alternativesKo='',recognized=true;
    if((kind==='history'||context.platform==='pc'||/^[A-Za-z]:[\\/]/.test(context.path||'')||/(?:^|[\s'"(])[A-Za-z]:[\\/]/.test(rawError))&&/EACCES|EPERM|Permission denied|ENOENT|no such file/i.test(rawError)){
      code='pc-record-access';reasonKo=kind==='history'?'이 PC에 저장된 작업 기록·결과 파일을 읽지 못했습니다.':'서버 PC의 파일·폴더 또는 프로그램 경로에 접근하지 못했습니다.';requiredAccessKo='서버 실행 계정의 PC 파일 접근, 파일·프로그램 존재 여부, 브라우저의 폴더 읽기 허용을 해당 작업에 맞게 확인해야 합니다. Android 권한·루팅과는 별개입니다.';alternativesKo='현재 PC에 보관된 목록이나 경로를 다시 확인할 수 있습니다. 기기 자료를 지우거나 새 진단 자료를 생성하지 않습니다.';
    }else if(/TypeError|ReferenceError|SyntaxError|Cannot read propert|Unexpected token|is not a function|JSON.*(?:parse|invalid)/i.test(rawError)){
      code='invalid-response';reasonKo='응답에 필요한 정보가 없거나 화면에서 응답을 처리하는 중 예외가 발생했습니다.';requiredAccessKo='이 오류는 Android 권한 부족을 뜻하지 않습니다. 서버 응답 형식이나 웹 프로그램의 처리를 확인해야 합니다.';alternativesKo='조회 요청은 다시 확인할 수 있습니다. 같은 오류가 계속되면 기술 원문을 기준으로 프로그램을 점검하며 폰 권한은 변경하지 않습니다.';
    }else if(/QuotaExceededError|localStorage.*(?:full|quota|denied)/i.test(rawError)){
      code='browser-storage';reasonKo='브라우저의 로컬 저장 공간에 접근하지 못했거나 저장 한도에 도달했습니다.';requiredAccessKo='현재 브라우저·웹 주소의 저장소 사용이 허용되어야 합니다. 폰 저장소나 Android 권한과는 별개입니다.';alternativesKo='기존 자료를 유지한 채 읽기를 다시 확인할 수 있습니다. 저장 자료를 자동 삭제하지 않습니다.';
    }else if(/NotAllowedError|document is not focused|user gesture|autoplay|secure context|clipboard.*(?:denied|not allowed)/i.test(rawError)){
      code='browser-access';reasonKo='브라우저가 재생·클립보드 등 현재 페이지의 요청을 허용하지 않았습니다.';requiredAccessKo='현재 브라우저의 기능 지원·페이지 포커스·사용자 동작 조건이 필요합니다. Android 권한이나 루팅을 바꾸는 문제와는 다릅니다.';alternativesKo='기능별 명시적 버튼을 다시 눌러 확인할 수 있습니다. 브라우저 권한을 자동 변경하지 않습니다.';
    }else if(kind==='connection'&&/SSLV3_ALERT_CERTIFICATE_UNKNOWN|TLSV1_ALERT_UNKNOWN_CA|certificate[_ ]unknown|unknown (?:certificate|ca)/i.test(rawError)){
      code='adb-certificate-untrusted';reasonKo='무선 ADB 상대가 연결 인증서를 신뢰하지 않아 인증을 완료하지 못했습니다.';requiredAccessKo='현재 PC와 기기 사이에 유효한 무선 디버깅 신뢰 관계가 필요합니다. 일반 앱 권한이나 루팅으로 해결하는 오류는 아닙니다.';alternativesKo='검색 목록과 실제 ADB 연결 상태는 조회할 수 있습니다. 인증서를 삭제하거나 페어링·승인을 자동으로 바꾸지 않습니다.';
    }else if(kind==='connection'&&/failed to connect|cannot connect to|unable to connect/i.test(rawError)){
      code='adb-connect-failed';reasonKo='검색된 주소에 무선 ADB 연결을 완료하지 못했습니다. 서비스 검색이나 열린 포트만으로 ADB 인증 성공을 확인할 수는 없습니다.';requiredAccessKo='이 문구만으로 페어링 미완료·인증 거부·주소 변경 중 어느 원인인지 확정할 수 없습니다. 정상적인 ADB 연결 승인이 필요하며 앱 권한·root와는 별개입니다.';alternativesKo='현재 검색 주소와 실제 연결 목록을 다시 조회할 수 있습니다. 연결·페어링·서버 재시작을 자동으로 반복하지 않습니다.';
    }else if(/device.*offline|device\s+['"].*?['"]\s+not found|no devices|device not found|오프라인|(?:기기|대상).{0,20}(?:연결되어 있지|연결되지 않았|온라인 상태가 아닙)/i.test(rawError)){
      code='offline';titleKo='ADB 연결을 확인해 주세요';reasonKo='기기가 오프라인이거나 현재 ADB 연결에서 대상을 찾지 못했습니다.';requiredAccessKo='추가 앱 권한보다 정상적인 ADB 연결이 먼저 필요합니다.';alternativesKo='연결 목록과 현재 주소를 조회할 수 있습니다. 오류 처리에서 자동 연결·재연결은 실행하지 않습니다.';
    }else if(/unauthorized|authorizing|debugging.*authoriz/i.test(rawError)){
      code='unauthorized';reasonKo='이 PC의 ADB 디버깅 접근이 기기에서 승인되지 않았습니다.';requiredAccessKo='기기에서 이 PC의 디버깅 연결이 승인된 상태여야 합니다. 루팅이 필요한 오류는 아닙니다.';
    }else if(/Failed to fetch|NetworkError|ECONN(?:REFUSED|RESET)|connection (?:refused|reset)|socket.*closed|WebSocket.*(?:closed|failed)/i.test(rawError)){
      code='connection-failed';reasonKo=['debug','mirror'].includes(kind)?'대상 서비스가 응답하지 않거나 연결이 닫혀 정보를 받지 못했습니다.':'웹 서버 또는 대상 서비스와 통신하지 못했습니다.';requiredAccessKo='통신 오류만으로 필요한 Android 권한을 확정할 수 없습니다.';alternativesKo=kind==='debug'?'현재 앱이 공개한 디버깅 소켓 목록을 다시 조회할 수 있습니다. 검사 도구를 자동으로 연결하거나 앱을 열지는 않습니다.':'서버 상태와 기기 연결 목록을 먼저 확인한 뒤 조회를 다시 시도할 수 있습니다.';
    }else if(/timed? out|timeout|시간.*초과|응답.*대기.*지났/i.test(rawError)){
      code='timeout';reasonKo='기기 또는 서비스가 제한 시간 안에 응답하지 않았습니다.';requiredAccessKo='응답 시간 초과만으로 권한 부족이나 루팅 필요 여부를 단정할 수 없습니다.';alternativesKo='현재 연결과 작업 상태를 먼저 확인할 수 있습니다. 변경 요청은 결과를 확인하기 전 같은 작업으로 반복하지 마세요.';
    }else if(/avc:\s*denied|SELinux.*(?:denied|denial)|Operation not permitted/i.test(rawError)){
      code='policy-denied';reasonKo='기기의 Linux 권한·시스템 보안 정책이 요청한 접근을 허용하지 않았습니다.';requiredAccessKo='해당 파일·서비스에 대한 정책상 허용이 필요합니다. 일반 앱 권한을 추가하거나 root 상태가 되는 것만으로 해결된다고 보장할 수 없습니다.';alternativesKo=kind==='files'?'읽기가 허용된 공유 저장소나 설치 APK 정보는 별도로 조회할 수 있지만 앱 내부 파일과 동일한 자료는 아닙니다.':'현재 ADB에 공개된 항목만 조회하며 제한된 값은 미확인으로 남깁니다.';
    }else if(/adbd cannot run as root|cannot run as root in production|userdebug|eng build|only.*debuggable.*build/i.test(rawError)){
      code='build-restricted';reasonKo='현재 출시용 펌웨어가 요청한 ADB 관리자·개발 기능을 제공하지 않습니다.';requiredAccessKo='해당 기능을 허용하는 개발용 펌웨어 또는 제조사 지원이 필요합니다. PC 프로그램을 관리자 권한으로 실행하는 것과는 다릅니다.';alternativesKo='일반 ADB 권한으로 허용되는 정보 조회를 사용할 수 있습니다. 펌웨어 변경이나 권한 상승은 자동으로 실행하지 않습니다.';
    }else if(/Read-only file system|remount failed|must be root.*remount/i.test(rawError)){
      code='read-only-filesystem';reasonKo='대상 파일 시스템이 쓰기 금지로 연결되어 있어 변경 요청을 수행하지 못했습니다.';requiredAccessKo='쓰기 마운트는 기기 펌웨어·관리자 권한·검증 정책의 지원이 필요합니다. 일반 파일 권한만 바꾸는 것으로 해결되지 않을 수 있습니다.';alternativesKo='같은 위치의 읽기가 허용되면 내용·속성 조회는 가능합니다. 읽기 제한까지 해제하는 대안은 아닙니다.';
    }else if(/INSTALL_FAILED_UPDATE_INCOMPATIBLE|signatures?.*(?:do not match|mismatch)|signature.*incompatible/i.test(rawError)){
      code='signature-mismatch';reasonKo='설치된 앱과 설치하려는 APK의 서명이 맞지 않습니다.';requiredAccessKo='같은 서명 또는 Android가 인정하는 서명 변경 계보의 APK가 필요합니다. 루팅이나 파일 읽기 권한 문제로 취급하지 않습니다.';alternativesKo='설치 전 APK 비교와 인증서 지문 조회로 확인할 수 있습니다. 기존 앱·데이터를 자동 삭제하지 않습니다.';
    }else if(/INSTALL_FAILED_VERSION_DOWNGRADE|version.*downgrade/i.test(rawError)){
      code='downgrade-restricted';reasonKo='기기가 더 낮은 앱 버전으로의 설치를 허용하지 않았습니다.';requiredAccessKo='앱의 디버깅 허용 여부와 기기 설치 정책이 해당 다운그레이드를 지원해야 합니다.';alternativesKo='설치 전 버전 비교는 조회만으로 가능합니다. 지원되지 않는 다운그레이드를 강제하지 않습니다.';
    }else if(/INSTALL_FAILED_INSUFFICIENT_STORAGE|No space left on device|ENOSPC/i.test(rawError)){
      code='space-unavailable';reasonKo='작업에 필요한 여유 저장 공간을 확보하지 못했습니다.';requiredAccessKo='추가 권한보다 대상 저장소의 여유 공간이 필요합니다.';alternativesKo='저장소 상태와 앱·파일 크기를 조회할 수 있습니다. 자동 삭제나 캐시 정리는 실행하지 않습니다.';
    }else if(/INTERACT_ACROSS_USERS|cross[- ]user|across users/i.test(rawError)){
      code='cross-user-denied';reasonKo='선택한 다른 사용자·업무 프로필의 정보에 접근할 수 없습니다.';requiredAccessKo=requested?`기기가 요구한 접근: ${requested}. 오류에 명시된 범위가 허용되어야 합니다.`:'기기가 허용하는 사용자 간 접근과 해당 프로필의 관리 정책 허용이 필요합니다.';alternativesKo='현재 사용자에서 허용된 정보는 별도로 조회할 수 있습니다. 사용자를 자동 전환하거나 프로필을 시작하지 않습니다.';
    }else if(/user.*(?:is locked|not unlocked)|credential.encrypted.*locked|CE storage.*locked/i.test(rawError)){
      code='user-locked';reasonKo='선택한 사용자·프로필의 암호화된 데이터가 잠겨 있습니다.';requiredAccessKo='해당 사용자·프로필이 잠금 해제된 상태여야 읽을 수 있는 정보입니다.';alternativesKo='잠금 상태에서도 공개된 앱 설치 정보는 따로 조회할 수 있습니다. 웹에서 잠금을 풀거나 앱을 실행하지 않습니다.';
    }else if(/run-as:\s*package not an application\b/i.test(rawError)){
      code='run-as-app-uid-restricted';reasonKo='run-as가 선택한 패키지를 내부 데이터에 접근할 수 있는 일반 앱 UID 대상으로 인정하지 않았습니다. 앱이 설치되어 있지 않다는 뜻은 아닙니다.';requiredAccessKo='이 방식은 run-as가 허용하는 앱 UID와 디버깅 가능한 앱 빌드가 필요합니다. 시스템 UID를 쓰는 앱 등은 제한되며 일반 앱 권한을 허용하는 것으로 바뀌는 조건이 아닙니다.';alternativesKo='같은 앱의 공개 패키지 정보·요청 권한은 조회할 수 있습니다. 앱을 다시 설치하거나 root 권한·폰 설정을 변경하지 않습니다.';
    }else if(/run-as:\s*unknown package\b/i.test(rawError)){
      code='target-missing';reasonKo='run-as가 선택한 패키지를 찾지 못했습니다. 현재 사용자에서 설치된 앱과 선택한 패키지를 확인해야 합니다.';requiredAccessKo='현재 사용자에 설치된 올바른 대상이 필요합니다. 이 오류만으로 디버깅 권한 부족이나 루팅 필요 여부를 단정하지 않습니다.';alternativesKo='설치된 앱 목록을 다시 읽어 대상을 선택할 수 있습니다. 앱 설치나 사용자 전환은 자동 실행하지 않습니다.';
    }else if(/not debuggable|not a debuggable|JDWP.*(?:not|denied)/i.test(rawError)){
      code='debug-build-required';reasonKo='대상 앱이 해당 디버깅·내부 데이터 조회 기능을 허용하지 않습니다.';requiredAccessKo='디버깅을 허용한 앱 빌드와 해당 기기의 접근 허용이 필요합니다. 모든 일반 앱에서 지원되는 기능은 아닙니다.';alternativesKo='공개 패키지 정보·요청 권한·읽기가 허용된 APK 정보는 조회할 수 있습니다. 앱 설정을 바꾸거나 다시 설치하지 않습니다.';
    }else if(/FLAG_SECURE|secure (?:surface|window)|DRM.*(?:protected|secure)|protected content/i.test(rawError)){
      code='protected-content';reasonKo='앱이나 콘텐츠가 보안 화면·보호 콘텐츠로 표시를 제한합니다.';requiredAccessKo='콘텐츠 또는 앱이 화면 캡처·전송을 허용해야 합니다. root나 브라우저 변경으로 해결된다고 안내하지 않습니다.';alternativesKo='보호되지 않은 화면의 전송 가능 여부는 별개입니다. 검은 화면만으로 보호 기능이 원인이라고 단정하지 않습니다.';
    }else if(/GET_USAGE_STATS|PACKAGE_USAGE_STATS/.test(rawError)||/app-storage/.test(action)&&/blocked by mode/.test(rawError)){
      code='usage-access-denied';reasonKo='조회 주체의 앱 사용 정보 접근이 제한되어 다른 앱의 통계를 읽지 못했습니다. 대상 앱의 일반 파일 권한과는 다릅니다.';requiredAccessKo='조회 주체의 GET_USAGE_STATS 허용 또는 기본 모드에서 PACKAGE_USAGE_STATS 권한 검사가 필요합니다. 명시적 차단은 권한 선언만으로 풀리지 않습니다.';alternativesKo='읽기가 허용된 설치 APK 크기는 별도 범위로 확인할 수 있지만 앱 데이터·캐시까지 포함한 전체 통계는 아닙니다.';
    }else if(/blocked by mode/i.test(rawError)){
      code='appops-denied';reasonKo='기기가 조회 주체의 기능별 접근(AppOps)을 차단했습니다.';requiredAccessKo=requested?`오류에 명시된 접근: ${requested}.`:'이 오류만으로 어떤 앱 권한을 바꿔야 하는지 확정할 수 없습니다. 해당 작업의 AppOps·서비스 정책이 허용되어야 합니다.';alternativesKo='현재 접근 상태는 읽기 전용으로 확인할 수 있습니다. 접근 모드를 자동 변경하지 않습니다.';
    }else if(/unknown command|unknown option|not supported|unsupported|flag.*not enabled|can't find service|cannot find service|service .*not found|not implemented|ENOSYS/i.test(rawError)){
      code='unsupported';reasonKo='이 Android·제조사 구현 또는 현재 환경이 해당 명령·서비스·기능을 제공하지 않습니다.';requiredAccessKo='지원되는 구현이 먼저 필요합니다. 권한 추가나 루팅으로 명령 지원이 생긴다고 단정할 수 없습니다.';alternativesKo=kind==='debug'?'앱이 WebView 디버깅을 허용한 빌드에서 공개한 대상만 찾을 수 있습니다. 앱의 디버깅 설정을 자동 변경하지 않습니다.':'해당 탭의 기본 정보·공개 목록 등 지원되는 조회만 사용할 수 있습니다. 실패한 값을 0이나 꺼짐으로 대신하지 않습니다.';
    }else if(/No such file|ENOENT|does not exist|unknown package|NameNotFoundException/i.test(rawError)){
      code='target-missing';reasonKo='조회할 파일·패키지·대상을 현재 위치 또는 선택한 사용자에서 찾지 못했습니다.';requiredAccessKo='없는 대상과 권한 때문에 숨겨진 대상은 다를 수 있어, 이 문구만으로 필요한 권한을 확정할 수 없습니다.';alternativesKo='목록과 선택한 사용자·경로를 다시 조회할 수 있습니다. 대상을 자동 생성·설치하지 않습니다.';
    }else if(kind==='files'&&/scoped storage|Android\/(?:data|obb)/i.test(rawError+' '+(context.path||''))&&/denied|restricted|permission|EACCES|EPERM|차단|제한/i.test(rawError)){
      code='app-storage-path-restricted';reasonKo='앱별 외부 저장소 경로에 대한 접근이 제한되었습니다. 경로 이름만으로 어떤 정책이 거부했는지 모두 확정할 수는 없습니다.';requiredAccessKo='Android 버전·접근 방식·ADB 정책이 해당 경로의 읽기를 허용해야 합니다. 일반 사진 권한이나 모든 파일 접근 권한만으로 다른 앱의 Android/data가 항상 열리는 것은 아닙니다.';alternativesKo='앱이 공개한 공유 저장소 파일은 따로 조회할 수 있습니다. 앱 내부 자료를 자동 내보내거나 접근 제한을 우회하지 않습니다.';
    }else if(/Cannot add more users of type[\s\S]*Maximum number of that type already exists|Cannot add user\. Maximum user limit is reached|USER_OPERATION_ERROR_MAX_USERS/i.test(rawError)){
      code='user-capacity';titleKo='사용자 정원 제한';reasonKo=/full\.SECONDARY/.test(rawError)?'일반 사용자 유형의 허용 정원에 도달해 새 사용자를 추가하지 못했습니다.':'기기가 허용하는 사용자 수 상한에 도달해 추가하지 못했습니다.';requiredAccessKo='이 오류는 사용자 정원 제한이며, 권한 부족을 뜻하지 않습니다.';alternativesKo='현재 사용자 목록과 유형별 정원을 다시 조회하세요. 일반 사용자와 관리·보안 프로필의 정원은 별개이며, 기존 사용자 삭제나 제한값 변경은 자동으로 하지 않습니다.';
    }else if(/Cannot add more profiles of type/i.test(rawError)){
      code='profile-capacity';titleKo='프로필 추가 제한';reasonKo='선택한 부모와 프로필 유형에 대해 추가 가능한 프로필 정원·지원 조건을 충족하지 못했습니다.';requiredAccessKo='프로필 유형·부모별 정원과 기기 정책을 확인해야 합니다. 이 문구만으로 root 필요 여부를 판단하지 않습니다.';alternativesKo='관리 프로필 지원 상태에서 부모·유형별 제한을 다시 조회하세요. 일반 사용자 상한만으로 프로필 추가 여부를 판단하지 않습니다.';
    }else if(permissions.length||/Permission (?:Denial|denied)|SecurityException|Security exception|permission denied|not allowed|EACCES|EPERM|권한.*거부/i.test(rawError)){
      code='permission-denied';reasonKo=kind==='files'?'현재 ADB 실행 주체에 선택한 경로의 요청을 허용하지 않았습니다.':`${target}에 대한 요청이 Android의 접근 검사에서 거부되었습니다.`;
      requiredAccessKo=requested?`기기가 요구한 접근: ${requested}. 해당 권한은 기기 정책·앱 서명·사용자 범위에 따라 제한되며 일반 앱 권한 창에서 모두 부여할 수 있는 것은 아닙니다.`:kind==='files'?'해당 경로의 소유권·파일 접근 권한과 SELinux·공유 저장소 정책이 요청을 허용해야 합니다. 오류만으로 root가 꼭 필요하다고 단정하지 않습니다.':'기기가 해당 서비스·정보에 대한 ADB 접근을 허용해야 합니다. 오류에 권한 이름이 없어 구체적인 권한은 확정하지 못했습니다.';
      if(kind==='logs')alternativesKo='main·system·crash처럼 기기가 공개한 버퍼를 별도로 조회할 수 있습니다. 커널·보안 로그의 내용과 같지는 않으며 READ_LOGS만으로 모든 버퍼 접근이 보장되지 않습니다.';
      else if(kind==='files')alternativesKo='읽기가 허용된 공유 저장소와 공개 파일 목록은 따로 확인할 수 있습니다. 앱 내부 데이터 접근을 우회하거나 파일 권한을 바꾸지 않습니다.';
      else if(kind==='network')alternativesKo='공개 IP·인터페이스·경로 등 확인된 값은 유지합니다. 숨겨진 SSID·기기 이름·연결 목록을 연결 없음이나 꺼짐으로 바꾸지 않습니다.';
      else if(kind==='settings')alternativesKo='읽기가 허용된 현재 설정값과 설명은 조회할 수 있습니다. 보호된 값의 수정 권한을 자동 부여하지 않습니다.';
      else alternativesKo='현재 권한으로 공개된 항목만 조회하고 제한된 값은 미확인으로 남깁니다. 서비스 호출 권한을 자동 변경하지 않습니다.';
    }else{
      recognized=false;reasonKo=hasKorean(rawError)&&!isTechnicalText(rawError)?rawError:'요청을 완료하지 못했습니다. 원문만으로 실패 원인과 필요한 권한을 확정하지 못했습니다.';
      if(rawError&&(!hasKorean(rawError)||isTechnicalText(rawError)))requiredAccessKo='권한 부족·기기 미지원·연결 문제 중 무엇인지 확인되지 않았습니다. 관리자 권한이 필요하다고 임의로 표시하지 않습니다.';
    }
    return{code,titleKo,reasonKo,requiredAccessKo,alternativesKo,rawError,recognized,permissions,technicalError:isTechnicalText(rawError)};
  }
  window.DeskErrors={explain,isFailureText,hasKorean,isTechnicalText};
})();
