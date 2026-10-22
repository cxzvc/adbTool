import { EXTRA_ACTIONS } from './workbench-extensions.mjs';
import { withWorkbenchAccess } from './workbench-access.mjs';
const text=(name,label,value='',extra={})=>({name,label,type:'text',value,...extra});
const select=(name,label,options,value)=>({name,label,type:'select',options:options.map(v=>Array.isArray(v)?{value:v[0],label:v[1]}:{value:v,label:v}),value:value??(Array.isArray(options[0])?options[0][0]:options[0])});
const number=(name,label,value,min,max)=>({name,label,type:'number',value,min,max});
const check=(name,label)=>({name,label,type:'checkbox',value:false});
const pkg=text('package','대상 패키지명','',{required:true,placeholder:'com.example.app'}),user=text('user','사용자 ID','current',{hint:'current 또는 숫자 ID'});
const upload=(label,accept)=>({name:'uploadId',label,type:'file',accept,required:true,hint:'파일 최대 2GB'});
const ns=select('namespace','설정 영역',[['system','System · 사용자'],['secure','Secure · 보안'],['global','Global · 공통']]);
const key=text('key','ADB 설정 키','',{required:true});
const buffer=select('buffer','로그 버퍼',['all','main','system','crash','events','radio','kernel','security']);
const port=(name,label,value)=>number(name,label,value,1,65535);
const a=(id,group,title,description,fields=[],write=false,support='일반 ADB')=>({id,group,title,description,fields,write,support});
export const WORKBENCH_GROUPS={files:'파일·폴더',apps:'앱·권한',display:'화면·재부팅',users:'사용자·프로필',connection:'연결·포트',logs:'로그 수집',diagnostics:'진단·디버깅',settings:'설정 직접 편집',advanced:'고급·백업'};
export const WORKBENCH_ACTIONS=[
 ...EXTRA_ACTIONS,
 a('file-text','files','파일 내용 보기','1MB 이하 UTF-8 텍스트를 웹에서 확인합니다.',[text('path','파일 경로','/sdcard/Download/')]),
 a('file-rename','files','이름 변경','파일 또는 폴더의 이름을 바꿉니다. 기존 대상은 덮어쓰지 않습니다.',[text('path','원본 경로'),text('name','새 이름')],true),
 a('file-move','files','기기 안에서 이동','원본을 지정한 전체 경로로 이동합니다.',[text('path','원본 경로'),text('target','이동 후 전체 경로')],true),
 a('file-copy','files','기기 안에서 복사','파일·폴더와 하위 파일을 새 경로로 복사합니다.',[text('path','원본 경로'),text('target','복사본 전체 경로')],true),
 a('file-delete','files','파일·폴더 삭제','선택한 경로와 그 안의 파일을 영구 삭제합니다.',[text('path','삭제할 정확한 경로')],true),
 a('file-chmod','files','파일 접근 권한','소유자·그룹·다른 사용자의 읽기/쓰기/실행 권한을 지정합니다.',[text('path','파일·폴더 경로'),text('mode','8진수 권한','644')],true,'파일 소유권·기기 권한 필요'),
 a('folder-download','files','폴더 전체 ZIP 다운로드','하위 폴더·파일을 PC로 가져와 ZIP으로 저장합니다. 합계 2GB/20,000파일 한도.',[text('path','기기 폴더','/sdcard/Download')]),
 a('package-details','apps','앱 상세·권한·컴포넌트','버전, 설치 경로, 서명 정보, 활동·서비스·수신기 및 권한을 조회합니다.',[pkg]),
 a('package-certificates','apps','APK 서명 인증서·SHA-256','설치된 기본 APK를 PC로 읽어와 서명 검증 결과와 인증서 지문을 확인합니다.',[pkg,user],false,'PC Android SDK Build Tools·Java 필요'),
 a('package-clear','apps','앱 데이터 초기화','로그인·설정·DB 등 앱 데이터를 삭제합니다. 앱 자체는 남습니다.',[pkg,user],true),
 a('package-cache','apps','앱 캐시만 비우기','지정한 앱의 캐시만 비웁니다. 일반 데이터 초기화와 구분합니다.',[pkg,user],true,'pm clear --cache-only 지원 필요'),
 a('package-keep','apps','데이터를 남기고 앱 삭제','앱 실행 파일을 제거하고 데이터·캐시는 유지하도록 요청합니다.',[pkg,user],true),
 a('permission-list','apps','앱 권한 조회','해당 사용자에 대한 런타임 권한과 manifest 요청 권한을 조회합니다.',[pkg,user]),
 a('permission-grant','apps','런타임 권한 허용','앱이 요청한 런타임 권한을 허용합니다. 정책 고정·서명 권한은 변경하지 못할 수 있습니다.',[pkg,user,text('permission','권한 이름','android.permission.CAMERA')],true),
 a('permission-revoke','apps','런타임 권한 회수','지정한 런타임 권한을 회수합니다.',[pkg,user,text('permission','권한 이름','android.permission.CAMERA')],true),
 a('appops-read','apps','AppOps 조회','앱의 기능별 접근 모드와 최근 사용 정보를 조회합니다.',[pkg,user]),
 a('appops-set','apps','AppOps 접근 모드','조회한 작업 이름에 대해 허용·무시·거부·기본 모드를 지정합니다.',[pkg,user,text('op','작업 이름','CAMERA'),select('mode','접근 모드',[['allow','허용'],['ignore','무시'],['deny','거부'],['default','기본값'],['foreground','앱 사용 중에만 (지원 작업)']])],true),
 a('appops-reset','apps','이 앱의 AppOps 초기화','지정한 앱의 AppOps를 기본값으로 돌립니다. 다른 앱은 대상에 포함하지 않습니다.',[pkg,user],true),
 a('display-read','display','현재 해상도·DPI','물리 화면 값과 사용자가 덮어쓴 값을 조회합니다.'),
 a('display-size','display','기기 화면 해상도 변경','실제 Android 표시 해상도를 변경합니다. 화면 전송 화질 설정과 다릅니다.',[number('width','가로 픽셀',1080,200,8192),number('height','세로 픽셀',2340,200,8192)],true),
 a('display-density','display','기기 화면 DPI 변경','글자·버튼 등 화면 요소의 표시 밀도를 변경합니다.',[number('density','DPI',420,72,1600)],true),
 a('display-reset','display','해상도·DPI 초기화','선택한 화면 덮어쓰기만 제조사 기본값으로 복원합니다.',[select('target','초기화 항목',[['both','해상도와 DPI'],['size','해상도만'],['density','DPI만']])],true),
 a('reboot','display','재부팅·복구 모드','기기를 재부팅합니다. 진행 중인 연결은 끊어지며 기종에 따라 지원하는 모드가 다릅니다.',[select('mode','부팅 대상',[['system','일반 재부팅'],['recovery','복구 모드'],['bootloader','부트로더'],['sideload','OTA sideload 모드'],['sideload-auto-reboot','OTA sideload · 전송 후 자동 재부팅']])],true),
 a('users-list','users','사용자·프로필 목록','사용자 ID와 현재 사용자를 확인합니다.'),
 a('user-create','users','새 사용자 만들기','기기가 허용하는 범위에서 별도 사용자를 만듭니다.',[text('name','사용자 이름','새 사용자')],true,'다중 사용자 지원 기기'),
 a('profile-create','users','관리 프로필 추가·설정','지원 조건을 확인한 뒤 새 관리 프로필 생성·설치된 관리 앱 지정·초기 설정과 완료 상태 확인을 단계별로 진행합니다.',[number('parent','부모 사용자 ID',0,0,9999),text('name','프로필 이름','새 프로필')],true,'프로필 생성 지원·호환 관리 앱·정책 허용 필요'),
 ...['switch','start','stop','remove'].map(mode=>a('user-'+mode,'users',({switch:'사용자 전환',start:'사용자 시작',stop:'사용자 중지',remove:'사용자·프로필 삭제'})[mode],mode==='remove'?'해당 사용자와 데이터를 삭제합니다. 기본 사용자·현재 사용자는 보호합니다.':'선택한 사용자 ID에 작업합니다. 기기 정책에 따라 거부될 수 있습니다.',[number('userId','대상 사용자 ID','',0,9999)],true)),
 a('connection-connect','connection','주소로 직접 연결','IP와 연결 포트를 직접 입력해 ADB 연결을 요청합니다.',[text('host','IP 또는 호스트',''),port('port','연결 포트',5555)],true),
 a('connection-recover','connection','오프라인 연결 복구','오프라인·인증 대기 연결의 재연결을 ADB 서버에 요청합니다. 다른 기기도 영향을 받을 수 있습니다.',[],true),
 {...a('connection-server','connection','ADB 서버 시작·중지·재시작','이 PC의 ADB 서버에 작업을 요청합니다. 중지 후에도 자동 조회나 다른 ADB 요청이 서버를 다시 시작할 수 있습니다.',[select('operation','서버 작업',[['restart','재시작 · 중지 후 시작'],['start','시작 요청'],['stop','중지 요청']],'restart')],true),scope:'host'},
 a('connection-mode','connection','USB·TCP 모드 전환','adbd 수신 모드를 변경합니다. 무선 디버깅 페어링과 별개이며 연결이 끊길 수 있습니다.',[select('mode','모드',[['usb','USB'],['tcpip','TCP/IP']]),port('port','TCP 포트',5555)],true),
 a('ports-list','connection','포트 터널 목록','ADB 정방향·역방향 포트 매핑을 조회합니다.'),
 a('ports-add','connection','포트 터널 추가','PC→기기 또는 기기→PC의 TCP 포트를 연결합니다. 기존 매핑을 자동 교체하지 않습니다.',[select('direction','방향',[['forward','PC → 기기'],['reverse','기기 → PC']]),port('local','PC 포트',8080),port('remote','기기 포트',8080)],true),
 a('ports-remove','connection','포트 터널 삭제','선택한 방향과 포트의 매핑 한 개만 제거합니다.',[select('direction','방향',['forward','reverse']),port('port','제거할 수신 포트',8080)],true),
 a('logs-buffers','logs','로그 버퍼 상태','버퍼의 현재 크기·최대 크기를 조회합니다.',[buffer]),
 a('logs-clear','logs','기기 로그 버퍼 비우기','기기의 선택한 로그 버퍼를 지웁니다. 웹 화면만 비우는 것과 다릅니다.',[buffer],true),
 a('logs-resize','logs','기기 로그 버퍼 크기','선택한 버퍼의 용량을 변경하고 다시 조회합니다.',[buffer,select('size','버퍼 크기',['256K','1M','4M','8M','16M'])],true,'logd 권한·용량 제한 적용'),
 a('logs-capture','logs','연속 로그 파일 수집','adb logcat을 계속 실행해 PC 파일에 저장합니다. 앱을 지정하면 UID로 여러 PID와 재시작을 추적합니다.',[buffer,select('level','최소 레벨',['V','D','I','W','E','F'],'I'),text('package','앱 패키지 (비우면 전체)'),user,number('minutes','최대 수집 시간(분)',60,1,1440),number('maxMB','최대 파일 크기(MB)',256,8,2048)],false),
 a('logs-capture-stop','logs','로그 수집 중지·저장','진행 중인 연속 수집 작업을 종료하고 파일을 다운로드할 수 있게 합니다.',[text('jobId','수집 작업 ID','',{required:true})]),
 a('diagnostic-services','diagnostics','시스템 서비스 목록','dumpsys로 조회 가능한 서비스 이름을 확인합니다.'),
 a('diagnostic-service','diagnostics','서비스 상세 진단','배터리·전원·창·메모리 등 지정한 시스템 서비스의 진단 정보를 저장합니다.',[text('service','서비스 이름','meminfo')]),
 a('diagnostic-properties','diagnostics','시스템 속성 전체 조회','getprop으로 빌드·하드웨어·시스템 속성을 조회합니다.'),
 a('diagnostic-crashes','diagnostics','ANR·충돌 자료','DropBox의 ANR/Java 충돌/네이티브 충돌 기록을 조회합니다.',[select('tag','자료 종류',['data_app_anr','system_app_anr','system_server_anr','data_app_crash','system_app_crash','SYSTEM_TOMBSTONE'])]),
 a('diagnostic-files','diagnostics','ANR·tombstone 파일 목록','접근 가능한 ANR 또는 네이티브 충돌 파일을 탐색합니다. 권한이 없으면 원인을 표시합니다.',[select('path','경로',['/data/anr','/data/tombstones'])],false,'일부 기기 root 필요'),
 a('trace','diagnostics','Perfetto 성능 추적','선택한 시간 동안 스케줄링·주파수·메모리·그래픽 이벤트를 수집해 추적 파일로 저장합니다.',[select('seconds','수집 시간(초)',['5','10','30','60'],'10'),select('bufferMB','버퍼(MB)',['8','16','32','64'],'32')],true,'Perfetto 지원·추적 권한 필요'),
 a('heap','diagnostics','프로세스 힙 덤프','선택한 디버깅 가능 프로세스의 Java 힙을 HPROF로 저장합니다. 앱이 일시 정지할 수 있습니다.',[number('pid','PID',0,2,99999999),user],true,'debuggable 앱 또는 허용된 권한'),
 a('jdwp-list','diagnostics','JDWP 디버깅 대상','JDWP 디버거 연결을 허용하는 프로세스 PID를 조회합니다.'),
 a('jdwp-forward','diagnostics','JDWP 디버거 포트 연결','대상 PID를 PC 포트에 연결해 IDE/디버거에서 연결할 수 있게 합니다.',[number('pid','디버깅 대상 PID',0,2,99999999),port('port','PC 포트',8700)],true,'JDWP 목록에 표시된 PID'),
 a('settings-read','settings','설정 키 직접 조회','System/Secure/Global 영역에서 지정한 키의 실제 값을 읽습니다.',[ns,key]),
 a('settings-put','settings','설정 키 직접 수정','설정 목록에 없는 키도 직접 지정할 수 있습니다. 키 존재·기기 지원과 실제 효과는 별개입니다.',[ns,key,text('value','새 값','',{type:'textarea'})],true),
 a('settings-delete','settings','설정 키 제거·기본값','저장된 키를 삭제하여 미지정 상태로 돌립니다.',[ns,key],true),
 a('settings-history','settings','직접 편집 변경 기록','PC에 저장한 직접 편집 기록과 되돌리기 ID를 조회합니다.'),
 a('settings-undo','settings','직접 편집 되돌리기','현재 값이 변경 직후 값과 일치하는 기록만 되돌립니다.',[text('historyId','변경 기록 ID')],true),
 a('settings-compare','settings','설정 JSON 비교','내보낸 설정 JSON과 현재 값을 비교합니다. 폰에는 적용하지 않습니다.',[{name:'entries',label:'설정 JSON 파일',type:'jsonfile',required:true}]),
 a('settings-import','settings','설정 JSON 가져오기','숨김·미조회 항목이 있는 파일은 거부하며 최대 5,000개 키를 순서대로 적용합니다. 부분 실패 시 이미 적용한 내역은 유지합니다.',[{name:'entries',label:'설정 JSON 파일',type:'jsonfile',required:true}],true),
 a('advanced-capabilities','advanced','기기 권한·도구 확인','현재 shell 권한, 빌드 유형, Perfetto/tar/run-as 도구 유무와 ADB 버전을 확인합니다.'),
 a('appdata-check','advanced','앱 데이터 백업 지원 확인','run-as로 접근 가능한 디버깅 앱인지 또는 이미 root인 adbd인지 확인합니다.',[pkg,user,select('method','방식',[['run-as','디버깅 앱 · run-as'],['root','이미 root인 adbd']])]),
 a('appdata-backup','advanced','앱 내부 데이터 TAR 백업','지원되는 앱의 CE 데이터 디렉터리를 보관합니다. Keystore·외부 저장소·DE 데이터는 포함하지 않습니다.',[pkg,user,select('method','방식',[['run-as','디버깅 앱 · run-as'],['root','이미 root인 adbd']])],false,'debuggable 앱 또는 이미 root인 adbd'),
 a('appdata-restore','advanced','앱 내부 데이터 TAR 복원','백업한 파일을 대상 앱 내부에 덮어씁니다. 앱/버전 일치와 앱 종료 여부를 사용자가 확인해야 합니다.',[pkg,user,select('method','방식',[['run-as','디버깅 앱 · run-as'],['root','이미 root인 adbd']]),upload('앱 데이터 TAR 선택','.tar')],true,'debuggable 앱 또는 이미 root인 adbd'),
 ...['root','unroot','remount','disable-verity','enable-verity'].map(id=>a('advanced-'+id,'advanced',({root:'adbd root 요청',unroot:'adbd 일반 권한 복귀',remount:'시스템 파티션 쓰기 마운트','disable-verity':'dm-verity 검사 비활성','enable-verity':'dm-verity 검사 활성'})[id],id==='root'?'기기가 원래 허용하는 adbd root 모드를 요청합니다. 루팅 도구가 아니며 일반 출시 펌웨어는 거부할 수 있습니다.':id==='remount'?'쓰기 마운트를 요청합니다. 필요 시 자동 재부팅은 아래에서 명시적으로 선택하며 root·파티션 지원이 필요합니다.':'연결 또는 시스템 검증 상태에 영향을 주는 고급 작업입니다.',id==='remount'?[check('rebootIfNeeded','필요하면 자동 재부팅 허용 (-R)')]:[],true,'지원되는 userdebug/eng·root 환경')),
 a('sideload','advanced','OTA ZIP 사이드로드','복구 모드의 sideload 상태에 연결된 기기에 OTA ZIP을 전송합니다. 재부팅은 별도 버튼으로 실행합니다.',[upload('기종에 맞는 OTA ZIP','.zip')],true,'복구 모드 sideload 상태'),
 a('shell-batch','advanced','셸 작업 일괄 실행','각 줄의 Android 셸 명령을 순서대로 실행하고 결과를 기록합니다. PC 셸 명령이 아닙니다.',[text('commands','한 줄에 한 명령','',{type:'textarea',required:true}),check('continueOnError','오류가 나도 다음 명령 계속')],true),
].map(withWorkbenchAccess);
