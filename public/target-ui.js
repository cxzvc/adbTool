(() => {
  const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const s={id:null,epoch:0,apps:[],files:[],file:null,app:null,path:'/sdcard',picker:null,request:0};
  const appScope=()=>String(window.AppInventory?.user??'current');
  const appUser=()=>appScope()==='current'?String(window.AppInventory?.currentUser??'current'):appScope();
  const parent=p=>p.replace(/\/$/,'').slice(0,p.replace(/\/$/,'').lastIndexOf('/'))||'/';
  const base=p=>p.replace(/\/$/,'').split('/').at(-1)||'/';
  const join=(dir,name)=>dir.replace(/\/$/,'')+'/'+name;
  function fileExplanation(raw,path){
    const rawError=String(raw?.rawError||raw?.message||raw||'');const shared=window.DeskErrors?.explain?.(rawError,{context:'files',action:'list',path});if(shared)return shared;
    const denied=/permission denied|access(?: is)? denied|operation not permitted|EACCES|EPERM|권한.*(?:거부|없|부족)|접근.*거부/i.test(rawError),offline=/offline|오프라인|failed to fetch|network|연결.*(?:실패|끊)/i.test(rawError);
    return{code:offline?'offline':denied?'permission_denied':'file_read_failed',titleKo:offline?'기기 연결을 확인하세요':denied?'이 폴더에 접근할 수 없습니다':'폴더 목록을 확인하지 못했습니다',reasonKo:offline?'기기 또는 PC 서버의 응답을 받지 못했습니다.':denied?'현재 ADB 연결의 접근 범위로 이 경로의 내용을 읽지 못했습니다.':/[가-힣]/.test(rawError)?rawError:'기기에서 폴더 목록을 읽지 못했습니다. 오류 원문을 보관했습니다.',requiredAccessKo:denied?'폴더와 상위 경로의 조회 권한이 필요합니다. 소유자·Android 저장소 정책·SELinux 중 어느 제한인지는 이 오류만으로 확정할 수 없습니다.':'',alternativesKo:denied?['상위 폴더 또는 Download 등 접근 가능한 공유 저장소를 목록에서 선택하세요.','파일 정보에서 소유자와 권한을 조회하거나, 앱의 내보내기 기능으로 제공되는 파일인지 확인하세요.']:['연결 상태와 경로를 확인한 뒤 다시 조회하세요.'],rawError,recognized:denied||offline};
  }
  const issueText=value=>typeof value==='string'?value:[value?.path,value?.rawError||value?.message||value?.reason||value?.error||'목록 일부를 확인하지 못했습니다.'].filter(Boolean).join(': ');
  function listingIssues(data){const errors=[...(Array.isArray(data.errors)?data.errors:[]),...(Array.isArray(data.warnings)?data.warnings:[]),...(Array.isArray(data.denied)?data.denied:[])].map(issueText);if(data.error)errors.unshift(issueText(data.error));if(data.readable===false)errors.unshift(issueText(data.reason||'이 경로의 내용을 읽을 수 없습니다.'));if(data.partial&&!errors.length)errors.push('폴더 목록을 일부만 확인했습니다. 전체 목록인지 확인할 수 없습니다.');return [...new Set(errors)];}
  const errorNotes=detail=>[detail.requiredAccessKo?`필요한 접근: ${detail.requiredAccessKo}`:'',...(Array.isArray(detail.alternativesKo)?detail.alternativesKo:detail.alternativesKo?[detail.alternativesKo]:[]).map(value=>'대안: '+value)].filter(Boolean).join('\n');
  const isFolder=f=>f.type==='directory';
  const textCandidate=f=>f.type==='file'&&(!Number.isFinite(f.size)||f.size<=1024*1024)&&!(/\.(apk|zip|tar|gz|png|jpg|jpeg|webp|gif|mp4|mp3|pdf|so|dex)$/i.test(f.name));
  function reveal(id){
    const panel=$(id);if(panel.hidden||!panel.getClientRects().length||document.querySelector('dialog[open]'))return;
    const inspector=panel.closest('.desk-inspector');
    if(inspector){
      const box=panel.getBoundingClientRect(),bounds=inspector.getBoundingClientRect(),heading=inspector.querySelector('.desk-inspector-heading')?.offsetHeight||0;
      if(inspector.scrollHeight>inspector.clientHeight&&(box.top<bounds.top+heading+6||box.top>bounds.bottom-48))inspector.scrollTo({top:Math.max(0,inspector.scrollTop+box.top-bounds.top-heading-6),behavior:'auto'});
      return;
    }
    const box=panel.getBoundingClientRect(),top=document.querySelector('.device-tabs')?.getBoundingClientRect().bottom||0;if(box.top<top+6||box.bottom>innerHeight)panel.scrollIntoView({block:'nearest'});
  }
  function refresh(){
    $('file-selection-preview').hidden=!s.file||s.file.type!=='file'||!window.FileMedia?.canPreview(s.file.path);$('file-selection-archive').hidden=!s.file||s.file.type!=='file'||!window.FileMedia?.canArchive(s.file.path);$('file-selection-zip').disabled=!s.file||s.file.type==='link';
    $('file-selection').hidden=!s.file;$('app-selection').hidden=!s.app;
    $('file-selection-name').textContent=s.file?(isFolder(s.file)?'폴더: ':'파일: ')+s.file.name:'';
    $('file-selection-path').textContent=s.file?.path||'';
    $('file-selection-open').hidden=!s.file||!isFolder(s.file);$('file-selection-download').hidden=!s.file||s.file.type!=='file';
    $('app-selection-name').textContent=s.app?.label||s.app?.package||'';$('app-selection-info').textContent=s.app?[s.app.label?s.app.package:null,s.app.kind==='system'?'기본 앱':s.app.kind==='user'?'사용자 앱':'앱 종류 미확인',s.app.enabled===true?'활성':s.app.enabled===false?'비활성':'활성 상태 미확인',`사용자 ${s.app.userId??appUser()}`].filter(Boolean).join(' · '):'';
    $('app-selection-open').disabled=!s.app||s.app.enabled===false||s.app.launchable===false;
    $('app-selection-toggle').textContent=s.app?.enabled===true?'비활성화':s.app?.enabled===false?'활성화':'활성 상태 미확인';$('app-selection-toggle').disabled=typeof s.app?.enabled!=='boolean';
    for(const row of document.querySelectorAll('[data-file-row]')){const selected=row.dataset.fileRow===s.file?.path;row.classList.toggle('target-selected',selected);row.querySelector('[data-path]')?.setAttribute('aria-pressed',String(selected));}
    for(const row of document.querySelectorAll('[data-app-row]')){const selected=row.dataset.appRow===s.app?.package;row.classList.toggle('target-selected',selected);row.querySelector('[data-select-package]')?.setAttribute('aria-pressed',String(selected));}
    window.Workbench?.refreshTargets();window.GpsIndicator?.selectApp(s.app,appUser());
  }
  function selectFile(file){s.file=file?{...file,name:file.name||base(file.path)}:null;refresh();if(s.file)reveal('file-selection');}
  function selectApp(value){s.app=typeof value==='string'?s.apps.find(a=>a.package===value)||null:value;refresh();if(s.app){window.AppKnowledge?.show(s.app.package);reveal('app-selection');}else window.AppKnowledge?.clear();}
  function updateFiles(data){window.FileBatch?.updateFiles(data);const moved=s.path!==data.path;s.files=data.entries;s.path=data.path;if(moved)s.file=null;else if(s.file&&parent(s.file.path)===data.path)s.file=s.files.find(f=>f.path===s.file.path)||null;refresh();}
  function updateApps(data){window.AppBatch?.updateApps(data);s.apps=data.map(app=>({...app,userId:String(app.userId??appUser())}));s.appsUser=appUser();if(s.app)s.app=s.apps.find(a=>a.package===s.app.package)||null;refresh();}
  function appScopeChanged(){s.apps=[];s.appsUser=null;s.app=null;if(s.picker?.type==='app')closePicker();window.AppKnowledge?.clear();$('apps-restore-package').value='';delete $('apps-restore-package').dataset.user;refresh();}
  function closePicker(value=null){const picker=s.picker;s.picker=null;s.request++;picker?.abort?.abort();picker?.finish?.();const dialog=$('target-picker');if(dialog.open)dialog.close();$('target-picker-loading').hidden=true;$('target-picker-list').inert=false;picker?.resolve(value);if(picker?.returnFocus?.isConnected!==false&&(!picker?.ownerDialog||picker.ownerDialog.open))picker?.returnFocus?.focus?.();}
  function pickerCurrent(p){if(p!==s.picker||p.deviceId!==s.id||p.epoch!==s.epoch)return false;if(p.ownerDialog&&!p.ownerDialog.open){closePicker();return false;}if(p.type==='app'&&(p.scope!==appScope()||p.scopeUser!==appUser())){closePicker();return false;}return true;}
  async function read(url,signal){const r=await fetch(url,{cache:'no-store',...(signal?{signal}:{})}),data=await r.json();if(!r.ok)throw new Error(data.error||'목록을 읽지 못했습니다.');return data;}
  function pickerState(p,{type,title,message='',actionLabel,onAction,rawError,errorContext,requiredAccessKo,alternativesKo}){
    const host=$('target-picker-list'),revision=s.request;
    const action=onAction?()=>{if(!p.loading&&revision===s.request&&pickerCurrent(p))return onAction();}:undefined;
    p.stateAction=action;host.dataset.state=type;window.PopupHelp?.update($('target-picker'),{status:[title,message].filter(Boolean).join(' · '),supportReason:requiredAccessKo||undefined,...(['error','offline'].includes(type)?{checkedAt:null}:{})});
    if(window.DeskFeedback?.state)window.DeskFeedback.state(host,{type,title,message,actionLabel,onAction:action,rawError,errorContext,requiredAccessKo,alternativesKo});
    else host.innerHTML=`<div class="ops-empty" role="status"><strong>${esc(title)}</strong>${message?`<p class="ops-note">${esc(message)}</p>`:''}${requiredAccessKo||alternativesKo?`<p>${esc(errorNotes({requiredAccessKo,alternativesKo})).replaceAll('\n','<br>')}</p>`:''}${rawError?`<details><summary>오류 원문</summary><pre>${esc(rawError)}</pre></details>`:''}${action?`<button type="button" class="ops-link-button" data-picker-state-action>${esc(actionLabel||'다시 조회')}</button>`:''}</div>`;
  }
  function pickerFileError(p,raw,partial=false){const detail=fileExplanation(raw,p.requestPath),context={context:'files',action:'list',path:p.requestPath};pickerState(p,{type:partial?'warning':/offline|network|connection-failed|device_not_found/i.test(detail.code||'')?'offline':'error',title:partial?'폴더 목록을 일부만 확인했습니다':detail.titleKo,message:[p.requestPath,detail.reasonKo,partial?'표시된 항목 외의 내용을 확인하지 못했습니다. 현재 폴더 선택은 전체 조회 후 가능합니다.':''].filter(Boolean).join('\n'),rawError:detail.rawError||String(raw),errorContext:context,requiredAccessKo:detail.requiredAccessKo,alternativesKo:detail.alternativesKo,actionLabel:'다시 조회',onAction:retryPicker(p)});}
  function retryPicker(p){return()=>loadPicker(p.requestPath,{force:true,button:document.activeElement?.tagName==='BUTTON'?document.activeElement:undefined});}
  function drawPicker(){
    const p=s.picker;if(!p||p.loading||p.error)return;const q=$('target-picker-search').value.toLowerCase().trim();
    const entries=p.entries.filter(e=>[e.package,e.label,e.name,e.knowledge?.title,e.knowledge?.summary].filter(Boolean).join(' ').toLowerCase().includes(q));
    $('target-picker-count').textContent=q?`${entries.length}개 / 전체 ${p.entries.length}개`:`${entries.length}개`;
    if(p.partial){$('target-picker-count').textContent=`확인된 ${entries.length}개 · 일부 조회`;pickerFileError(p,p.issues.join('\n'),true);if(!entries.length)return;}
    if(!entries.length){
      if(p.entries.length&&q)pickerState(p,{type:'empty',title:'검색 결과가 없습니다',message:'검색어를 바꾸거나 지우면 이 위치의 목록을 다시 볼 수 있습니다.',actionLabel:'검색어 지우기',onAction:()=>{$('target-picker-search').value='';drawPicker();}});
      else pickerState(p,{type:'empty',title:p.type==='app'?(p.restorable?'복원할 기본 앱이 없습니다':'표시할 앱이 없습니다'):p.totalEntries===0?'빈 폴더입니다':p.type==='folder'?'선택할 하위 폴더가 없습니다':'선택할 텍스트 파일이 없습니다',message:p.type==='folder'?'아래에서 현재 폴더를 선택하거나 다른 위치로 이동하세요.':p.type==='app'?`사용자 ${p.user}의 조회 결과입니다.`:'다른 폴더를 선택하거나 목록을 다시 조회하세요.',actionLabel:'다시 조회',onAction:retryPicker(p)});
      return;
    }
    if(!p.partial){p.stateAction=null;delete $('target-picker-list').dataset.state;}
    const rows=entries.map((e,i)=>`<div class="target-pick-row ${p.chosen===(e.package||e.path)?'chosen':''}"><button type="button" data-pick-index="${p.entries.indexOf(e)}"><strong>${esc(e.label||e.package||e.name)}</strong><small>${p.type==='app'?esc([e.label?e.package:null,e.restorable?'선택한 사용자에서 제거된 기본 앱':e.kind==='system'?'기본 앱':e.kind==='user'?'사용자 앱':'앱 종류 미확인',`사용자 ${e.userId??p.user}`].filter(Boolean).join(' · ')):e.type==='directory'?'폴더':e.type==='link'?'연결 경로':DeskUI.formatBytes(e.size)}</small></button>${p.type!=='app'&&e.type!=='file'?`<button type="button" data-pick-open="${p.entries.indexOf(e)}">열기 ›</button>`:''}</div>`).join('');
    if(p.partial){const host=$('target-picker-list');if(host.insertAdjacentHTML)host.insertAdjacentHTML('beforeend',rows);else host.innerHTML+=rows;}else $('target-picker-list').innerHTML=rows;
  }
  async function loadPicker(path,{force=false,button}={}){
    const p=s.picker;if(!p||!pickerCurrent(p))return;const request=++s.request,epoch=s.epoch;p.loading=true;p.error=false;p.partial=false;p.issues=[];p.chosen=null;p.abort?.abort();p.finish?.();p.abort=typeof AbortController==='function'?new AbortController():null;
    p.requestPath=(path||p.path||'/sdcard').replace(/\/+/g,'/');p.entries=[];p.navigationParent=p.requestPath==='/'?null:parent(p.requestPath);
    const label=p.type==='app'?'앱 목록 조회 중':'폴더 목록 조회 중';
    let stopped=false;const finishShared=window.DeskFeedback?.start?.(label,{button});if(!finishShared)button?.setAttribute?.('aria-busy','true');
    const finish=()=>{if(stopped)return;stopped=true;finishShared?.();if(!finishShared)button?.removeAttribute?.('aria-busy');};p.finish=finish;
    $('target-picker-loading').hidden=false;$('target-picker-error').hidden=true;$('target-picker-choose').disabled=true;$('target-picker-list').inert=true;$('target-picker-search').disabled=true;$('target-picker-count').textContent='조회 중';
    $('target-picker-selected').textContent=p.type==='app'?`사용자 ${p.user}의 앱을 조회하고 있습니다.`:'조회할 폴더: '+p.requestPath;
    if(p.type!=='app'){$('target-picker-path').textContent=p.requestPath;$('target-picker-up').disabled=!p.navigationParent;}
    pickerState(p,{type:'loading',title:label,message:p.type==='app'?`사용자 ${p.user}`:p.requestPath});
    try{
      if(p.type==='app'){
        if(!force&&!p.restorable&&s.apps.length&&p.user!=='current'&&s.appsUser===p.user)p.entries=s.apps;
        else{const data=await read('/api/device/apps?'+new URLSearchParams({id:p.deviceId,user:p.user,...(p.restorable?{restorable:'1'}:{})}),p.abort?.signal);if(request!==s.request||epoch!==s.epoch||!pickerCurrent(p))return;if(!Array.isArray(data?.apps))throw new Error('앱 목록 응답 형식을 확인할 수 없습니다. 다시 조회하세요.');const resolved=String(data.userId??p.user);if(p.user!=='current'&&resolved!==p.user)throw new Error('앱 목록의 사용자가 바뀌었습니다. 다시 선택하세요.');p.entries=data.apps.map(row=>({...row,userId:String(row.userId??resolved)}));if(p.entries.some(row=>row.userId!==resolved))throw new Error('앱 목록의 사용자 정보가 일치하지 않습니다. 다시 선택하세요.');}
      }else{
        const data=await read('/api/ops/files?'+new URLSearchParams({deviceId:p.deviceId,path:p.requestPath}),p.abort?.signal);
        if(request!==s.request||epoch!==s.epoch||!pickerCurrent(p))return;
        if(!data||typeof data.path!=='string'||!Array.isArray(data.entries))throw new Error('폴더 목록 응답 형식을 확인할 수 없습니다. 다시 조회하세요.');
        p.issues=listingIssues(data);p.partial=!!data.partial||p.issues.length>0;if(data.error||data.readable===false||!data.entries.length&&p.partial)throw new Error(p.issues.join('\n')||'폴더 목록을 확인할 수 없습니다.');
        if(p.path!==data.path)$('target-picker-search').value='';
        p.path=data.path;p.parent=data.parent;p.navigationParent=data.parent;p.totalEntries=data.entries.length;p.entries=p.type==='folder'?data.entries.filter(e=>e.type!=='file'):p.type==='text'?data.entries.filter(e=>e.type!=='file'||textCandidate(e)):data.entries;
        $('target-picker-path').textContent=p.path;$('target-picker-up').disabled=!p.parent;
      }
      if(request!==s.request||epoch!==s.epoch||!pickerCurrent(p))return;
      window.PopupHelp?.update($('target-picker'),{path:p.type==='app'?null:p.path,userId:p.type==='app'?p.user:null,status:(p.type==='app'?'앱':'파일·폴더')+' 목록 '+p.entries.length+'개'+(p.partial?' · 일부만 확인':' · 선택 대기'),checkedAt:Date.now()});p.loading=false;p.chosen=null;$('target-picker-search').disabled=false;$('target-picker-selected').textContent=p.type==='folder'?'선택할 폴더: '+p.path:'목록에서 대상을 선택하세요.';
      $('target-picker-choose').disabled=p.type!=='folder'||p.partial;drawPicker();
    }catch(error){if(request===s.request&&pickerCurrent(p)){p.error=true;p.entries=[];$('target-picker-error').hidden=true;$('target-picker-error').textContent=error.message;$('target-picker-count').textContent='조회 실패';$('target-picker-selected').textContent=p.type==='app'?'앱 목록을 확인하지 못했습니다.':'조회하지 못한 폴더: '+p.requestPath;if(p.type!=='app')pickerFileError(p,error.message);else pickerState(p,{type:/offline|오프라인|failed to fetch|network|연결.*(?:실패|끊)/i.test(error.message)?'offline':'error',title:'목록을 읽지 못했습니다',message:error.message,actionLabel:'다시 조회',onAction:retryPicker(p)});}}
    finally{finish();if(p.finish===finish)p.finish=null;if(request===s.request&&p===s.picker){p.loading=false;$('target-picker-loading').hidden=true;$('target-picker-list').inert=false;}}
  }
  function pick(type,{startPath,restorable=false,title}={}){
    if(!s.id)return Promise.resolve(null);if(s.picker)closePicker();
    return new Promise(resolve=>{const returnFocus=document.activeElement;s.picker={type,restorable,resolve,entries:[],path:startPath||s.path,chosen:null,user:appUser(),scope:appScope(),scopeUser:appUser(),deviceId:s.id,epoch:s.epoch,returnFocus,ownerDialog:returnFocus?.closest?.('dialog')||null};$('target-picker-title').textContent=title||(type==='app'?(restorable?'복원할 기본 앱 선택':'앱 선택'):type==='folder'?'폴더 선택':type==='text'?'텍스트 파일 선택':'파일·폴더 선택');$('target-picker-nav').hidden=type==='app';$('target-picker-search').value='';$('target-picker-list').innerHTML='';$('target-picker-choose').textContent=type==='folder'?'이 폴더 선택':'선택한 대상 사용';window.PopupHelp?.show($('target-picker'),'target-picker',{deviceId:s.id,userId:type==='app'?s.picker.user:null,path:type==='app'?null:startPath||s.path,status:'선택 목록 조회 전 · 선택만으로 작업을 실행하지 않습니다.'});$('target-picker').showModal();loadPicker(startPath||s.path);});
  }
  $('target-picker-close').onclick=()=>closePicker();$('target-picker').addEventListener('cancel',e=>{e.preventDefault();closePicker();});
  $('target-picker').addEventListener('close',()=>{if(!$('target-picker').open&&s.picker)closePicker();});
  $('target-picker-up').onclick=()=>s.picker?.navigationParent&&loadPicker(s.picker.navigationParent,{button:$('target-picker-up')});$('target-picker-home').onclick=()=>loadPicker('/sdcard',{button:$('target-picker-home')});$('target-picker-root').onclick=()=>loadPicker('/',{button:$('target-picker-root')});
  $('target-picker-search').oninput=drawPicker;
  $('target-picker-list').onclick=e=>{const p=s.picker;if(!p||p.loading||!pickerCurrent(p))return;if(e.target.closest('[data-picker-state-action]')){p.stateAction?.();return;}const open=e.target.closest('[data-pick-open]');if(open){const entry=p.entries[Number(open.dataset.pickOpen)];if(entry&&entry.type!=='file')loadPicker(entry.path,{button:open});return;}const b=e.target.closest('[data-pick-index]');if(!b)return;const entry=p.entries[Number(b.dataset.pickIndex)];if(!entry)return;if(p.type==='folder'||p.type==='text'&&entry.type!=='file'){loadPicker(entry.path,{button:b});return;}p.chosen=entry.package||entry.path;window.PopupHelp?.update($('target-picker'),{selection:'선택: '+p.chosen,status:'선택 버튼을 누르면 원래 작업 창으로 돌아갑니다.'});$('target-picker-selected').textContent=p.chosen;$('target-picker-choose').disabled=false;drawPicker();};
  $('target-picker-list').ondblclick=e=>{const b=e.target.closest('[data-pick-index]'),p=s.picker;if(!b||!p||p.loading||p.type==='app'||!pickerCurrent(p))return;const entry=p.entries[Number(b.dataset.pickIndex)];if(entry&&entry.type!=='file')loadPicker(entry.path);};
  $('target-picker-choose').onclick=()=>{const p=s.picker;if(!p||p.loading||$('target-picker-choose').disabled||!pickerCurrent(p))return;const chosen=p.type==='folder'?{path:p.path,name:base(p.path),type:'directory'}:p.entries.find(e=>(e.package||e.path)===p.chosen);if(chosen)closePicker(chosen);};

  function available(action){
    if(action.group==='files'){
      const f=s.file;if(!f)return false;
      if(action.id==='folder-download')return isFolder(f);
      if(['file-text','file-text-save'].includes(action.id))return textCandidate(f);
      if(action.id==='file-checksum')return f.type==='file';
      if(action.id==='file-inspect')return true;
      if(['/','/sdcard','/storage','/storage/emulated','/storage/emulated/0','/data','/system','/vendor','/product','/proc','/sys','/dev'].includes(f.path.replace(/\/$/,'')||'/'))return false;
      return action.id!=='file-chmod'||f.type!=='link';
    }
    if(action.group==='apps'||action.id.startsWith('appdata-'))return !!s.app;
    return true;
  }
  async function prepare(action,prefill){
    const values={...prefill},epoch=s.epoch,id=s.id,scope=appScope(),scopeUser=appUser(),current=()=>id===s.id&&epoch===s.epoch;
    if(action.group==='files'&&!values.path){const file=s.file||await pick(action.id==='folder-download'?'folder':['file-text','file-text-save'].includes(action.id)?'text':'entry');if(!file||!current())return null;selectFile(file);values.path=file.path;}
    if(action.fields.some(f=>f.name==='package'&&f.required)&&!values.package){const app=s.app||await pick('app');if(!app||!current()||scope!==appScope()||scopeUser!==appUser())return null;selectApp(app);values.package=app.package;}
    if(values.user==null&&action.fields.some(f=>f.name==='user')&&(action.group==='apps'||action.id.startsWith('appdata-')||values.package))values.user=String(s.app?.package===values.package?s.app.userId??appUser():appUser());
    return values;
  }
  function decorate(action,values){
    const pkg=$('wb-field-package');
    if(pkg){pkg.readOnly=true;pkg.placeholder='목록에서 앱을 선택하세요';const button=document.createElement('button');button.type='button';button.className='target-select-button';button.textContent='앱 목록에서 선택';button.onclick=async()=>{const epoch=s.epoch,app=await pick('app');if(app&&epoch===s.epoch&&$('wb-field-package')===pkg){pkg.value=app.package;pkg.dataset.user=String(app.userId??appUser());const user=$('wb-field-user');if(user)user.value=pkg.dataset.user;selectApp(app);pkg.dispatchEvent(new Event('change',{bubbles:true}));}};pkg.after(button);if(!action.fields.find(f=>f.name==='package').required){const clear=document.createElement('button');clear.type='button';clear.className='target-select-button';clear.textContent='전체 앱';clear.onclick=()=>{pkg.value='';delete pkg.dataset.user;pkg.dispatchEvent(new Event('change',{bubbles:true}));};button.after(clear);}}
    const source=$('wb-field-path');
    if(source&&action.group==='files'){
      source.readOnly=true;const button=document.createElement('button');button.type='button';button.className='target-select-button';button.textContent='목록에서 대상 변경';button.onclick=async()=>{const epoch=s.epoch,file=await pick(action.id==='folder-download'?'folder':['file-text','file-text-save'].includes(action.id)?'text':'entry',{startPath:source.value?parent(source.value):s.path});if(file&&epoch===s.epoch&&$('wb-field-path')===source){source.value=file.path;selectFile(file);source.dispatchEvent(new Event('change',{bubbles:true}));if($('wb-field-name'))$('wb-field-name').value=file.name;if($('wb-destination-name')){$('wb-destination-name').value=file.name+(action.id==='file-copy'?'-복사본':'');$('wb-destination-name').dispatchEvent(new Event('input'));}}};source.after(button);
    }
    const target=$('wb-field-target');
    if(target&&['file-move','file-copy'].includes(action.id)){
      target.type='hidden';const label=target.closest('label');label.classList.add('destination-field');label.querySelector('span').textContent='목적지 폴더와 이름';
      const directory=action.id==='file-copy'?parent(values.path):'',name=base(values.path)+(action.id==='file-copy'?'-복사본':'');
      const box=document.createElement('div');box.className='destination-controls';box.innerHTML=`<input id="wb-destination-dir" readonly value="${esc(directory)}" placeholder="폴더를 목록에서 선택하세요" aria-label="목적지 폴더"><button type="button" id="wb-destination-pick">목적지 폴더 선택</button><span>저장할 파일·폴더 이름</span><input id="wb-destination-name" value="${esc(name)}" required aria-label="목적지 이름">`;target.after(box);
      const update=()=>{const n=$('wb-destination-name'),d=$('wb-destination-dir');target.value=d.value&&n.value?join(d.value,n.value):'';n.setCustomValidity(!d.value?'목적지 폴더를 목록에서 선택하세요.':!n.value||/[\\/\x00-\x1f]/.test(n.value)||['.','..'].includes(n.value)?'이름만 입력하세요. 경로는 폴더 선택으로 지정합니다.':target.value===values.path?'원본과 다른 폴더나 이름을 선택하세요.':'');};
      $('wb-destination-name').oninput=update;$('wb-destination-pick').onclick=async()=>{const epoch=s.epoch,folder=await pick('folder',{startPath:$('wb-destination-dir').value||parent(values.path),title:'목적지 폴더 선택'});if(folder&&epoch===s.epoch&&$('wb-field-target')===target){$('wb-destination-dir').value=folder.path;update();}};update();
    }
  }
  $('app-tools-jump').onclick=()=>{if(s.app)$('app-selection').scrollIntoView({block:'start',behavior:'smooth'});};
  $('file-tools-jump').onclick=()=>{if(s.file)$('file-selection').scrollIntoView({block:'start',behavior:'smooth'});};
  $('file-selection-clear').onclick=()=>selectFile(null);$('app-selection-clear').onclick=()=>selectApp(null);
  $('file-selection-open').onclick=()=>s.file&&window.DeviceOps?.browse(s.file.path);
  $('file-selection-preview').onclick=()=>s.file&&window.FileMedia?.openPreview({deviceId:s.id,...s.file});
  $('file-selection-archive').onclick=()=>s.file&&window.FileMedia?.openArchive({deviceId:s.id,...s.file});
  $('file-selection-zip').onclick=()=>s.file&&window.FileMedia?.openCreate({deviceId:s.id,paths:[s.file.path]});
  $('file-selection-download').onclick=()=>s.file&&window.DeviceOps?.downloadSelected(s.file.path);
  for(const [id,action] of [['app-selection-stop','force-stop'],['app-selection-remove','uninstall-user'],['app-selection-backup','backup-apk']])$(id).onclick=()=>s.app&&window.DeviceOps?.selectedAppAction(s.app.package,action,String(s.app.userId??appUser()));
  $('app-selection-toggle').onclick=()=>typeof s.app?.enabled==='boolean'&&window.DeviceOps?.selectedAppAction(s.app.package,s.app.enabled?'disable':'enable',String(s.app.userId??appUser()));
  $('logs-pick-app').onclick=async()=>{const epoch=s.epoch,app=await pick('app');if(app&&epoch===s.epoch){$('logs-package').value=app.package;$('logs-package').dataset.user=String(app.userId??appUser());$('logs-package').dispatchEvent(new Event('change'));}};
  $('logs-clear-app').onclick=()=>{$('logs-package').value='';delete $('logs-package').dataset.user;$('logs-package').dispatchEvent(new Event('change'));};
  $('apps-pick-restore').onclick=async()=>{const epoch=s.epoch,app=await pick('app',{restorable:true});if(app&&epoch===s.epoch){$('apps-restore-package').value=app.package;$('apps-restore-package').dataset.user=String(app.userId??appUser());}};
  window.DeviceTargets={get file(){return s.file;},get app(){return s.app;},pick,cancelPicker(owner){if(!owner||!s.picker?.ownerDialog||s.picker.ownerDialog===owner)closePicker();},prepare,decorate,available,selectFile,selectApp,updateFiles,updateApps,appScopeChanged,
    open(id){closePicker();window.FileBatch?.open(id);window.AppBatch?.open(id);window.AppKnowledge?.clear();s.epoch++;s.id=id;s.file=null;s.app=null;s.files=[];s.apps=[];s.appsUser=null;s.path='/sdcard';refresh();},
    close(){window.FileBatch?.close();window.AppBatch?.close();window.AppKnowledge?.clear();s.epoch++;s.id=null;s.file=null;s.app=null;s.files=[];s.apps=[];closePicker();refresh();},
  };
})();
