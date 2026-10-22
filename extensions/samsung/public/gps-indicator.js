(() => {
  const root=document.getElementById('gps-indicator-panel');if(!root)return;
  const $=id=>document.getElementById(id);
  const state={id:null,active:false,app:null,user:null,data:null,error:null,valid:false,busy:false,revision:0,abort:null,finish:null,confirm:null,picking:false};
  root.innerHTML=`<div class="gps-indicator-heading"><div><h3><i aria-hidden="true"></i>앱별 파란 위치(GPS) 표시</h3><p>앱 목록에서 선택한 대상의 위치 표시 분류만 관리합니다.</p></div><div class="gps-indicator-toolbar"><button type="button" id="gps-indicator-pick">앱 목록에서 선택</button><button type="button" id="gps-indicator-refresh" disabled>현재 상태 조회</button></div></div>
    <div class="gps-indicator-target"><strong id="gps-indicator-app">앱을 선택하세요</strong><span id="gps-indicator-target-info">앱 목록의 이름을 누르거나 위의 선택 버튼을 이용하세요.</span></div>
    <div id="gps-indicator-status" class="gps-indicator-status" aria-live="polite"></div>
    <p id="gps-indicator-stale" class="gps-indicator-note" hidden>아래는 이전 조회값입니다. 현재 상태를 다시 확인할 때까지 변경할 수 없습니다.</p>
    <div class="gps-indicator-summary"><div><span>표시 분류값</span><strong id="gps-indicator-value">조회 전</strong></div><div><span>정확한 위치 권한</span><strong id="gps-indicator-permission">조회 전</strong></div><div><span>PC의 복원 기록</span><strong id="gps-indicator-original">기록 확인 전</strong></div></div>
    <div class="gps-indicator-actions"><button type="button" id="gps-indicator-hide" disabled>이 앱의 표시 숨기기</button><button type="button" id="gps-indicator-restore" disabled>원래 상태로 복원</button></div>
    <div id="gps-indicator-confirm" class="gps-indicator-confirm" hidden><strong id="gps-indicator-confirm-title"></strong><p id="gps-indicator-confirm-target"></p><label><input type="checkbox" id="gps-indicator-ack">위치 권한은 유지하고, 이 앱의 표시 분류만 변경하는 작업임을 확인했습니다.</label><p>개인정보 사용 목록의 분류에도 영향을 줄 수 있습니다. 재부팅·앱 업데이트 후 유지 여부는 확인되지 않았습니다.</p><div><button type="button" id="gps-indicator-confirm-run" disabled>확인 후 실행</button><button type="button" id="gps-indicator-confirm-cancel">취소</button></div></div>
    <div id="gps-indicator-progress" class="gps-indicator-progress" role="status" hidden><span id="gps-indicator-progress-text">앱의 위치 표시 상태를 조회하고 있습니다.</span><progress aria-label="앱별 위치 표시 처리 중"></progress></div><div id="gps-indicator-feedback" aria-live="polite"></div>
    <p class="gps-indicator-note">위치 권한은 유지합니다. 복원에는 이 PC에 보관한 변경 전 분류값을 사용합니다.</p>`;
  function current(revision){return state.active&&state.id&&state.revision===revision;}
  function feedback(options){const host=$('gps-indicator-feedback');if(window.DeskFeedback?.state)window.DeskFeedback.state(host,options);else{host.hidden=!options;host.textContent=options?[options.title,options.message,options.requiredAccessKo].filter(Boolean).join(' '):'';if(options?.onAction){const button=document.createElement('button');button.type='button';button.textContent=options.actionLabel||'다시 조회';button.addEventListener('click',options.onAction);host.append(button);}}}
  function resetConfirmation(){state.confirm=null;$('gps-indicator-ack').checked=false;}
  function cancel(){state.revision++;state.abort?.abort();state.abort=null;state.finish?.();state.finish=null;state.busy=false;state.picking=false;state.error=null;window.CompatibilityUI?.closeDetails?.();resetConfirmation();}
  function usable(action){const data=state.data;return!!(state.id&&state.active&&state.app&&state.valid&&!state.busy&&!state.picking&&(data?.compatibility?data.compatibility.canWrite:data?.profileMatches)&&(action==='hide'?data?.granted===true:typeof data?.granted==='boolean')&&[0,256].includes(data?.sensitiveBit)&&typeof data.snapshotToken==='string'&&data.snapshotToken&&(!Array.isArray(data.sharedPackages)||data.sharedPackages.length<=1)&&data[action==='hide'?'canHide':'canRestore']===true);}
  function shortReason(data){
    if(!state.app)return '앱 목록에서 대상을 선택하면 현재 분류와 복원 기록을 조회합니다.';
    if(!data)return '현재 상태를 조회한 뒤 사용할 수 있습니다.';
    if(usable('hide')||usable('restore'))return '';
    if(!data.profileMatches)return '현재 빌드의 표시 제어 경로를 검증하지 못해 조회만 제공합니다.';
    if(data.original?.identityMatches===false)return '앱 또는 기기 상태가 원본 기록과 달라 이전 값을 복원할 수 없습니다.';
    if(String(data.userId)!=='0')return '현재 구현은 소유자 사용자에서만 변경하며 다른 사용자는 조회만 제공합니다.';
    if(data.writeAccessGranted===false)return '현재 ADB 권한으로는 이 앱의 표시 분류를 변경할 수 없습니다.';
    if(Array.isArray(data.sharedPackages)&&data.sharedPackages.length>1)return '같은 UID를 공유하는 다른 앱에도 영향을 줄 수 있어 조회만 제공합니다.';
    if(data.granted===null)return /요청하지 않/.test(data.reasonKo||'')?'이 앱은 정확한 위치 권한을 요청하지 않아 표시 분류 변경 대상이 아닙니다.':'정확한 위치 권한 상태를 확인하지 못해 조회만 제공합니다.';
    if(data.granted===false)return '정확한 위치 권한이 허용되지 않아 표시를 숨길 수 없습니다.';
    if(data.sensitiveBit===0&&!data.original)return '표시 분류는 이미 해제되어 있으며 이 PC에 복원 기록이 없습니다.';
    return String(data.reasonKo||'현재 상태에서는 변경할 수 없습니다. 다시 조회해 주세요.').replace(/0x100/g,'표시 분류값').replace(/ADB shell/g,'ADB').split(/(?<=[.!?])\s+/)[0];
  }
  function renderStatus(data){
    const host=$('gps-indicator-status'),canAct=usable('hide')||usable('restore'),busy=state.busy||state.picking;
    const compatibility={...(data?.compatibility||{support:{state:'unknown',labelKo:'확인 필요'},access:{state:data?.writeAccessGranted?'allowed':'unknown',labelKo:data?.writeAccessGranted?'접근 가능':'확인 필요'},evidence:{state:data?.profileMatches?'current':data?'previous':'unverified',labelKo:data?.profileMatches?'현재 코드 확인':'미검증'},effect:{state:'untested',labelKo:'실제 효과 미시험'}}),reasonKo:state.error?.message||data?.reasonKo||'',requiredAccessKo:state.error?.requiredAccessKo||data?.requiredAccessKo};
    const sections=[{label:'표시 분류와 원본',text:data?`현재 분류 비트: ${data.sensitiveBit===256?'0x100 켜짐':data.sensitiveBit===0?'0x100 꺼짐':'확인 불가'}\n전체 플래그: ${data.flags??'확인 불가'}\n원본 분류 비트: ${data.original?String(data.original.bit):'기록 없음'}\n정확한 위치 권한의 민감도 플래그 0x100만 변경하며 다른 플래그는 유지합니다.`:'앱을 선택한 뒤 조회할 수 있습니다.'},{label:'검증 대상',text:data?[`빌드: ${data.fingerprint||'확인 불가'}`,`코드 검증 빌드: ${data.sourceBuild||'확인 불가'}`,`공유 UID 앱: ${(data.sharedPackages||[]).join(', ')||'확인 불가'}`].join('\n'):'조회 전'}];
    if(state.error?.rawError||state.error?.message)sections.push({label:'오류 원문',text:String(state.error.rawError||state.error.message)});
    if(data?.message)sections.push({label:'최근 처리 결과',text:data.message});
    const opts={mode:'write',canAct,canRead:!!(state.valid&&data),loading:busy,error:!!state.error,selectionRequired:!state.app,reason:shortReason(data),effectUntested:true,title:'앱별 위치 표시 상세 정보',sections,showReason:!busy&&!state.error};
    if(window.CompatibilityUI?.summary)host.innerHTML=window.CompatibilityUI.summary(compatibility,opts);
    else{
      host.textContent='';host.innerHTML='';
      const badge=document.createElement('strong'),reason=document.createElement('p'),effect=document.createElement('p');
      badge.className='gps-indicator-badge';badge.textContent=busy?'조회 중':state.error?'조회 실패':!state.app?'앱 선택 필요':!data?'조회 전':!data.profileMatches?'현재 빌드 확인 필요':canAct?'변경 요청 가능':'조회만 가능';host.append(badge);
      if(opts.showReason){reason.textContent=opts.reason;host.append(reason);}effect.className='gps-indicator-note';effect.textContent='실제 표시 효과 미확인';host.append(effect);
    }
  }
  function render(){
    const data=state.data,app=state.app,original=data?.original;
    $('gps-indicator-app').textContent=app?.label||app?.package||'앱을 선택하세요';
    $('gps-indicator-target-info').textContent=app?[app.label?app.package:null,`사용자 ${state.user}`,data?.uid!=null?`UID ${data.uid}`:null].filter(Boolean).join(' · '):'앱 목록의 이름을 누르거나 위의 선택 버튼을 이용하세요.';
    const bit=data&&[0,256].includes(data.sensitiveBit)?data.sensitiveBit!==0:null;
    $('gps-indicator-value').textContent=data?(bit===null?'조회 대상 아님 또는 확인 불가':bit?'분류 적용':'분류 해제'):'조회 전';
    $('gps-indicator-permission').textContent=data?(data.granted===true?'허용됨 · 변경 대상 아님':data.granted===false?'현재 미허용 · 복원 시에도 유지':'요청하지 않음 또는 확인 불가'):'조회 전';
    $('gps-indicator-original').textContent=original?`${Number(original.bit)?'분류 적용':'분류 해제'} · ${original.state==='restored'?'복원 확인':original.state==='uncertain'?'현재 상태 재조회 필요':original.state==='pending'?'작업 결과 재조회 필요':'원래 값 보관됨'}`:data?'보관 기록 없음':'기록 확인 전';
    $('gps-indicator-stale').hidden=!data||state.valid;
    renderStatus(data);
    $('gps-indicator-pick').disabled=!state.id||!state.active||state.busy||state.picking;
    $('gps-indicator-refresh').disabled=!state.id||!state.active||!app||state.busy||state.picking;
    $('gps-indicator-hide').disabled=!usable('hide');$('gps-indicator-restore').disabled=!usable('restore');
    $('gps-indicator-progress').hidden=!state.busy&&!state.picking;
    $('gps-indicator-confirm').hidden=!state.confirm;
    $('gps-indicator-confirm-run').disabled=!state.confirm||!$('gps-indicator-ack').checked||!usable(state.confirm);
    root.setAttribute?.('aria-busy',String(state.busy||state.picking));
  }
  function issue(cause,writing,retry=()=>refresh(),actionLabel='현재 상태 다시 조회'){
    state.error=cause;
    const raw=String(cause.message||''),message=/GRANT_RUNTIME|REVOKE_RUNTIME|WRITE_|SecurityException/i.test(raw)?'현재 ADB 권한 또는 기기 정책으로 상태를 확인하지 못했습니다.':/[가-힣]/.test(raw)?raw.split(/(?<=[.!?])\s+/)[0]:'기기 연결 또는 서버 응답을 확인하지 못했습니다. 현재 상태를 다시 조회하세요.';
    feedback({type:'error',title:writing?'위치 표시 변경을 확인하지 못했습니다':'앱의 위치 표시 상태를 읽지 못했습니다',message:message+(cause.mayHaveChanged?' 변경 요청이 전달됐을 수 있습니다. 같은 작업을 반복하지 말고 현재 상태를 다시 조회하세요.':''),actionLabel,onAction:retry});
  }
  async function api(method,target,body,signal){
    let headers,route='/api/device/gps-indicator?'+new URLSearchParams({id:target.id,package:target.package,user:String(target.user)});
    if(method==='POST'){
      const sessionResponse=await fetch('/api/session',{signal,cache:'no-store'}),session=await sessionResponse.json();
      if(!sessionResponse.ok||!session.csrfToken)throw new Error('페이지 인증을 확인하지 못했습니다. 새로고침한 뒤 다시 조회하세요.');
      headers={'Content-Type':'application/json','X-ADB-Desk-Token':session.csrfToken};route='/api/device/gps-indicator';
    }
    let response;try{response=await fetch(route,{method,headers,body:method==='POST'?JSON.stringify(body):undefined,signal,cache:'no-store'});}catch(cause){if(method==='POST')cause.mayHaveChanged=true;throw cause;}
    let data;try{data=await response.json();}catch{throw Object.assign(new Error('서버 응답을 읽지 못했습니다. 현재 상태를 다시 조회하세요.'),{mayHaveChanged:method==='POST'});}
    if(!response.ok)throw Object.assign(new Error(data.error||'위치 표시 요청을 처리하지 못했습니다.'),data);
    if(!data||data.package!==target.package||String(data.userId)!==String(target.user)||(data.canHide===true||data.canRestore===true)&&(![0,256].includes(data.sensitiveBit)||typeof data.granted!=='boolean'))throw Object.assign(new Error('선택한 앱과 조회 응답이 일치하지 않습니다. 현재 상태를 다시 조회하세요.'),{mayHaveChanged:method==='POST'});
    return data;
  }
  async function execute(action,button){
    const writing=action==='hide'||action==='restore';
    if(!state.id||!state.active||!state.app||state.busy||state.picking||writing&&!usable(action))return;
    const target={id:state.id,package:state.app.package,user:state.user},snapshot=state.data,revision=++state.revision,abort=new AbortController();
    resetConfirmation();state.error=null;window.CompatibilityUI?.closeDetails?.();state.abort=abort;state.busy=true;state.valid=false;
    $('gps-indicator-progress-text').textContent=writing?(action==='hide'?'원래 비트를 PC에 기록하고 선택한 앱의 표시 분류를 변경·확인하고 있습니다.':'PC에 보관한 원래 비트로 복원하고 권한 상태를 확인하고 있습니다.'):'선택한 앱의 위치 권한·표시 분류·복원 기록을 조회하고 있습니다.';
    const finish=window.DeskFeedback?.start?.(writing?'앱별 위치 표시 '+(action==='hide'?'숨기기':'복원'):'앱별 위치 표시 조회',{button});state.finish=finish;feedback(null);render();const timeout=setTimeout(()=>abort.abort(),120000);
    try{
      const data=await api(writing?'POST':'GET',target,writing?{deviceId:target.id,package:target.package,userId:target.user,action,expected:snapshot.snapshotToken}:undefined,abort.signal);
      if(!current(revision))return;
      state.data=data;state.valid=true;
      if(writing)feedback({type:data.mayHaveChanged||data.historyError?'warning':'success',title:data.mayHaveChanged?'변경 결과 재확인 필요':data.historyError?'표시 분류 확인 · 기록 저장 안내':'표시 분류 상태 확인',message:data.mayHaveChanged?'변경 결과를 확인하지 못했습니다. 현재 상태를 다시 조회하세요.':(action==='hide'?'표시 분류 해제와 위치 권한 유지를 확인했습니다.':'원래 표시 분류와 위치 권한 유지를 확인했습니다.')+(data.historyError?' '+data.historyError:''),actionLabel:data.mayHaveChanged?'현재 상태 다시 조회':undefined,onAction:data.mayHaveChanged?()=>refresh():undefined});
      if(data.mayHaveChanged)state.valid=false;
    }catch(cause){if(!current(revision))return;state.valid=false;issue(cause,writing);}
    finally{clearTimeout(timeout);finish?.();if(current(revision)){state.busy=false;state.abort=null;state.finish=null;render();}}
  }
  function refresh(){return execute(null,$('gps-indicator-refresh'));}
  function confirm(action){if(!usable(action))return;state.confirm=action;$('gps-indicator-ack').checked=false;$('gps-indicator-confirm-title').textContent=action==='hide'?'이 앱의 파란 위치 표시를 숨기시겠습니까?':'이 PC에 보관한 원래 표시 분류로 복원하시겠습니까?';$('gps-indicator-confirm-target').textContent=`${state.app.label||state.app.package} · ${state.app.package} · 사용자 ${state.user}`;render();}
  function selectApp(app,userId){
    const user=Number(app?.userId??userId),pkg=app?.package;
    if(app&&typeof pkg==='string'&&pkg&&Number.isSafeInteger(user)&&user>=0){
      if(state.app?.package===pkg&&state.user===user){state.app={...app};render();if(state.active&&!state.valid&&!state.busy)return refresh();return;}
      cancel();state.app={...app};state.user=user;state.data=null;state.valid=false;feedback(null);render();if(state.active&&state.id)return refresh();
    }else{cancel();state.app=null;state.user=null;state.data=null;state.valid=false;feedback(app?{type:'warning',title:'사용자 정보를 확인할 수 없습니다',message:'앱 목록을 새로 조회한 뒤 다시 선택하세요.'}:null);render();}
  }
  $('gps-indicator-refresh').addEventListener('click',refresh);
  $('gps-indicator-hide').addEventListener('click',()=>confirm('hide'));$('gps-indicator-restore').addEventListener('click',()=>confirm('restore'));
  $('gps-indicator-ack').addEventListener('change',render);$('gps-indicator-confirm-cancel').addEventListener('click',()=>{resetConfirmation();render();});
  $('gps-indicator-confirm-run').addEventListener('click',()=>{if(state.confirm&&$('gps-indicator-ack').checked)return execute(state.confirm,$('gps-indicator-confirm-run'));});
  $('gps-indicator-pick').addEventListener('click',async()=>{
    if(!state.id||!state.active||state.busy||state.picking)return;
    if(!window.DeviceTargets?.pick){feedback({type:'error',title:'앱 목록 선택을 열 수 없습니다',message:'페이지를 새로고침한 뒤 앱 목록에서 선택하세요.'});return;}
    const revision=++state.revision;resetConfirmation();state.error=null;window.CompatibilityUI?.closeDetails?.();state.picking=true;$('gps-indicator-progress-text').textContent='앱 목록에서 대상을 선택하고 있습니다.';feedback(null);render();
    try{const app=await window.DeviceTargets.pick('app',{title:'위치 표시를 관리할 앱 선택'});if(!current(revision))return;state.picking=false;if(app){window.DeviceTargets.selectApp?.(app);return selectApp(app,app.userId??window.AppInventory?.currentUser);}render();}
    catch(cause){if(!current(revision))return;state.picking=false;issue(cause,false,()=>$('gps-indicator-pick').click(),'앱 선택 다시 열기');render();}
  });
  window.GpsIndicator=Object.freeze({
    open(id){cancel();state.id=id;state.active=false;state.app=null;state.user=null;state.data=null;state.valid=false;feedback(null);render();},
    close(){cancel();state.id=null;state.active=false;state.app=null;state.user=null;state.data=null;state.valid=false;feedback(null);render();},
    activate(active){if(state.active===!!active)return;cancel();state.active=!!active;state.valid=false;feedback(null);render();if(state.active&&state.id&&state.app)return refresh();},
    selectApp,refresh
  });
  render();
})();
