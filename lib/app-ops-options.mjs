// Android AppOpsManager operation names. Entries are version gated, never guessed
// from permission suffixes. An actual read is required again before a write.
export const KNOWN_APP_OPS = [
  ['COARSE_LOCATION','대략적인 위치',19],['FINE_LOCATION','정밀한 위치',19],['GPS','GPS 사용',19],
  ['VIBRATE','진동',19],['READ_CONTACTS','연락처 읽기',19],['WRITE_CONTACTS','연락처 수정',19],
  ['READ_CALL_LOG','통화 기록 읽기',19],['WRITE_CALL_LOG','통화 기록 수정',19],['READ_CALENDAR','일정 읽기',19],['WRITE_CALENDAR','일정 수정',19],
  ['WIFI_SCAN','Wi-Fi 검색',19],['POST_NOTIFICATION','알림 표시',19],['CAMERA','카메라',19],['RECORD_AUDIO','마이크 녹음',19],
  ['READ_CLIPBOARD','클립보드 읽기',19],['WRITE_CLIPBOARD','클립보드 쓰기',19],['SYSTEM_ALERT_WINDOW','다른 앱 위에 표시',19],['WRITE_SETTINGS','시스템 설정 변경',19],
  ['GET_USAGE_STATS','앱 사용 기록',21],['READ_PHONE_STATE','전화 상태 읽기',23],['REQUEST_INSTALL_PACKAGES','앱 설치 요청',26],
  ['RUN_IN_BACKGROUND','백그라운드 실행',24],['RUN_ANY_IN_BACKGROUND','백그라운드 실행 제한',28],
  ['READ_EXTERNAL_STORAGE','공유 저장소 읽기',23],['WRITE_EXTERNAL_STORAGE','공유 저장소 쓰기',23],['MANAGE_EXTERNAL_STORAGE','공유 파일 전체 접근',30],
  ['BLUETOOTH_SCAN','Bluetooth 검색',31],['BLUETOOTH_CONNECT','Bluetooth 연결',31],['BLUETOOTH_ADVERTISE','Bluetooth 광고',31],
  ['READ_MEDIA_IMAGES','사진 접근',33],['READ_MEDIA_VIDEO','동영상 접근',33],['READ_MEDIA_AUDIO','음악·오디오 접근',33],
  ['NEARBY_WIFI_DEVICES','근처 Wi-Fi 기기',33],['READ_MEDIA_VISUAL_USER_SELECTED','선택한 사진·영상 접근',34],
];
export const normalizeAppOp = value => String(value).replace(/^android:/,'').toUpperCase();

export function parseAppOpsOptions(output, sdk = null) {
  const descriptions=new Map(KNOWN_APP_OPS.map(([name,description])=>[name,description])),rows=new Map();
  if(Number.isSafeInteger(sdk))for(const [name,description,minSdk] of KNOWN_APP_OPS)if(sdk>=minSdk)rows.set(name,{value:name,label:`${description} · ${name} · 기록 없음/기본값`,mode:null,source:'Android 버전별 공개 AppOps',observed:false});
  for(const line of output.split(/\r?\n/)){
    const match=/^\s*(?:Uid mode:\s*)?([A-Z][A-Z0-9_]*|android:[a-z0-9_]+):\s*(allow|ignore|deny|default|foreground|errored)\b/.exec(line);
    if(!match)continue;const key=normalizeAppOp(match[1]);
    rows.set(key,{value:match[1],label:`${descriptions.get(key)||'기기 고유 접근 항목'} · ${match[1]}`,mode:match[2],source:'기기 AppOps 응답',observed:true});
  }
  return [...rows.values()].sort((a,b)=>a.value.localeCompare(b.value));
}
