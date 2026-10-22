(() => {
  const $=id=>document.getElementById(id);
  const normalizeLines=text=>text.replace(/\r\n?/g,'\n');
  function serializeText(text,source){if(normalizeLines(text)===normalizeLines(source))return source;const clean=normalizeLines(text);if(source.includes('\r\n')&&!/(?:^|[^\r])\n|\r(?!\n)/.test(source))return clean.replace(/\n/g,'\r\n');if(source.includes('\r')&&!source.includes('\n'))return clean.replace(/\n/g,'\r');return clean;}
  const kindFor=(action,field)=>field.choices||({
    'permission-grant:permission':'app-permissions','permission-revoke:permission':'app-permissions',
    'appops-set:op':'appops','diagnostic-service:service':'services',
    'heap:pid':'processes','jdwp-forward:pid':'jdwp',
    'logs-capture-stop:jobId':'log-jobs','settings-undo:historyId':'settings-history',
    'user-switch:userId':'users','user-start:userId':'users','user-stop:userId':'users','user-remove:userId':'users','profile-create:parent':'users',
  }[action.id+':'+field.name])||(field.name==='user'?'users-current':null);
  function mount({action,deviceId,current,request,onBusy,onError}){
    let revision=0,disposed=false,ready=false,loaded=false,originalText='',successMessage='',finishFeedback=null;
    const box=$('workbench-fields'),status=document.createElement('div');status.className='wb-choice-status';status.setAttribute('role','status');
    const progress=document.createElement('progress');progress.setAttribute('aria-label','선택 목록 불러오기');
    const message=document.createElement('span'),retry=document.createElement('button'),unavailable=document.createElement('span');retry.type='button';retry.textContent='목록 다시 읽기';
    unavailable.className='wb-choice-restrictions';unavailable.hidden=true;status.append(progress,message,retry,unavailable);
    const fields=action.fields.filter(f=>kindFor(action,f)),editor=action.id==='file-text-save',initialValues=new Map();
    if(editor)retry.textContent='파일 다시 읽기 · 편집 초기화';
    const retryLabel=retry.textContent;
    if(!fields.length&&!editor)return {dispose(){},get ready(){return true;}};
    box.prepend(status);
    for(const f of fields){const old=$('wb-field-'+f.name);initialValues.set(f.name,old.value);if(old.tagName!=='SELECT'){const select=document.createElement('select');select.id=old.id;select.name=old.name;select.required=true;old.replaceWith(select);} }
    const value=name=>$('wb-field-'+name)?.value||'',optionValues=new Map(),optionRows=new Map(),choiceStates=new Map();
    function showState(type,text){status.setAttribute('data-state',type);message.textContent=text;}
    function updateControls(loading){
      for(const f of fields){const control=$('wb-field-'+f.name);if(control)control.disabled=f.name==='user'?!(optionRows.get(f.name)?.size):loading||!loaded||!optionRows.get(f.name)?.size;}
      if(editor&&$('wb-field-text'))$('wb-field-text').disabled=loading;
    }
    const validUser=value=>/^(?:0|[1-9]\d{0,4})$/.test(String(value??''));
    function validateResponse(response){
      if(!response||!Array.isArray(response.options))throw new Error('선택 목록 응답 형식이 올바르지 않습니다. 다시 읽으세요.');
      const seen=new Set();
      for(const item of response.options){
        if(!item||!(typeof item.value==='string'||typeof item.value==='number'&&Number.isFinite(item.value))||String(item.value)===''||typeof item.label!=='string'||!item.label.trim()||seen.has(String(item.value)))throw new Error('선택 항목의 값이나 이름이 올바르지 않습니다. 다시 읽으세요.');
        if(item.disabled!==undefined&&typeof item.disabled!=='boolean'||item.reasonKo!==undefined&&typeof item.reasonKo!=='string')throw new Error('선택 제한 정보의 형식이 올바르지 않습니다. 다시 읽으세요.');
        seen.add(String(item.value));
      }
      if(response.user!==undefined&&!validUser(response.user))throw new Error('조회 대상 사용자 번호가 올바르지 않습니다. 다시 읽으세요.');
      return response;
    }
    function fill(name,options,previous){
      const select=$('wb-field-'+name),missing=Boolean(previous)&&!options.some(o=>String(o.value)===previous);
      optionRows.set(name,new Map(options.map(item=>[String(item.value),item])));optionValues.set(name,new Set(options.filter(item=>item.disabled!==true).map(item=>String(item.value))));select.replaceChildren();
      const explicitUser=name==='userId'&&['user-switch','user-start','user-stop','user-remove'].includes(action.id),initialUser=explicitUser&&!previous&&choiceStates.get(name)!=='stale';
      if(missing)choiceStates.set(name,'stale');else if(previous&&optionRows.get(name).get(previous)?.disabled===true)choiceStates.set(name,'blocked');else if(initialUser)choiceStates.set(name,'initial');else if(previous)choiceStates.delete(name);
      if(missing||!options.length||initialUser||explicitUser&&choiceStates.get(name)==='stale'&&!previous){const empty=document.createElement('option');empty.value='';empty.textContent=!options.length?'선택 가능한 항목 없음':missing||choiceStates.get(name)==='stale'?'이전 대상이 없습니다. 다시 선택하세요.':'작업할 사용자를 선택하세요.';select.append(empty);}
      for(const item of options){const option=document.createElement('option');option.value=String(item.value);option.disabled=item.disabled===true;option.textContent=item.label+(option.disabled?' · 선택 불가':'');if(option.disabled){option.title=item.reasonKo||'이 작업에서는 선택할 수 없습니다.';option.setAttribute('aria-label',item.label+' · '+option.title);}select.append(option);}
      if(!missing&&previous)select.value=previous;
    }
    function refreshReady(){
      if(disposed||!current()||!loaded)return;
      const missing=fields.filter(f=>!value(f.name)||!optionValues.get(f.name)?.has(value(f.name)));
      const empty=fields.filter(f=>!optionValues.get(f.name)?.size);
      const blocked=missing.map(f=>optionRows.get(f.name)?.get(value(f.name))).filter(row=>row?.disabled===true),notes=[...optionRows.values()].flatMap(rows=>[...rows.values()].filter(row=>row.disabled===true).map(row=>row.label+': '+(row.reasonKo||'이 작업에서는 선택할 수 없습니다.')));
      unavailable.hidden=!notes.length;unavailable.textContent=notes.length?'표시되지만 선택할 수 없는 항목\n'+notes.join('\n'):'';
      ready=!missing.length;onBusy(!ready);
      const initialUser=missing.length&&missing.every(f=>choiceStates.get(f.name)==='initial');
      showState(ready?'ready':blocked.length?'restricted':empty.length?'empty':'selection',ready?successMessage:blocked.length?blocked.map(row=>row.reasonKo||'선택한 대상은 이 작업에서 사용할 수 없습니다.').join(' '):empty.length?empty.map(f=>f.label).join(', ')+' 목록을 확인했지만 실행 가능한 항목이 없습니다. 표시된 제한 이유를 확인하세요.':initialUser?'작업할 사용자를 목록에서 선택하세요. 선택만으로 실행되지 않습니다.':missing.map(f=>f.label).join(', ')+'에서 사용할 대상을 다시 선택하세요. 이전 대상은 자동으로 바꾸지 않았습니다.');
      updateControls(false);onError('');
    }
    async function load(){
      if(disposed||!current())return;
      const token=++revision;ready=false;loaded=false;onBusy(true);progress.hidden=false;showState('loading',editor?'파일 내용 읽는 중…':'기기에서 선택 목록 읽는 중…');retry.disabled=true;retry.textContent=editor?'파일 읽는 중…':'목록 읽는 중…';retry.setAttribute('aria-busy','true');status.setAttribute('aria-busy','true');updateControls(true);
      finishFeedback?.();const stopFeedback=window.DeskFeedback?.start?.(editor?'파일 내용 읽는 중':'선택 목록 읽는 중',{button:retry});let feedbackDone=false;const finish=()=>{if(!feedbackDone){feedbackDone=true;if(typeof stopFeedback==='function')stopFeedback();}};finishFeedback=finish;
      const alive=()=>!disposed&&token===revision&&current();
      try{
        const previous=Object.fromEntries(fields.map(f=>[f.name,value(f.name)||initialValues.get(f.name)])),args={deviceId,action:action.id,package:value('package'),user:value('user')||initialValues.get('user')||'current',path:value('path'),direction:value('direction'),mode:value('mode')};
        const packageUser=$('wb-field-package')?.dataset?.user;
        if(packageUser!==undefined){if(!validUser(packageUser))throw new Error('선택한 앱의 사용자 번호를 확인하지 못했습니다. 앱을 다시 선택하세요.');args.user=String(packageUser);previous.user=args.user;}
        const kinds=[...new Set(fields.map(f=>kindFor(action,f)))],fetched=[];
        if(kinds.includes('users-current')){
          const users=await request('workbench-options',{...args,kind:'users-current'});if(!alive())return;validateResponse(users);
          if(args.user==='current'){
            if(!/^(?:0|[1-9]\d{0,4})$/.test(String(users.user??'')))throw new Error('현재 사용자 번호를 확인하지 못했습니다. 목록을 다시 읽으세요.');
            args.user=String(users.user);previous.user=args.user;
          }
          if(!users.options.some(item=>String(item.value)===args.user))throw new Error('고정할 사용자가 목록에 없습니다. 앱 또는 사용자를 다시 선택하세요.');
          fetched.push(['users-current',users]);
        }
        fetched.push(...await Promise.all(kinds.filter(kind=>kind!=='users-current').map(async kind=>[kind,await request('workbench-options',{...args,kind})])));
        if(!alive())return;
        for(const [kind,response]of fetched){validateResponse(response);if(kind!=='users-current'&&response.user!==undefined&&args.user!=='current'&&String(response.user)!==String(args.user))throw new Error('조회 대상 사용자가 바뀌었습니다. 목록을 다시 읽으세요.');}
        const map=new Map(fetched);
        for(const f of fields){let options=map.get(kindFor(action,f)).options||[];if(kindFor(action,f)==='users-current'){options=[{value:'current',label:'현재 사용 중인 사용자'},...options];if(f.name==='user'&&args.user!=='current'&&!options.some(item=>String(item.value)===args.user))throw new Error('고정할 사용자가 목록에 없습니다. 목록을 다시 읽으세요.');}fill(f.name,options,previous[f.name]||String(f.value??''));}
        if(editor){const data=await request('file-text-read',args);if(!alive())return;if(!data||typeof data.text!=='string'||typeof data.sha256!=='string'||!/^[a-f0-9]{64}$/i.test(data.sha256)||!Number.isSafeInteger(data.bytes)||data.bytes<0)throw new Error('파일 내용 응답 형식이 올바르지 않습니다. 다시 읽으세요.');originalText=data.text;$('wb-field-text').value=data.text;$('wb-field-originalHash').value=data.sha256;successMessage=`${data.bytes.toLocaleString()}바이트 · 저장 전 원본 변경 여부를 확인합니다.`;}
        else successMessage=args.user!=='current'?`사용자 ${args.user}에 고정했습니다. 목록에서 선택하세요.`:'목록에서 선택하세요. 선택만으로 실행되지 않습니다.';
        initialValues.clear();loaded=true;refreshReady();
      }catch(error){if(alive()){const detail=error?.message||'기기 응답을 확인할 수 없습니다.';showState('error',(editor?'파일을':'선택 목록을')+' 읽지 못했습니다. '+detail);onError(message.textContent);onBusy(true);updateControls(false);}}
      finally{finish();if(finishFeedback===finish)finishFeedback=null;if(alive()){progress.hidden=true;retry.disabled=false;retry.textContent=retryLabel;retry.setAttribute('aria-busy','false');status.setAttribute('aria-busy','false');}}
    }
    const change=event=>{if(event.target.id==='wb-field-user'&&$('wb-field-package')?.dataset)delete $('wb-field-package').dataset.user;const changedField=fields.find(f=>'wb-field-'+f.name===event.target.id);if(changedField&&optionValues.get(changedField.name)?.has(value(changedField.name)))choiceStates.delete(changedField.name);if(['wb-field-package','wb-field-user','wb-field-direction','wb-field-mode',...(editor?['wb-field-path']:[])].includes(event.target.id))load();else if(changedField)refreshReady();};
    box.addEventListener('change',change);retry.onclick=()=>{if(!retry.disabled)return load();};load();
    return {dispose(){disposed=true;ready=false;revision++;finishFeedback?.();finishFeedback=null;retry.disabled=true;retry.setAttribute('aria-busy','false');status.setAttribute('aria-busy','false');box.removeEventListener('change',change);},get ready(){return !disposed&&current()&&ready;},readValue(name){return name==='text'&&editor?serializeText(value(name),originalText):value(name);}};
  }
  window.WorkbenchFields={mount,kindFor,serializeText};
})();
