import {currentReviewProfile} from '../../../lib/compatibility-profiles.mjs';
const number=value=>value==null||value===''||!Number.isFinite(Number(value))?null:Number(value);
const bool=value=>/^(?:true|yes|1)$/i.test(String(value))?true:/^(?:false|no|0)$/i.test(String(value))?false:null;
const onOff=value=>value==null?null:value?'켜짐':'꺼짐';
const unit=(value,suffix,divisor=1)=>number(value)==null?null:Number((Number(value)/divisor).toFixed(4))+' '+suffix;
// Samsung BatteryService exposes per-battery arrays. Read only the current dump,
// never boot/event-log history. One UI 9 DischargeLevelData + SecBatteryCycleCount
// use dischargeLevel / 100; the Settings screen uses its integer part.
const currentBatterySnapshot=text=>String(text).split(/^\s*\[(?:EventLogBuffer|SleepChargingLogBuffer|BattInfoLogBuffer|BattActionChangedLogBuffer|HiccupLogBuffer)\]\s*$/m)[0];
export function parseSamsungBatteryHistory(text='') {
  const current=currentBatterySnapshot(text);
  const read=key=>{const match=new RegExp('^\\s*'+key+'\\s*:\\s*(.*?)\\s*$','m').exec(current);if(!match)return{present:false,unsupported:false,values:[]};const raw=match[1].trim();if(/^unsupported$/i.test(raw))return{present:true,unsupported:true,values:[]};const body=/^\[([^\]\r\n]*)\]$/.exec(raw)?.[1]??raw,parts=body?body.split(',').map(x=>x.trim()):[];return{present:true,unsupported:false,values:parts.length<=8?parts:[]};};
  const usage=read('mSavedBatteryUsage'),asoc=read('mSavedBatteryAsoc'),firstUse=read('battery FirstUseDate');
  const whole=value=>/^\d{1,16}$/.test(value||'')&&Number.isSafeInteger(Number(value))?Number(value):null;
  const day=value=>{if(!/^\d{8}$/.test(value||''))return null;const year=Number(value.slice(0,4)),month=Number(value.slice(4,6)),date=Number(value.slice(6,8));if(year<2000||year>2099)return null;const d=new Date(Date.UTC(year,month-1,date));return d.getUTCFullYear()===year&&d.getUTCMonth()===month-1&&d.getUTCDate()===date?value.slice(0,4)+'-'+value.slice(4,6)+'-'+value.slice(6,8):null;};
  const count=Math.max(usage.values.length,asoc.values.length,firstUse.values.length);
  return{present:usage.present||asoc.present||firstUse.present,unsupported:{usage:usage.unsupported,asoc:asoc.unsupported,firstUse:firstUse.unsupported},batteries:Array.from({length:Math.max(count,1)},(_,index)=>{const raw=whole(usage.values[index]),health=whole(asoc.values[index]);return{index:index+1,usageRaw:raw,cycles:raw===null?null:Math.floor(raw/100),equivalentCycles:raw===null?null:raw/100,asoc:health!==null&&health<=100?health:null,firstUseDate:day(firstUse.values[index])};})};
}
// One UI 9 BatteryService.writeProtectBatteryValues / setSleepCharging. The
// misleading "Super Fast Charging Settings" dump line is SEC_FEATURE_USE_SFC,
// NOT mSuperFastChargingSettingsEnable. Never turn that feature flag into off.
export function parseSamsungChargingSettings(text='') {
  const snapshot=currentBatterySnapshot(text), raw={};
  for(const key of ['mProtectBatteryMode','mProtectionThreshold','mMaximumProtectionThreshold','Adaptive Fast Charging Settings','Super Fast Charging Settings','FEATURE_WIRELESS_FAST_CHARGER_CONTROL','mWirelessFastChargingSettingsEnable']){
    const match=new RegExp('^\\s*'+key+'\\s*:\\s*(.*?)\\s*$','m').exec(snapshot);
    if(match)raw[key]=match[1].trim();
  }
  const integer=key=>/^\d{1,5}$/.test(raw[key]||'')?Number(raw[key]):null;
  const percent=key=>{const value=integer(key);return value!==null&&value<=100?value:null;};
  const mode=integer('mProtectBatteryMode'), modes={
    0:{label:'꺼짐',description:'서비스가 충전 상한을 100%로 두고 보호용 재충전 제어를 해제합니다.'},
    1:{label:'최대 보호',description:'선택한 최대 보호 제한값에서 충전을 제한합니다. 내부 기본 기준값과 별도로 저장됩니다.'},
    2:{label:'높은 잔량 유지 억제',description:'내부 보호 기준값과 HIGHSOC 방식으로 높은 잔량 유지를 억제합니다. 최대 보호 모드의 고정 상한과 다릅니다.'},
    3:{label:'기본 보호 · 재충전 제어',description:'서비스는 상한을 100%로 두고 보호용 재충전 제어를 켭니다. 재충전을 시작하는 잔량은 이 필드만으로 확인할 수 없습니다.'},
    4:{label:'수면 패턴에 맞춘 보호',description:'수면 충전 관리자가 보호 중에는 내부 기준값으로 제한하고, 보호를 해제할 때 100%로 되돌립니다. 현재 수면 보호 단계와 고정 상한을 혼동하지 않습니다.'},
  }, known=Object.hasOwn(modes,mode)?modes[mode]:null;
  return {present:Object.keys(raw).length>0,mode,modeLabel:mode===null?null:known?`${known.label} (${mode})`:`의미 미확인 · 모드 ${mode}`,modeDescription:known?.description||'현재 펌웨어 코드와 의미가 대조되지 않은 값입니다. 꺼짐이나 기존 모드로 추정하지 않습니다.',maximumThreshold:percent('mMaximumProtectionThreshold'),internalThreshold:percent('mProtectionThreshold'),fastEnabled:bool(raw['Adaptive Fast Charging Settings']),superFastSeparateControl:bool(raw['Super Fast Charging Settings']),wirelessFastEnabled:bool(raw.mWirelessFastChargingSettingsEnable),wirelessFastControl:bool(raw.FEATURE_WIRELESS_FAST_CHARGER_CONTROL),unsupported:Object.fromEntries(Object.entries(raw).filter(([,value])=>/^unsupported$/i.test(value)).map(([key])=>[key,true]))};
}

