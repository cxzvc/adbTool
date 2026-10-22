(() => {
  const $ = id => document.getElementById(id);
  const keys = ['cpu', 'ram', 'battery', 'storage'];
  const labels = { cpu: 'CPU 사용률', ram: 'RAM 사용량', battery: '배터리 잔량', storage: '내부 저장소 사용량' };
  const s = { id: null, active: false, mode:'overview', revision: 0, data: null, range: 'all', session: 'latest', cursor: -1, busy: false, geometry: {}, dataScope: null };
  const inspector={cache:new Map(),revision:0,pinned:false,key:null,timer:null,abort:null,position:null,request:null};
  const exportJob = { revision: 0, abort: null, busy: false };
  function invalidateExport() { exportJob.abort?.abort(); exportJob.revision++; exportJob.busy = false; }
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clock = at => new Date(at).toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const stamp = at => new Date(at).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const format = (key, value) => !Number.isFinite(value) ? '—' : ['ram', 'storage'].includes(key) ? DeskUI.formatBytes(value) : value.toFixed(1).replace(/\.0$/, '') + '%';
  const duration = ms => { const seconds = Math.max(0, Math.floor(ms / 1000)); return seconds >= 3600 ? `${Math.floor(seconds/3600)}시간 ${Math.floor(seconds%3600/60)}분` : seconds >= 60 ? `${Math.floor(seconds/60)}분 ${seconds%60}초` : `${seconds}초`; };
  const query = () => new URLSearchParams({ deviceId: s.id, range: s.range, session: s.session });

  function stateCard(id, options) {
    const host=$(id);if(!host)return;host.hidden=!options;if(!options)return;
    host.classList.add('resource-state-host');
    if(window.DeskFeedback?.state)window.DeskFeedback.state(host,options);
    else if(typeof DeskFeedback!=='undefined'&&DeskFeedback.state)DeskFeedback.state(host,options);
    else host.textContent=options.title+' · '+options.message;
  }
  const retryHistory=()=>load(true);
  function showAllHistory(){invalidateExport();s.cursor=-1;s.range='all';s.session='all';hideInspector(true);for(const item of $('resource-ranges').querySelectorAll('button'))item.setAttribute('aria-pressed',String(item.dataset.resourceRange==='all'));return load(true);}
  function renderStates(d){
    let warning=null;
    if(d.error)warning={type:'warning',title:'측정값을 읽지 못했습니다',message:d.error+(d.count?' · 저장된 측정값을 표시합니다.':''),actionLabel:'다시 조회',onAction:retryHistory};
    else if(!d.collecting&&(d.sessions.length||d.count))warning={type:'offline',title:'기기 연결이 끊겨 기록 수집이 멈췄습니다',message:d.count?'저장된 기록은 계속 볼 수 있습니다. 기기를 다시 연결한 뒤 조회하세요.':'기기를 다시 연결하면 새 기록을 수집합니다.',actionLabel:'연결 상태 다시 조회',onAction:retryHistory};
    for(const id of ['resource-warning','overview-warning'])stateCard(id,warning);
    let empty=null;
    if(!d.count){
      const recorded=d.sessions.some(session=>session.count>0);
      if(d.collecting&&!recorded)empty={type:'empty',title:'첫 측정값을 기다리고 있습니다',message:'연결은 확인됐습니다. 약 5초 뒤 기록을 다시 확인하세요.',actionLabel:'다시 조회',onAction:retryHistory};
      else if(!recorded)empty={type:'empty',title:'아직 저장된 사용량 기록이 없습니다',message:'이 PC에서 기기가 ADB로 연결된 동안 기록합니다. 연결 전의 사용량은 가져올 수 없습니다.',actionLabel:'기록 다시 조회',onAction:retryHistory};
      else empty={type:'empty',title:'선택한 기간·연결 구간에 측정값이 없습니다',message:'다른 연결 구간에는 저장된 기록이 있습니다. 전체 기간과 모든 연결 구간을 함께 확인할 수 있습니다.',actionLabel:'전체 기간·모든 연결 보기',onAction:showAllHistory};
    }
    for(const id of ['resource-empty','overview-empty'])stateCard(id,empty);
  }

  async function load(manual = false, button = null) {
    if (!s.id || (!manual && s.busy)) return;
    const revision = ++s.revision, scope = query().toString();
    s.abort?.abort(); s.abort = new AbortController(); s.busy = true;
    const finish = manual ? DeskFeedback.start('사용량 기록·그래프 조회',{button:button||$(s.mode==='resources'?'resource-refresh':'overview-refresh')}) : () => {};
    $('resource-refresh').disabled = true;
    $('overview-refresh').disabled = true;
    $('resource-loading').hidden = !manual;
    $('resource-panel-content').setAttribute('aria-busy', 'true');window.ResourceOverview?.setBusy?.(true);
    if(manual){stateCard('resource-warning',null);stateCard('overview-warning',{type:'loading',title:'사용량 기록을 조회하고 있습니다',message:s.data?'기존 그래프를 유지하며 선택한 기록을 다시 읽고 있습니다.':'선택한 기간과 연결 구간의 기록을 읽고 있습니다.'});for(const id of ['resource-empty','overview-empty'])$(id).hidden=true;}
    try {
      const response = await fetch('/api/ops/telemetry?' + scope, { cache: 'no-store', signal: s.abort.signal });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || '기록을 읽지 못했습니다.');
      if (revision !== s.revision) return;
      const selectedAt = s.cursor >= 0 ? s.data?.points[s.cursor]?.at : null;
      s.data = data; s.dataScope = scope; s.cursor = selectedAt === null || selectedAt === undefined || !data.points.length ? -1 : data.points.reduce((closest,row,i)=>Math.abs(row.at-selectedAt)<Math.abs(data.points[closest].at-selectedAt)?i:closest,0); render();
    } catch (error) {
      if (revision === s.revision && error.name !== 'AbortError') {
        const warning={type:'error',title:'사용량 기록 조회에 실패했습니다',message:error.message+(s.data?' · 마지막으로 받은 그래프를 유지합니다.':' · 아직 기록이 없는 상태와 다릅니다.'),actionLabel:'다시 조회',onAction:retryHistory};
        for(const id of ['resource-warning','overview-warning'])stateCard(id,warning);
        for(const id of ['resource-empty','overview-empty'])$(id).hidden=true;
        for(const id of ['resource-live','overview-live']){$(id).textContent='조회 실패 · 다시 조회 가능';$(id).classList.remove('is-live');}
      }
    } finally {
      finish();
      if (revision === s.revision) { s.busy = false; $('resource-refresh').disabled = false; $('overview-refresh').disabled=false; $('resource-loading').hidden = true; $('resource-panel-content').setAttribute('aria-busy', 'false');window.ResourceOverview?.setBusy?.(false); }
    }
  }

  function render() {
    const d = s.data; if (!d) return;
    $('resource-live').textContent = d.collecting ? '연결 중 · 기록 수집' : '연결 대기 · 저장 기록';
    $('resource-live').classList.toggle('is-live', d.collecting);
    $('resource-updated').textContent = d.latest ? `마지막 측정 ${stamp(d.latest.at)}` : '첫 측정 대기';
    $('resource-warning').hidden = !d.error; $('resource-warning').textContent = d.error;
    const options = `<option value="latest">최근 연결 구간${d.collecting ? ' · 수집 중' : ''}</option><option value="all">모든 연결 구간</option>` + d.sessions.map(v => `<option value="${esc(v.id)}">${stamp(v.start)} ~ ${v.active ? '수집 중' : clock(v.end)} · ${v.count.toLocaleString()}회</option>`).join('');
    if ($('resource-session').innerHTML !== options) $('resource-session').innerHTML = options;
    $('resource-session').value = s.session; $('resource-session').disabled = false;
    if (!$('resource-session').value) { s.session = 'latest'; $('resource-session').value = 'latest'; load(true); return; }
    $('resource-count').textContent = `${d.count.toLocaleString()}회 측정`;
    $('resource-period').textContent = d.firstAt ? `${stamp(d.firstAt)} — ${stamp(d.lastAt)} · ${duration(d.lastAt-d.firstAt)}` : '기기가 연결되면 자동으로 기록을 시작합니다.';
    $('resource-empty').hidden = d.count > 0;
    $('resource-empty').textContent = d.collecting ? '첫 측정값을 기다리고 있습니다. 약 5초 뒤 그래프가 나타납니다.' : d.sessions.length ? '선택한 기간의 측정값이 없습니다. 전체 기간이나 다른 연결 구간을 선택하세요.' : '아직 저장된 기록이 없습니다. ADB로 연결하면 자동으로 측정합니다. 기능 추가 이전의 값은 복원할 수 없습니다.';
    $('resource-export').disabled = exportJob.busy || !d.count;
    for (const key of keys) {
      const last = d.latest, stats = d.stats[key];
      $(`resource-${key}-value`).textContent = format(key, last?.[key]);
      $(`resource-${key}-stats`).textContent = stats.count ? `최소 ${format(key, stats.min)}  ·  평균 ${format(key, stats.average)}  ·  최대 ${format(key, stats.max)}` : '이 항목의 측정값을 기다리는 중';
      let note = '';
      if (key === 'cpu') note = '전체 코어를 합쳐 0~100%로 표시';
      if (key === 'ram') note = last?.ramTotal ? `전체 ${DeskUI.formatBytes(last.ramTotal)} · 사용 가능 ${DeskUI.formatBytes(Number.isFinite(last.ram) ? last.ramTotal-last.ram : null)}` : '사용량 = 전체 − 사용 가능한 RAM';
      if (key === 'battery') note = `${({charging:'충전 중',full:'충전 완료',discharging:'방전 중','not-charging':'충전하지 않음'})[last?.charging] || '충전 상태 대기'}${Number.isFinite(last?.temperature) ? ` · ${last.temperature.toFixed(1)} °C` : ''}`;
      if (key === 'storage') note = last?.storageTotal ? `/data · 전체 ${DeskUI.formatBytes(last.storageTotal)} · 남음 ${DeskUI.formatBytes(last.storageFree)}` : '/data 내부 저장소 · 중복 파티션 제외';
      $(`resource-${key}-note`).textContent = note;
    }
    $('resource-scrubber').max = Math.max(0, d.points.length - 1); $('resource-scrubber').value = s.cursor >= 0 ? s.cursor : Math.max(0, d.points.length - 1); $('resource-scrubber').disabled = !d.count;
    window.ResourceOverview?.render(d);renderStates(d);draw(); selectPoint(s.cursor);
  }

  function draw() {
    const d = s.data; if (!d || !s.active || s.mode!=='resources') return;
    const end = Math.max(d.lastAt || d.serverTime, (d.firstAt || d.serverTime) + 60000);
    const start = d.firstAt || end - 60000;
    for (const key of keys) {
      const root = $(`resource-${key}-plot`), width = Math.max(230, Math.round(root.clientWidth || 500));
      const left = 49, right = width - 12, top = 12, bottom = 143, height = 176;
      const stats = d.stats[key], isBytes = ['ram', 'storage'].includes(key), factor = isBytes ? 1e9 : 1;
      let min = 0, max = isBytes ? Math.max(1, d.points.reduce((max,p)=>Math.max(max,p[key+'Total']||0),0) / factor) : 100;
      if (isBytes && $('resource-zoom').checked && stats.count) {
        const margin = Math.max((stats.max-stats.min)/factor*.2, key === 'ram' ? .05 : .1);
        min = Math.max(0, stats.min/factor-margin); max = stats.max/factor+margin;
      }
      if (max <= min) max = min+1;
      const x = at => left + (at-start)/(end-start)*(right-left), y = value => bottom-(value/factor-min)/(max-min)*(bottom-top);
      s.geometry[key] = { start, end, left, right, width, x, y, min, max, bottom, top };
      const ticks = [0,.25,.5,.75,1].map(f => { const value = min+(max-min)*f, yy = bottom-(bottom-top)*f; return `<line class="resource-gridline" x1="${left}" x2="${right}" y1="${yy}" y2="${yy}"/><text class="resource-axis" x="${left-8}" y="${yy+4}" text-anchor="end">${isBytes ? value.toFixed(max-min<2?2:1) : Math.round(value)}${!isBytes ? '%' : ''}</text>`; }).join('');
      const dates = [0,.5,1].map((f,i) => { const at = start+(end-start)*f; const label = end-start > 86400000 ? new Date(at).toLocaleDateString('ko-KR',{month:'numeric',day:'numeric'})+' '+clock(at).slice(0,5) : clock(at); return `<text class="resource-axis" x="${left+f*(right-left)}" y="165" text-anchor="${['start','middle','end'][i]}">${label}</text>`; }).join('');
      const segments = []; let segment = [], previous;
      for (const row of d.points) {
        const valid = row.event === 'sample' && Number.isFinite(row[key]);
        if (!valid || (previous && (row.session !== previous.session || (row.firstAt || row.at)-(previous.lastAt || previous.at) > d.intervalMs*3))) { if(segment.length)segments.push(segment); segment=[]; }
        if (valid) segment.push(row); previous = valid ? row : null;
      }
      if(segment.length)segments.push(segment);
      const lines = segments.map(rows => {
        const coords = rows.map(r => `${x(r.at).toFixed(2)},${y(r[key]).toFixed(2)}`);
        const envelope = rows.some(r => r.samples>1) ? `<polygon class="resource-envelope" points="${rows.map(r=>`${x(r.at)},${y(r.high?.[key]??r[key])}`).concat([...rows].reverse().map(r=>`${x(r.at)},${y(r.low?.[key]??r[key])}`)).join(' ')}"/>` : '';
        return `${envelope}<polygon class="resource-area" points="${x(rows[0].at)},${bottom} ${coords.join(' ')} ${x(rows.at(-1).at)},${bottom}"/><polyline class="resource-line" points="${coords.join(' ')}"/>${rows.length===1 ? `<circle class="resource-single" cx="${x(rows[0].at)}" cy="${y(rows[0][key])}" r="3.5"/>` : ''}`;
      }).join('');
      root.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${labels[key]} 시간별 그래프${isBytes ? ', GB 단위' : ''}"><title>${labels[key]} · ${d.count}회 측정</title>${ticks}${dates}${lines}<line class="resource-cursor" x1="0" x2="0" y1="${top}" y2="${bottom}" visibility="hidden"/><circle class="resource-marker" r="4" visibility="hidden"/></svg>`;
      $(`resource-${key}-unit`).textContent = isBytes ? ($('resource-zoom').checked ? 'GB · 변화 확대' : 'GB') : '%';
    }
    selectPoint(s.cursor);
  }
  function selectPoint(index) {
    const points = s.data?.points || []; s.cursor = index;
    const row = index >= 0 ? points[index] : points.at(-1);
    window.ResourceOverview?.select(row);
    $('resource-cursor-time').textContent = row ? `${index>=0?'선택 시점':'마지막 측정'} ${stamp(row.at)}${row.samples>1?` · ${row.samples}회 평균 (범위 포함)`:''}` : '그래프 위에 마우스를 올리거나 아래 막대를 움직여 시점을 확인하세요.';
    $('resource-scrubber').value=index>=0?index:Math.max(0,points.length-1);
    for (const key of keys) {
      const root=$(`resource-${key}-plot`), g=s.geometry[key], line=root.querySelector('.resource-cursor'), dot=root.querySelector('.resource-marker');
      $(`resource-${key}-hover`).textContent = row ? `${clock(row.at)} · ${format(key,row[key])}${row.samples>1&&Number.isFinite(row[key])?` (${format(key,row.low[key])}~${format(key,row.high[key])})`:''}` : '측정값 대기';
      if (!line||!dot||!g) continue;
      line.setAttribute('visibility',row?'visible':'hidden'); dot.setAttribute('visibility',row&&Number.isFinite(row[key])?'visible':'hidden');
      if(row){const xx=g.x(row.at);line.setAttribute('x1',xx);line.setAttribute('x2',xx);dot.setAttribute('cx',xx);if(Number.isFinite(row[key]))dot.setAttribute('cy',g.y(row[key]));}
    }
  }
  function pointFromPointer(event,key,pin=false) {
    if(inspector.pinned&&!pin)return null;
    const d=s.data,g=s.geometry[key];if(!d?.points.length||!g)return null;
    const rect=event.currentTarget.getBoundingClientRect();
    const px=(event.clientX-rect.left)*g.width/(rect.width||g.width);
    const at=g.start+Math.max(0,Math.min(1,(px-g.left)/(g.right-g.left)))*(g.end-g.start);
    let index=0;for(let i=1;i<d.points.length;i++)if(Math.abs(d.points[i].at-at)<Math.abs(d.points[index].at-at))index=i;
    const row=d.points[index];if(at<(row.firstAt||row.at)-d.intervalMs*1.5||at>(row.lastAt||row.at)+d.intervalMs*1.5){hideInspector();return null;}
    selectPoint(index);
    if(['cpu','ram'].includes(key))inspectIndex(index,event,pin,at);
    return index;
  }
  function positionInspector(event){
    const root=$('resource-inspector');
    if(event)inspector.position={x:event.clientX,y:event.clientY};
    const p=inspector.position||{x:window.innerWidth-40,y:120},w=root.offsetWidth,h=root.offsetHeight;
    let x=p.x+18,y=p.y+16;
    if(x+w>window.innerWidth-12)x=p.x-w-18;
    if(y+h>window.innerHeight-12)y=p.y-h-16;
    root.style.left=Math.max(12,Math.min(window.innerWidth-w-12,x))+'px';root.style.top=Math.max(12,Math.min(window.innerHeight-h-12,y))+'px';
  }
  function hideInspector(force=false){
    if(inspector.pinned&&!force)return;
    clearTimeout(inspector.timer);inspector.abort?.abort();inspector.revision++;inspector.key=null;inspector.pinned=false;inspector.request=null;
    $('resource-inspector').hidden=true;$('resource-inspector').classList.remove('is-pinned');
  }
  function retryInspector(){
    const request=inspector.request;if(!request||request.deviceId!==s.id||request.scope!==s.dataScope)return;
    inspector.cache.delete(inspector.key);inspector.key=null;inspectAt(request.at,null,true);
  }
  function inspectLatest(){
    const points=s.data?.points||[];let index=points.length-1;while(index>=0&&points[index].event!=='sample')index--;
    if(index>=0){inspector.key=null;inspectIndex(index,null,true);}else hideInspector(true);
  }
  function showDetail(row,{failed=false}={}){
    $('resource-inspector-time').textContent=stamp(row.at)+' · 당시 저장된 측정값';
    const charge=({charging:'충전 중',full:'충전 완료',discharging:'방전 중','not-charging':'충전하지 않음'})[row.charging]||'충전 상태 불명';
    $('resource-inspector-values').innerHTML=keys.map(key=>`<span>${labels[key]} <b>${format(key,row[key])}</b></span>`).join('')+`<span>${charge}</span>`;
    let message=null;
    if(failed)message={type:'error',title:'이 시점의 앱 사용량 조회에 실패했습니다',message:row.message||'잠시 뒤 같은 시점을 다시 조회하세요.',actionLabel:'같은 시점 다시 조회',onAction:retryInspector};
    else if(row.event!=='sample')message={type:'empty',title:'연결 또는 측정이 끊긴 구간입니다',message:'이 구간에는 실제 측정값과 앱 사용량 기록이 없습니다.',actionLabel:'최근 측정 시점 보기',onAction:inspectLatest};
    else if(!row.processes)message={type:'empty',title:'이 시점에는 앱별 기록이 없습니다',message:row.message||'전체 사용량만 저장된 시점입니다. 현재 앱 목록으로 대신 표시하지 않습니다.',actionLabel:'최근 측정 시점 보기',onAction:inspectLatest};
    else if(!row.processes.cpu?.length&&!row.processes.ram?.length)message={type:'warning',title:'이 시점의 앱 목록을 읽지 못했습니다',message:row.message||'전체 사용량은 있지만 CPU·RAM 상위 앱 목록이 비어 있습니다.',actionLabel:'같은 시점 다시 조회',onAction:retryInspector};
    else if(row.message)message={type:'info',title:'시점 기록 안내',message:row.message};
    stateCard('resource-inspector-message',message);
    const known={system_server:'Android 시스템',surfaceflinger:'화면 합성 서비스',adbd:'ADB 연결 서비스',top:'top · 측정 도구'};
    for(const key of ['cpu','ram']){
      const rows=row.processes?.[key]||[];
      $(`resource-inspector-${key}`).innerHTML=rows.length?rows.map(p=>`<li><div class="resource-process-name">${esc(/^app_process/.test(p.name)&&p.package?p.package:known[p.name]||p.name)}<small>PID ${Number(p.pid)} · ${esc(/^app_process/.test(p.name)&&p.package?p.name:p.user)}</small></div><b>${key==='cpu'?Number(p.cpu).toFixed(2)+'%':DeskUI.formatBytes(p.rss)}</b></li>`).join(''):`<div class="resource-inspector-empty">${row.processes?'이 시점의 목록을 읽지 못했습니다.':'저장된 앱 목록 없음'}</div>`;
    }
    $('resource-inspector-loading').hidden=true;$('resource-inspector').setAttribute('aria-busy','false');positionInspector();
  }
  function inspectIndex(index,event,pin=false,requestedAt=null){
    if(inspector.pinned&&!pin)return;
    const row=s.data?.points[index];if(!row||s.dataScope!==query().toString())return;
    selectPoint(index);
    const at=row.samples>1&&requestedAt!==null?Math.max(row.firstAt,Math.min(row.lastAt,requestedAt)):row.at;
    const key=[s.id,row.session,Math.round(at)].join(':');inspector.request={deviceId:s.id,scope:s.dataScope,at};
    if(pin)inspector.pinned=true;
    const root=$('resource-inspector');root.hidden=false;root.classList.toggle('is-pinned',inspector.pinned);root.setAttribute('role',inspector.pinned?'dialog':'tooltip');
    $('resource-inspector-hint').textContent=inspector.pinned?'고정된 시점 · × 또는 Esc로 닫기':'클릭하면 고정 · Esc로 닫기';
    positionInspector(event);
    if(inspector.key===key)return;
    inspector.key=key;clearTimeout(inspector.timer);inspector.abort?.abort();const revision=++inspector.revision;
    $('resource-inspector-time').textContent=stamp(at);$('resource-inspector-values').innerHTML='';$('resource-inspector-message').hidden=true;
    $('resource-inspector-cpu').innerHTML='';$('resource-inspector-ram').innerHTML='';
    if(row.event!=='sample'){showDetail({...row,message:'연결 또는 측정이 끊긴 구간입니다.',processes:null});return;}
    if(inspector.cache.has(key)){showDetail(inspector.cache.get(key));return;}
    $('resource-inspector-loading').hidden=false;root.setAttribute('aria-busy','true');
    inspector.timer=setTimeout(async()=>{
      inspector.abort=new AbortController();
      try{
        const params=new URLSearchParams({deviceId:s.id,at:String(at),session:String(row.session)});
        const response=await fetch('/api/ops/telemetry-point?'+params,{cache:'no-store',signal:inspector.abort.signal});const detail=await response.json();if(!response.ok)throw new Error(detail.error||'시점 기록 조회 실패');
        if(revision!==inspector.revision)return;
        inspector.cache.set(key,detail);if(inspector.cache.size>256)inspector.cache.delete(inspector.cache.keys().next().value);
        showDetail(detail);
      }catch(error){if(revision===inspector.revision&&error.name!=='AbortError'){inspector.key=null;showDetail({...row,processes:null,message:error.message+' · 같은 시점을 다시 선택하면 재시도합니다.'},{failed:true});}}
    },pin?0:110);
  }
  function inspectAt(at,event,pin=false){
    const points=s.data?.points;if(!points?.length)return;
    let index=0;for(let i=1;i<points.length;i++)if(Math.abs(points[i].at-at)<Math.abs(points[index].at-at))index=i;
    // Hovering a wide blank gap must not borrow an unrelated nearby snapshot.
    const row=points[index];if(at<(row.firstAt||row.at)-s.data.intervalMs*1.5||at>(row.lastAt||row.at)+s.data.intervalMs*1.5){hideInspector();return;}
    inspectIndex(index,event,pin,at);
  }
  function setRange(range,button=null){invalidateExport();s.cursor=-1;s.range=range;hideInspector(true);for(const item of $('resource-ranges').querySelectorAll('button'))item.setAttribute('aria-pressed',String(item.dataset.resourceRange===range));load(true,button);}
  function setSession(session){invalidateExport();s.cursor=-1;s.session=session;hideInspector(true);load(true);}
  $('resource-ranges').onclick = event => {
    const button=event.target.closest('[data-resource-range]');if(!button)return;
    setRange(button.dataset.resourceRange,button);
  };
  $('resource-session').onchange=()=>setSession($('resource-session').value);
  $('resource-refresh').onclick=()=>load(true,$('resource-refresh'));
  $('resource-zoom').onchange=()=>DeskFeedback.paint('그래프 축 범위 변경',draw);
  $('resource-scrubber').oninput=event=>inspectIndex(Number(event.target.value),null,true);
  $('resource-inspector-close').onclick=()=>hideInspector(true);
  document.addEventListener('keydown',event=>{if(event.key==='Escape')hideInspector(true);});
  $('resource-export').onclick=async()=>{
    if(!s.id||exportJob.busy)return;
    const scope=query().toString(),revision=++exportJob.revision,finish=DeskFeedback.start('사용량 기록 CSV 저장',{button:$('resource-export')});
    exportJob.abort=new AbortController();exportJob.busy=true;$('resource-export').disabled=true;stateCard('resource-warning',{type:'loading',title:'사용량 기록 CSV를 준비하고 있습니다',message:'선택한 기간·연결 구간의 원본 측정값을 파일로 읽고 있습니다.'});
    const current=()=>revision===exportJob.revision&&scope===query().toString();
    try{const response=await fetch('/api/ops/telemetry-export?'+scope,{cache:'no-store',signal:exportJob.abort.signal});if(!response.ok)throw new Error('CSV를 가져오지 못했습니다.');const blob=await response.blob();if(!current())return;const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`adb-resources-${new Date().toISOString().slice(0,10)}.csv`;a.click();stateCard('resource-warning',{type:'success',title:'CSV 파일 저장을 시작했습니다',message:'브라우저 다운로드 목록에서 파일을 확인하세요. 선택한 기간과 연결 구간은 유지됩니다.'});setTimeout(()=>URL.revokeObjectURL(url),10000);}
    catch(error){if(current()&&error.name!=='AbortError')stateCard('resource-warning',{type:'error',title:'CSV 저장에 실패했습니다',message:error.message,actionLabel:'CSV 다시 저장',onAction:()=>$('resource-export').onclick()});}
    finally{finish();if(revision===exportJob.revision){exportJob.busy=false;$('resource-export').disabled=!s.data?.count;}}
  };
  for(const key of keys){const plot=$(`resource-${key}-plot`);plot.addEventListener('pointermove',event=>pointFromPointer(event,key));plot.addEventListener('click',event=>pointFromPointer(event,key,true));plot.addEventListener('pointerleave',()=>{if(!inspector.pinned){selectPoint(-1);hideInspector();}});}
  let resizeFrame;new ResizeObserver(()=>{cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(draw);}).observe($('resource-charts'));
  setInterval(()=>{if(s.active&&!document.hidden)load();},5000);
  document.addEventListener('visibilitychange',()=>{if(s.active&&!document.hidden)load();});
  window.ResourceCharts={
    open(id){window.ResourceOverview?.setBusy?.(false);invalidateExport();hideInspector(true);inspector.cache.clear();window.ResourceOverview?.reset();s.abort?.abort();s.revision++;s.id=id;s.data=null;s.dataScope=null;s.busy=false;s.active=false;s.cursor=-1;s.session='latest';s.geometry={};$('resource-session').innerHTML='<option value="latest">최근 연결 구간</option><option value="all">모든 연결 구간</option>';$('resource-session').value='latest';$('resource-session').disabled=true;$('resource-scrubber').max=0;$('resource-scrubber').value=0;$('resource-scrubber').disabled=true;$('resource-warning').hidden=true;$('resource-export').disabled=true;$('resource-live').textContent='기록 확인 중';$('resource-live').classList.remove('is-live');$('resource-count').textContent='측정값 대기';$('resource-period').textContent='기록을 확인하고 있습니다.';$('resource-updated').textContent='';$('resource-empty').hidden=true;for(const key of keys){$(`resource-${key}-value`).textContent='—';$(`resource-${key}-plot`).innerHTML='';$(`resource-${key}-stats`).textContent='측정값 대기';$(`resource-${key}-note`).textContent='기록 조회 중';$(`resource-${key}-hover`).textContent='';}},
    close(){invalidateExport();hideInspector(true);s.abort?.abort();s.revision++;s.id=null;s.active=false;s.busy=false;},
    activate(active,mode){hideInspector(true);s.active=active;s.mode=mode;if(active){if(s.data)render();load(true);}},
    leave(){if(!inspector.pinned){selectPoint(-1);hideInspector();}},inspectAt,inspectIndex,hideInspector,setRange,setSession,refresh:button=>load(true,button)
  };
})();
