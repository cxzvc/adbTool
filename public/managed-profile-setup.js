(() => {
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const state = {id:null,revision:0,busy:false,valid:false,data:null,parent:'',manager:'',session:'',name:'업무 프로필',requestId:null,uncertain:false,storageIssue:'',abort:null,finish:null};
  const stages = [['support','지원 확인'],['create','프로필 생성'],['manager','관리 앱 지정'],['initialize','초기 설정'],['verify','완료 확인']];
  const receiptKey='adb-desk-managed-profile-receipts-v1',memoryReceipts=new Map();
  let dialog;

  function receipt(deviceId) {
    if(!globalThis.localStorage)return memoryReceipts.get(deviceId)||null;
    try{const entries=JSON.parse(globalThis.localStorage.getItem(receiptKey)||'{}');const value=entries[deviceId];return value&&typeof value.requestId==='string'&&/^[a-f\d-]{36}$/i.test(value.requestId)&&(!value.sessionId||typeof value.sessionId==='string')?value:null;}
    catch{throw new Error('이 브라우저의 이전 설정 요청 기록을 읽지 못했습니다. 중복 생성 여부를 확인할 수 없어 실행을 잠갔습니다. 브라우저 저장 공간을 확인하고 다시 여세요.');}
  }
  function rememberReceipt() {
    const value={requestId:state.requestId,...(state.session?{sessionId:state.session}:{})};
    if(!globalThis.localStorage){memoryReceipts.set(state.id,value);return;}
    try{const entries=JSON.parse(globalThis.localStorage.getItem(receiptKey)||'{}');if(!entries||Array.isArray(entries)||typeof entries!=='object')throw new Error('기록 형식');entries[state.id]=value;globalThis.localStorage.setItem(receiptKey,JSON.stringify(entries));}
    catch{state.storageIssue='중복 생성 방지를 위한 요청 기록을 이 브라우저에 저장하지 못했습니다. 저장 공간을 확인한 뒤 현재 상태를 다시 조회하세요.';throw new Error(state.storageIssue);}
  }
  function forgetReceipt() {
    memoryReceipts.delete(state.id);
    if(!globalThis.localStorage)return;
    try{const entries=JSON.parse(globalThis.localStorage.getItem(receiptKey)||'{}');if(entries[state.id]?.requestId===state.requestId){delete entries[state.id];globalThis.localStorage.setItem(receiptKey,JSON.stringify(entries));}}
    catch{state.storageIssue='이전 요청 기록을 정리하지 못했습니다. 브라우저 저장 공간을 확인한 뒤 다시 여세요.';}
  }

  function mount() {
    if (dialog) return;
    dialog = document.createElement('dialog'); dialog.id = 'managed-profile-setup-dialog';
    dialog.setAttribute('aria-labelledby','mps-title');
    dialog.innerHTML = `<div class="mps-heading"><div><h2 id="mps-title">관리 프로필 만들기·설정</h2><p>앱·데이터를 분리하는 업무 공간을 만들고, 선택한 관리 앱의 초기 설정까지 확인합니다.</p></div><button type="button" id="mps-close" aria-label="관리 프로필 설정 창 닫기">×</button></div>
      <p id="mps-target" class="mps-target"></p><ol id="mps-stages" class="mps-stage-list" aria-label="관리 프로필 설정 단계"></ol>
      <section class="mps-card" aria-labelledby="mps-support-title"><div class="mps-support-heading"><strong id="mps-support-title">지원 여부 조회 전</strong><small id="mps-updated"></small></div><ul id="mps-checks" class="mps-checks"></ul><div id="mps-read-problems" hidden></div></section>
      <form id="mps-form"><div class="mps-form-grid"><label class="mps-field mps-wide" id="mps-session-field" hidden>이 PC의 설정 기록<select id="mps-session"><option value="">새 프로필 설정</option></select><small>이전 작업을 골라도 조회만 합니다. 이어서 설정은 별도로 확인 후 실행합니다.</small></label>
      <label class="mps-field">부모 사용자<select id="mps-parent" required disabled><option value="">조회 후 선택</option></select><small id="mps-parent-note">소유자 같은 일반 사용자 아래에 만듭니다. 기존 보안 폴더는 부모로 선택할 수 없습니다.</small></label>
      <label class="mps-field">새 프로필 이름<input id="mps-name" type="text" maxlength="60" value="업무 프로필" autocomplete="off" required disabled><small>기존 소유자나 보안 폴더의 이름을 바꾸는 기능이 아닙니다.</small></label>
      <label class="mps-field mps-wide">프로필을 관리할 앱<select id="mps-manager" required disabled><option value="">조회 후 선택</option></select><small id="mps-manager-note">폰에 설치된 지원 관리 앱을 목록에서 선택합니다. 앱을 자동 다운로드하거나 임의 APK를 설치하지 않습니다.</small></label></div>
      <p class="mps-rights">선택한 앱은 새 프로필 안의 앱·권한·정책을 관리하는 ‘프로필 관리자’가 됩니다. 전체 폰의 기기 소유자로 지정하거나 기존 보안 폴더를 변경하지 않습니다. Shelter는 개인 공간의 Shelter 앱 자체 연동 상태도 갱신할 수 있습니다.</p>
      <label class="mps-ack"><input id="mps-ack" type="checkbox" disabled><span id="mps-ack-text">선택한 부모 아래에 새 프로필을 만들고, 선택한 관리 앱을 지정·초기 설정하는 변경임을 확인했습니다.</span></label>
      <div class="mps-actions"><button type="submit" class="primary-button" id="mps-run" disabled>확인 후 생성·설정</button><button type="button" id="mps-refresh">지원·현재 상태 다시 조회</button></div></form>
      <div id="mps-progress" class="mps-progress" role="status" hidden><p id="mps-progress-text"></p><progress aria-label="관리 프로필 설정 처리 중"></progress></div>
      <section id="mps-operation" class="mps-card mps-operation" aria-live="polite" hidden></section><div id="mps-feedback" aria-live="polite"></div>
      <p class="mps-note">지원 조회와 목록 선택은 읽기 전용입니다. 실행 버튼을 누를 때만 폰을 변경합니다. 초기 설정에 폰 화면의 확인이 필요하면 ‘확인 대기’로 표시하며, 조회만으로 완료 처리하거나 변경을 이어서 실행하지 않습니다.</p>`;
    document.body.append(dialog);
    $('mps-close').onclick = () => close();
    dialog.addEventListener('close',invalidate);
    $('mps-form').onsubmit = event => { event.preventDefault(); return submit(); };
    $('mps-refresh').onclick = () => refresh();
    $('mps-parent').onchange = () => selectionChanged('parent',$('mps-parent').value);
    $('mps-manager').onchange = () => selectionChanged('manager',$('mps-manager').value);
    $('mps-session').onchange = () => selectionChanged('session',$('mps-session').value);
    $('mps-name').oninput = () => { state.name = $('mps-name').value; $('mps-ack').checked = false; renderControls(); };
    $('mps-ack').onchange = renderControls;
  }

  function current(revision) { return Boolean(state.id && dialog?.open && revision === state.revision); }
  function invalidate() {
    state.revision++; state.abort?.abort(); state.abort=null; state.finish?.(); state.finish=null;
    state.busy=false; state.valid=false; state.id=null; state.data=null; state.uncertain=false;
  }
  function close() { if (!dialog) return; invalidate(); if (dialog.open) dialog.close(); }
  function feedback(options) {
    const root=$('mps-feedback');
    if(window.DeskFeedback?.state) return window.DeskFeedback.state(root,options);
    root.hidden=!options; root.textContent=options?[options.title,options.message,options.requiredAccessKo].filter(Boolean).join('\n'):'';
    if(options?.onAction){const button=document.createElement('button');button.type='button';button.textContent=options.actionLabel||'다시 조회';button.onclick=options.onAction;root.append(button);}
    if(options?.rawError){const details=document.createElement('details'),summary=document.createElement('summary'),pre=document.createElement('pre');summary.textContent='기술 오류 원문';pre.textContent=String(options.rawError);details.append(summary,pre);root.append(details);}
  }
  function fail(cause,writing=false) {
    const reason=cause.reasonKo||cause.error||cause.message;
    const message=/[가-힣]/.test(reason||'')?reason:'연결 또는 조회 권한 때문에 응답을 확인하지 못했습니다. 현재 상태를 다시 조회하세요.';
    feedback({type:'error',title:writing?'설정 요청의 결과를 확인하지 못했습니다':'지원·현재 상태 조회 실패',message:message+(writing?' 일부 단계가 이미 실행됐을 수 있습니다. 새 프로필을 다시 만들지 말고 설정 기록과 현재 상태를 조회하세요.':' 이전 조회값은 참고용이며 실행에는 사용할 수 없습니다.'),requiredAccessKo:cause.requiredAccessKo,rawError:cause.rawError||(!/[가-힣]/.test(reason||'')?reason:undefined),actionLabel:writing?'기존 설정 상태만 조회':'지원·현재 상태 다시 조회',onAction:()=>refresh()});
  }
  function operation() { return state.data?.operation || null; }
  function manager() { return state.data?.managers?.find(item=>String(item.id)===state.manager); }
  function parent() { return state.data?.parents?.find(item=>String(item.id)===state.parent); }
  function canSubmit() {
    if(!state.valid||state.busy||state.uncertain||state.storageIssue||!state.id||!dialog?.open) return false;
    const op=operation();
    if(state.session) return Boolean(op?.sessionId===state.session&&op.canResume===true&&!['running','complete'].includes(op.state)&&parent()&&!parent().disabled&&manager()&&!manager().disabled);
    const app=manager(),owner=parent();
    return state.data?.support?.canStart===true&&owner&&!owner.disabled&&app&&!app.disabled&&app.installed===true&&app.verified===true&&state.name.trim().length>0&&state.name.trim().length<=60;
  }
  function renderControls() {
    const op=operation(),locked=state.busy||!state.valid||state.uncertain||Boolean(state.session);
    $('mps-parent').disabled=locked; $('mps-manager').disabled=locked; $('mps-name').disabled=locked;
    $('mps-session').disabled=state.busy||!state.valid||state.uncertain;
    $('mps-refresh').disabled=state.busy||!state.id;
    $('mps-ack').disabled=!canSubmit();
    $('mps-run').disabled=!canSubmit()||!$('mps-ack').checked;
    $('mps-run').textContent=state.busy?'처리 중…':state.session?'확인 후 남은 설정 이어서 실행':'확인 후 생성·설정';
    $('mps-ack-text').textContent=state.session?`새 프로필을 만들지 않고, 기록된 프로필${op?.profileId!=null?' '+op.profileId:''}의 남은 설정만 이어서 실행함을 확인했습니다.`:'선택한 부모 아래에 새 프로필을 만들고, 선택한 관리 앱을 지정·초기 설정하는 변경임을 확인했습니다.';
    $('mps-progress').hidden=!state.busy; dialog?.setAttribute('aria-busy',String(state.busy));
    const labels={ready:'사전 조건 확인 · 실제 성공은 실행 후 확인',blocked:'현재 조건에서 진행 불가',unknown:'지원 여부 미확인'};
    $('mps-support-title').textContent=state.valid?(labels[state.data?.support?.state]||labels.unknown):state.data?'이전 조회값 · '+(state.busy?'현재 조건 다시 조회 중':'지원 여부 미확인'):state.busy?'지원 조건 조회 중':'지원 여부 미확인';
    if(!state.valid)$('mps-manager-note').textContent=state.busy?'설치된 관리 앱과 지원 조건을 조회하고 있습니다. 조회가 끝나기 전에는 설치 여부를 판단하지 않습니다.':'관리 앱의 현재 상태를 확인하지 못했습니다. 지원·현재 상태를 다시 조회해 주세요.';
  }
  function option(item,kind) {
    const value=kind==='session'?item.sessionId:item.id;
    const label=item.label||item.labelKo||(kind==='session'?`${item.name||'관리 프로필'} · ${item.profileId!=null?'프로필 '+item.profileId:item.state||'상태 미확인'}`:kind==='parent'?`사용자 ${item.id}`:item.package||item.id);
    return `<option value="${esc(value)}"${item.disabled?' disabled':''}>${esc(label)}${item.disabled&&item.reasonKo?' · '+esc(item.reasonKo):''}</option>`;
  }
  function renderLists() {
    const data=state.data,op=operation(),parents=Array.isArray(data?.parents)?data.parents.slice():[],managers=Array.isArray(data?.managers)?data.managers.slice():[],sessions=Array.isArray(data?.sessions)?data.sessions:[];
    if(op?.sessionId){state.session=op.sessionId;state.parent=String(op.parent??op.parentId??state.parent);state.manager=String(op.managerId??state.manager);state.name=op.name||state.name;}
    if(!op&&!parents.some(item=>String(item.id)===state.parent&&!item.disabled)) state.parent=String(parents.find(item=>!item.disabled)?.id??'');
    if(!op&&!managers.some(item=>String(item.id)===state.manager&&!item.disabled)) state.manager='';
    if(op&&state.parent&&!parents.some(item=>String(item.id)===state.parent))parents.push({id:state.parent,label:`기록된 부모 사용자 ${state.parent}`,disabled:true,reasonKo:'현재 목록에서 확인하지 못했습니다. 다른 부모로 자동 변경하지 않습니다.'});
    if(op&&state.manager&&!managers.some(item=>String(item.id)===state.manager))managers.push({id:state.manager,label:`기록된 관리 앱 ${state.manager}`,disabled:true,reasonKo:'현재 목록에서 확인하지 못했습니다. 다른 관리 앱으로 자동 변경하지 않습니다.'});
    $('mps-parent').innerHTML='<option value="">부모 사용자를 선택하세요</option>'+parents.map(item=>option(item,'parent')).join(''); $('mps-parent').value=state.parent;
    $('mps-manager').innerHTML='<option value="">설치된 지원 관리 앱을 선택하세요</option>'+managers.map(item=>option(item,'manager')).join(''); $('mps-manager').value=state.manager;
    const knownSessions=sessions.slice(); if(op?.sessionId&&!knownSessions.some(item=>item.sessionId===op.sessionId)) knownSessions.unshift(op);
    $('mps-session-field').hidden=!knownSessions.length; $('mps-session').innerHTML='<option value="">새 프로필 설정</option>'+knownSessions.map(item=>option(item,'session')).join(''); $('mps-session').value=state.session;
    $('mps-name').value=state.name;
    const app=manager();
    const managerHint={island:'Island의 프로필 관리자를 지정하고 초기 설정 완료 표식을 확인합니다.',shelter:'새 프로필과 개인 공간의 Shelter 앱 자체 연동 상태를 설정합니다. 개인 공간의 계정·기기 관리 정책을 바꾸는 작업은 아닙니다.','test-dpc':'개발·시험용 관리 앱입니다. 폰에서 계정·완료 안내를 확인해야 할 수 있으며, 그때는 완료가 아닌 확인 대기로 표시합니다.'};
    $('mps-manager-note').textContent=app?[app.package,app.scopeKo||managerHint[app.id],app.reasonKo,app.requiredAccessKo].filter(Boolean).join(' · '):managers.some(item=>item.installed&&!item.disabled)?'설치된 지원 앱을 선택하면 해당 앱 기준으로 지원 조건을 다시 조회합니다.':managers.some(item=>item.installed===true)?'설치된 관리 앱이 있지만 현재 조건에서 사용할 수 없습니다. 목록의 제한 이유를 확인해 주세요.':managers.some(item=>item.installed!==false)?'관리 앱의 설치·지원 상태를 모두 확인하지 못했습니다. 조회 제한 안내를 확인하고 다시 조회해 주세요.':'조회 결과에 사용 가능한 관리 앱이 없습니다. 이 창에서 앱을 자동 설치하지 않습니다.';
    const owner=parent(); $('mps-parent-note').textContent=owner?.reasonKo||'소유자 같은 일반 사용자 아래에 만듭니다. 기존 보안 폴더는 목록에 보이지만 부모로 선택할 수 없습니다.';
  }
  function renderStages() {
    const op=operation(),steps=Array.isArray(op?.steps)?op.steps:[],done=value=>['done','complete','completed','confirmed','success'].includes(value);
    function groupedState(ids){const selected=ids.map(id=>steps.find(step=>step.id===id));if(selected.some(step=>['failed','error','blocked'].includes(step?.state)))return'failed';if(selected.some(step=>step?.state==='running'))return'running';if(selected.every(step=>done(step?.state)))return'completed';if(selected.some(step=>step?.state==='pending'))return'pending';if(selected.some(step=>step?.state==='unknown'))return'unknown';return'waiting';}
    $('mps-stages').innerHTML=stages.map(([id,label],index)=>{
      const status=id==='support'?(state.valid?(state.data?.support?.state==='ready'?'completed':state.data?.support?.state==='blocked'?'blocked':'unknown'):'waiting'):groupedState(id==='manager'?['install','owner']:id==='initialize'?['start','initialize']:[id]);
      const labels={confirmed:'확인',completed:'완료',complete:'완료',done:'완료',success:'완료',running:'처리 중',pending:'확인 대기',blocked:'차단',failed:'실패',error:'실패',waiting:'대기',unknown:'미확인',skipped:'미실행'};
      const safeStatus=({confirmed:'completed',complete:'completed',success:'completed',error:'failed'})[status]||status;
      return `<li class="mps-stage is-${['completed','running','pending','blocked','failed'].includes(safeStatus)?safeStatus:'waiting'}"><strong>${index+1}. ${esc(label)}</strong><span>${esc(labels[status]||'미확인')}</span></li>`;
    }).join('');
  }
  function renderData() {
    const data=state.data,support=data?.support,labels={ready:'사전 조건 확인 · 실제 성공은 실행 후 확인',blocked:'현재 조건에서 진행 불가',unknown:'지원 여부 미확인'};
    $('mps-support-title').textContent=(state.valid?'':'이전 조회값 · ')+(labels[support?.state]||'지원 여부 미확인');
    $('mps-updated').textContent=data?.updatedAt?'조회: '+String(data.updatedAt):'';
    $('mps-checks').innerHTML=(Array.isArray(support?.checks)?support.checks:[]).map(check=>`<li class="is-${['confirmed','blocked'].includes(check.state)?check.state:'unknown'}"><strong>${esc(check.label||check.labelKo||check.id)}</strong> · ${esc(check.reasonKo||({confirmed:'확인',blocked:'진행 불가',unknown:'확인하지 못함'})[check.state]||'확인하지 못함')}${check.requiredAccessKo?'<br>필요: '+esc(check.requiredAccessKo):''}</li>`).join('')||'<li>아직 확인된 지원 조건이 없습니다. 미확인을 지원 안 됨으로 판정하지 않습니다.</li>';
    const errors=[...(Array.isArray(data?.errors)?data.errors:[]),...(Array.isArray(support?.errors)?support.errors:[])],warnings=Array.isArray(data?.warnings)?data.warnings:[],problems=$('mps-read-problems');
    problems.hidden=!errors.length&&!warnings.length;problems.innerHTML=errors.map(error=>{const reason=error?.reasonKo||error?.error||error?.message||String(error);return `<p class="mps-note">${esc(/[가-힣]/.test(reason)?reason:'일부 지원 조건을 읽지 못했습니다. 조회 권한·연결 상태를 확인하세요.')}${error?.requiredAccessKo?'<br>필요한 접근: '+esc(error.requiredAccessKo):''}</p>${error?.rawError?'<details class="mps-raw"><summary>조회 오류 원문</summary><pre>'+esc(error.rawError)+'</pre></details>':''}`;}).join('')+warnings.map(warning=>`<p class="mps-note">${esc(typeof warning==='string'?warning:warning.reasonKo||warning.message||'일부 조건은 확인되지 않았습니다.')}</p>`).join('');
    renderLists(); renderStages();
    const op=operation(),host=$('mps-operation'); host.hidden=!op;
    if(op){
      const labels={running:'설정 처리 중',complete:'관리 프로필 설정 완료 확인',pending:'초기 설정·폰 확인 대기',blocked:'다음 단계 진행 불가','blocked-before-create':op.noWrites===true?'생성 전 중단 · 폰 변경 없음':'생성 완료 미확인 · 설정 중단',partial:'일부 단계 완료 · 남은 설정 있음',uncertain:'현재 단계 결과 미확인'};
      host.className='mps-card mps-operation '+(op.state==='complete'?'is-completed':op.state==='pending'?'is-pending':['blocked','blocked-before-create','partial','uncertain'].includes(op.state)?'is-failed':'');
      const stageNames={create:'프로필 생성',install:'관리 앱 설치',owner:'프로필 관리자 지정',start:'새 프로필 시작',initialize:'관리 앱 초기 설정',verify:'최종 상태 확인'};
      host.innerHTML=`<h3>${esc(labels[op.state]||'설정 상태 미확인')}</h3><p><strong>${op.profileId!=null?'생성된 프로필 ID: '+esc(op.profileId):op.noWrites===true?'새 프로필을 생성하지 않았습니다.':'새 프로필 생성 여부: 미확인'}</strong> · 부모 ${esc(op.parent??op.parentId??'미확인')} · ${esc(op.name||'이름 미확인')}</p><p>관리 앱: ${esc(op.managerId||'미확인')} · 단계: ${esc(stageNames[op.stage]||op.stage||'미확인')}</p><p>${esc(op.reasonKo||'현재 상태를 다시 조회해 완료 여부를 확인하세요.')}</p>${op.requiredAccessKo?'<p>필요한 접근: '+esc(op.requiredAccessKo)+'</p>':''}${op.rawError?'<details class="mps-raw"><summary>설정 오류 원문</summary><pre>'+esc(op.rawError)+'</pre></details>':''}${op.state==='pending'?(op.managerId==='test-dpc'?'<p>Test DPC의 최종 확인 결과는 웹에서 판정할 수 없어 확인 대기로 남습니다. 폰의 Test DPC에서 완료 여부를 확인하세요. 다시 조회는 관리자·프로필 실행 상태만 확인하며 화면 확인을 대신하지 않습니다.</p>':'<p>폰에서 관리 앱의 안내·동의가 필요할 수 있습니다. 여기서는 자동으로 터치하거나 확인하지 않습니다. 완료한 뒤 ‘지원·현재 상태 다시 조회’를 누르세요.</p>'):''}${op.state==='complete'?'<p>현재 조회로 확인한 완료 상태입니다. 앱별 동작과 모든 제조사 기능까지 보장하는 뜻은 아닙니다.</p>':''}${op.canResume===true?'<p>서버가 기록된 새 프로필에 한해 이어서 설정을 허용했습니다. 아래 확인 후 실행을 눌러야 진행합니다.</p>':'<p>이 조회는 설정을 다시 실행하지 않습니다. 새 프로필을 자동 생성하거나 기존 프로필을 삭제하지 않습니다.</p>'}`;
    }
    renderControls();
  }
  async function jsonRequest(url,options,writing=false) {
    let response;try{response=await fetch(url,{cache:'no-store',...options});}catch(cause){if(writing)cause.mayHaveChanged=true;throw cause;}
    let data;try{data=await response.json();}catch{throw Object.assign(new Error('서버 응답을 읽지 못했습니다. 현재 상태를 다시 조회하세요.'),{mayHaveChanged:writing});}
    if(!response.ok)throw Object.assign(new Error(data?.reasonKo||data?.error||'요청을 처리하지 못했습니다.'),data);
    return data;
  }
  async function readStatus(revision,signal) {
    const query=new URLSearchParams({deviceId:state.id}); if(state.parent)query.set('parent',state.parent);if(state.manager)query.set('managerId',state.manager);if(state.session)query.set('sessionId',state.session);if(state.requestId)query.set('requestId',state.requestId);
    const data=await jsonRequest('/api/ops/managed-profile-setup?'+query,{method:'GET',signal});
    if(!current(revision))return null;
    if(data?.deviceId!==state.id||!data.support||!Array.isArray(data.parents)||!Array.isArray(data.managers))throw new Error('현재 기기의 관리 프로필 조회 응답을 확인하지 못했습니다. 다시 조회하세요.');
    if(state.session&&data.operation?.sessionId!==state.session)throw new Error('선택한 설정 기록의 응답을 확인하지 못했습니다. 다른 프로필로 자동 변경하지 않았습니다.');
    if(state.uncertain&&!state.session&&state.requestId){
      const found=data.operation?.requestId===state.requestId?data.operation:(data.sessions||[]).find(item=>item.requestId===state.requestId);
      if(found?.sessionId){state.session=found.sessionId;return readStatus(revision,signal);}
    }
    state.data=data;state.valid=true;
    if(data.operation?.sessionId&&(!state.requestId||data.operation.requestId===state.requestId||state.session===data.operation.sessionId)){state.session=data.operation.sessionId;state.uncertain=false;}
    renderData();return data;
  }
  function startBusy(text,button) {
    state.busy=true;state.valid=false;$('mps-ack').checked=false;$('mps-progress-text').textContent=text;
    state.finish=window.DeskFeedback?.start?.(text,{button});renderControls();
  }
  function finishBusy(revision) { if(!current(revision))return;state.finish?.();state.finish=null;state.busy=false;state.abort=null;renderControls(); }
  async function refresh() {
    if(!state.id||!dialog?.open||state.busy)return;
    const revision=++state.revision,abort=new AbortController();state.abort=abort;
    startBusy('관리 프로필 지원·현재 상태 조회');
    $('mps-progress-text').textContent='지원 조건·설치된 관리 앱·설정 기록을 조회 중입니다. 폰을 변경하지 않습니다.';
    feedback(null);
    try{await readStatus(revision,abort.signal);if(current(revision)&&state.storageIssue)feedback({type:'error',title:'브라우저 요청 기록 확인 필요',message:state.storageIssue,actionLabel:'지원·현재 상태만 다시 조회',onAction:()=>refresh()});else if(current(revision)&&state.uncertain)feedback({type:'warning',title:'이전 요청의 접수 여부 미확인',message:'설정 기록에서 같은 요청을 아직 확인하지 못했습니다. 중복 생성을 막기 위해 실행은 잠겨 있습니다. 현재 상태 조회만 다시 할 수 있습니다.',actionLabel:'설정 기록 다시 조회',onAction:()=>refresh()});}
    catch(cause){if(current(revision)&&cause.name!=='AbortError'){state.valid=false;if(state.data)renderData();fail(cause);}}
    finally{finishBusy(revision);}
  }
  function selectionChanged(key,value) {
    if(state.busy||state.uncertain||!state.valid||!state.id||!dialog?.open)return;
    state[key]=String(value);state.valid=false;state.uncertain=false;state.requestId=null;$('mps-ack').checked=false;
    if(key==='session'){state.data=null;state.manager='';state.parent='';state.name='업무 프로필';$('mps-operation').hidden=true;}
    renderControls();return refresh();
  }
  async function waitForJob(job,revision,signal) {
    let value=job;
    for(let attempt=0;attempt<120&&current(revision);attempt++){
      if(value.state&&value.state!=='running')return value;
      if(attempt)await new Promise(resolve=>setTimeout(resolve,750));
      if(!current(revision))return null;
      value=await jsonRequest('/api/ops/job?'+new URLSearchParams({deviceId:state.id,id:job.id}),{method:'GET',signal});
      if(value?.deviceId&&value.deviceId!==state.id||value?.id!==job.id)throw new Error('현재 설정 작업의 상태 응답이 일치하지 않습니다. 설정 기록을 다시 조회하세요.');
      $('mps-progress-text').textContent=value.message||value.progressText||'관리 프로필 설정 처리 중입니다. 같은 작업을 다시 보내지 않습니다.';
    }
    return value;
  }
  async function submit() {
    if(!canSubmit()||!$('mps-ack').checked)return;
    const revision=++state.revision,abort=new AbortController(),deviceId=state.id;
    const requestId=state.requestId||globalThis.crypto?.randomUUID?.();
    if(!requestId){feedback({type:'error',title:'실행 요청을 준비하지 못했습니다',message:'중복 실행 방지 번호를 만들지 못했습니다. 브라우저를 새로고침하고 다시 조회하세요.'});return;}
    const body={action:'profile-create',deviceId,parent:Number(state.parent),name:state.name.trim(),managerId:state.manager,confirmDevice:deviceId,requestId,...(state.session?{sessionId:state.session}:{})};
    state.requestId=requestId;state.abort=abort;startBusy(state.session?'기록된 프로필의 남은 설정을 요청 중입니다.':'새 관리 프로필 생성·관리 앱 지정·초기 설정을 요청 중입니다.',$('mps-run'));feedback(null);
    let posted=false;
    try{
      const session=await jsonRequest('/api/session',{method:'GET',signal:abort.signal});
      if(!current(revision))return;
      if(typeof session?.csrfToken!=='string'||!session.csrfToken)throw new Error('페이지 인증을 확인하지 못했습니다. 새로고침한 뒤 다시 조회하세요.');
      rememberReceipt();posted=true;state.uncertain=true;
      const job=await jsonRequest('/api/ops/workbench',{method:'POST',headers:{'Content-Type':'application/json','X-ADB-Desk-Token':session.csrfToken},body:JSON.stringify(body),signal:abort.signal},true);
      if(!current(revision))return;
      const sessionId=job.sessionId||job.result?.sessionId;if(sessionId){state.session=String(sessionId);rememberReceipt();}
      if(job.id)await waitForJob(job,revision,abort.signal);
      if(!current(revision))return;
      await readStatus(revision,abort.signal);
      if(current(revision)&&state.uncertain)feedback({type:'warning',title:'설정 결과 추가 확인 필요',message:'변경 요청은 보냈으나 설정 기록의 최종 상태를 아직 확인하지 못했습니다. 같은 생성을 반복하지 말고 기존 상태만 조회하세요.',actionLabel:'기존 설정 상태만 조회',onAction:()=>refresh()});
    }catch(cause){if(current(revision)&&cause.name!=='AbortError'){state.valid=false;state.uncertain=posted&&cause.mayHaveChanged!==false;if(posted&&cause.mayHaveChanged===false)forgetReceipt();if(cause.sessionId)state.session=String(cause.sessionId);if(state.data)renderData();fail(cause,state.uncertain);}}
    finally{finishBusy(revision);}
  }
  async function open(deviceId) {
    mount();close();state.id=String(deviceId||'');if(!state.id)return;
    state.data=null;state.parent='';state.manager='';state.session='';state.name='업무 프로필';state.requestId=null;state.uncertain=false;state.storageIssue='';
    try{const saved=receipt(state.id);if(saved){state.requestId=saved.requestId;state.session=saved.sessionId||'';state.uncertain=true;}}
    catch(cause){state.storageIssue=cause.message;}
    $('mps-target').textContent='대상 기기: '+state.id;$('mps-name').value=state.name;$('mps-ack').checked=false;$('mps-operation').hidden=true;$('mps-session-field').hidden=true;feedback(null);renderData();dialog.showModal();return refresh();
  }
  window.ManagedProfileSetup={open,close};
})();
