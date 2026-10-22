(() => {
  const root=document.getElementById('privacy-indicators-panel');if(!root)return;
  const $=id=>document.getElementById(id);
  const state={id:null,active:false,data:null,busy:false,revision:0,abort:null,finish:null,error:null,errorDetails:null};
  root.innerHTML=`<div class="privacy-indicators-heading"><h3>개인정보 사용 표시</h3><button type="button" id="privacy-indicators-refresh">현재 값 조회</button></div>
    <div class="privacy-indicators-grid">
      <article class="privacy-indicator-card" data-privacy-indicator="camera-microphone"><div class="privacy-indicator-title"><i class="privacy-color green" aria-hidden="true"></i><h4>초록 카메라·마이크 표시</h4><span id="privacy-camera-status"></span></div><p>카메라·마이크 권한을 유지하고 사용 표시만 설정합니다.</p><div class="privacy-indicator-value"><span>저장값</span><strong id="privacy-camera-value">조회 전</strong></div><small id="privacy-camera-previous" hidden></small><div class="privacy-indicator-actions"><button type="button" data-privacy-set="true" disabled>켜기</button><button type="button" data-privacy-set="false" disabled>끄기</button></div><div id="privacy-compatibility"></div></article>
      <article class="privacy-indicator-card" data-privacy-indicator="location"><div class="privacy-indicator-title"><i class="privacy-color blue" aria-hidden="true"></i><h4>파란 위치(GPS) 표시</h4><span class="compatibility-badge is-unknown">전체 제어 미제공</span></div><p>모든 앱의 표시를 한 번에 끄는 방법은 확인되지 않았습니다.</p><div class="privacy-location-actions"><button type="button" id="privacy-location-apps">앱별 표시 설정</button><span id="privacy-location-details"></span></div><small>앱별 분류 변경 · 실제 표시 효과 미확인</small></article>
    </div><div id="privacy-indicator-progress" class="privacy-indicator-progress" role="status" hidden><span id="privacy-indicator-progress-text">표시 설정을 읽고 있습니다.</span><progress aria-label="개인정보 사용 표시 처리 중"></progress></div><div id="privacy-indicator-feedback" aria-live="polite"></div>`;
  const current=(id,revision)=>state.id===id&&state.revision===revision&&state.active;
  const writeDenied=data=>data?.writeAccess?.state==='denied';
  const writeUnverified=data=>data?.canWrite===false&&data?.writeAccess?.state==='unverified';
  const savedValue=data=>!data?'조회 전':data.storageStatus==='stored'?data.stored.value==='true'?'켜짐으로 저장됨':'꺼짐으로 저장됨':data.storageStatus==='default'?'저장값 없음':'저장값 형식 미확인';
  const shortReason=data=>!data?'':writeDenied(data)?data.writeAccess.code==='privacy_indicator_allowlist_denied'?'현재 ADB 허용 목록에 이 설정이 없어 변경할 수 없습니다.':'현재 ADB 권한으로 이 설정을 변경할 수 없습니다.':!data.profileMatches?'현재 빌드의 제어 방식을 검증하지 못해 조회만 제공합니다.':writeUnverified(data)?'현재 변경 권한을 확인하지 못해 조회만 제공합니다.':!data.canWrite?'저장값 형식을 확인하지 못해 변경할 수 없습니다.':'';
  function assessment(data){
    if(!data)return null;
    const base=data.compatibility||{support:{state:data.profileMatches?'supported':'unknown',labelKo:data.profileMatches?'코드 조건 확인':'미검증'},access:{state:'unknown',labelKo:'권한 미확인'},evidence:{state:data.profileMatches?'current':'previous',labelKo:data.profileMatches?'현재 빌드 코드 확인':'이전 빌드 자료'},effect:{state:'untested',labelKo:'실제 효과 미시험'},source:{build:data.sourceBuild},canRead:true,canWrite:data.canWrite};
    return {...base,...(writeDenied(data)?{access:{state:'denied',labelKo:'권한 제한'}}:{}),reasonKo:data.writeAccess?.reasonKo||base.reasonKo||'',requiredAccessKo:data.writeAccess?.requiredAccessKo||base.requiredAccessKo||''};
  }
  function detailSections(data){return [
    {label:'제어 항목',text:'DeviceConfig · privacy / camera_mic_icons_enabled'},
    {label:'저장값과 기본값',text:data?data.storageStatus==='default'?(data.profileMatches?'저장값이 없습니다. 분석한 코드의 기본값은 켜짐입니다.':'저장값이 없습니다. 현재 빌드의 기본값은 미확인입니다.'):'현재 저장값: '+String(data.stored?.value):'조회 전입니다.'},
    {label:'효과 검증 범위',text:'설정값 조회와 실제 화면 효과는 별개입니다. 표시 변화와 재부팅 후 유지 여부는 미시험입니다.'},
    ...(state.errorDetails?[{label:'최근 요청 오류',text:state.errorDetails.message||''},{label:'필요한 접근',text:state.errorDetails.requiredAccessKo||''},{label:'기술 오류 원문',text:state.errorDetails.rawError||''}]:[])
  ];}
  function feedback(options){const host=$('privacy-indicator-feedback');if(window.DeskFeedback?.state)window.DeskFeedback.state(host,options);else{host.hidden=!options;host.textContent=options?[options.title,options.message].filter(Boolean).join(' '):'';if(options?.onAction){const button=document.createElement('button');button.type='button';button.textContent=options.actionLabel||'다시 조회';button.addEventListener('click',options.onAction);host.append(button);}}}
  function render(){
    const data=state.data,comp=assessment(data),opts={mode:'write',canAct:!!data?.canWrite&&!writeDenied(data),canRead:!!data,loading:state.busy,error:!!state.error,reason:state.busy||state.error?'':shortReason(data),effectUntested:!!data&&!state.error&&!state.busy,title:'초록 표시 상세 정보',sections:detailSections(data)};
    $('privacy-camera-value').textContent=state.busy?'조회 중…':state.error?'현재 값 미확인':savedValue(data);
    $('privacy-camera-previous').hidden=!state.error||!data;$('privacy-camera-previous').textContent=state.error&&data?'이전 조회값: '+savedValue(data):'';
    if(window.CompatibilityUI){$('privacy-camera-status').innerHTML=window.CompatibilityUI.badge(comp,opts);$('privacy-compatibility').innerHTML=window.CompatibilityUI.summary(comp,{...opts,showStatus:false});}
    else{$('privacy-camera-status').textContent=state.busy?'조회 중':state.error?'조회 실패':data?opts.canAct?'변경 요청 가능':'조회만 가능':'조회 전';$('privacy-compatibility').textContent=[opts.reason,opts.effectUntested?'실제 효과 미확인':''].filter(Boolean).join(' ');}
    $('privacy-location-details').innerHTML=window.CompatibilityUI?.detailButton(null,{title:'파란 위치 표시 상세 정보',sections:[{label:'전체 표시 제어',text:'보관된 One UI 9.0 코드에서는 모든 앱의 위치 사용 표시를 끄는 제어 방법을 확인하지 못했습니다.'},{label:'앱별 제어',text:'앱 관리에서는 정밀 위치 권한의 0x100 분류 비트만 변경·복원합니다. 위치 권한 자체는 유지하지만 개인정보 사용 목록 분류에도 영향을 줄 수 있으며 실제 표시 효과와 재부팅 후 유지는 미시험입니다.'}]})||'';
    for(const button of root.querySelectorAll('[data-privacy-set]'))button.disabled=!state.active||!data?.canWrite||writeDenied(data)||state.busy||!!state.error;
    $('privacy-indicators-refresh').disabled=!state.id||!state.active||state.busy;
    $('privacy-indicator-progress').hidden=!state.busy;
  }
  function cancel(){state.revision++;state.abort?.abort();state.abort=null;state.finish?.();state.finish=null;state.busy=false;state.error=null;state.errorDetails=null;window.CompatibilityUI?.closeDetails();}
  async function api(method,body,signal){
    let headers,route='/api/device/privacy-indicators?id='+encodeURIComponent(state.id);
    if(method==='POST'){
      const sessionResponse=await fetch('/api/session',{signal}),session=await sessionResponse.json();
      if(!sessionResponse.ok||!session.csrfToken)throw new Error('페이지 인증을 확인하지 못했습니다. 새로고침한 뒤 다시 조회하세요.');
      headers={'Content-Type':'application/json','X-ADB-Desk-Token':session.csrfToken};route='/api/device/privacy-indicators';
    }
    let response;try{response=await fetch(route,{method,headers,body:method==='POST'?JSON.stringify(body):undefined,signal});}catch(cause){if(method==='POST')cause.mayHaveChanged=true;throw cause;}
    let data;try{data=await response.json();}catch{throw Object.assign(new Error('서버 응답을 읽지 못했습니다. 서버와 연결을 확인한 뒤 다시 조회하세요.'),{mayHaveChanged:method==='POST'});}
    if(!response.ok)throw Object.assign(new Error(data.error||'표시 설정 요청을 처리하지 못했습니다.'),data);
    return data;
  }
  async function execute(value,button){
    if(!state.id||!state.active||state.busy)return;
    const writing=typeof value==='boolean';
    if(writing&&(!state.data?.canWrite||writeDenied(state.data)||state.error))return;
    const id=state.id,revision=++state.revision,snapshot=state.data,abort=new AbortController();
    window.CompatibilityUI?.closeDetails();state.error=null;state.errorDetails=null;state.abort=abort;state.busy=true;
    $('privacy-indicator-progress-text').textContent=writing?'표시 설정을 저장하고 값을 확인하고 있습니다.':'개인정보 표시 설정을 읽고 있습니다.';
    const finish=window.DeskFeedback?.start?.(writing?'초록 표시 설정 저장':'개인정보 표시 설정 조회',{button});state.finish=finish;
    feedback(null);render();const timeout=setTimeout(()=>abort.abort(),20000);
    try{
      const data=await api(writing?'POST':'GET',writing?{deviceId:id,indicator:'camera-microphone',value,expected:{...snapshot.stored},expectedFingerprint:snapshot.fingerprint}:undefined,abort.signal);
      if(!current(id,revision))return;
      if(!data||data.deviceId!==id||typeof data.canWrite!=='boolean'||typeof data.stored?.exists!=='boolean'||!['stored','default','unexpected'].includes(data.storageStatus)||data.storageStatus==='stored'&&(!data.stored.exists||!['true','false'].includes(data.stored.value))||data.storageStatus==='default'&&(data.stored.exists||data.stored.value!==null))throw Object.assign(new Error('현재 기기와 표시 설정 응답을 확인하지 못했습니다. 다시 조회해 주세요.'),{mayHaveChanged:writing});
      state.data=data;
      if(writing)feedback({type:data.historyError?'warning':'success',title:'저장값 확인',message:'요청한 저장값을 다시 읽었습니다.'+(data.historyError?' PC 변경 기록은 저장하지 못했습니다.':'')});
    }catch(cause){
      if(!current(id,revision))return;
      const message=/[가-힣]/.test(cause.message||'')?cause.message:'연결 또는 조회 권한 때문에 현재 상태를 확인하지 못했습니다.';
      state.errorDetails={message,requiredAccessKo:cause.requiredAccessKo,rawError:cause.rawError||(!/[가-힣]/.test(cause.message||'')?cause.message:'')};
      const denied=writing&&cause.mayHaveChanged===false&&(cause.writeBlocked===true||cause.code==='privacy_indicator_allowlist_denied');
      if(denied)state.data={...snapshot,canWrite:false,writeAccess:{state:'denied',code:cause.code,reasonKo:message,requiredAccessKo:cause.requiredAccessKo}};
      else {state.data=snapshot||null;state.error=message;}
      feedback({type:'error',title:denied?'변경 요청 거부':writing?'저장 결과 확인 실패':'조회 실패',message:denied?'기존 저장값은 변경되지 않았습니다.':cause.mayHaveChanged?'저장 요청이 전달됐을 수 있습니다. 다시 조회로 현재 값을 확인해 주세요.':'현재 상태를 읽지 못했습니다. 연결과 조회 권한을 확인한 뒤 다시 시도해 주세요.',actionLabel:'현재 값 다시 조회',onAction:()=>refresh()});
    }finally{
      clearTimeout(timeout);finish?.();
      if(current(id,revision)){state.busy=false;state.abort=null;state.finish=null;render();}
    }
  }
  function refresh(){return execute(undefined,$('privacy-indicators-refresh'));}
  $('privacy-location-apps').addEventListener('click',()=>{window.CompatibilityUI?.closeDetails();document.getElementById('apps-tab')?.click();document.getElementById('gps-indicator-panel')?.scrollIntoView?.({block:'nearest'});});
  $('privacy-indicators-refresh').addEventListener('click',refresh);
  for(const button of root.querySelectorAll('[data-privacy-set]'))button.addEventListener('click',()=>execute(button.dataset.privacySet==='true',button));
  window.PrivacyIndicators=Object.freeze({
    open(id){cancel();state.id=id;state.active=false;state.data=null;feedback(null);render();},
    activate(active){if(state.active===active)return;cancel();state.active=active;if(!active){state.data=null;feedback(null);}render();if(active&&state.id)return refresh();},
    refresh,
    close(){cancel();state.id=null;state.active=false;state.data=null;feedback(null);render();}
  });
  render();
})();
