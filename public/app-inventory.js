(() => {
  const state={user:'current',users:[],category:'all',removal:'all',translation:'all',feature:'all',launch:'all',split:'all',backup:'all',sort:'name',descending:false,onChange:null,onUserChange:null,getDevice:null,onEnriched:null,labelJob:null,labelPending:false,labelEpoch:0};
  const $=id=>document.getElementById(id);
  const fields=[
    ['apps-category-filter','category','설명 분류',[['all','설명 분류 전체'],['Aosp','Android 공통'],['Oem','제조사 앱'],['Google','Google 앱'],['Carrier','통신사 앱'],['Misc','기타'],['none','참고 자료 없음']]],
    ['apps-removal-filter','removal','커뮤니티 제거 영향',[['all','제거 영향 전체'],['Recommended','커뮤니티 권장'],['Advanced','영향 검토'],['Expert','전문가 검토'],['Unsafe','제거 부적합'],['none','분류 없음']]],
    ['apps-translation-filter','translation','한글 설명',[['all','한글 설명 전체'],['any-reviewed','기능·영향 한글 있음'],['source-reviewed','공식 기능 자료 대조'],['community-summary','커뮤니티 근거 한글'],['untranslated','원문만 있음'],['unavailable','설명 미확인']]],
    ['apps-feature-filter','feature','기타 앱 상태',[['all','기타 상태 전체'],['suspended','일시중지됨']]],
    ['apps-launch-filter','launch','실행 화면',[['all','실행 화면 전체'],['yes','실행 화면 있음'],['no','실행 화면 없음'],['unknown','실행 화면 미확인']]],
    ['apps-split-filter','split','분할 APK',[['all','분할 APK 전체'],['yes','분할 APK만'],['no','단일 APK만'],['unknown','분할 여부 미확인']]],
    ['apps-backup-filter','backup','백업 선언',[['all','백업 선언 전체'],['yes','백업 허용 선언'],['no','백업 불허 선언'],['unknown','백업 선언 미확인']]],
    ['apps-sort','sort','정렬 기준',[['name','이름·패키지'],['version','버전 번호'],['updated','최근 업데이트'],['used','최근 사용 시각'],['installed','설치 시각'],['storage','저장 용량'],['code','앱 코드 전체 크기'],['apk','APK 파일 크기'],['data','앱 데이터 크기'],['cache','캐시 크기'],['uid','UID']]],
  ];
  function option(value,label){const item=document.createElement('option');item.value=value;item.textContent=label;return item;}
  function makeSelect(id,label,options,change){const select=document.createElement('select');select.id=id;select.setAttribute('aria-label',label);for(const [value,text]of options)select.append(option(value,text));select.addEventListener('change',change);return select;}
  function init(options={}) {
    state.onChange=options.onChange||state.onChange;state.onUserChange=options.onUserChange||state.onUserChange;state.getDevice=options.getDevice||state.getDevice;state.onEnriched=options.onEnriched||state.onEnriched;
    if($('apps-inventory-filters'))return;
    const list=$('apps-list');if(!list)return;
    const wrap=document.createElement('div');wrap.id='apps-inventory-filters';wrap.className='app-inventory-filters';
    const toolbar=list.closest?.('.desk-browser-main')?.querySelector('.inventory-toolbar');
    const profile=makeSelect('apps-user','앱을 관리할 사용자·프로필',[['current','현재 사용자']],()=>{const previous=state.user;state.user=profile.value;if(previous!==state.user){state.labelEpoch++;state.labelPending=false;state.labelJob=null;if($('apps-usage-read'))$('apps-usage-read').disabled=false;setStorageBusy(false);if($('apps-labels-read'))$('apps-labels-read').disabled=false;if($('apps-labels-stop'))$('apps-labels-stop').hidden=true;state.onUserChange?.(state.user,previous);}});
    if(toolbar&&$('apps-count')?.parentElement===toolbar)$('apps-count').before(profile);else (toolbar||wrap).append(profile);
    for(const [id,key,label,options]of fields)wrap.append(makeSelect(id,label,options,event=>{state[key]=event.target.value;state.onChange?.();}));
    const direction=document.createElement('button');direction.id='apps-sort-direction';direction.type='button';direction.textContent='오름차순 ↑';direction.setAttribute('aria-label','정렬 방향 변경');direction.addEventListener('click',()=>{state.descending=!state.descending;direction.textContent=state.descending?'내림차순 ↓':'오름차순 ↑';state.onChange?.();});wrap.append(direction);
    const identityTools=document.createElement('section');identityTools.id='app-identity-tools';identityTools.className='app-identity-tools';const identityTitle=document.createElement('h4');identityTitle.className='app-state-subtitle';identityTitle.textContent='실제 앱 이름·아이콘';identityTools.append(identityTitle);
    const labels=document.createElement('button');labels.id='apps-labels-read';labels.type='button';labels.textContent='선택 앱 정보 확인';labels.title='체크한 앱, 없으면 현재 페이지의 앞 25개 기본 APK를 PC로 복사해 실제 이름·아이콘을 읽습니다. 앱당 256MB·총 1GB. 앱 설치나 설정을 바꾸지 않습니다.';labels.addEventListener('click',readLabels);identityTools.append(labels);
    const stop=document.createElement('button');stop.id='apps-labels-stop';stop.type='button';stop.hidden=true;stop.textContent='이름 확인 중지';stop.addEventListener('click',async()=>{if(state.labelJob)try{await labelsApi('cancel',{id:state.labelJob});}catch(error){$('apps-inventory-note').textContent=error.message;}});identityTools.append(stop);
    const usageButton=document.createElement('button');usageButton.id='apps-usage-read';usageButton.type='button';usageButton.textContent='최근 사용 기록 조회';usageButton.title='Android 사용 통계에서 선택한 사용자·프로필의 마지막 전면 사용 기록을 읽습니다. 미제공은 미확인으로 표시합니다.';usageButton.addEventListener('click',readUsage);identityTools.append(usageButton);
    const storageTools=document.createElement('div');storageTools.className='app-storage-tools';
    const storageButton=document.createElement('button');storageButton.id='apps-storage-read';storageButton.type='button';storageButton.textContent='선택 앱 용량 조회';storageButton.title='최대 10개 앱의 전체 용량을 조회합니다. 권한이 제한되면 읽을 수 있는 APK 파일 합계만 따로 표시하고, 데이터·캐시는 미확인으로 둡니다. 권한이나 폰 설정은 변경하지 않습니다.';storageButton.addEventListener('click',readStorage);storageTools.append(storageButton);
    const apkButton=document.createElement('button');apkButton.id='apps-apk-size-read';apkButton.type='button';apkButton.textContent='APK 크기만 조회';apkButton.title='체크한 앱 또는 현재 목록의 앞 10개 앱에서 설치된 기본·분할 APK 파일 크기만 읽습니다. 앱 데이터·캐시·최적화 파일은 제외합니다. 현재 ADB 파일 읽기 권한을 사용하며 권한이나 폰 설정은 변경하지 않습니다.';apkButton.addEventListener('click',()=>readStorage({readMode:'apk-only',button:apkButton}));storageTools.append(apkButton);identityTools.append(storageTools);
    const storageAccess=document.createElement('span');storageAccess.className='app-storage-access';storageAccess.textContent='전체 통계: 사용 정보 접근 조건';storageAccess.title='다른 앱의 전체 용량은 조회 주체의 GET_USAGE_STATS 허용 또는 기본 모드에서 PACKAGE_USAGE_STATS 권한 검사를 통과해야 합니다. 대상 앱의 일반 저장소 권한이 아니며, 이 사이트는 권한을 변경하지 않습니다.';identityTools.append(storageAccess);
    const storageNote=document.createElement('p');storageNote.className='app-storage-scope';storageNote.textContent='용량 조회는 최대 10개 · APK 크기만 조회는 기본·분할 APK 합계만 확인하며 앱 데이터·캐시·최적화 파일은 제외합니다.';identityTools.append(storageNote);
    const identityNote=document.createElement('p');identityNote.textContent='체크한 앱 또는 현재 목록의 앞 25개 · APK에서 실제 정보를 읽습니다.';identityTools.append(identityNote);
    const storage=$('app-state-tools');if(storage)storage.before(identityTools);else wrap.append(identityTools);
    const note=document.createElement('div');note.id='apps-inventory-note';note.className='app-inventory-note';note.textContent='앱 이름·버전·기능 설명으로 검색할 수 있습니다. 사용자 선택은 목록의 범위만 바꿉니다.';
    if(toolbar)toolbar.after(wrap,note);else (list.previousElementSibling?.classList?.contains('desk-app-list-heading')?list.previousElementSibling:list).before(wrap,note);
  }
  function readState(type,title,message,retry,ctx=requestContext(),actionLabel='다시 조회'){
    if(!currentRequest(ctx))return;const value={type,title,message,...(retry?{actionLabel,onAction:()=>{if(currentScope(ctx))return retry();}}:{})};if(window.DeskFeedback?.state)window.DeskFeedback.state($('apps-inventory-note'),value);else $('apps-inventory-note').textContent=title+' · '+message;
  }
  function feedback(title,error,retry,ctx=requestContext(),actionLabel='다시 조회'){
    const offline=/offline|no devices|device.*not found|오프라인|연결되어 있지|온라인 상태가 아닙|연결.*(?:끊|실패|없)|Failed to fetch|NetworkError/i.test(error.message||'');readState(offline?'offline':'error',offline?'기기 연결을 확인해 주세요':title,error.message||String(error),retry,ctx,actionLabel);
  }
  const failureSummary=rows=>(rows||[]).slice(0,4).map(row=>`${row.package||'앱'}: ${row.error||row.message||'이유 미제공'}`).join(' / ');
  function storageIssueInfo(issue={}){
    const raw=String(issue.rawError||issue.error||issue.message||'');
    if(issue.reasonKo)return {reason:issue.reasonKo,access:issue.requiredAccessKo||'기기가 허용하는 해당 사용자·프로필의 용량 조회 접근이 필요합니다.',raw};
    if(/blocked by mode|GET_USAGE_STATS|PACKAGE_USAGE_STATS|usage.?stats.*permission/i.test(raw))return {reason:'다른 앱의 용량 통계를 읽는 ADB shell의 사용 정보 접근이 제한되어 있습니다. 대상 앱의 일반 저장소 권한 문제가 아닙니다.',access:'조회 주체의 사용 정보 접근(GET_USAGE_STATS)이 허용되어야 합니다. 기본 모드에서는 PACKAGE_USAGE_STATS 권한 검사도 적용됩니다. 명시적 차단은 권한 선언만으로 풀리지 않으며 이 사이트는 권한을 변경하지 않습니다.',raw};
    if(/INTERACT_ACROSS_USERS|cross.?user/i.test(raw))return {reason:'선택한 사용자·업무 프로필의 정보를 읽을 권한이 없습니다.',access:'사용자 간 정보 조회 권한(INTERACT_ACROSS_USERS 또는 기기가 요구하는 FULL 권한)과 해당 프로필에 대한 기기 정책 허용이 필요합니다.',raw};
    if(/locked|unlock|잠금/i.test(raw))return {reason:'해당 사용자·프로필의 데이터가 잠겨 있어 용량을 확인할 수 없습니다.',access:'해당 사용자·프로필의 잠금 해제가 필요합니다. 웹에서 잠금을 해제하거나 사용자를 전환하지 않습니다.',raw};
    if(/unknown (?:command|option)|flag.*not enabled|지원하지|미지원/i.test(raw))return {reason:'이 Android 버전 또는 제조사 펌웨어가 전체 앱 용량 조회 명령을 제공하지 않습니다.',access:'이 명령을 지원하는 기기 구현이 필요합니다. 일반 앱의 파일·사진 접근 권한을 허용해도 명령 지원이 추가되지는 않습니다.',raw};
    if(/offline|no devices|device.*not found|Failed to fetch|NetworkError|연결.*(?:끊|없)|오프라인/i.test(raw))return {reason:'ADB 또는 웹 서버 연결을 확인하지 못해 용량 조회를 완료하지 못했습니다.',access:'ADB에 연결되고 디버깅이 승인된 기기가 필요합니다. 권한을 추가하는 것으로 연결 오류가 해결되지는 않습니다.',raw};
    if(/Permission|SecurityException|denied|권한/i.test(raw))return {reason:'현재 ADB 실행 권한 또는 기기의 보안 정책 때문에 전체 용량을 읽지 못했습니다.',access:'오류가 발생한 용량 조회 서비스나 파일에 대한 읽기 접근이 필요합니다. USB 디버깅 승인만으로 앱 내부 데이터 접근까지 보장되지는 않습니다.',raw};
    return {reason:'기기가 전체 앱 용량을 제공하지 않아 확인하지 못했습니다.',access:'대상 앱이 선택한 사용자에 설치되어 있고 해당 조회 방식이 기기에서 지원·허용되어야 합니다. 자세한 원문은 아래에서 확인할 수 있습니다.',raw};
  }
  function renderStorageIssues(failures,request={}){
    if(!failures.length)return;
    const list=document.createElement('ul');list.className='app-storage-issues';
    for(const failure of failures.slice(0,10)){
      const info=storageIssueInfo(failure),item=document.createElement('li'),name=document.createElement('strong'),reason=document.createElement('p'),access=document.createElement('p');
      name.textContent=failure.package||'용량 조회';reason.textContent=info.reason;access.className='app-storage-required';access.textContent='필요한 접근: '+info.access;item.append(name,reason,access);
      if(failure.fallback?.reasonKo){const alternative=document.createElement('p');alternative.textContent='대체 조회: '+failure.fallback.reasonKo;item.append(alternative);}
      if(failure.fallback?.requiredAccessKo&&failure.fallback.requiredAccessKo!==failure.requiredAccessKo){const access=document.createElement('p');access.textContent='APK 조회에 필요한 접근: '+failure.fallback.requiredAccessKo;item.append(access);}
      const code=failure.code||'',canChoose=!!request.ctx&&/^\d{1,5}$/.test(String(request.userId))&&request.packages?.includes(failure.package)&&!['device-offline','device-unauthorized','user-not-found','user-locked','package-not-installed','package-version-unavailable'].includes(code)&&!/offline|no devices|device.*not found|unauthorized|Failed to fetch|NetworkError|연결.*(?:끊|없)|오프라인/i.test(info.raw);
      if(canChoose){
        const actions=document.createElement('div'),button=document.createElement('button'),access=document.createElement('span'),description=document.createElement('p');actions.className='app-storage-actions';button.type='button';button.className='desk-state-action';button.textContent='APK 파일 크기만 조회';button.title=`${failure.package} · 사용자 ${request.userId} · 설치된 기본·분할 APK의 파일 크기만 읽습니다. 전체 통계·앱 데이터·캐시는 조회하지 않습니다.`;
        access.className='app-storage-access';access.textContent='현재 ADB 파일 읽기';access.title='기존 ADB shell 권한으로 설치 APK 경로와 파일 정보를 읽습니다. 권한 부여·루팅·앱 실행은 하지 않으며, 파일 접근 자체가 막힌 기기에서는 제한될 수 있습니다.';
        description.textContent='기본·분할 APK 합계만 확인 · 데이터·캐시·최적화 파일 제외';
        button.addEventListener('click',()=>{if(!currentScope(request.ctx))return;if(!currentRequest(request.ctx))return changedStorageSelection(request.ctx);return readStorage({ctx:request.ctx,userId:request.userId,packages:[failure.package],readMode:'apk-only',button});});actions.append(button,access);item.append(actions,description);
      }
      const rawText=[info.raw,failure.fallback?.rawError?'APK 대체 조회 오류:\n'+failure.fallback.rawError:''].filter(Boolean).join('\n\n');
      if(rawText){const details=document.createElement('details'),summary=document.createElement('summary'),raw=document.createElement('pre');summary.textContent='기술 오류 원문';raw.textContent=rawText;details.append(summary,raw);item.append(details);}
      list.append(item);
    }
    $('apps-inventory-note').append(list);
  }
  function storageTargets(){const checked=Array.isArray(window.AppBatch?.selectedPackages)?window.AppBatch.selectedPackages:[...document.querySelectorAll('input[data-app-batch-check]:checked')].map(input=>input.value),visible=[...document.querySelectorAll('#apps-list [data-app-row]')].map(row=>row.dataset.appRow);return {packages:[...new Set(checked.length?checked:visible)].slice(0,10),selected:checked.length};}
  const requestContext=()=>({deviceId:state.getDevice?.(),user:state.user,epoch:state.labelEpoch});
  const selectionKey=packages=>JSON.stringify([...packages].sort());
  const currentScope=ctx=>ctx.deviceId===state.getDevice?.()&&ctx.user===state.user&&ctx.epoch===state.labelEpoch;
  const currentRequest=ctx=>currentScope(ctx)&&(ctx.storageSelection===undefined||ctx.storageSelection===selectionKey(storageTargets().packages));
  function changedStorageSelection(ctx){return readState('info','조회 대상이 변경되었습니다','현재 앱 목록이나 체크한 앱이 달라 이전 요청을 다시 보내지 않았습니다. 대상을 확인한 뒤 용량 조회 버튼을 누르세요.',null,{deviceId:ctx.deviceId,user:ctx.user,epoch:ctx.epoch});}
  async function labelsApi(route,body,ctx=requestContext()){if(!currentRequest(ctx))throw new Error('기기·사용자 선택이 변경됐습니다.');const token=await fetch('/api/session').then(response=>response.json());if(!currentRequest(ctx))throw new Error('기기·사용자 선택이 변경되어 요청을 중단했습니다.');const response=await fetch('/api/ops/'+route,{method:'POST',headers:{'Content-Type':'application/json','X-ADB-Desk-Token':token.csrfToken},body:JSON.stringify(body)}),data=await response.json();if(!response.ok)throw new Error(data.error||'앱 정보 요청에 실패했습니다.');return data;}

  async function readLabels(){
    if(state.labelPending)return;const deviceId=state.getDevice?.();if(!deviceId)return;
    const checked=Array.isArray(window.AppBatch?.selectedPackages)?window.AppBatch.selectedPackages:[...document.querySelectorAll('input[data-app-batch-check]:checked')].map(input=>input.value),visible=[...document.querySelectorAll('#apps-list [data-app-row]')].map(row=>row.dataset.appRow),packages=[...new Set(checked.length?checked:visible)].slice(0,25),requestedScope=state.user,user=state.user==='current'?String(state.users.find(row=>row.current)?.id??'current'):state.user,epoch=state.labelEpoch;
    if(!packages.length){$('apps-inventory-note').textContent='먼저 앱 목록에서 대상을 선택하세요.';return;}const finish=window.DeskFeedback?.start?.('앱 이름·아이콘 조회 중',{button:$('apps-labels-read')})||(()=>{});state.labelPending=true;$('apps-labels-read').disabled=true;$('apps-inventory-note').textContent=`${packages.length}개 앱의 실제 이름·아이콘 확인 준비 · ${checked.length>25?'선택한 앱 중 앞 25개만 확인합니다.':'기본 APK를 PC로 읽으며 폰 설정은 바꾸지 않습니다.'}`;
    try{
      const job=await labelsApi('app-labels',{deviceId,userId:user,packages});if(epoch!==state.labelEpoch)return;state.labelJob=job.id;$('apps-labels-stop').hidden=false;window.DeviceOps?.refreshJobs?.();
      while(epoch===state.labelEpoch){const response=await fetch('/api/ops/app-labels-result?'+new URLSearchParams({deviceId,id:job.id})),result=await response.json();if(!response.ok)throw new Error(result.error||'이름 확인 결과를 읽지 못했습니다.');if(epoch!==state.labelEpoch)return;
        $('apps-inventory-note').textContent=result.state==='running'?`앱 이름·아이콘 확인 ${result.progress==null?'진행 중':result.progress+'%'} · 확인 ${result.entries?.length||0}개 · 미확인 ${result.failures?.length||0}개`:result.message;
        if(result.state!=='running'){
          const ctx={deviceId,user:requestedScope,epoch},entries=result.entries||[],failures=result.failures||[];
          if(currentRequest(ctx)&&entries.length)await state.onEnriched?.(result);if(!currentRequest(ctx))return;
          if(result.state==='cancelled')readState('info','앱 정보 확인을 중지했습니다',`${entries.length}개 확인됨. ${result.message||''}`,readLabels,ctx);
          else if(result.state==='error')feedback('앱 이름·아이콘을 확인하지 못했습니다',new Error([result.message,failureSummary(failures)].filter(Boolean).join(' ')),readLabels,ctx);
          else if(failures.length)readState('warning','일부 앱 정보만 확인했습니다',`${entries.length}개 확인 · ${failures.length}개 미확인. ${failureSummary(failures)}`,readLabels,ctx);
          else if(!entries.length)readState('empty','표시할 앱 정보가 없습니다','조회는 끝났지만 이름·아이콘 결과가 없습니다. 대상 앱을 확인한 뒤 다시 조회하세요.',readLabels,ctx);
          else $('apps-inventory-note').textContent=result.message||`${entries.length}개 앱 정보 확인 완료`;
          break;
        }await new Promise(resolve=>setTimeout(resolve,750));
      }
    }catch(error){if(epoch===state.labelEpoch)feedback('앱 이름·아이콘을 읽지 못했습니다',error,state.labelJob?()=>window.DeviceOps?.refreshJobs?.():readLabels,{deviceId,user:requestedScope,epoch},state.labelJob?'작업 상태 확인':'다시 조회');}finally{finish();if(epoch===state.labelEpoch){state.labelPending=false;state.labelJob=null;$('apps-labels-read').disabled=false;$('apps-labels-stop').hidden=true;window.DeviceOps?.refreshJobs?.();}}
  }
  async function readUsage(){
    const button=$('apps-usage-read'),deviceId=state.getDevice?.(),selected=state.user,userId=selected==='current'?String(state.users.find(row=>row.current)?.id??'current'):selected;if(!deviceId||button.disabled)return;const epoch=state.labelEpoch;button.disabled=true;const finish=window.DeskFeedback?.start?.('앱 최근 사용 기록 조회',{button});$('apps-inventory-note').textContent='선택한 사용자·프로필의 사용 기록을 읽고 있습니다…';
    try{const result=await labelsApi('app-usage',{deviceId,userId}),ctx={deviceId,user:selected,epoch};if(!currentRequest(ctx))return;const entries=result.entries||[];if(entries.length)await state.onEnriched?.(result);if(!currentRequest(ctx))return;
      const observed=entries.some(row=>Number.isFinite(row.lastUsedTimestamp)&&row.lastUsedTimestamp>0),unavailable=result.available===false||/권한|거부|denied|permission|제공하지|실패|지원하지|시간.*초과|사용 통계 구간이 없습니다/i.test(result.note||'');
      if(unavailable)feedback('최근 사용 기록을 확인하지 못했습니다',new Error(result.note||'이 기기가 사용 통계를 제공하지 않았습니다.'),readUsage,ctx);
      else if(!observed)readState('empty',entries.length?'표시할 최근 사용 기록이 없습니다':'조회할 설치 앱이 없습니다',result.note||'최근 사용 기록이 없다고 한 번도 사용하지 않은 앱으로 단정하지 않습니다.',readUsage,ctx);
      else $('apps-inventory-note').textContent=`${result.checkedAt} · ${result.note}`;}catch(error){if(epoch===state.labelEpoch)feedback('사용 기록을 읽지 못했습니다',error,readUsage,{deviceId,user:selected,epoch});}finally{if(epoch===state.labelEpoch)button.disabled=false;finish?.();}
  }
  function setStorageBusy(busy,button){for(const item of [$('apps-storage-read'),$('apps-apk-size-read'),button])if(item)item.disabled=busy;}
  async function readStorage(options={}){
    const mainButton=$('apps-storage-read'),button=options.button||(options.readMode==='apk-only'?$('apps-apk-size-read'):mainButton),ctx=options.ctx||requestContext();if(!ctx.deviceId||mainButton.disabled||!currentRequest(ctx))return;const targets=storageTargets(),packages=options.packages||targets.packages,selected=targets.selected,userId=options.userId??(state.user==='current'?String(state.users.find(row=>row.current)?.id??'current'):state.user),readMode=options.readMode==='apk-only'?'apk-only':'storage-stats';if(!packages.length){$('apps-inventory-note').textContent='앱을 목록에서 선택하세요.';return;}
    if(ctx.storageSelection===undefined)ctx.storageSelection=selectionKey(targets.packages);
    const retry=()=>{if(!currentScope(ctx))return;if(!currentRequest(ctx))return changedStorageSelection(ctx);return readStorage({ctx,userId,packages,readMode});};
    setStorageBusy(true,button);const finish=window.DeskFeedback?.start?.(readMode==='apk-only'?'APK 파일 크기 조회':'선택 앱 용량 조회',{button});const limitNote=selected>10?' 선택 '+selected+'개 중 앞 10개만 조회합니다.':'';$('apps-inventory-note').textContent=readMode==='apk-only'?`${packages.length}개 앱 · 사용자 ${userId} · 기본·분할 APK 크기만 읽는 중…${limitNote}`:`${packages.length}개 앱의 사용자별 용량 조회 중…${limitNote}`;
    try{const result=await labelsApi('app-storage',{deviceId:ctx.deviceId,userId,packages,...(readMode==='apk-only'?{readMode}:{})},ctx);if(!currentRequest(ctx))return;const resultUser=String(result.userId??userId);if(/^\d+$/.test(String(userId))&&resultUser!==String(userId))throw new Error('요청한 사용자와 용량 응답의 사용자가 달라 결과를 표시하지 않았습니다.');const entries=result.entries||[],failures=result.failures||[];if(entries.length||failures.length)await state.onEnriched?.(result);if(!currentRequest(ctx))return;
      const apkOnly=entries.filter(row=>row.storageStatus==='apk-only'||row.sizeKind==='apk-files').length,full=entries.length-apkOnly,unavailable=failures.filter(f=>!entries.some(row=>row.package===f.package)).length;
      const counts=`전체 용량 ${full}개 · APK 크기만 ${apkOnly}개 · 조회 불가 ${unavailable}개.`;
      if(!entries.length&&failures.length)readState('error','앱 용량을 확인하지 못했습니다',counts+' 아래에서 앱별 이유와 필요한 접근을 확인하세요. 읽지 못한 크기는 0으로 표시하지 않습니다.',retry,ctx);
      else if(failures.length||apkOnly)readState(readMode==='apk-only'&&!failures.length?'success':'warning',readMode==='apk-only'&&!failures.length?'APK 파일 크기를 확인했습니다':'앱 용량을 일부 범위만 확인했습니다',counts+' APK 합계에는 앱 데이터·캐시·최적화 파일이 포함되지 않습니다. 전체 사용량과 구분해 표시합니다.',retry,ctx);
      else if(!entries.length)readState('empty','표시할 앱 용량 결과가 없습니다','크기가 0이라는 뜻은 아닙니다. 대상 앱과 사용자·프로필을 확인하고 다시 조회하세요.',retry,ctx);
      else $('apps-inventory-note').textContent=new Date(result.checkedAt).toLocaleTimeString('ko-KR',{hour12:false})+' · '+result.note;
      renderStorageIssues(failures,{ctx,userId:resultUser,packages});$('apps-inventory-note').title=failures.map(row=>storageIssueInfo(row).reason).join('\n');}catch(error){if(currentRequest(ctx)){const issue=storageIssueInfo({error:error.message});readState(/offline|연결을 확인/.test(issue.reason)?'offline':'error','앱 용량을 읽지 못했습니다',issue.reason,retry,ctx);renderStorageIssues(packages.map(pkg=>({package:pkg,error:error.message})),{ctx,userId,packages});}}finally{if(currentScope(ctx))setStorageBusy(false,button);finish?.();}
  }
  function setContext(data={}) {
    state.users=Array.isArray(data.users)?data.users:[];const select=$('apps-user');if(select){const selected=state.user;select.replaceChildren(option('current',data.currentUserId==null?'현재 사용자':`현재 사용자 (${data.currentUserId})`));for(const row of state.users)select.append(option(String(row.id),`${row.name} · ${row.managed?'업무 프로필':row.guest?'게스트':'사용자'} ${row.id}${row.running?'':' · 중지됨'}`));if([...select.options].some(row=>row.value===selected))select.value=selected;}
    const note=$('apps-inventory-note');if(note){const sizes=data.apps?.some(row=>row.sizeCached);note.textContent=`사용자 ${data.userId??state.user} · 이름·버전·설명 검색${sizes?' · 용량: Android 캐시 통계':''}${data.usageCheckedAt?' · 사용 기록 조회 '+new Date(data.usageCheckedAt).toLocaleTimeString('ko-KR',{hour12:false}):''}${data.errors?.length?' · 미조회 '+data.errors.length+'건 (마우스를 올려 확인)':''}`;note.title=[...(data.errors||[]),...(data.sourceNotes||[]),...(data.usageNote?[data.usageNote]:[])].join('\n');}
  }
  function searchText(row){return [row.package,row.label,row.versionName,row.versionCode,row.uid,row.knowledge?.title,row.knowledge?.summary,row.knowledge?.function,row.knowledge?.removalImpact,row.knowledge?.alternative,row.knowledge?.categoryLabel,row.knowledge?.removalLabel,...(row.knowledge?.labels||[])].filter(value=>value!=null).join(' ').toLocaleLowerCase('ko-KR');}
  function matches(row,{query='',scope='all',...filters}={}) {
    const f={...state,...filters},knowledge=row.knowledge;
    if(scope==='disabled'?row.enabled!==false:scope==='enabled'?row.enabled!==true:scope!=='all'&&row.kind!==scope)return false;
    if(query&&!searchText(row).includes(String(query).trim().toLocaleLowerCase('ko-KR')))return false;
    if(f.category!=='all'&&(f.category==='none'?knowledge?.found:knowledge?.category!==f.category))return false;
    if(f.removal!=='all'&&(f.removal==='none'?knowledge?.removal:knowledge?.removal!==f.removal))return false;
    if(f.translation==='any-reviewed'&&!['reviewed-source','reviewed-community'].includes(knowledge?.functionalExplanationStatus))return false;else if(!['all','any-reviewed'].includes(f.translation)&&(knowledge?.translationStatus||'unavailable')!==f.translation)return false;
    if(f.feature==='launchable'&&row.launchable!==true||f.feature==='no-launcher'&&row.launchable!==false||f.feature==='split'&&!(row.splitCount>0)||f.feature==='single'&&row.splitCount!==0||f.feature==='suspended'&&row.suspended!==true||f.feature==='unknown'&&row.launchable!=null)return false;
    if(f.feature==='backup-allowed'&&row.allowBackup!==true||f.feature==='backup-denied'&&row.allowBackup!==false||f.feature==='backup-unknown'&&row.allowBackup!=null)return false;
    const tri=(value,filter)=>filter==='all'||filter==='unknown'?filter==='all'||value==null:value===(filter==='yes');
    if(!tri(row.launchable,f.launch)||!tri(row.splitCount==null?null:row.splitCount>0,f.split)||!tri(row.allowBackup,f.backup))return false;
    return true;
  }
  function sortValue(row,key){return key==='name'?row.label||row.package:key==='version'?row.versionCode:key==='updated'?row.lastUpdateTime:key==='used'?row.lastUsedTimestamp:key==='installed'?row.firstInstallTime:key==='storage'?row.storageBytes:key==='code'?row.appBytes:key==='apk'?row.apkBytes:key==='data'?row.dataBytes:key==='cache'?row.cacheBytes:key==='uid'?row.uid:null;}
  function filter(rows,options={}) {
    const key=options.sort||state.sort,descending=options.descending??state.descending;
    return rows.filter(row=>matches(row,options)).sort((a,b)=>{const left=sortValue(a,key),right=sortValue(b,key);if(left==null&&right!=null)return 1;if(left!=null&&right==null)return -1;const order=typeof left==='number'&&typeof right==='number'?left-right:String(left??'').localeCompare(String(right??''),'ko',{numeric:true,sensitivity:'base'});return order*(descending?-1:1)||a.package.localeCompare(b.package);});
  }
  function size(value){if(!Number.isFinite(value))return '확인 불가';if(value>=1e9)return (value/1e9).toFixed(2)+' GB';if(value>=1e6)return (value/1e6).toFixed(1)+' MB';if(value>=1e3)return (value/1e3).toFixed(1)+' KB';return value+' B';}
  function describe(row){return [`버전 ${row.versionName??'미확인'}${row.versionCode!=null?' ('+row.versionCode+')':''}`,row.lastUpdateTime?`업데이트 ${row.lastUpdateTime}`:null,Number.isFinite(row.lastUsedTimestamp)?`최근 사용 ${new Date(row.lastUsedTimestamp).toLocaleString('ko-KR',{hour12:false})}`:row.usageCheckedAt?'최근 사용 미확인':null,row.storageBytes!=null?`저장소 ${size(row.storageBytes)}${row.sizeCached?' · 과거 통계 참고값'+(row.sizeCacheUpdatedAt?' · 작성 '+new Date(row.sizeCacheUpdatedAt).toLocaleString('ko-KR',{hour12:false}):' · 작성 시각 미확인'):row.sizeCheckedAt?' · 조회 '+new Date(row.sizeCheckedAt).toLocaleString('ko-KR',{hour12:false}):''}`:null,row.appBytes!=null?`앱 코드 ${size(row.appBytes)} · 데이터 ${size(row.dataBytes)} · 캐시 ${size(row.cacheBytes)}${row.optimizedBytes!=null?' · 최적화 '+size(row.optimizedBytes):''}`:null,row.storageStatus==='apk-only'&&Number.isFinite(row.apkBytes)?`APK 파일 합계 ${size(row.apkBytes)} · ${row.apkFileCount??'확인된'}개 파일 · 앱 전체 용량 아님 · 데이터·캐시 미확인`:null,row.storageStatus==='unavailable'?'앱 용량 미확인 · 읽기 제한을 0바이트로 표시하지 않음':null,row.sizeIssue?'용량 조회 제한: '+storageIssueInfo(row.sizeIssue).reason:null,row.sizeIssue?.requiredAccessKo?'필요한 접근: '+row.sizeIssue.requiredAccessKo:null,row.sizeCached?'통계 작성 후 앱 업데이트·재설치로 달라질 수 있음':null,row.allowBackup!=null?`백업 ${row.allowBackup?'허용':'불허'} 선언 · 실제 데이터 백업과 다름`:null,row.splitCount!=null?(row.splitCount?`분할 ${row.splitCount}개`:'단일 APK'):null].filter(Boolean);}
  function reset(){state.labelEpoch++;state.labelPending=false;state.labelJob=null;state.user='current';state.users=[];if($('apps-usage-read'))$('apps-usage-read').disabled=false;setStorageBusy(false);if($('apps-labels-read'))$('apps-labels-read').disabled=false;if($('apps-labels-stop'))$('apps-labels-stop').hidden=true;if($('apps-user'))$('apps-user').replaceChildren(option('current','현재 사용자'));if($('apps-inventory-note'))$('apps-inventory-note').textContent='사용자·프로필 정보를 읽기 전입니다.';}
  function resetFilters(){for(const [id,key]of fields){if(key==='sort')continue;state[key]='all';if($(id))$(id).value='all';}state.onChange?.();}
  window.AppInventory={init,setContext,filter,matches,searchText,describe,size,reset,resetFilters,get hasFilters(){return fields.some(([,key])=>key!=='sort'&&state[key]!=='all');},get user(){return state.user;},get currentUser(){return state.users.find(row=>row.current)?.id??null;}};
})();
