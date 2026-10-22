// Samsung-only reads and explanations. The common setup service selects this
// provider only for an enabled extension and a matching device manufacturer.
const integerSetting=text=>/^\d+$/.test(String(text||'').trim())?Number(String(text).trim()):null;
export function requests({parent}){
  return [['autoBlocker',['settings','--user',parent,'get','secure','rampart_blocked_device_admin_apps']]];
}
export function explainError(raw){
  return /rampart|auto.?block|status.?52/i.test(String(raw))?'삼성 보안 위험 자동 차단 정책이 관리자 앱 또는 업무 프로필 활성화를 막았습니다. 웹에서 보안 설정을 바꾸지 않습니다.':null;
}
export function checks({raw}){
  const blocker=integerSetting(raw.autoBlocker);
  return [
    {id:'auto-blocker',label:'삼성 관리자 앱 차단',state:blocker===1?'blocked':blocker===0?'confirmed':'unknown',reasonKo:blocker===1?'보안 위험 자동 차단 정책이 관리자 앱·업무 프로필 활성화를 막습니다. 보안 설정을 자동으로 변경하지 않습니다.':blocker===0?'현재 읽은 관리자 앱 차단 값은 꺼짐입니다.':'rampart_blocked_device_admin_apps 값을 읽지 못했거나 이 기기가 제공하지 않습니다. 차단 여부를 추정하지 않습니다.'},
    {id:'knox',label:'삼성 추가 생성 검사',state:'unknown',reasonKo:'Knox 무결성·키 검사는 실제 생성 없이 완전히 판정할 수 없습니다. 키를 생성하는 시험 호출은 하지 않습니다.',informational:true},
  ];
}
