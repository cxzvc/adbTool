(() => {
  const $=id=>document.getElementById(id), keys=['cpu','ram','storage','battery'];
  let data,geometry,selectedRow=null;
  const enabled=new Set(keys);
  const clock=at=>new Date(at).toLocaleTimeString('ko-KR',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'});
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const ratio=(p,key)=>Number.isFinite(p[key])?(['ram','storage'].includes(key)?(p[key+'Total']>0?p[key]/p[key+'Total']*100:null):p[key]):null;
  const fmt=(p,key)=>!p||!Number.isFinite(p[key])?'—':['ram','storage'].includes(key)?`${ratio(p,key)?.toFixed(1)||'—'}% · ${DeskUI.formatBytes(p[key])}`:p[key].toFixed(1).replace(/\.0$/,'')+'%';
  const chargeStyle=value=>value==='charging'?'':['full','discharging','not-charging'].includes(value)?'not-charging':'charge-unknown';
  function select(row){
    selectedRow=row||null;
    const index=row&&data?data.points.findIndex(p=>p.at===row.at&&p.session===row.session):-1;
    $('overview-scrubber').value=index>=0?index:Math.max(0,(data?.points.length||1)-1);
    const root=$('overview-plot'),line=root.querySelector('.resource-cursor');
    if(line)line.setAttribute('visibility',geometry&&row?'visible':'hidden');
    if(line&&geometry&&row){line.setAttribute('x1',geometry.x(row.at));line.setAttribute('x2',geometry.x(row.at));line.setAttribute('visibility','visible');}
    $('overview-selected').textContent=row?`${clock(row.at)} · ${{charging:'충전 중',full:'충전 완료',discharging:'방전 중','not-charging':'충전하지 않음'}[row.charging]||'충전 상태 확인 불가'} · 그래프에 마우스를 올리면 당시 앱 사용량 표시`:'그래프에 마우스를 올리거나 클릭해서 당시 앱 사용량을 확인하세요.';
  }
  function draw(){
    if(!data||$('overview-panel').hidden)return;
    const root=$('overview-plot'),width=Math.max(240,Math.round(root.clientWidth||800)),height=242,left=44,right=width-15,top=12,bottom=196;
    const start=data.firstAt||data.serverTime,end=Math.max(data.lastAt||data.serverTime,start+60000),x=at=>left+(at-start)/(end-start)*(right-left),y=value=>bottom-value/100*(bottom-top);
    geometry={start,end,left,right,width,x,y};
    const grid=[0,25,50,75,100].map(v=>`<line class="resource-gridline" x1="${left}" x2="${right}" y1="${y(v)}" y2="${y(v)}"/><text class="resource-axis" x="${left-8}" y="${y(v)+4}" text-anchor="end">${v}%</text>`).join('');
    const ticks=(width>600?[0,.25,.5,.75,1]:[0,.5,1]).map((f,i,array)=>{const at=start+(end-start)*f;const label=end-start>86400000?new Date(at).toLocaleDateString('ko-KR',{month:'numeric',day:'numeric'})+' '+clock(at).slice(0,5):clock(at);return `<text class="resource-axis" x="${x(at)}" y="236" text-anchor="${i===0?'start':i===array.length-1?'end':'middle'}">${label}</text>`;}).join('');
    const connected=(a,b)=>a&&b&&a.event==='sample'&&b.event==='sample'&&a.session===b.session&&(b.firstAt||b.at)-(a.lastAt||a.at)<=data.intervalMs*3;
    const bands=data.points.map((p,i)=>{const next=data.points[i+1];if(p.charging!=='charging'||!connected(p,next))return '';return `<rect class="overview-charge-zone" x="${x(p.at)}" y="${top}" width="${Math.max(0,x(next.at)-x(p.at))}" height="${bottom-top}"/><rect class="overview-charge-band" x="${x(p.at)}" y="204" width="${Math.max(0,x(next.at)-x(p.at))}" height="6"/>`;}).join('');
    const lines=keys.filter(key=>enabled.has(key)).map(key=>{
      let segment=[],previous;const segments=[];
      for(const p of data.points){const value=ratio(p,key),valid=p.event==='sample'&&Number.isFinite(value);
        if(!valid||!connected(previous,p)||(key==='battery'&&previous?.charging!==p.charging)){if(segment.length)segments.push(segment);segment=[];}
        if(valid)segment.push(p);previous=valid?p:null;
      }
      if(segment.length)segments.push(segment);
      return segments.map(rows=>`<polyline class="overview-line ${key} ${key==='battery'?chargeStyle(rows[0].charging):''}" points="${rows.map(p=>`${x(p.at).toFixed(2)},${y(ratio(p,key)).toFixed(2)}`).join(' ')}"/>${rows.length===1?`<circle class="overview-dot ${key} ${key==='battery'?chargeStyle(rows[0].charging):''}" cx="${x(rows[0].at)}" cy="${y(ratio(rows[0],key))}" r="3"/>`:''}`).join('');
    }).join('');
    root.innerHTML=`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="CPU RAM 저장소 배터리 통합 사용량 그래프"><title>CPU·RAM·저장소·배터리 사용률, 충전 구간</title>${grid}${bands}${lines}<line class="resource-cursor" x1="0" x2="0" y1="${top}" y2="${bottom}" visibility="hidden"/>${ticks}</svg>`;
    select(selectedRow||data.latest);
  }
  function render(value){
    data=value;
    if(selectedRow)selectedRow=data.points.find(p=>p.at===selectedRow.at&&p.session===selectedRow.session)||null;
    $('overview-live').textContent=data.collecting?'연결 중 · 5초마다 기록':'연결 대기 · 저장 기록';$('overview-live').classList.toggle('is-live',data.collecting);
    $('overview-warning').hidden=!data.error;$('overview-warning').textContent=data.error;
    $('overview-count').textContent=`${data.count.toLocaleString()}회 측정${data.latest?' · 마지막 '+clock(data.latest.at):''}`;
    const p=data.latest;
    for(const key of keys)$(`overview-${key}-value`).textContent=fmt(p,key);
    $('overview-charge-label').textContent=p?({charging:'충전 중',full:'충전 완료',discharging:'방전 중','not-charging':'충전하지 않음'})[p.charging]||'상태 조회 불가':'첫 측정 대기';
    $('overview-empty').hidden=data.count>0;$('overview-empty').textContent=data.collecting?'첫 측정값을 기다리고 있습니다.':'선택한 기간에 기록이 없습니다. 기기를 연결하면 자동으로 기록합니다.';
    const options=`<option value="latest">최근 연결 구간</option><option value="all">모든 연결 구간</option>`+data.sessions.map(v=>`<option value="${esc(v.id)}">${new Date(v.start).toLocaleDateString('ko-KR',{month:'numeric',day:'numeric'})} ${clock(v.start)} ~ ${v.active?'수집 중':clock(v.end)}</option>`).join('');
    if($('overview-session').innerHTML!==options)$('overview-session').innerHTML=options;
    $('overview-session').disabled=false;
    const session=$('resource-session').value;$('overview-session').value=session;
    for(const button of $('overview-ranges').querySelectorAll('button'))button.setAttribute('aria-pressed',String(button.dataset.overviewRange===data.range));
    $('overview-scrubber').max=Math.max(0,data.points.length-1);$('overview-scrubber').value=Math.max(0,data.points.length-1);$('overview-scrubber').disabled=!data.count;
    draw();
  }
  function hover(event,pin=false){if(!data?.points.length||!geometry)return;const rect=$('overview-plot').getBoundingClientRect(),g=geometry;const px=(event.clientX-rect.left)*g.width/(rect.width||g.width),at=g.start+Math.max(0,Math.min(1,(px-g.left)/(g.right-g.left)))*(g.end-g.start);window.ResourceCharts?.inspectAt(at,event,pin);}
  $('overview-plot').addEventListener('pointermove',e=>hover(e));
  $('overview-plot').addEventListener('click',e=>hover(e,true));
  $('overview-plot').addEventListener('pointerleave',()=>{if(window.ResourceCharts?.leave)window.ResourceCharts.leave();else window.ResourceCharts?.hideInspector();});
  $('overview-scrubber').oninput=e=>window.ResourceCharts?.inspectIndex(Number(e.target.value),null,true);
  $('overview-ranges').onclick=e=>{const button=e.target.closest('[data-overview-range]');if(button)window.ResourceCharts?.setRange(button.dataset.overviewRange,button);};
  $('overview-session').onchange=e=>window.ResourceCharts?.setSession(e.target.value);
  $('overview-refresh').onclick=()=>window.ResourceCharts?.refresh($('overview-refresh'));
  $('overview-detail').onclick=()=>$('resources-tab').click();
  $('overview-legend').onclick=e=>{const button=e.target.closest('[data-overview-series]');if(!button)return;const key=button.dataset.overviewSeries;if(enabled.has(key)){if(enabled.size===1)return;enabled.delete(key);}else enabled.add(key);button.setAttribute('aria-pressed',String(enabled.has(key)));draw();};
  let frame;new ResizeObserver(()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(draw);}).observe($('overview-plot'));
  window.ResourceOverview={render,select,setBusy(busy){$('overview-plot').setAttribute?.('aria-busy',String(busy));$('overview-refresh').setAttribute?.('aria-busy',String(busy));},reset(){
    data=null;geometry=null;selectedRow=null;$('overview-plot').innerHTML='';
    for(const key of keys)$(`overview-${key}-value`).textContent='—';
    $('overview-live').textContent='기록 확인 중';$('overview-live').classList.remove('is-live');
    $('overview-warning').hidden=true;$('overview-warning').textContent='';$('overview-count').textContent='기록 확인 중';
    $('overview-charge-label').textContent='기록 조회 전';select(null);
    $('overview-session').innerHTML='<option value="latest">최근 연결 구간</option><option value="all">모든 연결 구간</option>';
    $('overview-session').value='latest';$('overview-session').disabled=true;
    $('overview-scrubber').max=0;$('overview-scrubber').value=0;$('overview-scrubber').disabled=true;
    $('overview-empty').hidden=false;$('overview-empty').textContent='선택한 기기의 기록을 확인하고 있습니다.';
  }};
})();
