// Runtime dumpsys output takes precedence over version-based AOSP references.
// Android 11–13: split/headless mode selects system vs non-system parents.
// Android 14–15: UserInfo.canHaveProfile() requires MAIN.
// Android 16+: MAIN or the runtime profilesForAll flag may allow a parent.
// https://android.googlesource.com/platform/frameworks/base/+/refs/tags/android-16.0.0_r1/core/java/android/content/pm/UserInfo.java#496
const result=(state,reasonKo,source)=>({state,reasonKo,source});
export const flagsOf=user=>typeof user?.flagsHex==='string'&&/^0x[a-f\d]+$/i.test(user.flagsHex)?Number.parseInt(user.flagsHex.slice(2),16):null;
export function profileParentRole(user){
  if(!user)return result('unknown','선택한 부모 사용자를 현재 목록에서 확인하지 못했습니다.','user-list');
  const flags=flagsOf(user);
  if(user.profile===true||user.secureFolder===true||user.canSwitch===false||flags!==null&&(flags&(0x4|0x8|0x40|0x200))!==0)return result('blocked','기존 프로필·제조사 전용 프로필·게스트·제한·비활성·데모 사용자는 새 업무 프로필의 부모로 사용할 수 없습니다.','user-role');
  if(user.profile!==false||user.canSwitch!==true||flags===null)return result('unknown','일반 사용자 유형·사용 상태·관리 권한을 모두 확인하지 못했습니다. 사용자 상태를 다시 조회하세요.','user-role');
  if((flags&0x2)===0)return result('blocked','이 설정 과정에서는 관리 권한이 있는 일반 사용자만 부모로 사용할 수 있습니다.','user-role');
  return result('confirmed','관리 권한이 있는 일반 사용자입니다.','user-role');
}
export function propertyBoolean(value){
  if(value===undefined||value===null)return null;
  const text=String(value).trim().toLowerCase();
  if(['1','true','y','yes','on'].includes(text))return true;
  // A successful empty getprop response uses the framework's false default.
  if(['','0','false','n','no','off'].includes(text))return false;
  return null;
}
export function profileParentAssessment(user,{sdk,mainUserId,splitSystemUser,headlessSystemUser}={}){
  const role=profileParentRole(user);if(role.state!=='confirmed')return role;
  if(typeof user.canHaveProfile==='boolean')return result(user.canHaveProfile?'confirmed':'blocked',user.canHaveProfile?'기기가 이 사용자의 프로필 부모 자격을 허용한다고 직접 보고했습니다. 생성 가능 개수·관리 정책은 별도로 확인합니다.':'기기가 이 사용자의 프로필 부모 자격을 허용하지 않는다고 직접 보고했습니다.','dumpsys-can-have-profile');
  const version=Number(sdk),flags=flagsOf(user);
  if(!Number.isInteger(version)||version<30)return result('unknown','현재 Android 버전과 프로필 부모 자격을 확인하지 못했습니다. 일반 관리자라는 사실만으로 실행을 허용하지 않습니다.','unknown');
  if(version>=34){
    const markedMain=(flags&0x4000)!==0,reportedMain=/^\d+$/.test(String(mainUserId))&&String(mainUserId)===String(user.id);
    if(markedMain||reportedMain)return result('confirmed','현재 주 사용자(MAIN)이며 관리 권한이 있는 일반 사용자입니다. Android 공통 부모 조건을 충족하며 생성 가능 개수·관리 정책은 별도로 확인합니다.',reportedMain?'cmd-user-main':'main-user-flag');
    return result('unknown',version>=36?'주 사용자가 아닌 일반 사용자입니다. 이 버전은 런타임 기능 설정에 따라 부모 자격이 달라지지만 기기의 Can have profile 결과를 받지 못했습니다. 부모 자격을 확인하기 전까지 실행할 수 없습니다.':'주 사용자가 아닌 일반 사용자입니다. Android 14·15 공통 구현은 주 사용자만 허용하지만 이 기기의 직접 판정은 확인하지 못했습니다. 부모 자격을 확인하기 전까지 실행할 수 없습니다.','runtime-parent-unverified');
  }
  const split=propertyBoolean(splitSystemUser),headless=propertyBoolean(headlessSystemUser);
  if(split===null||headless===null)return result('unknown','이 Android 버전의 시스템 사용자 분리·화면 없는 시스템 사용자 모드를 모두 읽지 못했습니다. 프로필 부모 자격을 확인한 뒤 실행할 수 있습니다.','legacy-mode-unverified');
  const allowed=split||headless?String(user.id)!=='0':String(user.id)==='0';
  return result(allowed?'confirmed':'unknown',allowed?'조회한 시스템 사용자 모드와 Android 11~13의 공통 부모 조건을 충족합니다. 생성 가능 개수·관리 정책은 별도로 확인합니다.':'조회한 시스템 사용자 모드에서는 이 사용자가 Android 11~13의 공통 부모 조건과 맞지 않습니다. 제조사별 예외를 확인할 직접 판정이 없어 실행을 보류합니다.','legacy-user-mode');
}
