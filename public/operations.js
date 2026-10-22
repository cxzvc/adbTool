(() => {
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const s = { id:null, epoch:0, tab:'screen', path:'/sdcard', logs:[], seen:new Set(), logAfter:0, status:null, busy:new Set(), jobs:new Map(), package:null, action:null, snapshot:0 };
  const bytes = DeskUI.formatBytes;
  const uploadControllers=new Map();
  const pauseUpload=progress=>{uploadControllers.get(progress)?.abort();};
  $('files-upload-pause').onclick=()=>pauseUpload('files-upload-progress');$('apps-upload-pause').onclick=()=>pauseUpload('apps-upload-progress');
  s.processSort={key:'cpu',direction:'desc'};
  const when = value => new Date(value).toLocaleString('ko-KR',{hour12:false});
  const feedback = (text,error=false,recovery) => {delete $('device-feedback').dataset.source;delete $('device-feedback').dataset.operation;if(error&&DeskFeedback.state){DeskFeedback.state($('device-feedback'),{type:'error',title:'요청을 완료하지 못했습니다',message:text,rawError:text,errorContext:{context:s.tab==='monitor'?'diagnostics':s.tab==='apps'?'apps':s.tab==='files'?'files':s.tab==='logs'?'logs':'workbench'},...(recovery?{actionLabel:recovery.label,onAction:recovery.run}:{})});return;} $('device-feedback').hidden=!text; $('device-feedback').textContent=text; $('device-feedback').classList.toggle('failure',error); };
  async function api(route,params={},body,request={}) {
    const labels={logs:'로그 조회',status:'기기 상태·프로세스 조회',backups:'APK 백업 목록 조회',capabilities:'기기 기능 확인','process-info':'프로세스 종료 범위 확인','process-stop':'프로세스 종료 요청',transfer:'파일 전송 요청',pull:'파일 다운로드 요청',mkdir:'폴더 생성',install:'APK 설치 요청','backup-apk':'APK 백업 요청','restore-apk':'APK 복원 요청','package-action':'앱 작업 요청',bugreport:'버그 리포트 생성 요청'};
    const buttonIds={logs:'logs-refresh',status:'monitor-refresh',backups:'apps-backups-refresh',mkdir:'files-mkdir',bugreport:'monitor-bugreport','process-info':'process-stop-run','package-action':'package-confirm-run'};const finish=labels[route]?DeskFeedback.start(labels[route],{button:buttonIds[route]?$(buttonIds[route]):undefined}):()=>{};
    try {
    const url='/api/ops/'+route+(body?'':'?'+new URLSearchParams(params));
    const options={cache:'no-store',...(request.signal?{signal:request.signal}:{})};
    if(body){
      const epoch=s.epoch,deviceId=s.id,userRevision=typeof appScopeRevision==='number'?appScopeRevision:0;
      const tokenResponse=await fetch('/api/session',{cache:'no-store',...(request.signal?{signal:request.signal}:{})});
      if(!tokenResponse.ok)throw new Error('서버 연결을 확인한 뒤 다시 시도해 주세요.');
      const token=await tokenResponse.json();
      if(body.deviceId&&(epoch!==s.epoch||deviceId!==s.id)||body.userId!=null&&userRevision!==(typeof appScopeRevision==='number'?appScopeRevision:0))throw new Error('대상 기기 또는 사용자·프로필이 변경되어 요청을 취소했습니다.');
      Object.assign(options,{method:'POST',headers:{'Content-Type':'application/json','X-ADB-Desk-Token':token.csrfToken},body:JSON.stringify(body)});
    }
    const response=await fetch(url,options); const data=await response.json();if(!response.ok){const error=new Error(data.error||'요청을 처리하지 못했습니다.');error.status=response.status;throw error;}return data;
    } finally {finish();}
  }
  async function guarded(key,fn) {
    if(!s.id||s.busy.has(key))return;
    if(typeof $==='function'&&$('device-feedback')?.dataset?.operation===key){delete $('device-feedback').dataset.operation;feedback('');}
    const epoch=s.epoch,lease={};s.busyLeases??=new Map();s.busyLeases.set(key,lease);s.busy.add(key);
    try{await fn(epoch);}catch(error){if(epoch===s.epoch&&s.busyLeases.get(key)===lease){const readers={files:()=>loadFiles(),status:()=>loadStatus(),jobs:()=>loadJobs(),backups:()=>loadBackups(),logs:()=>loadLogs(),mkdir:()=>loadFiles(),pull:()=>loadFiles(),transfer:()=>loadFiles(),install:()=>window.DeviceDesk?.refreshApps(),package:()=>window.DeviceDesk?.refreshApps(),restore:()=>window.DeviceDesk?.refreshApps()};if(key!=='files')feedback(error.message,true,readers[key]?{label:['files','mkdir','pull','transfer'].includes(key)?'파일 목록 다시 조회':['install','package','restore'].includes(key)?'앱 상태 다시 조회':'상태 다시 조회',run:()=>epoch===s.epoch?readers[key]():undefined}:null);if(key!=='files'&&typeof $==='function'&&$('device-feedback')?.dataset)$('device-feedback').dataset.operation=key;}}finally{if(epoch===s.epoch&&s.busyLeases.get(key)===lease){s.busyLeases.delete(key);s.busy.delete(key);}}
  }
  async function job(route,body) {const id=s.id,epoch=s.epoch,userRevision=typeof appScopeRevision==='number'?appScopeRevision:0;let result;for(;;){if(epoch!==s.epoch||body.userId!=null&&userRevision!==(typeof appScopeRevision==='number'?appScopeRevision:0))throw new Error('대상 기기 또는 사용자·프로필이 변경되어 대기 작업을 중단했습니다.');try{result=await api(route,{}, {deviceId:id,...body});break;}catch(error){if(error.status!==429)throw error;feedback('다른 작업이 완료될 때까지 대기합니다.');await new Promise(resolve=>setTimeout(resolve,2000));}}if(epoch===s.epoch){$('ops-jobs').hidden=false;$('ops-jobs').open=true;await loadJobs();}return result;}
  function download(text,name,type='text/plain;charset=utf-8') {const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
  async function upload(file,progress,id) {
    if(window.ResumableUpload){
      const epoch=s.epoch,controller=new AbortController(),button=$(progress==='apps-upload-progress'?'apps-upload-pause':'files-upload-pause'),finish=DeskFeedback.start('PC 파일 업로드·재개');
      uploadControllers.set(progress,controller);button.hidden=false;
      try{const staged=await ResumableUpload.upload(file,{deviceId:id,signal:controller.signal,onProgress:p=>{if(s.id===id&&s.epoch===epoch)$(progress).textContent=`${file.name} · ${({hashing:'파일 확인',verifying:'이전 조각 확인',uploading:'PC로 전송',finalizing:'전체 확인',complete:'준비 완료',restart:'처음부터 다시 전송'})[p.phase]||p.phase} ${Math.round(p.percent||0)}%${p.resumedBytes?' · 이어받기':''}`;}});if(s.id!==id||s.epoch!==epoch)throw new Error('기기가 변경되어 후속 전송을 취소했습니다.');return staged;}finally{if(uploadControllers.get(progress)===controller){uploadControllers.delete(progress);button.hidden=true;}finish();}
    }

    if(file.size>2*1024**3)throw new Error('파일당 최대 2GB까지 선택할 수 있습니다.');
    const token=await fetch('/api/session',{cache:'no-store'}).then(r=>r.json());
    if(s.id!==id)throw new Error('대상 기기가 변경되었습니다. 파일을 다시 선택하세요.');
    const finish=DeskFeedback.start('PC 파일 업로드');
    return new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open('POST','/api/ops/upload?name='+encodeURIComponent(file.name));xhr.setRequestHeader('X-ADB-Desk-Token',token.csrfToken);xhr.setRequestHeader('Content-Type','application/octet-stream');xhr.timeout=15*60*1000;
      xhr.upload.onprogress=e=>{if(s.id===id)$(progress).textContent=`${file.name} · PC → 서버 ${e.lengthComputable?Math.round(e.loaded/e.total*100)+'%':bytes(e.loaded)}`;};
      xhr.onerror=()=>reject(new Error('파일 업로드 연결이 끊겼습니다.'));xhr.ontimeout=()=>reject(new Error('파일 업로드 시간이 초과되었습니다.'));
      xhr.onload=()=>{try{const data=JSON.parse(xhr.responseText);xhr.status<300?resolve(data):reject(new Error(data.error));}catch(error){reject(error);}};xhr.send(file);
    }).finally(finish);
  }
  async function loadJobs(){return guarded('jobs',async epoch=>{const data=await api('jobs',{deviceId:s.id});if(epoch!==s.epoch)return;let refresh=false;
    for(const item of data.jobs){const old=s.jobs.get(item.id);if(item.state==='success'&&old?.state!=='success'&&window.Workbench?.readOnlyJob?.(item.kind)!==true)refresh=true;s.jobs.set(item.id,item);}
    $('ops-jobs').hidden=!data.jobs.length;$('ops-job-count').textContent=`${data.jobs.filter(j=>j.state==='running').length}개 진행 · ${data.jobs.length}개 기록`;
    $('ops-job-list').innerHTML=data.jobs.slice(0,20).map(j=>{const message=j.state==='error'&&window.DeskErrors?window.DeskErrors.explain(j.message,{context:'workbench',action:j.kind}).reasonKo:j.message||'ADB 작업을 처리하고 있습니다.';return `<div class="ops-job ${esc(j.state)}"><span class="ops-job-state">${({running:'진행 중',success:'완료',error:'실패',cancelled:'취소'})[j.state]}</span><div><strong>${esc(j.title)}</strong><p>${esc(message)}</p>${j.state==='running'?`<progress max="100" ${j.progress===null?'':`value="${j.progress}"`}></progress>`:''}</div><div>${j.state==='running'?j.kind==='log-capture'?`<button data-stop-capture="${esc(j.id)}">중지·저장</button>`:`<button data-cancel-job="${esc(j.id)}">취소</button>`:''}${j.output||j.state==='error'?`<button data-job-output="${esc(j.id)}">결과 보기</button>`:''}${j.state!=='running'&&j.downloadUrl?`<a class="ops-link-button" href="${esc(j.downloadUrl)}" download>다운로드</a>`:''}</div></div>`;}).join('');
    if(refresh){if(s.tab==='files'&&!s.busy.has('files'))loadFiles();if(s.tab==='apps'){$('apps-refresh').click();loadBackups();}if(s.tab==='monitor')loadStatus();}
  });}
  $('ops-job-list').addEventListener('click',e=>{const out=e.target.closest('[data-job-output]'),stop=e.target.closest('[data-stop-capture]');if(out)return window.Workbench?.showJob(s.jobs.get(out.dataset.jobOutput));if(stop)return guarded('stop-log',async()=>{await api('workbench',{}, {deviceId:s.id,action:'logs-capture-stop',jobId:stop.dataset.stopCapture});await loadJobs();});const b=e.target.closest('[data-cancel-job]');if(b)guarded('cancel',async()=>{await api('cancel',{}, {id:b.dataset.cancelJob});await loadJobs();});});
  function renderFiles(){
    const data=s.fileData;if(!data)return;const query=$('files-search').value.toLowerCase().trim(),sort=$('files-sort').value;
    const rows=data.entries.filter(f=>f.name.toLowerCase().includes(query)).sort((a,b)=>Number(b.type==='directory')-Number(a.type==='directory')||(sort==='newest'?b.modified-a.modified:sort==='size'?b.size-a.size:a.name.localeCompare(b.name,'ko')));
    const limited=!!(data.partial||data.errors?.length||data.warnings?.length);
    $('files-count').textContent=`${rows.length} / ${data.entries.length}개${limited?' · 일부 목록 미확인':''}`;
    $('file-list').innerHTML=`<div class="ops-file-heading"><span>이름 · ${rows.length}개</span><span>크기</span><span>수정 시간</span><span>파일 작업</span></div>`+(rows.map(f=>`<div class="ops-file-row ${window.DeviceTargets?.file?.path===f.path?'target-selected':''}" data-file-row="${esc(f.path)}"><button class="ops-file-name" aria-pressed="${window.DeviceTargets?.file?.path===f.path}" data-path="${esc(f.path)}" data-type="${esc(f.type)}"><span class="ops-file-icon ${f.type}">${f.type==='directory'?'▣':f.type==='link'?'↗':'▤'}</span><span>${esc(f.name)}${f.type==='link'?'<small>연결 경로</small>':''}</span></button><span>${f.type==='file'?bytes(f.size):'—'}</span><time>${when(f.modified)}</time><span>${f.type==='file'?`<button data-pull="${esc(f.path)}">PC로 저장</button>`:''}${f.type!=='file'?`<button data-file-open="${esc(f.path)}">열기</button>`:''}<button data-file-manage="${esc(f.path)}" data-file-kind="${esc(f.type)}">선택</button></span></div>`).join('')||`<div class="ops-empty">${query?'검색 조건에 맞는 파일이 없습니다.':'빈 폴더입니다. PC 파일을 선택해 복사할 수 있습니다.'}</div>`);
    if(!rows.length&&DeskFeedback.state){const epoch=s.epoch,path=s.path;DeskFeedback.state($('file-list'),{type:limited&&!query?'warning':'empty',title:query?'읽은 목록에서 검색 조건에 맞는 파일이 없습니다':limited?'파일 정보를 확인하지 못했습니다':'빈 폴더입니다',message:query?'검색어를 지우면 읽기에 성공한 목록을 다시 표시합니다.':limited?'목록이나 파일 정보를 읽는 중 제한이 있었습니다. 빈 폴더라고 단정하지 않습니다. 아래 안내에서 제한 사유를 확인하거나 상위 폴더로 이동할 수 있습니다.':'현재 위치에 파일이 없습니다. PC 파일을 선택해 전송하거나 상위 폴더로 이동할 수 있습니다.',actionLabel:query?'검색어 지우기':'이 폴더 다시 조회',onAction:()=>{if(epoch!==s.epoch||path!==s.path)return;if(query){$('files-search').value='';renderFiles();}else return loadFiles(path);}});}
    window.FileBatch?.decorateRows();
  }
  function showFileLoading(active,target='') {
    clearTimeout(s.fileLoadTimer);
    $('files-loading').hidden=!active;
    $('file-list').setAttribute('aria-busy',String(active));
    $('file-list').classList.toggle('is-loading',active);
    $('file-list').inert=active;
    for(const id of ['files-upload','files-mkdir','files-home','files-refresh','files-search','files-sort'])$(id).disabled=active;
    $('files-up').disabled=active||!s.parent;
    if(active){
      $('files-loading-path').textContent=target;
      $('files-loading-note').textContent='기기에서 파일 목록을 읽고 있습니다.';
      s.fileLoadTimer=setTimeout(()=>{ $('files-loading-note').textContent='기기 응답을 기다리고 있습니다. 파일이 많거나 무선 연결이 느리면 시간이 걸릴 수 있습니다.'; },2000);
    }
  }
  async function loadFiles(target=s.path){
    if(!s.id)return;
    target=target.replace(/\/+/g,'/');
    const alternativeActions=(path,raw)=>{
      if(!/Permission (?:Denial|denied)|SecurityException|EACCES|EPERM|Operation not permitted|avc:\s*denied|권한.*(?:없|제한|거부)/i.test(String(raw)))return [];
      const currentPath=s.path,currentEpoch=s.epoch,device=s.id,paths=[];
      if(path!=='/sdcard'&&!/^\/storage\/emulated\/\d+\/?$/.test(path))paths.push(['/sdcard','공유 저장소 조회','현재 사용자에게 공개된 공유 파일 목록입니다. 제한된 앱 내부 자료와는 다릅니다.']);
      const parent=path.replace(/\/+$/,'').replace(/\/[^/]*$/,'')||'/';
      if(parent!==path&&parent!=='/sdcard'&&parent!==currentPath)paths.push([parent,'상위 폴더 조회','상위 위치도 기기 정책에 따라 읽기가 제한될 수 있습니다.']);
      return paths.map(([destination,label,description])=>({label,description,accessLabel:'일반 ADB · 읽기',onAction:()=>currentEpoch===s.epoch&&device===s.id&&currentPath===s.path?loadFiles(destination):undefined}));
    };
    if(DeskFeedback.state)DeskFeedback.state($('files-status'),null);showFileLoading(true,target);
    if(s.busy.has('files')){s.nextPath=target;return;}
    const epoch=s.epoch;let failure=null;
    await guarded('files',async current=>{
      let data;try{data=await api('files',{deviceId:s.id,path:target});}catch(error){failure=error;throw error;}
      if(current!==s.epoch||s.nextPath)return;
      if(!data||!Array.isArray(data.entries)){failure=new Error('폴더 목록 응답 형식을 확인하지 못했습니다.');throw failure;}
      if(!data.entries.length&&data.errors?.some(error=>error.operation==='list')){failure=Object.assign(new Error('폴더 목록을 읽지 못했습니다.'),{rawError:data.errors.map(error=>error.rawError||error.message).join('\n')});throw failure;}
      const moved=s.path!==data.path;
      if(moved)$('files-search').value='';
      s.path=data.path;s.fileData=data;s.parent=data.parent;window.DeviceTargets?.updateFiles(data);$('files-path').value=data.path;
      renderFiles();if(moved)$('file-list').scrollTop=0;
      if((data.partial||data.errors?.length||data.warnings?.length)&&DeskFeedback.state){const path=data.path,raw=(data.errors||[]).map(error=>`${error.path||path}: ${error.rawError||error.message||''}`).join('\n')||(data.warnings||[]).join('\n');DeskFeedback.state($('files-status'),{type:'warning',title:'폴더의 일부 정보를 읽지 못했습니다',message:`확인한 항목 ${data.entries.length}개를 표시합니다. 읽지 못한 항목은 크기 0이나 빈 목록으로 처리하지 않습니다.`,rawError:raw,errorContext:{context:'files',path},actionLabel:'이 위치 다시 조회',onAction:()=>epoch===s.epoch?loadFiles(path):undefined,actions:alternativeActions(path,raw)});}
    });
    if(epoch!==s.epoch)return;
    if(s.nextPath&&s.id){const next=s.nextPath;s.nextPath=null;return loadFiles(next);}
    $('files-path').value=s.path;showFileLoading(false);if(failure&&DeskFeedback.state)DeskFeedback.state($('files-status'),{type:/offline|끊|연결/i.test(failure.message)?'offline':'error',title:'폴더 목록을 읽지 못했습니다',message:target+' 위치를 조회하지 못했습니다. 이전에 읽은 폴더는 '+s.path+'입니다.',rawError:failure.rawError||failure.message,errorContext:{context:'files',path:target},actionLabel:'이 위치 다시 조회',onAction:()=>epoch===s.epoch?loadFiles(target):undefined,actions:alternativeActions(target,failure.rawError||failure.message)});
  }
  $('files-search').oninput=renderFiles;$('files-sort').onchange=renderFiles;
  $('files-refresh').onclick=()=>loadFiles();$('files-home').onclick=()=>loadFiles('/sdcard');$('files-up').onclick=()=>s.parent&&loadFiles(s.parent);$('files-go').onclick=async()=>{const folder=await window.DeviceTargets?.pick('folder',{startPath:s.path});if(folder)loadFiles(folder.path);};
  $('file-list').onclick=e=>{if(e.target.closest('[data-file-batch-check]'))return;const open=e.target.closest('[data-file-open]');if(open)return loadFiles(open.dataset.fileOpen);const pull=e.target.closest('[data-pull]');if(pull)return guarded('pull',()=>job('pull',{path:pull.dataset.pull}));const row=e.target.closest('[data-file-row]');if(row){const f=s.fileData?.entries.find(f=>f.path===row.dataset.fileRow);if(f)window.DeviceTargets?.selectFile(f);}};
  $('file-list').ondblclick=e=>{if(e.target.closest('[data-file-batch-check]'))return;if(e.target.closest('[data-pull],[data-file-manage],[data-file-open]'))return;const row=e.target.closest('[data-file-row]'),f=s.fileData?.entries.find(f=>f.path===row?.dataset.fileRow);if(f&&f.type!=='file')loadFiles(f.path);};
  $('files-mkdir').onclick=()=>guarded('mkdir',async()=>{await api('mkdir',{}, {deviceId:s.id,path:s.path,name:$('files-new-name').value});$('files-new-name').value='';await loadFiles();});
  function uploadFiles(value,{destination=s.path,overwrite=$('files-overwrite').checked}={}){const files=Array.from(value||[]),id=s.id;if(!id||!files.length)throw new Error('대상 기기와 PC 파일을 선택하세요.');if(typeof destination!=='string'||!destination.startsWith('/')||destination.split('/').includes('..')||/[\x00-\x1f]/.test(destination))throw new Error('목적지 폴더를 목록에서 선택하세요.');if(s.busy.has('upload'))throw new Error('파일 업로드가 진행 중입니다. 작업 목록을 확인하세요.');let accepted=false;return guarded('upload',async epoch=>{
    for(const file of files){const staged=await upload(file,'files-upload-progress',id);if(epoch!==s.epoch)return;await job('transfer',{uploadId:staged.uploadId,path:destination,overwrite});}
    if(epoch===s.epoch){accepted=true;$('files-upload-progress').textContent='파일을 접수했습니다. 기기로 복사하는 진행 상황은 작업 목록에 표시됩니다.';}
  }).then(()=>accepted);}
  $('files-upload').onchange=()=>{const files=[...$('files-upload').files];$('files-upload').value='';if(files.length)return uploadFiles(files);};
  let logScopeRevision=0;
  function logAppUser(){const selected=$('logs-package').value.trim()?$('logs-package').dataset.user:null;const scope=String(selected??window.AppInventory?.user??'current');return scope==='current'?String(window.AppInventory?.currentUser??'current'):scope;}
  function logSignature(){return [$('logs-buffer').value,$('logs-level').value,$('logs-pid').value,$('logs-package').value,logAppUser(),logScopeRevision].join('|');}
  function logReadAlternatives(raw,epoch,signature){
    if(!/Permission (?:Denial|denied)|SecurityException|EACCES|EPERM|not permitted|not supported|unsupported|권한.*(?:없|제한|거부)/i.test(String(raw)))return [];
    return [['main','일반 앱 로그'],['system','시스템 로그'],['crash','충돌 로그']].filter(([buffer])=>buffer!==$('logs-buffer').value).map(([buffer,label])=>({label:label+' 조회',description:'버퍼를 바꿔 읽습니다. 앱·PID 조건은 유지하며, 보호된 로그와 같은 자료는 아닙니다.',accessLabel:'일반 ADB · 허용 버퍼',onAction:()=>{if(epoch!==s.epoch||signature!==logSignature())return;$('logs-buffer').value=buffer;return loadLogs();}}));
  }
  function clearLogs(){s.logAfter=s.logs.length?Math.max(...s.logs.map(r=>r.time)):s.logAfter;s.logs=[];s.seen.clear();renderLogs();}
  function filteredLogs(){return DeskUI.filterLogs(s.logs,{pid:$('logs-pid').value.trim(),level:$('logs-level').value,exact:$('logs-exact').checked,tag:$('logs-tag').value,query:$('logs-query').value,buffer:$('logs-buffer').value});}
  function renderLogs(){if(window.LiveLogs?.active())return;const rows=filteredLogs();$('logs-count').textContent=`${rows.length.toLocaleString()}줄 표시 / ${s.logs.length.toLocaleString()}줄 보관`;
    const header='<div class="ops-log-head" role="row">'+['시간','레벨','PID','TID','버퍼','태그','메시지'].map(text=>`<span role="columnheader">${text}</span>`).join('')+'</div>';
    const pid=$('logs-pid').value.trim(),app=$('logs-package').value.trim();$('logs-target').hidden=!pid&&!app;$('logs-target-label').textContent=pid?`${s.logProcess?.pid===Number(pid)?s.logProcess.name+' · ':''}PID ${pid}의 로그만 표시`:app?`${app} · 사용자 ${logAppUser()} · UID에 속한 모든 PID 로그`:'';
    $('logs-output').innerHTML=header+(rows.length?rows.map(r=>`<div class="ops-log-line level-${r.level}" role="row"><time role="cell" title="${esc(when(r.time))}">${DeskUI.formatLogTime(r.time)}</time><b role="cell">${r.level}</b><span role="cell">${r.pid}</span><span role="cell">${r.tid}</span><span role="cell">${esc(r.buffer)}</span><strong role="cell">${esc(r.tag)}</strong><pre role="cell">${esc(r.message)}</pre></div>`).join(''):`<div class="ops-empty">${s.logsLoading?'선택한 조건의 로그를 읽고 있습니다…':s.logFailure?'최근 로그 조회에 실패했습니다. 오류 안내에서 다시 조회할 수 있습니다.':pid?'이 PID의 최근 로그가 없습니다. 프로세스가 새 로그를 남기면 표시됩니다.':'조건에 맞는 로그가 없습니다. 레벨·PID·검색 조건을 확인하세요.'}</div>`);
    if(!rows.length&&!s.logFailure&&typeof DeskFeedback!=='undefined'&&DeskFeedback.state){const host=$('logs-output').querySelector('.ops-empty'),loading=s.logsLoading,filtered=s.logs.length>0;DeskFeedback.state(host,{type:loading?'loading':'empty',title:loading?'로그를 읽고 있습니다':filtered?'화면 검색에 맞는 로그가 없습니다':'아직 표시할 로그가 없습니다',message:loading?'선택한 PID·버퍼·레벨로 최근 로그를 확인합니다.':filtered?'받은 로그에서 검색어와 태그에 맞는 줄이 없습니다.':'기기 연결과 조회 조건을 확인하세요. 선택한 앱이 새 로그를 남기면 표시됩니다.',...(!loading?{actionLabel:filtered?'화면 검색 해제':'최근 로그 다시 조회',onAction:()=>{if(filtered){$('logs-tag').value='';$('logs-query').value='';$('logs-exact').checked=false;renderLogs();}else return loadLogs();}}:{})});}
    if($('logs-follow').checked)$('logs-output').scrollTop=$('logs-output').scrollHeight;
  }
  async function loadLogs(){if(window.LiveLogs?.active())return;if(s.busy.has('logs')){s.logsPending=true;return;}await guarded('logs',async epoch=>{const signature=logSignature(),user=logAppUser();if(s.logSignature!==signature){s.logs=[];s.seen.clear();s.logAfter=0;s.logSignature=signature;}s.logsLoading=true;s.logFailure=false;renderLogs();
    try{const data=await api('logs',{deviceId:s.id,buffer:$('logs-buffer').value,level:$('logs-level').value,pid:$('logs-pid').value,package:$('logs-package').value.trim(),user,limit:1500});if(epoch!==s.epoch||s.logSignature!==signature||logSignature()!==signature)return;
      for(const row of data.entries){const key=JSON.stringify([row.timeKey??row.time,row.pid,row.tid,row.level,row.buffer,row.tag,row.message]);if(row.time>s.logAfter&&!s.seen.has(key)){s.seen.add(key);s.logs.push({...row,key});}}
      s.logs.sort((a,b)=>a.time-b.time);if(s.logs.length>5000){for(const row of s.logs.splice(0,s.logs.length-5000))s.seen.delete(row.key);}
      const restricted=!!data.notice&&window.DeskErrors?.isFailureText(data.notice);s.logFailure=restricted&&!data.entries.length;
      if(restricted&&DeskFeedback.state)DeskFeedback.state($('logs-error'),{type:data.entries.length?'warning':'error',title:data.entries.length?'일부 로그만 읽었습니다':'선택한 로그를 읽지 못했습니다',message:data.entries.length?'읽기에 성공한 로그는 유지하며 제한된 버퍼는 별도로 안내합니다.':'선택한 버퍼가 비었다고 단정하지 않습니다. 기기의 조회 제한을 확인하세요.',rawError:data.notice,errorContext:{context:'logs'},actionLabel:'로그 다시 조회',onAction:()=>epoch===s.epoch&&logSignature()===signature?loadLogs():undefined,actions:logReadAlternatives(data.notice,epoch,signature)});else{$('logs-error').hidden=!data.notice;$('logs-error').textContent=data.notice||'';}s.logsLoading=false;renderLogs();
    }catch(error){if(epoch===s.epoch&&s.logSignature===signature&&logSignature()===signature){if(typeof DeskFeedback!=='undefined'&&DeskFeedback.state)DeskFeedback.state($('logs-error'),{type:'error',title:'로그를 읽지 못했습니다',message:error.message,errorContext:{context:'logs'},actionLabel:'로그 다시 조회',onAction:()=>epoch===s.epoch&&logSignature()===signature?loadLogs():undefined,actions:logReadAlternatives(error.message,epoch,signature)});else{$('logs-error').hidden=false;$('logs-error').textContent=error.message;}s.logsLoading=false;s.logFailure=true;renderLogs();}}
  });if(s.logsPending&&s.id){s.logsPending=false;return loadLogs();}}
  $('logs-refresh').onclick=()=>loadLogs();$('logs-clear').onclick=clearLogs;
  for(const id of ['logs-buffer','logs-level','logs-pid','logs-package'])$(id).onchange=()=>{if(id==='logs-package')$('logs-pid').value='';if(id==='logs-pid'){$('logs-package').value='';delete $('logs-package').dataset.user;}renderLogs();loadLogs();};
  for(const id of ['logs-tag','logs-query','logs-exact'])$(id).oninput=()=>DeskFeedback.paint('로그 필터 적용',renderLogs);
  $('logs-all-processes').onclick=()=>{$('logs-package').value='';delete $('logs-package').dataset.user;$('logs-pid').value='';s.logProcess=null;s.logs=[];s.seen.clear();renderLogs();loadLogs();};
  $('logs-export').onclick=()=>download(filteredLogs().map(r=>`${new Date(r.time).toISOString()} ${r.pid} ${r.tid} ${r.level} ${r.tag}: ${r.message}`).join('\n'),`adb-logcat-${Date.now()}.txt`);
  const kv = rows => `<dl class="ops-kv">${rows.map(([k,v])=>`<div><dt>${esc(k)}</dt><dd>${esc(v||'조회 불가')}</dd></div>`).join('')}</dl>`;
  function bar(label,value,total,detail=''){const percent=total?Math.min(100,Math.max(0,value/total*100)):0;return `<div class="ops-bar-row"><div><strong>${esc(label)}</strong><span>${esc(detail||`${bytes(value)} / ${bytes(total)}`)}</span></div><progress max="100" value="${percent}"></progress></div>`;}
  async function loadStatus(){if(s.busy.has('status'))return s.statusPromise;const promise=guarded('status',async epoch=>{const finish=DeskFeedback.start('기기 상태 조회',{button:$('monitor-refresh')});const host=$('monitor-unavailable');if(DeskFeedback.state)DeskFeedback.state(host,{type:'loading',title:'기기 상태를 읽고 있습니다',message:'CPU·메모리·저장소·프로세스를 조회합니다.'});try{const data=await api('status',{deviceId:s.id});if(epoch!==s.epoch)return;const openDetails=['monitor-system','monitor-storage'].filter(id=>$(id).querySelector('details')?.open);s.status=data;s.snapshot++;const m=data.memory,p=data.static.properties||{},store=data.storage.find(i=>i.mount==='/data'),used=m.MemTotal-m.MemAvailable,swap=m.SwapTotal-m.SwapFree;
    $('monitor-time').textContent=when(data.updatedAt)+' · '+s.snapshot+'회 갱신';
    const metric=(label,value,sub)=>`<div class="ops-metric"><span>${label}</span><strong>${esc(value)}</strong><small>${esc(sub)}</small></div>`;
    $('monitor-metrics').innerHTML=metric('CPU 사용률',data.cpu.usage===null?'조회 불가':data.cpu.usage.toFixed(1)+'%',`${data.cpu.cores||'?'}코어 전체 기준`)+metric('실제 RAM 사용',bytes(used),`사용 가능 ${bytes(m.MemAvailable)}`)+metric('내부 저장소',store?bytes(store.available):'조회 불가','남은 용량 · /data')+metric('배터리',Number.isFinite(data.battery.level)?(Math.round(data.battery.level*10)/10)+'%':'조회 불가',data.battery.temperature===null?'온도 조회 불가':data.battery.temperature+' °C')+metric('가동 시간',data.uptimeSeconds===null?'조회 불가':`${Math.floor(data.uptimeSeconds/86400)}일 ${Math.floor(data.uptimeSeconds%86400/3600)}시간 ${Math.floor(data.uptimeSeconds%3600/60)}분`,`${data.processes.length}개 프로세스`);
    $('monitor-system').innerHTML=kv([['모델',p['ro.product.model']],['Android / API',`${p['ro.build.version.release']} / ${p['ro.build.version.sdk']}`],['보안 패치',p['ro.build.version.security_patch']],['프로세서 / 플랫폼',`${p['ro.soc.manufacturer']||''} ${p['ro.soc.model']||p['ro.board.platform']||p['ro.hardware']||''}`],['지원 ABI',p['ro.product.cpu.abilist']],['커널',data.static.kernel],['화면 크기·밀도',data.static.display],['부팅 검증 상태',p['ro.boot.verifiedbootstate']],['전원 / 화면',`${data.power.wakefulness||'?'} / ${data.power.displayState||'조회 불가'}`],['빌드',p['ro.build.display.id']]])+`<details><summary>CPU 원본 정보</summary><pre class="ops-raw">${esc(data.static.cpuInfo)}</pre></details>`;
    $('monitor-memory').innerHTML=bar('실제 RAM 사용',used,m.MemTotal)+bar('스왑 사용',swap,m.SwapTotal)+kv([['RAM 전체 (OS 인식)',bytes(m.MemTotal)],['사용 가능한 RAM',bytes(m.MemAvailable)],['빈 RAM / 파일 캐시',`${bytes(m.MemFree)} / ${bytes(m.Cached)}`],['스왑 전체 / 남은 공간',`${bytes(m.SwapTotal)} / ${bytes(m.SwapFree)}`],['ZRAM 압축 전 / 압축 후',data.zram?`${bytes(data.zram.originalBytes)} / ${bytes(data.zram.compressedBytes)}`:'권한 또는 기기 지원 확인 필요'],['ZRAM 실제 점유',data.zram?bytes(data.zram.allocatedBytes):'조회 불가']])+ '<p class="ops-note">RAM 사용량은 전체 − 사용 가능(MemAvailable)입니다. 스왑은 메모리를 보조하는 공간이며 실제 RAM과 다릅니다. ZRAM은 RAM 안에서 압축해 저장합니다.</p>';
    const stores=data.storage.filter(i=>!['tmpfs','none'].includes(i.source));const primary=stores.filter(i=>['/data','/','/system','/vendor','/product','/storage/emulated','/storage/emulated/0'].includes(i.mount));const other=stores.filter(i=>!primary.includes(i));const storeBar=i=>bar(i.mount,i.used,i.total,`${i.percent}% · ${bytes(i.used)} / ${bytes(i.total)}`);$('monitor-storage').innerHTML='<div class="ops-storage-grid">'+primary.map(storeBar).join('')+'</div>'+(other.length?`<details><summary>기타 마운트 ${other.length}개 펼치기</summary><div class="ops-storage-grid">${other.map(storeBar).join('')}</div></details>`:'')+'<p class="ops-note">같은 저장장치의 마운트 경로가 중복될 수 있습니다. 시스템 파티션의 100% 사용은 읽기 전용 이미지 특성일 수 있습니다.</p>';
    $('monitor-partitions').innerHTML=`<div class="ops-partitions">${(data.static.partitions||[]).map(p=>`<span><b>${esc(p.name)}</b>${bytes(p.bytes)}</span>`).join('')}</div><p class="ops-note">물리 장치와 논리 파티션이 함께 표시되므로 용량을 모두 더하면 중복됩니다.</p>`;
    for(const id of openDetails){const details=$(id).querySelector('details');if(details)details.open=true;}$('monitor-unavailable').textContent=[...(data.unavailable||[]),...(data.static.unavailable||[])].join('\n');renderProcesses();
  }catch(error){if(epoch===s.epoch){if(DeskFeedback.state)DeskFeedback.state(host,{type:/offline|연결|오프라인/i.test(error.message)?'offline':'error',title:'기기 상태를 읽지 못했습니다',message:error.message,errorContext:{context:'diagnostics'},actionLabel:'기기 상태 다시 조회',onAction:()=>epoch===s.epoch?loadStatus():undefined});else host.textContent=error.message;}}finally{finish();}
  });s.statusPromise=promise;try{return await promise;}finally{if(s.statusPromise===promise)s.statusPromise=null;}}
  const processColumns=[['pid','PID'],['ppid','PPID'],['name','프로세스'],['user','사용자'],['state','상태'],['cpu','CPU'],['rss','실메모리 RSS'],['virtual','가상 주소 VSZ']];
  $('process-sort').innerHTML=processColumns.flatMap(([key,label])=>['desc','asc'].map(direction=>`<option value="${key}:${direction}">${label} ${direction==='asc'?'오름차순':'내림차순'}</option>`)).join('');$('process-sort').value='cpu:desc';
  function renderProcesses(){
    if(!s.status)return;
    const query=$('process-search').value.toLowerCase(),{key,direction}=s.processSort;
    const rows=DeskUI.sortProcesses(s.status.processes.filter(p=>`${p.pid} ${p.name} ${p.user}`.toLowerCase().includes(query)),key,direction);
    const focused=document.activeElement?.dataset?.processSort;
    $('monitor-process-count').textContent=`${rows.length}개 / 전체 ${s.status.processes.length}개`;
    const headers=processColumns.map(([field,label])=>`<th scope="col" aria-sort="${field===key?(direction==='asc'?'ascending':'descending'):'none'}"><button data-process-sort="${field}" aria-label="${label} 정렬">${label}<span aria-hidden="true">${field===key?(direction==='asc'?'▲':'▼'):'↕'}</span></button></th>`).join('');
    $('monitor-processes').innerHTML=`<table class="ops-table"><thead><tr>${headers}<th scope="col">작업</th></tr></thead><tbody>${rows.map(p=>`<tr><td>${p.pid}</td><td>${p.ppid}</td><td class="ops-process-name" title="${esc(p.name)}">${esc(p.name)}</td><td>${esc(p.user)}</td><td title="R 실행, S 대기, D I/O 대기, Z 좀비, T 중지">${esc(p.state)}</td><td>${p.cpu===null?'—':p.cpu.toFixed(1)+'%'}</td><td>${bytes(p.rss)}</td><td>${bytes(p.virtual)}</td><td class="process-row-actions"><button data-log-pid="${p.pid}">로그</button><button data-stop-pid="${p.pid}" class="process-stop-button">종료</button></td></tr>`).join('')}</tbody></table><p class="ops-note">CPU 수치는 상위 120개 샘플에서 읽습니다. ‘—’는 이번 샘플에 없는 프로세스입니다.</p>`;
    if(focused)$('monitor-processes').querySelector(`[data-process-sort="${focused}"]`)?.focus({preventScroll:true});
  }
  function processLog(pid){
    const process=s.status?.processes.find(p=>p.pid===pid);s.logProcess=process?{pid,name:process.name}:null;
    $('logs-package').value='';delete $('logs-package').dataset.user;$('logs-pid').value=String(pid);$('logs-buffer').value='all';$('logs-level').value='V';$('logs-exact').checked=false;$('logs-tag').value='';$('logs-query').value='';
    s.logs=[];s.seen.clear();s.logAfter=0;s.logSignature=null;s.logsLoading=true;renderLogs();$('logs-tab').click();$('logs-panel').style.scrollMarginTop=(document.querySelector('.device-tabs').offsetHeight+36)+'px';$('logs-panel').scrollIntoView({block:'start'});
  }
  async function showProcessStop(pid){
    const epoch=s.epoch;s.processTarget=null;s.processDialogRequest=(s.processDialogRequest||0)+1;const request=s.processDialogRequest;
    const current=()=>epoch===s.epoch&&request===s.processDialogRequest&&$('process-dialog').open;
    s.processReadController?.abort();window.PopupHelp?.show($('process-dialog'),'process-stop',{deviceId:s.id,pid,status:'현재 프로세스와 종료 가능 범위를 조회 중입니다. 아직 종료하지 않았습니다.'});const controller=new AbortController();s.processReadController=controller;const timeout=setTimeout(()=>controller.abort(),30000);
    const row=s.status?.processes.find(p=>p.pid===pid);
    $('process-target').textContent=`${row?.name||'프로세스'} · PID ${pid}`;DeskFeedback.state($('process-stop-result'),null);$('process-stop-note').textContent='';$('process-stop-mode').innerHTML='';$('process-stop-run').disabled=true;DeskFeedback.state($('process-dialog-loading'),{type:'loading',title:'프로세스 정보를 읽고 있습니다',message:`PID ${pid}의 현재 상태와 종료 가능 범위만 조회합니다. 종료 요청은 보내지 않습니다.`});if(!$('process-dialog').open)$('process-dialog').showModal();
    try{
      const info=await api('process-info',{deviceId:s.id,pid},undefined,{signal:controller.signal});if(!current())return;
      s.processTarget=info;window.PopupHelp?.update($('process-dialog'),{status:info.process.name+' · '+info.process.user+' · '+(info.reason||'종료 범위를 확인했습니다.'),supported:!!(info.canSignal||info.packageId),supportReason:info.reason||'PID 종료 권한과 앱 전체 종료 가능 여부를 현재 응답으로 확인합니다.',checkedAt:Date.now()});const options=[];
      if(info.canSignal)options.push(['term','선택한 PID 일반 종료 (TERM)'],['kill','선택한 PID 강제 종료 (KILL)']);
      if(info.packageId)options.push(['app',`앱 전체 강제 종료 · ${info.packageId}`]);
      $('process-stop-mode').innerHTML=options.map(([value,label])=>`<option value="${value}">${esc(label)}</option>`).join('');
      $('process-stop-note').textContent=info.reason||'선택한 프로세스를 다시 확인한 뒤 종료합니다.';$('process-stop-run').disabled=!options.length;
      $('process-target').textContent=`${info.process.name} · PID ${pid} · ${info.process.user}`;updateStopLabel();
    }catch(error){if(current())window.PopupHelp?.update($('process-dialog'),{status:'프로세스 조회 실패 · 종료 요청 없음',supportReason:error.name==='AbortError'?'기기 응답 시간이 초과되었습니다. 프로세스 정보 다시 조회를 이용하세요.':error.message,checkedAt:null});if(current())DeskFeedback.state($('process-stop-result'),{type:/offline|끊|연결.*없/i.test(error.message)?'offline':'error',title:'프로세스 정보를 읽지 못했습니다',message:(error.name==='AbortError'?'기기 응답 대기 시간이 지났습니다.':error.message)+' 프로세스가 종료되었거나 PID가 바뀌었을 수 있습니다. 종료 요청은 보내지 않았습니다.',actionLabel:'프로세스 정보 다시 조회',onAction:()=>current()?showProcessStop(pid):undefined});}
    finally{clearTimeout(timeout);if(s.processReadController===controller)s.processReadController=null;if(epoch===s.epoch&&request===s.processDialogRequest)DeskFeedback.state($('process-dialog-loading'),null);}
  }
  function updateStopLabel(){$('process-stop-run').textContent=$('process-stop-mode').value==='app'?'이 앱 전체 강제 종료':'선택한 PID 종료';}
  $('process-stop-mode').onchange=updateStopLabel;
  $('process-close').onclick=()=>{s.processDialogRequest++;$('process-dialog').close();};
  $('process-dialog').addEventListener('close',()=>{s.processDialogRequest++;s.processReadController?.abort();s.processReadController=null;s.processTarget=null;DeskFeedback.state($('process-dialog-loading'),null);});
  $('process-stop-run').onclick=()=>guarded('process-stop',async epoch=>{
    const info=s.processTarget;if(!info)return;const p=info.process;$('process-stop-run').disabled=true;
    try{await job('process-stop',{pid:p.pid,startTime:p.startTime,expectedName:p.name,expectedUser:p.user,confirmPid:p.pid,mode:$('process-stop-mode').value});if(epoch===s.epoch){$('process-dialog').close();s.processTarget=null;}}
    catch(error){if(epoch===s.epoch){$('process-stop-result').hidden=false;$('process-stop-result').textContent=error.message;$('process-stop-run').disabled=false;}}
  });
  $('monitor-refresh').onclick=()=>loadStatus();$('process-search').oninput=()=>DeskFeedback.paint('프로세스 검색',renderProcesses);
  $('process-sort').onchange=()=>{const [key,direction]=$('process-sort').value.split(':');s.processSort={key,direction};DeskFeedback.paint('프로세스 정렬',renderProcesses);};
  $('monitor-processes').onclick=e=>{
    const log=e.target.closest('[data-log-pid]'),stop=e.target.closest('[data-stop-pid]'),sort=e.target.closest('[data-process-sort]');
    if(log)processLog(Number(log.dataset.logPid));
    else if(stop)showProcessStop(Number(stop.dataset.stopPid));
    else if(sort){const key=sort.dataset.processSort;const direction=s.processSort.key===key?(s.processSort.direction==='asc'?'desc':'asc'):(['pid','ppid','name','user','state'].includes(key)?'asc':'desc');s.processSort={key,direction};$('process-sort').value=key+':'+direction;DeskFeedback.paint('프로세스 정렬',renderProcesses);}
  };
  $('monitor-export').onclick=()=>s.status?download(JSON.stringify(s.status,null,2),`device-status-${Date.now()}.json`,'application/json'):feedback('먼저 상태를 조회하세요.',true);
  $('monitor-bugreport').onclick=()=>guarded('bugreport',()=>job('bugreport',{}));
  const actionNames={'backup-apk':'APK 백업',enable:'활성화',disable:'비활성화','force-stop':'강제 종료','uninstall-user':'현재 사용자에서 삭제','uninstall-all':'기기에서 완전 삭제','restore-system':'기본 패키지 복원'};
  let appScopeRevision=0,packageDialogRevision=0;
  const selectedAppUser=()=>String(window.AppInventory?.user==='current'?window.AppInventory?.currentUser??'current':window.AppInventory?.user??'current');
  const installEpoch=()=>`${s.epoch}:${appScopeRevision}:${selectedAppUser()}`;
  function appScopeChanged(){uploadControllers.get('apps-upload-progress')?.abort();for(const key of ['install','package','restore']){s.busy.delete(key);s.busyLeases?.delete(key);}window.MultiDeviceApps?.scopeChanged();logScopeRevision++;s.logSignature=null;s.logsPending=false;s.logsLoading=false;s.logs=[];s.seen.clear();s.logAfter=0;$('logs-package').value='';delete $('logs-package').dataset.user;$('logs-pid').value='';s.logProcess=null;$('logs-error').hidden=true;window.LiveLogs?.scopeChanged();renderLogs();appScopeRevision++;s.package=null;s.action=null;s.packageUser=null;$('package-dialog').close();$('package-result').textContent='';window.InstallUI.sync?.();}
  function manage(pkg,action,userId=selectedAppUser()){packageDialogRevision++;window.DeviceTargets?.selectApp(pkg);s.package=pkg;s.packageUser=String(userId);s.action=null;$('package-target').textContent=`${pkg} · 사용자 ${s.packageUser}`;$('package-result').textContent='';$('package-confirm').hidden=true;const selected=window.DeviceTargets?.app;window.PopupHelp?.show($('package-dialog'),'package-manager',{deviceId:s.id,package:pkg,userId:s.packageUser,status:selected?.package===pkg?(typeof selected.enabled==='boolean'?(selected.enabled?'목록 기준 활성 앱':'목록 기준 비활성 앱'):'선택한 앱 · 상세 상태 미조회'):'선택한 앱 · 상세 상태 미조회'});$('package-dialog').showModal();if(action)chooseAction(action);}
  function chooseAction(action){packageDialogRevision++;s.action=action;window.PopupHelp?.update($('package-dialog'),{status:'선택 작업: '+(actionNames[action]||action)+' · 확인 후 실행 대기'});$('package-confirm').hidden=false;$('package-confirm-name').value=s.package;$('package-confirm-check').checked=false;$('package-confirm-run').textContent=actionNames[action]+' 실행';$('package-confirm-note').textContent=`${s.package} · ${actionNames[action]}. `+({'disable':'시스템 핵심 앱을 비활성화하면 기능이 작동하지 않을 수 있습니다.','uninstall-user':'현재 사용자의 앱과 데이터가 삭제됩니다. 기본 앱의 설치 파일은 기기에 남습니다.','uninstall-all':'모든 사용자의 앱과 데이터가 삭제됩니다. 시스템 앱은 허용되지 않을 수 있습니다.','force-stop':'앱 프로세스가 종료되고 다시 실행하기 전까지 백그라운드 동작이 제한됩니다.','restore-system':'기기에 설치 파일이 남아 있는 기본 앱만 복구할 수 있습니다.'}[action]||'선택한 대상 앱을 확인한 뒤 실행하세요.');$('package-confirm-name').focus();}
  $('package-close').onclick=()=>$('package-dialog').close();$('package-dialog').addEventListener('close',()=>{if(!$('package-dialog').open)packageDialogRevision++;});
  $('package-dialog').addEventListener('click',e=>{const extra=e.target.closest('[data-wb-package]');if(extra){const pkg=s.package,user=s.packageUser;$('package-dialog').close();window.Workbench?.openAction(extra.dataset.wbPackage,{package:pkg,user});return;}const b=e.target.closest('[data-package-action]');if(!b)return;const action=b.dataset.packageAction,pkg=s.package,userId=s.packageUser,revision=appScopeRevision,dialogRevision=packageDialogRevision;if(action==='backup-apk')guarded('package',async epoch=>{await job('backup-apk',{package:pkg,userId});if(epoch===s.epoch&&revision===appScopeRevision&&dialogRevision===packageDialogRevision&&pkg===s.package){$('package-result').textContent='APK 백업을 시작했습니다. 작업 목록에서 진행 상황과 다운로드를 확인하세요.';}});else chooseAction(action);});
  $('package-confirm-run').onclick=()=>{const pkg=s.package,userId=s.packageUser,action=s.action,confirmPackage=$('package-confirm-name').value,confirmed=$('package-confirm-check').checked,revision=appScopeRevision,dialogRevision=packageDialogRevision;return guarded('package',async epoch=>{if(!confirmed||!pkg||confirmPackage!==pkg){$('package-result').textContent='선택한 앱과 작업 내용을 확인해 주세요.';return;}await job('package-action',{package:pkg,action,confirmPackage,userId});if(epoch===s.epoch&&revision===appScopeRevision&&dialogRevision===packageDialogRevision&&pkg===s.package){$('package-result').textContent='작업을 시작했습니다. 결과는 작업 목록에 표시됩니다.';$('package-confirm').hidden=true;}});};
  window.InstallUI.bind({getDevice:()=>s.id,getEpoch:installEpoch,getUser: selectedAppUser,run:async(files,options,target)=>{
    if(s.busy.has('install'))throw new Error('다른 APK 업로드·설치 접수를 기다려 주세요.');
    if(target.device!==s.id||target.epoch!==installEpoch())throw new Error('대상 기기 또는 사용자·프로필이 변경되었습니다. APK를 다시 선택하세요.');
    const userId=String(target.userId??selectedAppUser()),requestEpoch=installEpoch();
    let accepted=false;
    await guarded('install',async epoch=>{
      const id=s.id,{groupIndices,stagedUploadIds,...installOptions}=options,ids=stagedUploadIds?[...stagedUploadIds]:[];
      if(!stagedUploadIds)for(const file of files){if(epoch!==s.epoch||requestEpoch!==installEpoch())return;const staged=await upload(file,'apps-upload-progress',id);if(epoch!==s.epoch||requestEpoch!==installEpoch())return;ids.push(staged.uploadId);}
      if(epoch!==s.epoch||requestEpoch!==installEpoch())return;
      await job('install',{uploadIds:ids,...installOptions,userId,...(groupIndices?{groupUploadIds:groupIndices.map(group=>group.map(index=>ids[index]))}:{})});
      if(epoch!==s.epoch||requestEpoch!==installEpoch())return;accepted=true;$('apps-upload-progress').textContent='설치를 접수했습니다. 작업 목록에서 진행·취소·결과를 확인하세요.';
    });return accepted;
  }});
  async function loadBackups(){return guarded('backups',async epoch=>{const finish=DeskFeedback.start('PC 백업 목록 조회',{button:$('apps-backups-refresh')});const host=$('apps-backup-list');if(DeskFeedback.state)DeskFeedback.state(host,{type:'loading',title:'PC 백업 목록을 읽고 있습니다'});try{const replies=await Promise.allSettled([api('backups'),api('capabilities')]);if(epoch!==s.epoch)return;if(replies[0].status==='rejected')throw replies[0].reason;const data=replies[0].value,caps=replies[1].status==='fulfilled'?replies[1].value:{};if(!data||!Array.isArray(data.files))throw new Error('백업 목록 응답 형식을 확인하지 못했습니다.');
    $('apps-backup-capability').textContent=(caps.dataNotice||'백업 지원 정보를 읽지 못했습니다. 목록은 PC에 저장된 APK 기준입니다.')+(!caps.legacyBackup?' 일반 앱의 전체 데이터 백업은 제한됩니다. 앱 목록에서 대상을 선택하면 ‘내부 데이터 백업 가능 여부’를 확인할 수 있습니다.':'');
    $('apps-backup-list').innerHTML=data.files.length?data.files.map(f=>`<div class="ops-backup-row"><div><strong>${esc(f.name)}</strong><small>${bytes(f.size)} · ${when(f.modified)}</small></div><a class="ops-link-button" href="/api/ops/download-backup?name=${encodeURIComponent(f.name)}" download>다운로드</a><button data-restore-backup="${esc(f.name)}">이 기기에 복원</button></div>`).join(''):'<div class="ops-empty">보관된 APK 백업이 없습니다. 앱의 ‘관리 → APK 백업’으로 보관하세요.</div>';
  }catch(error){if(epoch===s.epoch){if(DeskFeedback.state)DeskFeedback.state(host,{type:'error',title:'PC 백업 목록을 읽지 못했습니다',message:error.message,actionLabel:'백업 목록 다시 조회',onAction:()=>epoch===s.epoch?loadBackups():undefined});else host.textContent=error.message;}}finally{finish();}
  });}
  $('apps-backups-refresh').onclick=()=>loadBackups();
  $('apps-backup-list').onclick=e=>{const b=e.target.closest('[data-restore-backup]');if(b){const backupName=b.dataset.restoreBackup,userId=selectedAppUser();guarded('restore',()=>job('restore-apk',{backupName,userId}));}};
  $('apps-restore-file').onchange=()=>{const file=$('apps-restore-file').files[0],id=s.id,userId=selectedAppUser(),revision=appScopeRevision;$('apps-restore-file').value='';if(file)guarded('restore',async epoch=>{const staged=await upload(file,'apps-upload-progress',id);if(epoch!==s.epoch||revision!==appScopeRevision)return;await job('restore-apk',{uploadId:staged.uploadId,userId});});};
  $('apps-restore-system').onclick=()=>{const pkg=$('apps-restore-package').value.trim(),userId=$('apps-restore-package').dataset.user??selectedAppUser();if(!/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/.test(pkg))return feedback('목록에서 복원할 기본 앱을 선택하세요.',true);manage(pkg,'restore-system',userId);};
  window.DeviceOps={uploadFiles,get currentPath(){return s.path;},get currentDeviceId(){return s.id;},waitForStatus(){return s.statusPromise;},prepareBrowse(path){s.preparedPath=path;},refreshJobs:loadJobs,browse:loadFiles,downloadSelected:path=>guarded('pull',()=>job('pull',{path})),appScopeChanged,selectedAppAction(pkg,action,userId=selectedAppUser()){const targetUser=String(userId);if(action==='backup-apk')return guarded('package',()=>job('backup-apk',{package:pkg,userId:targetUser}));manage(pkg,action,targetUser);},open(id){window.LiveLogs?.open(id);s.preparedPath=null;s.epoch++;s.statusPromise=null;s.id=id;window.MultiDeviceApps?.open(id);s.tab='screen';s.path='/sdcard';s.parent=null;s.fileData=null;s.nextPath=null;showFileLoading(false);s.busy.clear();s.jobs.clear();s.logs=[];s.seen.clear();s.status=null;s.snapshot=0;s.logSignature=null;s.logsPending=false;s.logsLoading=false;s.logProcess=null;s.logAfter=0;$('ops-jobs').hidden=true;$('file-list').innerHTML='';$('monitor-metrics').innerHTML='';$('package-dialog').close();$('process-dialog').close();loadJobs();},close(){window.MultiDeviceApps?.close();window.LiveLogs?.close();for(const controller of uploadControllers.values())controller.abort();uploadControllers.clear();s.preparedPath=null;s.id=null;s.epoch++;s.processDialogRequest=(s.processDialogRequest||0)+1;$('process-dialog').close();s.busy.clear();showFileLoading(false);$('package-dialog').close();},activate(tab){s.tab=tab;if(tab==='files'&&!s.busy.has('files')){const target=s.preparedPath;s.preparedPath=null;loadFiles(target||s.path);}if(tab==='logs')window.LiveLogs?.activate();if(tab==='logs')loadLogs();if(tab==='monitor')loadStatus();if(tab==='apps')loadBackups();},manage};
  let ticks=0;setInterval(()=>{if(!s.id||document.hidden)return;ticks++;if(ticks%2===0){loadJobs();if(s.tab==='logs'&&$('logs-auto').checked)loadLogs();}if(ticks%5===0&&s.tab==='monitor'&&$('monitor-auto').checked&&!$('process-dialog').open)loadStatus();},1000);
})();
