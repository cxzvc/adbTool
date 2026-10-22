(() => {
  const $=id=>document.getElementById(id),esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const state={id:null,epoch:0,active:false,built:false,captureBusy:false,networkBusy:false,imageUrl:null,captureAbort:null,networkAbort:null,captureFinish:null,networkFinish:null,captureIssue:null,networkIssue:null,navigate:null};
  const MAX_IMAGE=24*1024*1024,UUID=/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
  const cancelled=()=>Object.assign(new Error('기기 선택이 변경되었습니다.'),{name:'AbortError'});
  const valid=(id,epoch)=>state.id===id&&state.epoch===epoch&&state.active;
  const clock=value=>{const date=new Date(value||Date.now());return Number.isFinite(date.getTime())?date.toLocaleTimeString('ko-KR',{hour12:false}):'시간 미확인';};
  function navigate(tab,path){if(!state.id)return;(state.navigate||((name,target)=>window.DeviceDesk?.navigate(name,target)))(tab,path);}
  function build(){
    const panel=$('overview-tools');if(!panel)return false;if(state.built)return true;
    panel.classList.add('overview-tools');panel.innerHTML=`
      <article class="overview-tool-card overview-screen-card"><header><div><h3>현재 화면 캡처</h3><small>버튼을 눌렀을 때의 화면 한 장</small></div><button type="button" id="overview-screen-read">지금 캡처</button></header><div id="overview-screen-frame" class="overview-screen-frame"><p id="overview-screen-empty">캡처를 누르면 기기 화면을 가져옵니다.<br>화면을 켜거나 조작하지 않습니다.</p><img id="overview-screen-image" alt="선택한 기기에서 직접 요청해 캡처한 화면" hidden></div><div id="overview-screen-progress" class="overview-tool-progress" hidden><progress aria-label="화면 캡처 진행 중"></progress></div><p id="overview-screen-status" class="overview-tool-status" role="status">아직 캡처하지 않았습니다.</p><div id="overview-screen-state" hidden></div><footer><a id="overview-screen-save" hidden download>PNG 저장</a><button type="button" id="overview-screen-open">화면 조작 열기</button></footer></article>
      <article class="overview-tool-card"><header><div><h3>Wi-Fi 간단 상태</h3><small>연결·신호·IP 한눈에 보기</small></div><button type="button" id="overview-network-read">상태 조회</button></header><div id="overview-network-progress" class="overview-tool-progress" hidden><progress aria-label="네트워크 상태 조회 중"></progress></div><dl id="overview-network-values" class="overview-network-values"><div><dt>조회 상태</dt><dd>조회 전</dd></div></dl><p id="overview-network-status" class="overview-tool-status" role="status">자동 조회하지 않습니다.</p><div id="overview-network-state" hidden></div><footer><button type="button" id="overview-network-open">네트워크 상세</button></footer></article>
      <article class="overview-tool-card"><header><div><h3>파일 즐겨찾기</h3><small>이 브라우저에 저장한 폴더</small></div><button type="button" id="overview-bookmarks-read">목록 새로고침</button></header><div id="overview-bookmarks" class="overview-bookmarks"></div><p id="overview-bookmarks-status" class="overview-tool-status" role="status"></p><footer><button type="button" id="overview-files-open">내장 저장소 열기</button></footer></article>`;
    $('overview-screen-read').onclick=capture;$('overview-network-read').onclick=network;$('overview-bookmarks-read').onclick=bookmarks;
    $('overview-screen-open').onclick=()=>navigate('screen');$('overview-network-open').onclick=()=>navigate('network');$('overview-files-open').onclick=()=>navigate('files','/sdcard');
    $('overview-bookmarks').onclick=event=>{const button=event.target.closest('[data-overview-folder]');if(!button)return;try{navigate('files',normalizePath(button.dataset.overviewFolder));}catch(error){$('overview-bookmarks-status').textContent=error.message;}};
    $('overview-screen-image').onerror=()=>{if(!state.imageUrl)return;$('overview-screen-image').hidden=true;$('overview-screen-empty').hidden=false;$('overview-screen-empty').textContent='PNG 이미지를 표시하지 못했습니다.';$('overview-screen-status').textContent='캡처 파일을 다시 확인해 주세요.';issue('capture',{type:'error',title:'캡처 이미지를 표시하지 못했습니다.',message:'파일을 다시 캡처하거나 PNG 저장으로 결과를 확인하세요. 자동으로 캡처하지 않습니다.'});};
    state.built=true;return true;
  }
  function normalizePath(value){
    if(window.DevicePreferences?.normalizePath)return window.DevicePreferences.normalizePath(value);
    if(typeof value!=='string'||!value.startsWith('/')||value.startsWith('//')||value.length>4096||/[\x00-\x1f\x7f\\]/.test(value)||value.split('/').some(part=>part==='.'||part==='..'))throw new Error('저장된 폴더 위치가 올바르지 않습니다.');
    return value.replace(/\/{2,}/g,'/').replace(/\/$/,'')||'/';
  }
  function bookmarks(){
    if(!build())return;let paths=[];
    if(state.id)try{const raw=localStorage.getItem('adb-desk-file-shortcuts:'+state.id);if(raw&&raw.length<=100000){const data=JSON.parse(raw);if(Array.isArray(data?.favorites))paths=[...new Set(data.favorites.slice(0,20).flatMap(value=>{try{return[normalizePath(value)];}catch{return[];}}))];}}catch{}
    $('overview-bookmarks').innerHTML=paths.length?paths.map(path=>`<button type="button" data-overview-folder="${esc(path)}" title="${esc(path)}"><span aria-hidden="true">☆</span><span><strong>${esc(path==='/'?'기기 최상위':path.split('/').at(-1))}</strong><small>${esc(path)}</small></span><span aria-hidden="true">›</span></button>`).join(''):'<p class="overview-tool-empty">저장한 폴더가 없습니다.<br>파일 관리에서 ‘현재 폴더 저장’을 누르세요.</p>';
    $('overview-bookmarks-status').textContent=paths.length?`${paths.length}개 · 선택하면 해당 폴더를 엽니다.`:'즐겨찾기 목록은 폰 조회 없이 불러옵니다.';
  }
  function releaseImage(){if(state.imageUrl)URL.revokeObjectURL(state.imageUrl);state.imageUrl=null;if(!state.built)return;$('overview-screen-image').removeAttribute('src');$('overview-screen-image').hidden=true;$('overview-screen-save').removeAttribute('href');$('overview-screen-save').hidden=true;$('overview-screen-empty').hidden=false;}
  function issue(kind,options){
    state[kind+'Issue']=options;const host=$(kind==='capture'?'overview-screen-state':'overview-network-state');if(!host)return;const id=state.id,epoch=state.epoch;
    const data=options?{...options,actionLabel:options.actionLabel||(kind==='capture'?'다시 캡처':'상태 다시 조회'),onAction:()=>{if(valid(id,epoch))return kind==='capture'?capture():network();}}:null;
    if(window.DeskFeedback?.state)window.DeskFeedback.state(host,data);else{host.hidden=!data;host.textContent=data?`${data.title} ${data.message||''}`:'';}
  }
  function feedback(kind,label,button){const end=window.DeskFeedback?.start(label,{button})||(()=>{});let done=false;const finish=()=>{if(!done){done=true;end();}if(state[kind+'Finish']===finish)state[kind+'Finish']=null;};state[kind+'Finish']=finish;return finish;}
  const failureType=error=>/연결|offline|not found|Failed to fetch|network/i.test(error.message)?'offline':/지원하지|지원하지 않|not supported|unknown command/i.test(error.message)?'warning':'error';
  function reset(){
    state.epoch++;state.captureAbort?.abort();state.networkAbort?.abort();state.captureFinish?.();state.networkFinish?.();state.captureAbort=null;state.networkAbort=null;state.captureBusy=false;state.networkBusy=false;releaseImage();
    if(!build())return;$('overview-screen-read').disabled=!state.id;$('overview-network-read').disabled=!state.id;$('overview-screen-open').disabled=!state.id;$('overview-network-open').disabled=!state.id;$('overview-files-open').disabled=!state.id;
    $('overview-screen-empty').innerHTML='캡처를 누르면 기기 화면을 가져옵니다.<br>화면을 켜거나 조작하지 않습니다.';$('overview-screen-status').textContent='아직 캡처하지 않았습니다.';$('overview-network-status').textContent='자동 조회하지 않습니다.';$('overview-network-values').innerHTML='<div><dt>조회 상태</dt><dd>조회 전</dd></div>';
    $('overview-screen-progress').hidden=true;$('overview-network-progress').hidden=true;issue('capture',null);issue('network',null);bookmarks();
  }
  async function json(url,options={}){const response=await fetch(url,{cache:'no-store',...options}),data=await response.json();if(!response.ok)throw new Error(data.error||'요청을 처리하지 못했습니다.');return data;}
  function pause(ms,signal){return new Promise((resolve,reject)=>{const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(cancelled());};const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});});}
  async function pngBlob(response){
    if(!response.ok)throw new Error('캡처 파일을 가져오지 못했습니다.');
    const type=(response.headers.get('Content-Type')||'').split(';')[0].trim().toLowerCase();if(!['image/png','application/octet-stream'].includes(type))throw new Error('캡처 파일의 형식이 PNG가 아닙니다.');
    const advertised=Number(response.headers.get('Content-Length'));if(Number.isFinite(advertised)&&advertised>MAX_IMAGE)throw new Error('화면 미리보기는 24MB 이하의 PNG만 표시합니다. 작업 목록에서 파일을 받으세요.');
    let bytes;if(response.body?.getReader){const reader=response.body.getReader(),chunks=[];let total=0;try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>MAX_IMAGE)throw new Error('화면 미리보기 파일의 크기 한도를 초과했습니다.');chunks.push(value);}}catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}}else bytes=new Uint8Array(await response.arrayBuffer());
    if(bytes.length<33||bytes.length>MAX_IMAGE||![137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value)||String.fromCharCode(...bytes.slice(12,16))!=='IHDR')throw new Error('캡처 결과가 올바른 PNG 파일이 아닙니다.');
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),width=view.getUint32(16),height=view.getUint32(20);if(!width||!height||width>12000||height>12000||width*height>32000000)throw new Error('이미지 크기가 미리보기 범위를 벗어났습니다.');
    return {blob:new Blob([bytes],{type:'image/png'}),width,height};
  }
  async function capture(){
    if(!state.id||!state.active||state.captureBusy||!build())return;const id=state.id,epoch=state.epoch,controller=new AbortController();state.captureAbort=controller;state.captureBusy=true;$('overview-screen-read').disabled=true;$('overview-screen-progress').hidden=false;$('overview-screen-status').textContent='기기 화면 한 장을 요청하고 있습니다…';
    issue('capture',null);const finish=feedback('capture','현재 화면 캡처', $('overview-screen-read'));
    const timer=setTimeout(()=>controller.abort(),65000);let jobId;
    try{
      const session=await json('/api/session',{signal:controller.signal});if(!valid(id,epoch))throw cancelled();
      let job=await json('/api/ops/workbench',{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json','X-ADB-Desk-Token':session.csrfToken},body:JSON.stringify({deviceId:id,action:'screen-native-capture'})});
      jobId=job.id;if(!UUID.test(jobId||''))throw new Error('캡처 작업을 확인하지 못했습니다.');window.DeviceOps?.refreshJobs?.();
      while(job.state==='running'){if(!valid(id,epoch))throw cancelled();$('overview-screen-status').textContent='화면 캡처를 받는 중…';await pause(600,controller.signal);job=await json('/api/ops/job?'+new URLSearchParams({deviceId:id,id:jobId}),{signal:controller.signal});}
      if(!valid(id,epoch))throw cancelled();if(job.deviceId!==id||job.id!==jobId||job.kind!=='screen-native-capture')throw new Error('선택한 기기의 캡처 결과가 아닙니다.');if(job.state!=='success')throw new Error(job.message||'화면 캡처를 완료하지 못했습니다.');
      const result=await pngBlob(await fetch('/api/ops/download-job?'+new URLSearchParams({id:jobId}),{cache:'no-store',signal:controller.signal}));if(!valid(id,epoch))throw cancelled();
      releaseImage();state.imageUrl=URL.createObjectURL(result.blob);$('overview-screen-image').src=state.imageUrl;$('overview-screen-image').hidden=false;$('overview-screen-empty').hidden=true;$('overview-screen-save').href=state.imageUrl;$('overview-screen-save').download=`adb-screen-${Date.now()}.png`;$('overview-screen-save').hidden=false;$('overview-screen-status').textContent=`${clock(job.finishedAt)} 캡처 · ${result.width} × ${result.height} · 정지 이미지`;
    }catch(error){if(valid(id,epoch)){const text=error.name==='AbortError'?'캡처 대기 시간이 끝났습니다. 작업 목록에서 결과를 확인하세요.':error.message;$('overview-screen-status').textContent=text;issue('capture',{type:failureType(error),title:'화면 캡처를 완료하지 못했습니다.',message:text+(state.imageUrl?' 이전에 받은 캡처를 유지합니다.':'')+' 다시 캡처는 버튼을 눌렀을 때만 요청합니다.'});}}
    finally{clearTimeout(timer);finish();if(valid(id,epoch)){state.captureBusy=false;state.captureAbort=null;$('overview-screen-read').disabled=false;$('overview-screen-progress').hidden=true;if(jobId)window.DeviceOps?.refreshJobs?.();}}
  }
  const present=value=>value==null||value===''?'확인 불가':Array.isArray(value)?value.join(', '):String(value);
  function networkValues(data){
    const wifi=data.sections?.find(section=>section.id==='wifi'),addresses=data.sections?.find(section=>section.id==='network')?.tables?.find(table=>table.title==='인터페이스·주소')?.rows||[];
    const value=label=>{const item=wifi?.items?.find(row=>row.label===label);return item?.status&&item.status!=='ok'?'확인 불가':present(item?.value);};
    const ip=addresses.filter(row=>/^wlan\d*$/i.test(row.name||'')).map(row=>`${row.name}: ${present(row.ipv4)}`).join(' · ')||'확인 불가';
    return [['Wi-Fi',value('Wi-Fi 상태')],['연결',value('접속 상태')],['네트워크',value('네트워크 이름 (SSID)')],['신호',value('수신 신호 (RSSI)')],['링크 속도',value('연결 속도')],['Wi-Fi IP',ip]];
  }
  async function network(){
    if(!state.id||!state.active||state.networkBusy||!build())return;const id=state.id,epoch=state.epoch,controller=new AbortController();state.networkAbort=controller;state.networkBusy=true;$('overview-network-read').disabled=true;$('overview-network-progress').hidden=false;$('overview-network-status').textContent='현재 네트워크 상태를 조회하는 중…';const timer=setTimeout(()=>controller.abort(),65000);
    issue('network',null);const finish=feedback('network','Wi-Fi 간단 상태 조회',$('overview-network-read'));
    try{const data=await json('/api/ops/network-info?'+new URLSearchParams({deviceId:id}),{signal:controller.signal});if(!valid(id,epoch))return;if(data.deviceId!==id||!Array.isArray(data.sections))throw new Error('선택한 기기의 네트워크 결과가 아닙니다.');$('overview-network-values').innerHTML=networkValues(data).map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('');$('overview-network-status').textContent=`${clock(data.updatedAt)} 조회 · 무선 링크 속도이며 인터넷 속도 측정값이 아닙니다.`;
      const items=data.sections.find(section=>section.id==='wifi')?.items||[];if(!items.some(item=>(!item.status||item.status==='ok')&&item.value!=null)){const restricted=items.some(item=>['unsupported','denied'].includes(item.status));issue('network',{type:restricted?'warning':'empty',title:restricted?'이 기기의 Wi-Fi 정보 공개가 제한되어 있습니다.':'표시할 Wi-Fi 상태를 받지 못했습니다.',message:'확인되지 않은 값을 꺼짐이나 0으로 판단하지 않았습니다. 연결 상태를 확인하고 다시 조회할 수 있습니다.'});}
    }
    catch(error){if(valid(id,epoch)){const text=error.name==='AbortError'?'조회 시간이 초과되었습니다. 다시 조회해 주세요.':error.message;$('overview-network-status').textContent=text;issue('network',{type:failureType(error),title:'Wi-Fi 상태를 조회하지 못했습니다.',message:text});}}
    finally{clearTimeout(timer);finish();if(valid(id,epoch)){state.networkBusy=false;state.networkAbort=null;$('overview-network-read').disabled=false;$('overview-network-progress').hidden=true;}}
  }
  window.OverviewTools={configure(options={}){state.navigate=typeof options.navigate==='function'?options.navigate:null;build();},open(id){if(state.id===id)return;state.id=id;state.active=false;reset();},close(){state.id=null;state.active=false;reset();},activate(active){
    state.active=!!active;
    if(active){bookmarks();if(state.captureIssue)issue('capture',state.captureIssue);if(state.networkIssue)issue('network',state.networkIssue);return;}
    state.epoch++;state.captureAbort?.abort();state.networkAbort?.abort();state.captureFinish?.();state.networkFinish?.();state.captureAbort=null;state.networkAbort=null;
    if(state.built){if(state.captureBusy)$('overview-screen-status').textContent='탭을 이동해 캡처 대기를 멈췄습니다. 이미 요청한 작업은 작업 목록에서 확인하세요.';if(state.networkBusy)$('overview-network-status').textContent='탭을 이동해 조회 대기를 멈췄습니다.';$('overview-screen-read').disabled=!state.id;$('overview-network-read').disabled=!state.id;$('overview-screen-progress').hidden=true;$('overview-network-progress').hidden=true;}
    state.captureBusy=false;state.networkBusy=false;
  }};
  window.addEventListener('storage',event=>{if(state.active&&(!event.key||event.key==='adb-desk-file-shortcuts:'+state.id))bookmarks();});
  window.addEventListener('pagehide',()=>window.OverviewTools.close());
})();
