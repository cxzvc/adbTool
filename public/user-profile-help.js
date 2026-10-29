(() => {
  'use strict';
  const guides={
    'users-list':{read:true,purpose:'폰의 사용자·프로필 번호와 현재 화면의 사용자를 확인합니다.',use:'조회하기 → 사용자 번호·유형·현재 사용자 확인. 계정 로그인 목록과는 다릅니다.',effect:'조회만 합니다. 사용자·프로필을 생성하거나 전환하지 않습니다.'},
    'users-detail':{read:true,purpose:'사용자 유형, 부모·자식 프로필 관계와 사용자 서비스의 상세 상태를 읽습니다.',use:'조회하기 → 아래 한글 요약과 서비스 원문 확인. 알 수 없는 항목은 미확인으로 표시합니다.',effect:'조회만 합니다. 앱 계정의 로그인 상태를 관리하지 않습니다.'},
    'user-state':{read:true,purpose:'선택한 사용자·프로필의 시작·중지 및 데이터 잠금 상태를 확인합니다.',use:'목록에서 대상 선택 → 조회하기. 현재 화면의 사용자는 그대로입니다.',effect:'RUNNING_UNLOCKED는 사용자 데이터 접근 가능 상태입니다. 화면 잠금 해제를 뜻하지 않습니다.'},
    'user-create':{read:false,purpose:'앱·데이터 공간을 분리한 일반 사용자를 추가합니다. 앱 계정 추가 기능은 아닙니다.',use:'지원 상태 확인 → 사용자 이름 입력 → 실행. 생성만으로 화면 사용자가 바뀌지는 않습니다.',effect:'폰에 새 사용자 공간을 만듭니다. 다중 사용자 지원과 기기 정책 허용이 필요합니다.'},
    'profile-create':{read:false,purpose:'부모 사용자에 관리 프로필을 만들고 설치된 호환 관리 앱 지정·초기 설정을 이어서 진행합니다.',use:'지원 상태 확인 → 부모·관리 앱 선택 → 이름 입력 → 영향 확인 후 실행. 기존 관리·비공개 프로필도 표시되지만 부모로는 선택할 수 없으며 이유를 함께 표시합니다. 완료 여부는 관리자·실행·관리 앱 초기화 상태를 다시 읽어 확인합니다.',effect:'새 관리 프로필에만 관리 앱을 지정합니다. 기기 정책·프로필 개수 제한을 받으며 기존 프로필을 복제하는 기능은 아닙니다. 폰 확인이 필요한 단계나 중간 실패는 완료와 구분합니다.'},
    'user-switch':{read:false,purpose:'다른 일반 사용자를 화면의 현재 사용자로 전환합니다.',use:'목록에서 다른 일반 사용자 선택 → 실행. 관리·비공개 프로필도 보이지만 전환 불가 이유와 함께 선택이 제한됩니다. 잠금 해제가 필요할 수 있습니다.',effect:'화면의 사용자가 바뀝니다. 관리·비공개 프로필은 독립된 화면 사용자 전환 대상이 아닙니다.'},
    'user-start':{read:false,purpose:'선택한 사용자의 환경을 백그라운드에서 시작합니다.',use:'사용자·프로필 선택 → 실행. 이 기능은 시작 요청 뒤 사용자 데이터 잠금 해제 완료를 최대 120초 기다립니다. 시간 초과만으로 시작 자체가 실패했다고 단정하지 않습니다. 화면 전환은 별도입니다.',effect:'시스템 정책에 따라 사용자 데이터 잠금 해제를 시도할 수 있습니다. 기기·관리자 인증을 우회하거나 잠금 해제 성공을 보장하지 않으며, 일시 중지 모드를 해제하는 명령도 아닙니다.'},
    'user-stop':{read:false,purpose:'선택한 사용자·프로필의 실행 환경과 그 안의 앱을 중지합니다.',use:'현재 사용자가 아닌 대상 선택 → 작업 내용 확인 → 실행. 실행 중인 작업이 중단될 수 있습니다.',effect:'사용자 데이터는 삭제하지 않습니다. 기본 사용자·현재 사용자는 중지할 수 없고 정책이 추가로 제한할 수 있습니다.'},
    'user-remove':{read:false,purpose:'선택한 사용자·프로필과 그 공간에 저장된 앱·데이터를 삭제합니다.',use:'대상 번호·이름을 다시 확인 → 확인 절차 후 실행. 이 화면에서 원상 복원할 수 없습니다.',effect:'데이터가 삭제됩니다. 기본 사용자·현재 사용자는 보호되며 관리·비공개 프로필에는 기기·관리 정책이 적용됩니다.'}
  };
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const host=()=>document.getElementById('user-profile-help');
  const resultHost=()=>document.getElementById('user-profile-result');
  let action=null,device=null,snapshot=null,operationReview=null,values={},loading=false,failure=null,request=0,controller=null;
  const textState=state=>({RUNNING_UNLOCKED:'실행 중 · 사용자 데이터 접근 가능',RUNNING_LOCKED:'실행 중 · 사용자 데이터 잠김',RUNNING_UNLOCKING:'실행 중 · 사용자 데이터 잠금 해제 중',BOOTING:'시작 중',STOPPING:'중지 중',SHUTDOWN:'종료 중',STOPPED:'시작되지 않음','-1':'시작된 사용자 상태 없음 (상태 -1)'})[String(state??'').trim()]||null;
  const confirmedSecureFolder=user=>user?.profile===true&&user.secureFolder===true;
  function typeLabel(user){
    if(confirmedSecureFolder(user))return '삼성 보안 폴더';
    const type=String(user.type||'');
    if(/profile\.MANAGED/i.test(type))return '관리 프로필 · 업무용';
    if(/profile\.PRIVATE/i.test(type))return '비공개 프로필';
    if(user.profile===true)return '프로필';
    if(user.profile===false||/\.full\./i.test(type))return '일반 사용자';
    return '유형 미확인';
  }
  function userState(user){
    const known=textState(user.state);
    if(known)return known;
    if(user.stateLabelKo)return String(user.stateLabelKo);
    if(user.running===true)return '실행 중 · 데이터 잠금 상태 미확인';
    if(user.running===false)return '실행 안 됨';
    return '실행 상태 미확인';
  }
  function stamp(value){
    const date=new Date(value);return Number.isFinite(date.valueOf())?date.toLocaleString('ko-KR',{hour12:false}):'조회 시각 미확인';
  }
  function selectedUser(){
    const id=action==='profile-create'?values.parent:values.userId;
    if(id===undefined||id===null||String(id)==='')return null;
    return snapshot?.users?.find(user=>String(user.id)===String(id))||null;
  }
  function selectionNote(){
    const user=selectedUser();if(!user)return '';
    const notes=[];
    if(confirmedSecureFolder(user))notes.push('보안 폴더는 별도 화면 사용자로 전환하는 대상이 아닙니다. 시작 과정에서 정책에 따른 데이터 잠금 해제를 시도할 수 있으나 보안 폴더·Knox 인증을 우회하거나 잠금 해제 성공을 보장하지 않습니다.');
    else if(user.profile===true&&action==='user-switch')notes.push('이 대상은 프로필입니다. 일반 사용자처럼 화면의 사용자로 전환할 수 없습니다.');
    if(action==='profile-create'&&user.profile===true)notes.push('프로필의 부모는 일반 사용자여야 합니다. 기존 관리·비공개 프로필은 목록에서 확인할 수 있지만 부모로 선택할 수 없습니다.');
    if(action==='profile-create')notes.push('프로필 부모 자격: '+(user.canHaveProfile===true?'기기에서 허용':user.canHaveProfile===false?'기기에서 불가로 응답':'미확인')+' · 실제 생성 정원·권한·정책 확인은 별도입니다.');
    if(action==='user-start'&&user.running===true)notes.push('이미 실행 중인 사용자입니다. 다시 시작할 필요가 없으며 화면 전환은 별도이고 데이터 잠금 해제 결과도 보장하지 않습니다.');
    if(action==='user-start'&&confirmedSecureFolder(user))notes.push('보안 폴더의 시작 가능 여부는 실행 상태·권한·Knox 정책에 따라 달라집니다. 이 폰에서 실제 시작 동작은 시험하지 않았습니다.');
    if(action==='user-switch'&&user.current)notes.push('이미 현재 화면에서 사용 중인 사용자입니다.');
    else if(action==='user-switch'&&user.canSwitch===false&&user.profile!==true&&!confirmedSecureFolder(user))notes.push('현재 기기 상태·정책에서 이 사용자로 전환할 수 없습니다.');
    if(['user-stop','user-remove'].includes(action)&&(Number(user.id)===0||user.current))notes.push('기본 사용자 또는 현재 사용자는 이 작업의 대상이 될 수 없습니다.');
    if(user.quietMode===true)notes.push('일시 중지 모드입니다. 프로필 앱의 실행·알림이 제한되며, 해제는 해당 프로필의 정상 잠금·정책 절차를 따릅니다.'+(action==='user-start'?' 직접 시작 요청은 일시 중지 플래그를 해제하지 않습니다.':''));
    return notes.length?`<p class="uph-selection-note" role="note"><strong>선택: ${esc(user.name||'이름 미확인')} · ${esc(user.id)}</strong> ${notes.map(esc).join(' ')}</p>`:'';
  }
  function savedReview(){
    if(!['profile-create','user-start'].includes(action)||!operationReview||String(operationReview.deviceId)!==device)return '';
    const entry=operationReview.operations?.[action];if(!entry||typeof entry!=='object')return '';
    const firmware=operationReview.firmware;
    const firmwareText=typeof firmware==='string'?firmware:firmware?.fingerprint||firmware?.buildLabelKo||firmware?.buildId||'빌드 표기 미확인';
    const checks=items=>Array.isArray(items)&&items.length?`<div class="uph-review-checks">${items.map(item=>{const state=['confirmed','blocked'].includes(item.state)?item.state:'unverified';return `<div class="uph-review-check is-${state}"><strong>${esc(item.label||'확인 항목')}</strong><span>${state==='confirmed'?'자료로 확인':state==='blocked'?'제한 확인':'미확인'}</span><p>${esc(item.detailKo||'판정 자료가 없습니다.')}</p></div>`;}).join('')}</div>`:'';
    const limits=items=>Array.isArray(items)&&items.length?`<ul class="uph-review-limits">${items.map(note=>`<li>${esc(note)}</li>`).join('')}</ul>`:'';
    const targets=Array.isArray(entry.targets)?entry.targets:[];
    const selected=values.userId===undefined||values.userId===null?'':String(values.userId);
    const matched=selected?targets.filter(target=>String(target.userId)===selected):targets;
    let scope='';
    if(action==='profile-create'&&values.parent!==undefined&&values.parent!==null&&String(values.parent)!==''&&String(values.parent)!=='0')scope='<p class="uph-review-scope">아래 검토는 부모 사용자 0 기준입니다. 지금 선택한 부모의 가능 여부를 확인한 자료가 아닙니다.</p>';
    if(action==='user-start'&&selected&&!matched.length)scope='<p class="uph-review-scope">선택한 사용자에 대한 보관 검토 자료가 없습니다. 다른 대상의 판정을 적용하지 않습니다.</p>';
    const sourceItems=Array.isArray(entry.sources)?entry.sources:[];
    const sources=sourceItems.length?`<p class="uph-review-sources">근거: ${sourceItems.map(source=>{const filename=String(source.path||'').split(/[\\/]/).pop();return esc(source.label||filename||'시스템 코드')+(filename&&source.label?' · '+esc(filename):'')+(Number.isInteger(source.line)?':'+esc(source.line):'');}).join(' / ')}</p>`:'';
    return `<section class="uph-operation-review" aria-label="보관된 코드·조회 자료 검토"><div class="uph-review-heading"><strong>보관된 시스템 코드·조회 자료 검토 · 현재 실시간 상태 아님</strong><span class="uph-review-verdict ${entry.verdict==='blocked'?'is-blocked':'is-conditional'}">${esc(entry.labelKo||'실제 실행 미시험')}</span></div><p class="uph-review-summary">${esc(entry.summaryKo||'현재 연결 없이 저장된 자료만 검토했습니다.')}</p><p class="uph-review-meta">조회 자료: ${esc(stamp(operationReview.snapshotAt))} · 코드 검토: ${esc(stamp(operationReview.reviewedAt))}<br>대조 빌드: ${esc(firmwareText)}${operationReview.sourceLabelKo?'<br>'+esc(operationReview.sourceLabelKo):''}</p>${scope}${checks(entry.checks)}${action==='user-start'?matched.map(target=>`<article class="uph-review-target"><div><strong>${esc(target.name||'이름 미확인')} · 사용자 ${esc(target.userId)}</strong><span>${esc(target.labelKo||'실행 미시험')}</span></div><p>${esc(target.summaryKo||'실제 시작 요청은 시험하지 않았습니다.')}</p>${checks(target.checks)}${limits(target.limitsKo)}</article>`).join(''):''}${limits(entry.limitsKo)}${sources}<p class="uph-review-footnote">자료만으로 현재 실행 성공을 보장하지 않습니다. 이 안내를 표시하기 위해 생성·시작·잠금 해제 명령을 실행하지 않습니다.</p></section>`;
  }
  function render(){
    const root=host();if(!root)return;
    const guide=guides[action];if(!guide){root.hidden=true;root.innerHTML='';return;}
    root.hidden=false;root.className='user-profile-help';
    const users=Array.isArray(snapshot?.users)?snapshot.users:[];
    const support=snapshot?.support||{},current=snapshot?.currentUserId;
    let supportText='일반 사용자 전환 지원: 미확인'+(Number.isInteger(support.maxSwitchableUsers)?' · 상한 '+support.maxSwitchableUsers+'명':'');
    if(support.switchableUsers===false)supportText='일반 사용자 전환 지원 안 됨'+(Number.isInteger(support.maxSwitchableUsers)?' · 최대 '+support.maxSwitchableUsers+'명':'');
    else if(support.switchableUsers===true)supportText='일반 사용자 전환 지원'+(Number.isInteger(support.maxSwitchableUsers)?' · 최대 '+support.maxSwitchableUsers+'명':'');
    let actionSupportText=supportText;
    if(action==='profile-create')actionSupportText='관리 프로필 추가 가능 여부: 미확인 · 일반 사용자 상한과 별도';
    else if(action==='user-start')actionSupportText='시작 가능 여부: 대상 상태·권한·정책에 따름 · 화면 전환과 별도 · 데이터 잠금 해제 시도 가능';
    else if(action==='user-switch'){
      const others=users.filter(user=>!user.current&&(current===null||current===undefined||String(user.id)!==String(current)));
      const fullOrUnknownOthers=others.filter(user=>user.profile!==true);
      const unknownOthers=fullOrUnknownOthers.some(user=>user.profile!==false||user.canSwitch===null||user.canSwitch===undefined);
      if(snapshot&&users.length&&current!==null&&current!==undefined&&fullOrUnknownOthers.length===0)actionSupportText='전환할 다른 일반 사용자 없음';
      else if(unknownOthers)actionSupportText='전환 가능한 다른 일반 사용자: 미확인 · 대상 유형·지원 상태 확인 필요';
    }
    const scopeSpecific=['profile-create','user-start'].includes(action);
    const backgroundSupport=scopeSpecific||action==='user-switch'&&actionSupportText!==supportText;
    const warnings=(snapshot?.warnings||[]).filter(note=>!(scopeSpecific&&support.switchableUsers===false&&String(note).startsWith('이 기기는 전환 가능한 여러 사용자 기능을 지원하지 않는다고 보고했습니다.')));
    const errors=[...(snapshot?.errors||[]),...(failure?[failure]:[])];
    root.innerHTML=`<div class="uph-heading"><strong>기능·현재 상태·사용법</strong><span class="uph-mode ${guide.read?'is-read':'is-change'}">${guide.read?'조회 전용':'실행하면 폰 상태 변경'}</span><button type="button" data-uph-refresh ${loading?'disabled':''}>${loading?'상태 확인 중…':'현재 상태 다시 조회'}</button></div>
      <dl class="uph-guide"><dt>기능</dt><dd>${esc(guide.purpose)}</dd><dt>사용법</dt><dd>${esc(guide.use)}</dd><dt>${guide.read?'읽는 법':'영향'}</dt><dd>${esc(guide.effect)}</dd></dl>
      ${savedReview()}
      ${loading?'<p class="uph-progress" role="status" aria-live="polite"><span></span>사용자·프로필과 지원 상태를 조회 중입니다. 폰 상태를 변경하지 않습니다.</p>':''}
      ${snapshot?`<div class="uph-snapshot"><span>현재 화면 사용자: <strong>${current===null||current===undefined?'미확인':esc(current)}</strong> · ${esc(actionSupportText)}</span><small>${esc(stamp(snapshot.updatedAt))}${loading||failure?' · 이전 조회값':''}</small></div>
      ${backgroundSupport?`<p class="uph-footnote">일반 사용자 전환에 대한 기기 보고: ${esc(supportText)}.${scopeSpecific?' 이 보고만으로 관리 프로필 추가나 사용자 시작의 가능 여부를 판정하지 않습니다.':''}</p>`:''}
      <div class="uph-users">${users.length?users.map(user=>`<article class="uph-user"><div><strong>${esc(user.name||'이름 미확인')} <span>사용자 ${esc(user.id)}</span></strong><span class="uph-type">${esc(typeLabel(user))}${user.current?' · 현재 화면':''}</span></div><p>${esc(userState(user))}${user.quietMode===true?' · 일시 중지 모드':''}${user.quietMode===false?' · 일시 중지 아님':''}</p>${user.parentId!==null&&user.parentId!==undefined?`<small>부모 사용자 ${esc(user.parentId)} · `:'<small>'}${user.flagsHex?`속성 0x${esc(String(user.flagsHex).replace(/^0x/i,''))}`:'속성 플래그 미확인'}</small></article>`).join(''):'<p class="uph-muted">사용자 목록이 비어 있습니다. 조회 오류 안내를 확인하거나 다시 조회하세요.</p>'}</div>
      <p class="uph-footnote">사용자 번호는 Android 공간의 ID이며 계정 로그인과 다릅니다. 사용자 번호나 이름만으로 프로필 종류를 판단하지 않습니다. 속성은 16진수 플래그 묶음이며 오류 코드가 아닙니다. 일반 사용자 수 제한과 관리 프로필 수 제한은 별개입니다.</p>`:''}
      ${selectionNote()}
      ${action==='user-create'&&snapshot?`<p class="uph-warning"><strong>${snapshot.userCreation?.canCreate===true?'생성 요청 가능 · 실행 직전 재확인':snapshot.userCreation?.canCreate===false?'현재 생성 불가':'생성 조건 확인 필요'}</strong> ${esc(snapshot.userCreation?.reasonKo||'현재 응답에 일반 사용자 생성 조건이 없습니다. 상태를 다시 조회하세요.')}</p>`:''}
      ${warnings.map(note=>`<p class="uph-warning">${esc(note)}</p>`).join('')}
      ${errors.length?`<div class="uph-errors" role="status"><strong>${failure?'현재 상태 조회 실패':'일부 상태 미확인'}</strong>${errors.map(error=>`<p>${esc(error.reasonKo||'권한 또는 기기 응답 때문에 상태를 확인하지 못했습니다.')}${error.requiredAccessKo?' · '+esc(error.requiredAccessKo):''}</p>`).join('')}<button type="button" data-uph-refresh ${loading?'disabled':''}>다시 조회</button></div>`:''}`;
    root.onclick=event=>{if(event.target?.closest?.('[data-uph-refresh]'))refresh();};
    window.Workbench?.syncRunAvailability?.();
  }
  async function refresh(){
    if(!action||!device||loading)return;
    const token=++request,expectedDevice=device;controller?.abort();controller=new AbortController();loading=true;failure=null;operationReview=null;render();
    try{
      const response=await fetch('/api/device/user-profile-help?id='+encodeURIComponent(device),{method:'GET',cache:'no-store',signal:controller.signal});
      const data=await response.json();
      if(token!==request)return;
      const review=data.operationReview;
      operationReview=review&&typeof review==='object'&&String(review.deviceId)===expectedDevice&&review.live===false&&(!data.deviceId||data.deviceId===expectedDevice)?review:null;
      if(!response.ok)throw Object.assign(new Error(data.reasonKo||data.error||'사용자·프로필 상태를 조회하지 못했습니다.'),{data});
      if(data.deviceId!==expectedDevice||!Array.isArray(data.users))throw new Error('현재 기기의 사용자·프로필 조회 결과를 확인하지 못했습니다. 다시 조회하세요.');
      snapshot=data;
    }catch(error){
      if(token!==request||error.name==='AbortError')return;
      const reason=error.data?.reasonKo||error.data?.error||error.message;
      failure={reasonKo:/[가-힣]/.test(reason||'')?reason:'연결 또는 조회 권한 때문에 현재 상태를 확인하지 못했습니다. 연결을 확인하고 다시 조회하세요.',requiredAccessKo:error.data?.requiredAccessKo||''};
    }finally{if(token===request){loading=false;controller=null;render();}}
  }
  function clearResult(){const root=resultHost();if(root){root.innerHTML='';root.hidden=true;}}
  function clear(){request++;controller?.abort();controller=null;action=null;device=null;snapshot=null;operationReview=null;values={};loading=false;failure=null;render();clearResult();}
  function open(nextAction,nextDevice){clear();if(!guides[nextAction]||!nextDevice)return Promise.resolve();action=nextAction;device=String(nextDevice);render();return refresh();}
  function selectionChanged(next){values=next&&typeof next==='object'?{...next}:{};render();}
  function showResult(actionId,output,selectedUserId){
    clearResult();const root=resultHost();if(!root||!guides[actionId]?.read)return;
    const raw=String(output??'');let summary='';
    if(actionId==='user-state'){
      const state=raw.trim(),notStarted=state.match(/^User is not started:\s*(\d+)$/);
      const notStartedMatches=Boolean(notStarted&&(selectedUserId===null||selectedUserId===undefined||String(selectedUserId)===''||String(selectedUserId)===notStarted[1]));
      const label=notStartedMatches?'시작된 사용자 상태 없음':textState(state);
      summary=`<strong>선택 사용자 ${esc(selectedUserId??'미확인')}의 조회 당시 상태</strong><p>${esc(label||'실행 상태를 한글로 판정하지 못했습니다. 아래 원문을 확인하세요.')}</p>`;
      if(state==='RUNNING_UNLOCKED')summary+='<p>사용자 데이터가 접근 가능한 상태입니다. 폰 화면이 잠금 해제됐다는 뜻은 아닙니다.</p>';
      if(state==='-1'||notStartedMatches)summary+='<p>시작된 사용자 상태가 없습니다. 삭제됐거나 오류가 났다는 뜻으로 단정하지 않습니다.</p>';
    }else if(actionId==='users-list'){
      const rows=[...raw.matchAll(/UserInfo\{(\d+):([^\r\n]*):([0-9a-f]+)\}([^\r\n]*)/gi)];
      const current=raw.match(/현재 사용자:\s*(\d+)/)?.[1];
      summary=`<strong>조회 당시 사용자 목록: ${rows.length?rows.length+'개':'개수 판정 미확인'}${current!==undefined?' · 현재 화면 사용자 '+esc(current):''}</strong>`;
      if(rows.length)summary+='<p>'+rows.map(row=>esc(row[2])+' · 사용자 '+esc(row[1])+' · '+(/\brunning\b/i.test(row[4])?'실행 중':'이 목록만으로 실행 여부 미확인')).join('<br>')+'</p>';
      summary+='<p>running은 실행 중이라는 뜻이며 화면 잠금 상태는 알려주지 않습니다. 프로필 유형·부모 관계는 위의 현재 상태 조회 또는 상세 상태에서 확인합니다.</p>';
    }else summary='<strong>사용자 서비스 원문을 조회했습니다.</strong><p>위의 사용자·프로필 카드는 별도로 조회한 현재 상태입니다. 아래 원문과 조회 시점이 다를 수 있으며, 없는 항목은 지원 여부를 단정하지 않습니다.</p>';
    root.className='user-profile-result';root.hidden=false;root.innerHTML=summary;
  }
  function executionStatus(expectedAction){
    if(expectedAction!=='user-create')return null;
    if(action!==expectedAction||!device||loading)return{allowed:false,state:'loading',reasonKo:'일반 사용자 생성 조건을 조회하고 있습니다.'};
    if(failure)return{allowed:false,state:'error',reasonKo:failure.reasonKo};
    const creation=snapshot?.userCreation;
    return{allowed:creation?.canCreate===true,state:creation?.state||'unverified',reasonKo:creation?.reasonKo||'일반 사용자 생성 조건을 확인한 뒤 실행할 수 있습니다.'};
  }
  window.UserProfileHelp={open,refresh,executionStatus,clear,clearResult,selectionChanged,showResult};
})();
