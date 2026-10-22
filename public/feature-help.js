(() => {
  'use strict';
  const targets=['package','user','path','namespace','key','pid','service','buffer','method','direction','mode','query','tool','permission','op','component','imeId'];
  const targetLabels={package:'앱',user:'사용자',path:'파일·폴더',namespace:'설정 영역',key:'설정 키',pid:'프로세스 PID',service:'서비스',buffer:'로그 버퍼',method:'조회 방식',direction:'연결 방향',mode:'작업 방식',query:'조회 대상',tool:'기기 도구',permission:'권한',op:'기능별 접근',component:'앱 구성요소',imeId:'입력기'};
  const profileActions=new Set(['users-list','users-detail','user-state','user-create','profile-create','user-switch','user-start','user-stop','user-remove']);
  const states={available:{label:'조회된 실행 조건',className:'is-available'},unsupported:{label:'지원 안 됨',className:'is-unsupported'},restricted:{label:'권한·정책 제한',className:'is-restricted'},unverified:{label:'지원 여부 미확인',className:'is-unverified'}};
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const prose=value=>Array.isArray(value)?value.filter(item=>typeof item==='string').join(' '):typeof value==='string'?value:'';
  const ko=(value,fallback)=>typeof value==='string'&&/[가-힣]/.test(value)?value:fallback;
  const host=()=>document.getElementById('feature-help');
  let definition=null,device=null,selected={},snapshot=null,snapshotKey='',snapshotTarget='',loading=false,failure=null,timer=null,controller=null,epoch=0,readingKey='',resultNote='';
  function normalized(values){
    const next={};for(const key of targets){const value=values?.[key];if((typeof value==='string'||typeof value==='number')&&String(value).trim()!=='')next[key]=String(value).trim();}return next;
  }
  function requestKey(){return JSON.stringify([device,definition?.id,targets.map(key=>selected[key]??'')]);}
  function targetText(values=selected){const items=targets.filter(key=>Object.hasOwn(values,key)).map(key=>(targetLabels[key]||key)+': '+values[key]);return items.join(' · ')||'기기 전체 · 대상 선택 전';}
  function stamp(value){const date=new Date(value);return value&&Number.isFinite(date.valueOf())?date.toLocaleString('ko-KR',{hour12:false}):'조회 시각 미확인';}
  const technicalFact = fact => /^(작업 범위|필요한 접근|연결 방식|기기 모델|Android API|빌드 종류|ADB shell 권한|디버그 허용 속성|ADB 보안 속성)$/.test(fact.label||'') || /fingerprint|빌드 번호|권한명|검증 출처/i.test(fact.label||'');
  function shortReason(value,fallback='현재 조건을 확인한 뒤 다시 조회해 주세요.'){
    const text=ko(value,fallback).trim();
    if(/android\.permission\.|WRITE_DEVICE_CONFIG|SecurityException|java\.|UID \d|ro\.debuggable|ro\.secure|fingerprint|0x[0-9a-f]+/i.test(text))return '현재 기기의 권한 또는 지원 조건이 충족되지 않았습니다. 상세 정보에서 필요한 조건을 확인해 주세요.';
    return text.match(/^.*?[.!?](?:\s|$)/)?.[0].trim()||text;
  }
  function essentialWarning(value){
    if(typeof value!=='string'||!/[가-힣]/.test(value))return '';
    // Keep value interpretation and concrete side effects visible. Observation/evidence
    // disclaimers remain available in the read-only details without another main badge.
    if(/폴더 항목 자체의 크기/.test(value))return '표시된 크기는 폴더 항목 자체의 크기이며 하위 파일의 합계가 아닙니다.';
    if(/^연결 파일입니다/.test(value))return '연결 파일입니다. 실행 전에 연결 대상과 링크 처리 방식을 확인해 주세요.';
    if(/공유\s*UID|같은\s*UID/.test(value))return '같은 사용자 번호를 공유하는 앱이 있어 다른 앱에도 영향을 줄 수 있습니다.';
    if(/구성요소 목록을 다시 읽고 선택/.test(value))return '구성요소 목록을 다시 읽고 대상을 선택해 주세요.';
    if(/^쓰기·실제 효과 제한:/.test(value))return shortReason(value.replace(/^쓰기·실제 효과 제한:\s*/,''));
    if(/다른 기기의.*영향|삭제(?:되|됩)|복구(?:할 수 없|되지)|하위 파일|(?:일부|부분).*(?:범위|목록|합계|포함)|(?:범위|목록).*(?:일부|부분|제외)|(?:합계|전체 용량).*(?:아닙|아님)/.test(value))return shortReason(value);
    return '';
  }
  const sameReason=(first,second)=>Boolean(first&&second&&first.replace(/[\s.·]/g,'')===second.replace(/[\s.·]/g,''));
  function detailSections(guide,data,error){
    const sections=[];
    for(const [label,value]of [['기능',guide.purpose||definition.description],['사용법',guide.usage],['영향',guide.effect],['결과 읽는 법',guide.interpretation],['필요 조건',guide.requirements]]){const text=prose(value);if(text)sections.push({label,text});}
    if(data){
      if(data.status?.reasonKo)sections.push({label:'판정 근거',text:ko(data.status.reasonKo,'응답만으로 필요한 조건을 확인하지 못했습니다.')});
      for(const fact of data.facts.filter(technicalFact))sections.push({label:fact.label,text:String(fact.value??'미확인')});
      for(const warning of data.warnings||[])sections.push({label:'추가 안내',text:ko(warning,'일부 조건을 확인하지 못했습니다.')});
      sections.push({label:'조회 시각',text:stamp(data.updatedAt)});
    }
    for(const item of [error,...(data?.errors||[])].filter(Boolean)){
      sections.push({label:'확인하지 못한 항목',text:ko(item.reasonKo||item.messageKo,'기기 응답 또는 조회 권한 때문에 확인하지 못했습니다.')});
      if(item.requiredAccessKo)sections.push({label:'필요한 접근',text:ko(item.requiredAccessKo,'응답에서 필요한 권한을 구체적으로 확인하지 못했습니다.')});
      if(item.rawError)sections.push({label:'기술 오류 원문',text:String(item.rawError)});
    }
    return sections;
  }
  function fallbackSummary(data,options){
    const state=options.loading?'loading':options.error?'error':data?.support?.state==='unsupported'?'unsupported':options.canAct===false?'restricted':'available';
    const label=options.loading?'조회 중':options.error?'조회 실패':state==='unsupported'?'미지원':options.canAct?'조회 가능':options.canRead?'조회만 가능':'현재 조건 확인 필요';
    return `<div class="fh-status is-${state}"><strong>${esc(options.mode==='write'&&options.canAct?'변경 요청 가능':label)}</strong>${options.reason?`<span>${esc(options.reason)}</span>`:''}</div>${options.effectUntested?'<p class="fh-effect">실제 효과 미확인</p>':''}`;
  }
  function render(){
    const root=host();if(!root)return;
    const guide=definition?.help;if(!guide){root.hidden=true;root.innerHTML='';root.onclick=null;return;}
    const current=Boolean(snapshot&&snapshotKey===requestKey()&&!loading&&!failure),data=current?snapshot:null;
    const guard=executionStatus(definition.id),support=data?.status;
    const reason=failure?shortReason(failure.reasonKo,'연결 또는 조회 권한 때문에 현재 상태를 확인하지 못했습니다.'):loading?'':support?.state==='available'?'':shortReason(support?.reasonKo,'현재 조건을 확인하지 못했습니다. 다시 조회해 주세요.');
    const options={mode:definition.write?'write':'read',canAct:guard?.allowed===true,canRead:data?.compatibility?.canRead===true,loading,error:Boolean(failure),reason,effectUntested:definition.write===true,title:definition.title||'기능 상세 정보',sections:detailSections(guide,data,failure)};
    const compatibility=data?.compatibility||{support:{state:support?.state==='available'?'supported':support?.state==='unsupported'?'unsupported':'unknown'},access:{state:support?.state==='restricted'?'denied':'unknown'},reasonKo:support?.reasonKo||failure?.reasonKo||''};
    const summary=window.CompatibilityUI?.summary?.(compatibility,options)||fallbackSummary(compatibility,options);
    const facts=(data?.facts||[]).filter(fact=>!technicalFact(fact));
    const errorReasons=(data?.errors||[]).map(item=>shortReason(item.reasonKo||item.messageKo,'기기 응답 또는 조회 권한 때문에 일부 상태를 확인하지 못했습니다.'));
    const warnings=[...new Set((data?.warnings||[]).map(essentialWarning).filter(Boolean))].filter(note=>![reason,...errorReasons].some(other=>sameReason(note,other)));
    const firstError=errorReasons[0],errorIsRepeated=firstError&&[reason,...warnings].some(other=>sameReason(firstError,other));
    root.hidden=false;root.className='feature-help';root.setAttribute?.('aria-busy',String(loading));
    root.innerHTML=`${!document.getElementById('workbench-dialog-desc')?`<p class="fh-purpose">${esc(prose(guide.purpose)||definition.description||'')}</p>`:''}
      <p class="fh-target"><strong>현재 선택</strong> ${esc(targetText())}</p>
      <div class="fh-heading"><strong>현재 상태</strong><button type="button" data-fh-refresh ${loading?'disabled':''}>${loading?'조회 중…':failure?'다시 조회':'현재 상태 조회'}</button></div>
      ${summary}
      ${facts.length?`<dl class="fh-facts">${facts.map(fact=>`<div><dt>${esc(fact.label||'항목')}</dt><dd>${esc(fact.value===null||fact.value===undefined||fact.value===''?'미확인':fact.value)}</dd></div>`).join('')}</dl>`:current?'<p class="fh-muted">표시할 현재 상태 값이 없습니다.</p>':''}
      ${warnings.map(note=>`<p class="fh-warning">${esc(note)}</p>`).join('')}
      ${data?.errors?.length?`<div class="fh-errors" role="status"><strong>일부 상태 조회 실패 · ${data.errors.length}건</strong>${firstError&&!errorIsRepeated?`<p>${esc(firstError)}</p>`:''}<button type="button" data-fh-refresh>상태 다시 조회</button></div>`:''}
      ${prose(guide.usage)?`<p class="fh-usage"><strong>사용법</strong> ${esc(prose(guide.usage))}</p>`:''}
      ${guide.executionLabel?`<span class="fh-execution-note${guide.observationOnly===true?' is-observation':''}">${esc(guide.executionLabel)}</span>`:''}
      ${resultNote?`<p class="fh-result-note" role="note">${esc(resultNote)}</p>`:''}`;
    root.onclick=event=>{if(event.target?.closest?.('[data-fh-refresh]')){void refresh();}};
    const run=document.getElementById('workbench-run');
    if(window.Workbench?.syncRunAvailability)window.Workbench.syncRunAvailability();
    else if(run?.dataset&&guard){
      if(!guard.allowed){if(!run.disabled)run.dataset.compatibilityBlocked='true';run.disabled=true;run.title=guard.reasonKo;}
      else if(run.dataset.compatibilityBlocked==='true'){delete run.dataset.compatibilityBlocked;run.disabled=false;run.title='';}
    }
  }
  function cancel(){epoch++;if(timer!==null){clearTimeout(timer);timer=null;}controller?.abort();controller=null;readingKey='';}
  async function refresh(){
    if(!definition||!device)return;
    const key=requestKey();if(controller&&readingKey===key)return;
    cancel();const ticket=epoch,expectedDevice=device,expectedAction=definition.id,expectedTarget=targetText();controller=new AbortController();const signal=controller.signal;readingKey=key;loading=true;failure=null;render();
    const query=new URLSearchParams({id:device,action:definition.id});for(const name of targets)if(Object.hasOwn(selected,name))query.set(name,selected[name]);
    try{
      const response=await fetch('/api/device/feature-help?'+query.toString(),{method:'GET',cache:'no-store',signal});const data=await response.json();if(ticket!==epoch)return;
      if(!response.ok)throw Object.assign(new Error(data.reasonKo||data.error||''),{data});
      if(!data||data.deviceId!==expectedDevice||data.actionId!==expectedAction||!states[data.status?.state]||!Array.isArray(data.facts))throw new Error('현재 기기·기능의 상태 응답을 확인하지 못했습니다. 다시 조회하세요.');
      snapshot={...data,warnings:Array.isArray(data.warnings)?data.warnings:[],errors:Array.isArray(data.errors)?data.errors:[]};snapshotKey=key;snapshotTarget=expectedTarget;
    }catch(error){
      if(ticket!==epoch||error.name==='AbortError')return;
      const raw=error.data?.rawError||error.data?.error||error.message;failure={reasonKo:ko(error.data?.reasonKo||error.data?.error||error.message,'연결 또는 조회 권한 때문에 현재 상태를 확인하지 못했습니다. 연결을 확인하고 다시 조회하세요.'),requiredAccessKo:error.data?.requiredAccessKo||'',rawError:typeof raw==='string'&&!/[가-힣]/.test(raw)?raw:''};
    }finally{if(ticket===epoch){loading=false;controller=null;readingKey='';render();}}
  }
  function clear(){window.CompatibilityUI?.closeDetails?.();cancel();definition=null;device=null;selected={};snapshot=null;snapshotKey='';snapshotTarget='';loading=false;failure=null;resultNote='';render();}
  function open(def,nextDevice,initialValues={}){clear();if(!def?.help||def.help.renderer==='user-profile'||profileActions.has(def.id)||!nextDevice)return Promise.resolve();definition=def;device=String(nextDevice);selected=normalized(initialValues);render();return refresh();}
  function selectionChanged(values){
    if(!definition)return;const previous=requestKey();selected=normalized(values);if(requestKey()===previous)return;window.CompatibilityUI?.closeDetails?.();cancel();snapshot=null;snapshotKey='';snapshotTarget='';loading=true;failure=null;resultNote='';render();timer=setTimeout(()=>{timer=null;void refresh();},300);
  }
  function result(actionId,output,error=false){if(!definition||definition.id!==actionId)return;resultNote=error?'아래 실행 결과에 오류가 있습니다. 위 상태는 별도 조회값이므로 실행 성공을 뜻하지 않습니다.':prose(definition.help.interpretation)?'결과 읽는 법: '+prose(definition.help.interpretation):'실행 결과와 위 상태 조회는 시점이 다를 수 있습니다. 필요한 경우 현재 상태를 다시 조회하세요.';render();}
  function executionStatus(actionId){
    if(!definition||definition.id!==actionId)return null;
    if(loading)return {allowed:false,state:'loading',reasonKo:'현재 대상의 지원 조건을 조회하고 있습니다.'};
    if(failure||!snapshot||snapshotKey!==requestKey())return {allowed:false,state:failure?'error':'pending',reasonKo:failure?shortReason(failure.reasonKo):'현재 대상의 지원 조건을 먼저 조회해 주세요.'};
    return {state:'ready',allowed:snapshot.executionAllowed!==false&&!['unsupported','restricted'].includes(snapshot.status?.state),reasonKo:snapshot.status?.reasonKo||snapshot.compatibility?.reasonKo||'현재 기기의 조건을 다시 조회하세요.'};
  }
  window.FeatureHelp={open,selectionChanged,clear,result,executionStatus,refresh};
})();
