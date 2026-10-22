(() => {
  const $ = id => document.getElementById(id), esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const s = { id:null, epoch:0, path:'/sdcard', entries:[], selected:new Set(), favorites:[], recent:[], storage:[], busy:false };
  const base = p => p.replace(/\/$/, '').split('/').at(-1) || '/';
  const key = () => 'adb-desk-file-shortcuts:' + s.id;
  function save() { try { localStorage.setItem(key(), JSON.stringify({ favorites:s.favorites, recent:s.recent })); } catch {} }
  function readSaved() { try { const d = JSON.parse(localStorage.getItem(key()) || '{}'), valid = a => Array.isArray(a) ? a.filter(p => typeof p === 'string' && p.startsWith('/') && p.length < 2048).slice(0,20) : []; s.favorites = valid(d.favorites); s.recent = valid(d.recent); } catch { s.favorites=[]; s.recent=[]; } }
  function message(text, error=false) { const el=$('file-batch-message'); if(el){el.textContent=text;el.classList.toggle('failure',error);} }
  function status(host,text,error=false,options={}){const rawError=String(options.rawError??text),errorContext={context:'files',path:s.path,...options.errorContext},info=error?window.DeskErrors?.explain?.(rawError,errorContext):null,settings={type:error?(['offline','connection-failed'].includes(info?.code)?'offline':info?.recognized?'error':/device.*offline|오프라인|연결.*끊|Failed to fetch|NetworkError|ECONN/i.test(rawError)?'offline':'error'):'info',title:error?(info?.titleKo||(/offline|오프라인|연결|fetch|network/i.test(rawError)?'연결 확인 필요':'파일 작업 확인 필요')):'',...options,message:(error?(info?.reasonKo||(/[가-힣]/.test(rawError)?rawError:'파일 작업을 완료하지 못했습니다. 오류 원문을 확인하세요.')):text)+(options.followup?' '+options.followup:''),...(error?{rawError,errorContext,requiredAccessKo:options.requiredAccessKo??info?.requiredAccessKo,alternativesKo:options.alternativesKo??info?.alternativesKo}:{})};if(window.DeskFeedback?.state)return window.DeskFeedback.state(host,settings);host.textContent=[settings.title,settings.message,settings.requiredAccessKo&&'필요한 접근: '+settings.requiredAccessKo,settings.alternativesKo&&'가능한 확인: '+settings.alternativesKo].filter(Boolean).join(' · ');host.setAttribute('aria-busy',String(settings.type==='loading'));if(settings.rawError){const details=document.createElement('details'),summary=document.createElement('summary'),raw=document.createElement('pre');summary.textContent='기술 오류 원문';raw.textContent=settings.rawError;details.append(summary,raw);host.append(details);}if(settings.onAction){const button=document.createElement('button');button.type='button';button.textContent=settings.actionLabel;button.onclick=settings.onAction;host.append(button);}}
  function render() {
    const panel=$('file-batch-panel'); if(!panel)return;
    panel.innerHTML=`<div class="file-batch-shortcuts"><strong>빠른 위치</strong><button type="button" data-fb-favorite>${s.favorites.includes(s.path)?'★ 즐겨찾기 해제':'☆ 현재 폴더 저장'}</button><button type="button" data-fb-storage ${s.busy?'disabled':''}>저장장치 찾기</button>${s.storage.map(p=>`<button type="button" data-fb-nav="${esc(p)}">${esc(p==='/sdcard'?'내장 저장소':base(p))}</button>`).join('')}</div><div class="file-batch-shortcuts"><small>즐겨찾기</small>${s.favorites.length?s.favorites.map(p=>`<button type="button" title="${esc(p)}" data-fb-nav="${esc(p)}">★ ${esc(base(p))}</button>`).join(''):'<span>자주 쓰는 폴더를 PC에 저장합니다.</span>'}${s.recent.length?`<label>최근 위치<select data-fb-recent aria-label="최근 열었던 폴더"><option value="">목록에서 선택</option>${s.recent.map(p=>`<option value="${esc(p)}">${esc(p)}</option>`).join('')}</select></label>`:''}</div><div class="file-batch-actions"><strong>${s.selected.size}개 선택</strong><button type="button" data-fb-all>표시된 항목 선택</button><button type="button" data-fb-clear ${s.selected.size?'':'disabled'}>선택 해제</button>${[['download','ZIP 받기'],['copy','다른 폴더로 복사'],['move','이동'],['delete','삭제']].map(([action,label])=>`<button type="button" data-fb-action="${action}" ${s.selected.size?'':'disabled'}>${label}</button>`).join('')}<small>체크박스로 최대 100개 · 변경은 공유 저장소만 · 같은 이름은 덮어쓰지 않음</small></div><div id="file-batch-message" role="status"></div>`;
    if(window.FileMedia?.openCreate){const button=document.createElement('button');button.type='button';button.dataset.fbCreate='';button.textContent='ZIP 만들기·폰에 저장';button.disabled=!s.selected.size;panel.querySelector('.file-batch-actions').append(button);}
    if(window.FileGallery){const button=document.createElement('button');button.type='button';button.dataset.fbGallery='';button.textContent='사진 썸네일 보기';panel.querySelector('.file-batch-actions').append(button);}
    if(window.FileLocations){for(const [action,label,disabled]of [['nested','여러 단계 폴더',false],['duplicates','현재 폴더 중복 검사',false],['compare','선택 2개 내용 비교',s.selected.size!==2||[...s.selected].some(p=>s.entries.find(f=>f.path===p)?.type!=='file')]]){const button=document.createElement('button');button.type='button';button.dataset.fbLocation=action;button.textContent=label;button.disabled=disabled;panel.querySelector('.file-batch-actions').append(button);}}
    panel.onclick=async e=>{
      if(e.target.closest('[data-fb-gallery]')){const visible=[...document.querySelectorAll('[data-file-row]')].map(row=>s.entries.find(item=>item.path===row.dataset.fileRow)).filter(Boolean);window.FileGallery.open({deviceId:s.id,path:s.path,entries:visible,selectedPaths:[...s.selected]});return;}
      const location=e.target.closest('[data-fb-location]');if(location&&!location.disabled){if(location.dataset.fbLocation==='nested')window.FileLocations.openNested({deviceId:s.id,parent:s.path});else if(location.dataset.fbLocation==='duplicates')window.FileLocations.openDuplicates({deviceId:s.id,path:s.path});else window.FileLocations.openCompare({deviceId:s.id,paths:[...s.selected]});return;}
      if(e.target.closest('[data-fb-create]')){if(s.id&&s.selected.size)window.FileMedia?.openCreate({deviceId:s.id,paths:[...s.selected]});return;}
      const nav=e.target.closest('[data-fb-nav]');if(nav)return window.DeviceOps?.browse(nav.dataset.fbNav);
      if(e.target.closest('[data-fb-favorite]')){const i=s.favorites.indexOf(s.path);if(i>=0)s.favorites.splice(i,1);else{s.favorites.unshift(s.path);s.favorites=s.favorites.slice(0,20);}save();render();return;}
      if(e.target.closest('[data-fb-storage]'))return window.FileLocations?window.FileLocations.openVolumes({deviceId:s.id}):discoverStorage();
      if(e.target.closest('[data-fb-clear]')){s.selected.clear();render();decorateRows();return;}
      if(e.target.closest('[data-fb-all]')){const paths=[...document.querySelectorAll('[data-file-row]')].map(row=>row.dataset.fileRow).filter(p=>s.entries.some(f=>f.path===p&&f.type!=='link'));if(paths.length>100){message('현재 표시된 항목이 100개를 넘습니다. 검색으로 범위를 줄여 주세요.',true);return;}s.selected=new Set(paths);render();decorateRows();return;}
      const action=e.target.closest('[data-fb-action]');if(action)openDialog(action.dataset.fbAction);
    };
    panel.onchange=e=>{if(e.target.matches('[data-fb-recent]')&&e.target.value)window.DeviceOps?.browse(e.target.value);};
  }
  function decorateRows() {
    for(const row of document.querySelectorAll('[data-file-row]')) {
      const p=row.dataset.fileRow, file=s.entries.find(f=>f.path===p); let checkbox=row.querySelector('[data-file-batch-check]');
      if(!checkbox){checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.dataset.fileBatchCheck='';checkbox.className='file-batch-check';row.prepend(checkbox);row.classList.add('has-batch-check');checkbox.addEventListener('change',()=>{if(checkbox.checked){if(s.selected.size>=100){checkbox.checked=false;message('한 번에 100개까지 선택할 수 있습니다.',true);return;}s.selected.add(p);}else s.selected.delete(p);render();});}
      checkbox.checked=s.selected.has(p);checkbox.disabled=!file||file.type==='link';checkbox.setAttribute('aria-label',(file?.name||base(p))+' 묶음 선택');
      checkbox.title=file?.type==='link'?'연결 경로는 묶음 작업에서 제외합니다.':'묶음 작업에 선택';
    }
  }
  async function getFiles(id,p) { const r=await fetch('/api/ops/files?'+new URLSearchParams({deviceId:id,path:p}),{cache:'no-store'}),d=await r.json();if(!r.ok||d.error)throw new Error(d.error||'저장소 목록을 읽지 못했습니다.');if(!Array.isArray(d.entries))throw new Error('저장소 목록 응답을 확인하지 못했습니다.');return d; }
  async function discoverStorage() {
    if(s.busy||!s.id)return;const epoch=s.epoch,id=s.id; s.busy=true;render();status($('file-batch-message'),'저장장치와 열 수 있는 위치를 조회하고 있습니다…',false,{type:'loading'});const done=window.DeskFeedback?.start('저장장치 목록 조회',{button:$('file-batch-panel')?.querySelector('[data-fb-storage]')})||(()=>{});
    try {
      const problems=[],issues=(data,p)=>{const items=data.errors?.length?data.errors.map(e=>({path:e.path||p,message:e.rawError||e.message||'일부 항목을 확인하지 못했습니다.'})):(data.warnings||[]).map(value=>({path:p,message:String(value)}));if(!items.length&&data.partial)items.push({path:p,message:'목록을 끝까지 확인하지 못했습니다.'});return items;};
      let candidates=[];try{const data=await getFiles(id,'/storage');problems.push(...issues(data,'/storage'));candidates=data.entries.filter(e=>e.type==='directory'&&!['emulated','self'].includes(e.name)).slice(0,12);}catch(error){problems.push({path:'/storage',message:error.message});}
      if(epoch!==s.epoch)return;
      // Failure to enumerate /storage does not prove the standard shared alias is unreadable.
      const checked=await Promise.all([{path:'/sdcard'},...candidates].map(async item=>{try{const data=await getFiles(id,item.path),warnings=issues(data,item.path);problems.push(...warnings);return data.entries.length||!warnings.length?item.path:null;}catch(error){problems.push({path:item.path,message:error.message});return null;}}));
      if(epoch!==s.epoch)return;s.storage=[...new Set(checked.filter(Boolean))];render();
      if(problems.length){const first=problems[0];status($('file-batch-message'),first.message,true,{type:s.storage.length?'warning':'error',title:s.storage.length?`${s.storage.length}개 저장소 조회 가능 · 일부 위치 확인 제한`:'저장소 접근을 확인하지 못했습니다.',rawError:problems.map(p=>p.path+' · '+p.message).join('\n'),errorContext:{action:'list',path:first.path},followup:s.storage.length?'위에 표시된 위치는 현재 권한으로 조회할 수 있습니다. 확인하지 못한 위치를 저장소 없음으로 판단하지 않습니다.':'조회 실패와 저장소가 없는 상태는 다릅니다.',actionLabel:'저장장치 다시 조회',onAction:()=>epoch===s.epoch&&discoverStorage()});}
      else message(s.storage.length?`${s.storage.length}개 저장소를 열 수 있습니다.`:'조회된 저장소가 없습니다.');
    } catch(error){if(epoch===s.epoch)status($('file-batch-message'),error.message,true,{errorContext:{action:'list',path:'/storage'},actionLabel:'저장장치 다시 조회',onAction:()=>epoch===s.epoch&&discoverStorage()});}finally{done();if(epoch===s.epoch){s.busy=false;const b=$('file-batch-panel')?.querySelector('[data-fb-storage]');if(b)b.disabled=false;}}
  }
  let dialog,dialogRevision=0;
  function closeDialog(){dialogRevision++;if(dialog?.open)dialog.close();}
  function openDialog(action) {
    const paths=[...s.selected];if(!paths.length||!s.id)return;const deviceId=s.id,epoch=s.epoch,labels={download:'선택 항목 ZIP 받기',copy:'선택 항목 복사',move:'선택 항목 이동',delete:'선택 항목 삭제'};
    if(!dialog){dialog=document.createElement('dialog');dialog.id='file-batch-dialog';dialog.className='file-batch-dialog';document.body.append(dialog);}
    const revision=++dialogRevision,sourceDirectory=s.path;let destination=null,running=false;
    dialog.innerHTML=`<form><div class="file-batch-dialog-head"><h3>${labels[action]}</h3><button type="button" data-fb-close>닫기</button></div><p>${action==='delete'?'선택한 항목과 폴더 안의 내용을 삭제합니다.':action==='download'?'선택한 파일·폴더를 한 ZIP으로 받습니다. 합계 2GB·20,000개까지 지원합니다.':'선택한 항목을 같은 이름으로 옮깁니다. 목적지의 기존 항목은 덮어쓰지 않습니다.'}</p><ul>${paths.map(p=>`<li>${esc(p)}</li>`).join('')}</ul>${['copy','move'].includes(action)?'<div class="file-batch-destination"><input readonly aria-label="목적지 폴더" placeholder="목록에서 목적지 폴더 선택"><button type="button" data-fb-pick>폴더 선택</button></div>':''}<label><input type="checkbox" data-fb-continue>일부 항목 실패 시 나머지 계속</label>${action!=='download'?'<label><input type="checkbox" data-fb-confirm required>위 항목에 이 작업을 적용합니다.</label>':''}<div data-fb-result role="status"></div><button type="submit" data-fb-run>${action==='download'?'ZIP 만들기':'작업 실행'}</button></form>`;
    dialog.querySelector('[data-fb-close]').onclick=closeDialog;
    const pick=dialog.querySelector('[data-fb-pick]');if(pick)pick.onclick=async()=>{const d=await window.DeviceTargets?.pick('folder',{startPath:s.path,title:'묶음 작업 목적지 폴더'});if(d&&epoch===s.epoch&&revision===dialogRevision&&dialog.open){destination=d.path;window.PopupHelp?.update(dialog,{destination:d.path,status:'목적지 선택 완료 · 작업 확인 후 실행 대기'});dialog.querySelector('.file-batch-destination input').value=d.path;}};
    dialog.querySelector('form').onsubmit=async e=>{
      e.preventDefault();if(running||epoch!==s.epoch||revision!==dialogRevision||!dialog.open)return;
      const output=dialog.querySelector('[data-fb-result]'),button=dialog.querySelector('[data-fb-run]');
      if(['copy','move'].includes(action)&&!destination){output.textContent='목적지 폴더를 목록에서 선택하세요.';return;}
      if(action!=='download'&&!dialog.querySelector('[data-fb-confirm]').checked)return;
      const body={deviceId,action,paths,destination,confirmPaths:action==='download'?undefined:paths,continueOnError:dialog.querySelector('[data-fb-continue]').checked};
      const controls=['[data-fb-pick]','[data-fb-continue]','[data-fb-confirm]','[data-fb-run]'].map(selector=>dialog.querySelector(selector)).filter(Boolean).map(element=>({element,disabled:element.disabled}));
      let submitted=false;running=true;for(const {element}of controls)element.disabled=true;status(output,'작업을 접수하고 있습니다…',false,{type:'loading'});const done=window.DeskFeedback?.start(labels[action],{button})||(()=>{});
      try {
        const tokenResponse=await fetch('/api/session',{cache:'no-store'}),session=await tokenResponse.json();if(!tokenResponse.ok)throw new Error(session.error||'접속 정보를 확인하지 못했습니다.');
        if(epoch!==s.epoch||revision!==dialogRevision||!dialog.open)return;
        submitted=true;const response=await fetch('/api/ops/file-batch',{method:'POST',headers:{'Content-Type':'application/json','X-ADB-Desk-Token':session.csrfToken},body:JSON.stringify(body)}),result=await response.json();if(!response.ok)throw new Error(result.error||'작업을 시작하지 못했습니다.');
        if(epoch!==s.epoch)return;window.DeviceOps?.refreshJobs();if(revision!==dialogRevision)return;closeDialog();message('작업을 시작했습니다. 작업 목록에서 진행·취소·항목별 결과를 확인하세요.');
      } catch(error){if(epoch===s.epoch&&revision===dialogRevision&&dialog.open)status(output,error.message,true,{errorContext:{action,path:destination||sourceDirectory},followup:submitted?'접수 결과가 확정되지 않았다면 작업 목록과 파일 목록을 먼저 확인하세요. 자동으로 다시 실행하지 않습니다.':'',actionLabel:'파일 목록 확인',onAction:()=>{if(epoch!==s.epoch||revision!==dialogRevision||!dialog.open)return;window.DeviceOps?.refreshJobs();closeDialog();return window.DeviceOps?.browse(sourceDirectory);}});}finally{done();running=false;for(const {element,disabled}of controls)element.disabled=disabled;if(submitted&&action!=='download'){button.disabled=true;button.textContent='목록 확인 후 새로 선택';const confirm=dialog.querySelector('[data-fb-confirm]');if(revision===dialogRevision&&confirm)confirm.checked=false;}}
    };
    window.PopupHelp?.show(dialog,'file-batch',{deviceId,selection:'선택 '+paths.length+'개 · '+labels[action],path:sourceDirectory,status:'선택 항목 확인 대기 · 아직 실행하지 않았습니다.',effect:action==='download'?'기기 파일 읽기 · PC에 ZIP 준비':'실행 시 기기 파일 '+labels[action]});dialog.showModal();
  }
  window.FileBatch={
    get selectedPaths(){return [...s.selected];},
    open(id){s.epoch++;s.id=id;s.path='/sdcard';s.entries=[];s.selected.clear();s.storage=[];s.busy=false;closeDialog();readSaved();render();},
    close(){s.epoch++;s.id=null;s.entries=[];s.selected.clear();s.busy=false;closeDialog();},
    updateFiles(data){if(s.path!==data.path)s.selected.clear();s.path=data.path;s.entries=data.entries;s.selected=new Set([...s.selected].filter(p=>s.entries.some(f=>f.path===p&&f.type!=='link')));s.recent=[data.path,...s.recent.filter(p=>p!==data.path)].slice(0,12);save();render();},
    decorateRows,
  };
})();
