// Static display metadata only. This module never probes a device or grants access.
// IDs were reviewed against workbench.mjs and each workbench-extensions handler.
// Requiring explicit membership prevents a new privileged action silently becoming "ADB".
export const WORKBENCH_ACCESS_KINDS = Object.freeze(['adb','root-required','root-optional','debug-build','privileged','recovery']);
const item = (kind, label, description, extra = {}) => Object.freeze({kind,label,description,...extra});
const adb = description => item('adb','일반 ADB',description);
const ordinary = adb('ADB 연결 승인 후 사용합니다. 실제 지원은 기기 버전과 대상의 접근 권한·정책에 따라 다릅니다.');
const adbIds = `
file-inspect file-checksum file-text-save
app-permissions app-components app-component-open app-component-state app-diagnostics
app-standby-read app-standby-set app-inactive-read app-inactive-set app-links-read app-links-verify app-suspend
connection-inspect connection-host-info connection-mdns connection-reconnect-target connection-wait
connection-usb-detach connection-usb-attach connection-keygen connection-emulator-info ports-socket-remove ports-clear-owned
input-key input-shortcut input-tap input-longpress input-swipe input-text input-displays
screen-native-capture screen-native-record screen-ui-tree
diagnostic-battery-usage diagnostic-thermal diagnostic-power-detail diagnostic-connectivity diagnostic-network-usage
diagnostic-wifi diagnostic-bluetooth diagnostic-storage-detail diagnostic-input diagnostic-window diagnostic-display-detail
diagnostic-audio diagnostic-sensors diagnostic-process-memory diagnostic-command-services diagnostic-command-help diagnostic-tool-help
users-detail user-state shizuku-status shizuku-open shizuku-start shizuku-stop shizuku-restart
network-ping network-tcp-check network-dns-query network-http-check browser-url-open
device-ime-manage notification-snooze notification-unsnooze notification-dnd device-shutdown device-job-manage
file-text file-rename file-move file-copy file-delete folder-download
package-details package-certificates package-clear package-cache package-keep permission-list permission-grant permission-revoke
appops-read appops-set appops-reset display-read display-size display-density display-reset reboot
users-list user-create profile-create user-switch user-start user-stop user-remove
connection-connect connection-recover connection-server connection-mode ports-list ports-add ports-remove logs-capture-stop
diagnostic-services diagnostic-service diagnostic-properties diagnostic-crashes trace jdwp-list jdwp-forward
settings-read settings-put settings-delete settings-history settings-undo settings-compare settings-import
advanced-capabilities advanced-unroot shell-batch
`.trim().split(/\s+/);
const runAs = item('privileged','디버깅 앱 필요','선택한 사용자에게 설치된 debuggable 앱에서 run-as 접근이 허용되어야 합니다. 일반 출시 앱의 내부 데이터에는 이 방식으로 접근할 수 없습니다.');
const rootData = item('root-required','루트 adbd 필요','현재 ADB shell의 UID가 0인 adbd만 지원합니다. su 앱 설치만으로 충족되지 않으며 자동 root 요청은 하지 않습니다. SELinux·앱 데이터 접근 정책도 적용됩니다.');
const appData = item('root-optional','디버깅 앱 또는 루트','run-as는 디버깅 허용 앱, root 방식은 이미 UID 0으로 실행 중인 adbd가 필요합니다. 선택한 방식의 권한을 먼저 확인합니다.',{
  field:'method',variants:Object.freeze({'run-as':runAs,root:rootData}),
});
const logAccess = item('privileged','버퍼별 권한','일반 로그 버퍼는 ADB 권한으로 요청합니다. kernel·security 같은 보호 버퍼는 기기 빌드·logd 정책과 추가 권한에 따라 제한되며, root여도 접근이 보장되지는 않습니다.');
// Confirmed in the corresponding Android service dump entry points. This is an
// execution requirement, not a claim that the currently connected shell lacks it.
const dumpRead = Object.freeze({permissionLabel:'DUMP 진단 권한',permissionDescription:'시스템 진단 정보를 읽는 android.permission.DUMP 권한을 검사합니다. 일반 ADB shell에 이미 허용되는 권한일 수 있으며 루트 필수라는 뜻은 아닙니다. 실제 공개 범위는 기기 정책에 따릅니다.',requiredPermissions:Object.freeze(['android.permission.DUMP'])});
const dumpUsageRead = Object.freeze({...dumpRead,permissionDescription:dumpRead.permissionDescription+' 사용 통계 검사도 있는 서비스지만 ADB shell UID 2000은 해당 추가 검사의 예외입니다. 앱에 사용 정보 접근 권한을 켜라는 안내로 바꾸지 않습니다.'});
const verifiedDumpActions = Object.freeze({
  'diagnostic-thermal':dumpRead,'diagnostic-power-detail':dumpRead,'diagnostic-storage-detail':dumpRead,
  'diagnostic-input':dumpRead,'diagnostic-window':dumpRead,'diagnostic-display-detail':dumpRead,
  'diagnostic-battery-usage':dumpUsageRead,'diagnostic-process-memory':dumpUsageRead,'diagnostic-crashes':dumpUsageRead,
});
const verifiedDumpServices = Object.freeze({battery:dumpRead,power:dumpRead,thermalservice:dumpRead,mount:dumpRead,input:dumpRead,window:dumpRead,display:dumpRead,batterystats:dumpUsageRead,meminfo:dumpUsageRead,dropbox:dumpUsageRead});