export async function readExtra({results,commands,warnings,readUser,readCommand,failRead,diagnosticErrorLine}){
 let superFastUserId=null;
 const snapshot=results.get('battery')?.text||'';
 if(!parseSamsungBatteryHistory(snapshot).present&&!parseSamsungChargingSettings(snapshot).present)return {reviewed:false};
 const build={id:'manufacturerBatteryBuild',label:'제조사 배터리 설명의 빌드 조건',command:'getprop ro.build.fingerprint'};commands.push(build);
 try{
  const fingerprint=String(await readCommand(build.command)).trim();
  if(!currentReviewProfile(fingerprint)){warnings.push('삼성 배터리 추가 정보는 현재 빌드의 의미를 검증하지 못해 표시하지 않습니다. 표준 배터리 상태는 계속 조회할 수 있습니다.');return {reviewed:false};}
  results.set(build.id,{status:'ok',text:fingerprint});
 }catch(error){failRead(build,error.message);warnings.push('현재 빌드를 읽지 못해 삼성 전용 배터리 정보의 의미를 확정하지 않았습니다.');return {reviewed:false};}
    // The dump exposes only the SFC feature flag. Read the real preference only
    // when this firmware actually enables that separate control path. Keep the
    // numeric user fixed for both the setting and its displayed provenance.
    if(parseSamsungChargingSettings(results.get('battery')?.text||'').superFastSeparateControl===true){
      const command={id:'batterySuperFastSetting',label:'초고속 충전의 별도 설정',command:'settings --user current get system super_fast_charging'};
      commands.push(command);
      try{superFastUserId=await readUser();}catch(error){failRead(command,error.message);}
      if(superFastUserId!==null){
        command.command=command.command.replace('--user current',`--user ${superFastUserId}`);
        try{
          const response=String(await readCommand(command.command)).trim(),errorLine=diagnosticErrorLine(response);
          if(errorLine)failRead(command,errorLine);else results.set(command.id,{status:response?'ok':'unavailable',text:response});
        }catch(error){failRead(command,error.message);}
        try{const after=await readUser();if(after!==superFastUserId)warnings.push(`조회 중 사용자가 바뀌었습니다. 초고속 충전 별도 설정은 처음 고정한 ${superFastUserId}번 사용자의 저장값입니다.`);}catch{warnings.push(`조회 후 현재 사용자를 확인하지 못했습니다. 초고속 충전 별도 설정은 ${superFastUserId}번 사용자의 저장값입니다.`);}
      }
    }

 return {superFastUserId,reviewed:true};
}
export function batterySections({batteryText,text,item,superFastUserId,reviewed}){
 if(!reviewed)return [];
 const sections=[],b={samsung:parseSamsungBatteryHistory(batteryText),chargingSettings:parseSamsungChargingSettings(batteryText)};
      if(b.chargingSettings.present){
        const c=b.chargingSettings,report=(key,value)=>c.unsupported[key]?'기기 미지원':value;
        const cap=c.mode===1?unit(c.maximumThreshold,'%'):c.mode===0?'100 % · 보호 제한 없음':c.mode===3?'100 % · 재충전 제어':c.mode===2?'조건에 따라 제한':c.mode===4?'수면 보호 단계에 따라 변경':null;
        const stored=text('batterySuperFastSetting').trim(),superFast=c.superFastSeparateControl===false?'별도 제어 미사용':c.superFastSeparateControl===true?(stored==='1'?'켜짐':stored==='0'?'꺼짐':stored==='null'?'저장값 없음 · 서비스 기본 켜짐':null):null;
        sections.unshift({id:'battery-samsung-charging',title:'삼성 충전 보호·충전 설정',description:'조회 전용 · 저장 설정과 보호 모드를 표시합니다. 실제 충전 중 여부·전력·속도는 아래 현재 상태에서 구분합니다.',items:[
          item('충전 보호 모드',report('mProtectBatteryMode',c.modeLabel),'battery',c.modeDescription),
          item('모드 기준 충전 상한',report('mProtectBatteryMode',c.mode===1?report('mMaximumProtectionThreshold',cap):cap),'battery','선택한 모드의 상한입니다. 현재 충전 여부·순간 전력·충전 중단 원인은 따로 확인해야 합니다.'),
          item('최대 보호 제한값 · 저장값',report('mMaximumProtectionThreshold',unit(c.maximumThreshold,'%')),'battery','최대 보호 모드(1)에서만 사용하는 저장 제한값입니다.'),
          item('내부 보호 기준값',report('mProtectionThreshold',unit(c.internalThreshold,'%')),'battery','높은 잔량 억제(2)·수면 보호(4)에 쓰는 기준이며 최대 보호 상한과 다릅니다.'),
          item('고속 유선 충전 설정',report('Adaptive Fast Charging Settings',onOff(c.fastEnabled)),'battery','서비스의 유선 고속 충전 허용 설정입니다. 충전기·케이블·온도·잔량에 따라 실제 속도는 달라집니다.'),
          item('초고속 충전 별도 설정',report('Super Fast Charging Settings',superFast),c.superFastSeparateControl===true?'batterySuperFastSetting':'battery',c.superFastSeparateControl===false?'별도 제어 경로를 사용하지 않는 펌웨어입니다. 로그의 false는 기능 플래그로, 초고속 충전 꺼짐이나 충전기 미지원이라는 뜻이 아닙니다.':`사용자 ${superFastUserId??'미확인'}의 별도 초고속 충전 저장값을 조회합니다. 미저장 시 서비스 기본값은 켜짐입니다. 현재 충전 속도를 나타내는 값은 아닙니다.`),
          item('고속 무선 충전 설정',report('mWirelessFastChargingSettingsEnable',onOff(c.wirelessFastEnabled)),'battery','고속 무선 충전을 허용하는 설정입니다. 지금 무선 충전 중이라는 뜻은 아닙니다.'),
          item('고속 무선 충전 제어 기능',report('FEATURE_WIRELESS_FAST_CHARGER_CONTROL',c.wirelessFastControl===null?null:c.wirelessFastControl?'별도 제어 경로 사용':'별도 제어 경로 미사용'),'battery','펌웨어 제어 기능입니다. 사용자 설정·현재 무선 충전 상태와 다릅니다.')
        ],tables:[]});
      }
      if(b.samsung.present){const history=b.samsung,items=[];for(const row of history.batteries){const prefix=history.batteries.length>1?`배터리 ${row.index} · `:'';const report=(key,value)=>history.unsupported[key]?'기기 미지원':value;
        items.push(item(prefix+'충전 사이클 · 삼성 설정 앱 기준',report('usage',row.cycles===null?null:row.cycles+' 회'),'battery','mSavedBatteryUsage를 100으로 나눈 정수부입니다. 누적 방전량을 환산한 값이며 충전기를 연결한 횟수와 다릅니다.'));
        items.push(item(prefix+'누적 방전량 환산',report('usage',row.equivalentCycles===null?null:row.equivalentCycles.toFixed(2)+' 회'),'battery',row.usageRaw===null?'누적 사용량이 공개되지 않았거나 유효한 숫자가 아닙니다.':'원시값 mSavedBatteryUsage = '+row.usageRaw+' ÷ 100. 소수 환산값과 설정 앱의 정수 표시를 구분합니다.'));
        items.push(item(prefix+'배터리 수명 지표 · ASOC',report('asoc',unit(row.asoc,'%')),'battery','mSavedBatteryAsoc에 저장된 삼성의 배터리 노화 추정 지표입니다. 실제 최대 용량을 직접 측정한 결과나 성능 보증값은 아닙니다.'));
        items.push(item(prefix+'배터리 최초 사용 기록',report('firstUse',row.firstUseDate),'battery','battery FirstUseDate의 YYYYMMDD 기록입니다. 통신사 개통일이나 기기가 처음 켜진 날짜로 확정하지 않습니다. 배터리 교체·정비·기록 갱신의 영향을 받을 수 있습니다.'));
      }sections.unshift({id:'battery-samsung-history',title:'삼성 배터리 수명·사용 이력',items,tables:[],description:'보관된 One UI 9.0의 BatteryService·설정 앱 코드와 대조한 표시입니다. 서비스가 공개한 현재 저장값만 읽으며 과거 이벤트 로그 값은 사용하지 않습니다.'});}

 return sections;
}