export const WORKBENCH_ACCESS = Object.freeze({
  ...Object.fromEntries(adbIds.map(id=>[id,ordinary])),
  // These handlers call the ADB service directly; they do not invoke su or root first.
  'advanced-root':item('debug-build','디버그 빌드 필요','adbd 자체의 root 전환을 허용하는 userdebug·eng 또는 지원 커스텀 빌드에서 사용합니다. 루팅 도구가 아니며 일반 출시 펌웨어나 su 설치만으로는 지원되지 않을 수 있습니다.'),
  'advanced-unroot':adb('이미 root로 실행 중인 adbd를 일반 ADB 권한으로 돌립니다. 일반 adbd에서는 변경할 것이 없다는 응답이 가능하며, 루팅을 설치하거나 제거하는 기능은 아닙니다.'),
  'advanced-remount':item('root-required','루트 adbd 필요','root 권한의 adbd와 해당 시스템 파티션의 쓰기 마운트 지원이 필요합니다. 잠금·검증 상태·SELinux 정책에 따라 root여도 거부될 수 있습니다.'),
  'advanced-disable-verity':item('root-required','루트 adbd 필요','root 권한의 adbd와 해당 디버그 빌드의 dm-verity·AVB 변경 지원이 필요합니다. 부트로더 잠금·기기 검증 방식에 따라 거부될 수 있습니다.'),
  'advanced-enable-verity':item('root-required','루트 adbd 필요','root 권한의 adbd와 해당 디버그 빌드의 dm-verity·AVB 변경 지원이 필요합니다. root만으로 모든 기기의 검증 상태를 변경할 수 있는 것은 아닙니다.'),
  'appdata-check':appData,'appdata-backup':appData,'appdata-restore':appData,
  'diagnostic-files':item('root-optional','보호 경로 권한','/data/anr·/data/tombstones의 목록 읽기 권한이 필요합니다. 일반 ADB에 공개되는 기기도 있지만 보호된 경로는 root가 필요할 수 있고 SELinux 제한도 적용됩니다.'),
  'heap':item('privileged','디버깅 대상 필요','대상 프로세스가 debuggable 앱이거나, 디버그 빌드·제조사 정책에서 힙 덤프를 허용해야 합니다. 일반 앱의 메모리를 무조건 읽을 수 있는 기능은 아닙니다.'),
  'file-chmod':item('privileged','파일 소유권 필요','현재 shell이 소유한 파일이거나 접근 권한 변경이 허용된 대상이어야 합니다. 다른 소유자의 파일은 root가 필요할 수 있으며 공유 저장소·읽기 전용 마운트·SELinux는 별도 제한입니다.'),
  'logs-buffers':logAccess,'logs-clear':logAccess,'logs-capture':logAccess,
  'logs-resize':item('privileged','로그 변경 권한','선택한 버퍼의 logd 변경 권한과 허용 크기 범위가 적용됩니다. 일반 ADB로 허용하는 기기도 있으며 보호 버퍼·제조사 정책은 추가로 제한될 수 있습니다.'),
  'ports-socket-add':item('privileged','대상 접근 권한','TCP 터널은 일반 ADB로 사용합니다. 시스템 UNIX 소켓·/dev 장치 파일은 해당 경로와 SELinux 접근 권한, JDWP는 공개된 디버깅 PID, VSock은 기기 지원이 필요합니다.'),
  'sideload':item('recovery','복구 모드 필요','기기가 복구 프로그램의 ADB sideload 상태여야 합니다. 기종·서명·버전에 맞는 OTA ZIP을 복구 프로그램이 허용해야 하며 root 권한은 필수 조건이 아닙니다.'),
  // Make the common exceptions clear without painting ordinary ADB as root-only.
  'permission-grant':adb('앱이 요청한 런타임 권한을 일반 ADB로 허용합니다. 서명 전용·정책 고정 권한은 이 방식으로 부여할 수 없습니다.'),
  'permission-revoke':adb('런타임 권한을 일반 ADB로 회수합니다. 관리 정책이나 시스템 고정 상태에 따라 거부될 수 있습니다.'),
  'trace':adb('일반 ADB에서 제공되는 Perfetto 추적을 요청합니다. 실제 데이터 소스와 출력 경로는 기기·추적 서비스의 공개 범위에 따릅니다.'),
  'jdwp-forward':adb('현재 JDWP 목록에 공개된 PID만 일반 ADB로 연결합니다. 앱의 디버깅 허용 상태가 필요하며 root가 필수인 기능은 아닙니다.'),
  'shell-batch':adb('현재 ADB shell 권한으로 입력한 명령을 실행합니다. 필요한 권한은 명령마다 다르며 이 기능이 권한을 자동으로 높이지는 않습니다.'),
  ...Object.fromEntries(['shizuku-start','shizuku-stop','shizuku-restart'].map(id=>[id,adb('기본 사용자 0의 ADB shell UID 2000에서만 지원합니다. root로 실행한 Shizuku 서버는 이 버튼의 대상이 아닙니다.')])),
  ...Object.fromEntries(['connection-host-info','connection-mdns','connection-keygen','connection-server'].map(id=>[id,adb('이 PC의 ADB 작업입니다. 폰의 root 권한은 필요하지 않습니다.')])),
  'logs-capture-stop':adb('이 PC에서 진행 중인 로그 수집을 중지하고 저장합니다. 추가 기기 권한은 필요하지 않습니다.'),
  ...Object.fromEntries(Object.entries(verifiedDumpActions).map(([id,requirement])=>[id,item('adb',ordinary.label,ordinary.description,requirement)])),
  'diagnostic-service':item('adb',ordinary.label,ordinary.description,{field:'service',variants:verifiedDumpServices}),
});

export function withWorkbenchAccess(action) {
  const access=WORKBENCH_ACCESS[action.id];
  if(!access)throw new Error(`작업 권한 분류가 없습니다: ${action.id}`);
  return {...action,access};
}
