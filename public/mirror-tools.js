(() => {
  const state = { connected: false, supported: true, unsupportedReason: '', pending: false, api: null, received: false, revision: 0, readTask: null, copyTask: null, retryRead: false };
  const $ = id => document.getElementById(id);
  const status = (message, type = 'info', title = '', action) => {
    type=type==='unsupported'?'warning':type==='disconnected'?'offline':type;
    const node=$('mirror-clipboard-status');if(!node)return;node.dataset.state=type;node.classList.toggle('failure',type==='error'||type==='offline');
    if(window.DeskFeedback?.state){try{window.DeskFeedback.state(node,{type,title,message,errorContext:{context:'mirror',action:'clipboard-read'},...(['error','offline'].includes(type)?{rawError:message}:{}),...(action?{actionLabel:action.label,onAction:action.run}:{})});return;}catch{}}
    node.textContent=(title?title+' · ':'')+message;
  };
  const feedback=(label,button)=>{try{const finish=window.DeskFeedback?.start?.(label,{button});return typeof finish==='function'?finish:()=>{};}catch{return()=>{};}};
  const retry=()=>state.connected&&state.supported?{label:'다시 읽기',run:readClipboard}:undefined;
  const update = () => {
    if (!$('mirror-clipboard-read')) return;
    const read=$('mirror-clipboard-read'),copy=$('mirror-clipboard-copy'),copying=!!state.copyTask;
    read.disabled=!state.connected||!state.supported||state.pending||copying;read.setAttribute?.('aria-busy',String(state.pending));read.textContent=state.pending?'읽는 중…':state.retryRead?'다시 읽기':'폰 클립보드 읽기';
    copy.disabled=!state.received||!$('mirror-clipboard-text').value||state.pending||copying;copy.setAttribute?.('aria-busy',String(copying));copy.textContent=copying?'복사 중…':'PC에 복사';
    $('mirror-clipboard-clear').disabled=state.pending||copying||!state.received;
    $('mirror-clipboard-text').setAttribute?.('aria-busy',String(state.pending));
  };
  function finishRead(task){if(!task||task.finished)return;task.finished=true;clearTimeout(task.timer);task.finish();if(state.readTask===task){state.readTask=null;state.pending=false;}update();task.resolve?.();}
  function finishCopy(task){if(!task||task.finished)return;task.finished=true;clearTimeout(task.timer);task.cancel?.();task.finish();if(state.copyTask===task)state.copyTask=null;update();}
  function reset() {
    state.revision++;finishRead(state.readTask);finishCopy(state.copyTask);state.pending=false;state.received=false;state.retryRead=false;
    if ($('mirror-clipboard-text')) $('mirror-clipboard-text').value = '';
    if(!state.supported)status(state.unsupportedReason||'이 연결 방식에서는 폰 클립보드 읽기를 지원하지 않습니다.','unsupported','클립보드 읽기 미지원');
    else if(!state.connected)status('화면 또는 조작 연결을 시작한 뒤 읽기 버튼을 누르세요.','disconnected','클립보드 연결 대기');
    else status('읽기를 눌렀을 때만 폰의 텍스트를 가져옵니다.');update();
  }
  function readClipboard() {
    if(!state.connected||!state.supported||state.pending||state.copyTask)return;
    state.revision++;state.pending=true;state.received=false;state.retryRead=false;$('mirror-clipboard-text').value='';
    const task={revision:state.revision,finish:feedback('폰 클립보드 읽기',$('mirror-clipboard-read'))};task.promise=new Promise(resolve=>task.resolve=resolve);state.readTask=task;update();status('폰의 클립보드 응답을 기다리고 있습니다.','loading','클립보드 읽는 중');
    task.timer=setTimeout(()=>{if(state.readTask!==task||task.revision!==state.revision)return;state.retryRead=true;finishRead(task);status('응답을 확인하지 못했습니다. 빈 클립보드나 기기 제한일 수도 있습니다. 폰에서 텍스트를 복사한 뒤 다시 읽기를 눌러 주세요.','error','읽기 응답 확인 안 됨',retry());},10500);
    try{if(!state.api?.send({type:'get-clipboard'}))throw new Error('조작 연결이 준비되지 않았습니다. 연결 상태를 확인해 주세요.');}
    catch(error){if(state.readTask!==task)return;state.retryRead=true;finishRead(task);status(error.message||'클립보드 읽기를 요청하지 못했습니다.','error','클립보드 읽기 실패',retry());}
    return task.promise;
  }
  async function copyClipboard() {
    const field=$('mirror-clipboard-text');if(!state.received||!field?.value||state.pending||state.copyTask)return;
    const revision=state.revision,text=field.value,task={finish:feedback('PC 클립보드 복사',$('mirror-clipboard-copy'))};state.copyTask=task;update();status('브라우저에 복사를 요청하고 있습니다.','loading','PC에 복사 중');
    const current=()=>state.copyTask===task&&revision===state.revision&&state.received&&field.value===text;
    try {
      if(navigator.clipboard?.writeText&&window.isSecureContext){
        const waiting=new Promise(resolve=>{task.cancel=()=>resolve({cancelled:true});task.timer=setTimeout(()=>resolve({timeout:true}),15000);});let result;
        try{result=await Promise.race([Promise.resolve(navigator.clipboard.writeText(text)).then(()=>({ok:true}),()=>({failed:true})),waiting]);}catch{result={failed:true};}
        if(!current()||result.cancelled)return;
        if(result.ok){status('PC 클립보드에 복사했습니다.','success');return;}
        if(result.timeout){status('브라우저의 복사 완료 응답을 확인하지 못했습니다. 자동으로 다시 복사하지 않습니다. 필요하면 복사 버튼을 다시 누르세요.','error','복사 응답 확인 안 됨');return;}
      }
      if(!current())return;field.focus();field.select();
      try{if(document.execCommand('copy')){status('PC 클립보드에 복사했습니다.','success');return;}}catch{}
      status('자동 복사를 사용할 수 없어 텍스트를 선택했습니다. Ctrl+C 또는 길게 눌러 직접 복사하세요.','unsupported','직접 복사 필요');
    } finally {finishCopy(task);}
  }
  function configure(api) {
    state.api = api; const host = $('mirror-tools'); if (!host || host.dataset.ready) return;
    host.dataset.ready = '1';
    host.innerHTML = '<section class="mirror-tool-section"><h3>폰 클립보드 → PC</h3><div class="mirror-tool-buttons"><button id="mirror-clipboard-read" disabled>폰 클립보드 읽기</button><button id="mirror-clipboard-copy" disabled>PC에 복사</button><button id="mirror-clipboard-clear">지우기</button></div><textarea id="mirror-clipboard-text" rows="3" readonly aria-label="폰에서 읽은 클립보드 텍스트" placeholder="버튼을 눌러 읽은 내용만 여기에 표시됩니다."></textarea><div id="mirror-clipboard-status" role="status" aria-live="polite"></div><small>자동 동기화하지 않습니다. 지우기는 이 화면만 비웁니다.</small></section><section class="mirror-tool-section"><h3>마우스·두 손가락</h3><label><input id="mirror-pinch-mode" type="checkbox">두 손가락 확대·축소</label><label><input id="mirror-mouse-shortcuts" type="checkbox" checked>오른쪽 버튼: 뒤로 · 가운데 버튼: 홈</label><p>왼쪽 드래그: Ctrl은 확대·축소/회전, Shift는 두 손가락 세로 이동, Ctrl+Shift는 가로 이동입니다. 지도 기울이기 등 앱이 지원하는 동작에 사용합니다.</p></section>';
    $('mirror-clipboard-read').onclick = readClipboard; $('mirror-clipboard-copy').onclick = copyClipboard; $('mirror-clipboard-clear').onclick = reset; reset();
    if(window.MirrorInputMap)$('mirror-mouse-shortcuts')?.closest?.('label')?.remove();
  }
  function setConnected(connected,options={}) { const supported=options.clipboardSupported!==false,disconnected=state.connected&&!connected,changed=state.connected!==!!connected||state.supported!==supported;state.connected=!!connected;state.supported=supported;state.unsupportedReason=options.reason||'';if(changed)reset();else update();if(disconnected)status('조작 연결이 종료되어 클립보드 작업과 읽은 내용을 정리했습니다. 다시 연결한 뒤 읽기 버튼을 누르세요.','disconnected','클립보드 연결 종료'); }
  function receive(message) {
    if (!state.pending) return;
    if(message.type==='control-error'){if(message.operation&&message.operation!=='get-clipboard')return;state.retryRead=true;finishRead(state.readTask);status(message.message||'폰 클립보드를 읽지 못했습니다.','error','클립보드 읽기 실패',retry());return;}
    if (message.type !== 'clipboard' || typeof message.text !== 'string') return;
    state.received=true;state.retryRead=false;$('mirror-clipboard-text').value=message.text;finishRead(state.readTask);
    status(message.text?'폰의 텍스트를 읽었습니다. PC에 복사하려면 버튼을 누르세요.':'폰 클립보드가 비어 있습니다. 텍스트를 복사한 뒤 다시 읽어 주세요.',message.text?'success':'empty',message.text?'':'클립보드 비어 있음',message.text?undefined:retry());update();
  }
  function canvasPoint(event, rect, border, size) {
    const innerWidth = rect.width - border.left - border.right, innerHeight = rect.height - border.top - border.bottom;
    if (!size.width || !size.height || innerWidth <= 0 || innerHeight <= 0) return null;
    return { x: Math.max(0, Math.min(size.width - 1, Math.floor((event.clientX - rect.left - border.left) / innerWidth * size.width))), y: Math.max(0, Math.min(size.height - 1, Math.floor((event.clientY - rect.top - border.top) / innerHeight * size.height))) };
  }
  const virtualPoint = (point,size,gesture='pinch') => ({x:gesture==='tilt-horizontal'?point.x:size.width-1-point.x,y:gesture==='tilt-vertical'?point.y:size.height-1-point.y});
  const pinchPoint = (point, size) => virtualPoint(point,size);
  function bindCanvas(canvas, api) {
    const active = new Map(), queued = new Map(); let frame = null, lastMoveAt = -Infinity;
    const enabled = () => api.isReady() && !api.isViewOnly() && !window.MirrorHid?.mouseActive && !window.MirrorView?.inputBlocked && !canvas.hidden;
    const point = event => {
      if (window.MirrorView?.point) return window.MirrorView.point(canvas,event,api.getSize());
      const style = getComputedStyle(canvas);
      return canvasPoint(event,canvas.getBoundingClientRect(),{left:parseFloat(style.borderLeftWidth)||0,right:parseFloat(style.borderRightWidth)||0,top:parseFloat(style.borderTopWidth)||0,bottom:parseFloat(style.borderBottomWidth)||0},api.getSize());
    };
    const pressure = event => Number.isFinite(event.pressure) && event.pressure >= 0 && event.pressure <= 1 ? event.pressure : 1;
    function sendTouches(entry,action,first,release=false) {
      if(!first)return;const size=api.getSize();if(!size.width||!size.height)return;
      first={x:Math.max(0,Math.min(size.width-1,first.x)),y:Math.max(0,Math.min(size.height-1,first.y))};
      const points=entry.gesture?[first,virtualPoint(first,size,entry.gesture)]:[first];
      for(const index of release?points.map((_,i)=>i).reverse():points.map((_,i)=>i))api.send({type:'touch',action,pointerId:entry.ids[index],...points[index],...size,pressure:release?0:entry.pressure});
      entry.last=first;
    }
    function clearFrame(){if(frame!==null)cancelAnimationFrame(frame);frame=null;queued.clear();}
    function releasePointer(browserId,release=true){const entry=active.get(browserId);if(!entry)return;active.delete(browserId);queued.delete(browserId);if(release&&api.isReady())sendTouches(entry,1,entry.last,true);try{if(canvas.hasPointerCapture?.(browserId))canvas.releasePointerCapture(browserId);}catch{}if(!active.size)clearFrame();}
    function cancel(release=true){clearFrame();for(const browserId of [...active.keys()].reverse())releasePointer(browserId,release);lastMoveAt=-Infinity;}
    function flush(timestamp){frame=null;if(!enabled()){cancel();return;}const count=[...active.values()].reduce((sum,entry)=>sum+entry.ids.length,0);if(count>2&&Number.isFinite(timestamp)&&timestamp-lastMoveAt<50){frame=requestAnimationFrame(flush);return;}lastMoveAt=Number.isFinite(timestamp)?timestamp:-Infinity;for(const [id,next]of queued){const entry=active.get(id);if(entry){entry.pressure=next.pressure;sendTouches(entry,2,next.point);}}queued.clear();}
    function resolve(event){const selected=window.MirrorInputMap?.getAction(event);if(selected)return selected;if([1,2].includes(event.button)&&$('mirror-mouse-shortcuts')?.checked)return {kind:'command',message:{type:'key',keycode:event.button===2?4:3}};return {kind:event.button===0?'touch':'ignore'};}
    window.MirrorInputMap?.configure({mount:$('mirror-tools'),onChange:()=>cancel()});
    canvas.addEventListener('pointerdown',event=>{
      if(!enabled())return;const choice=resolve(event);if(choice.kind==='ignore')return;
      // A rejected transformed point must not fall back to untransformed coordinates.
      const first=point(event);if(!first)return;
      if(choice.kind==='command'){event.preventDefault();api.send(choice.message);return;}
      if(active.has(event.pointerId))return;
      const physical=['touch','pen'].includes(event.pointerType);let gesture=null;
      if(!physical){if(['pinch','tilt-vertical','tilt-horizontal'].includes(choice.kind))gesture=choice.kind;else if(choice.kind==='touch'&&event.button===0&&!choice.explicitShift){if(event.shiftKey)gesture=event.ctrlKey?'tilt-horizontal':'tilt-vertical';else if(event.ctrlKey||$('mirror-pinch-mode')?.checked)gesture='pinch';}}
      const used=new Set([...active.values()].flatMap(entry=>entry.ids)),ids=Array.from({length:10},(_,index)=>index).filter(index=>!used.has(index)).slice(0,gesture?2:1);if(ids.length!==(gesture?2:1))return;
      event.preventDefault();canvas.focus();const entry={browserId:event.pointerId,ids,gesture,last:first,pressure:pressure(event),size:api.getSize()};active.set(event.pointerId,entry);
      try{canvas.setPointerCapture(event.pointerId);}catch{}sendTouches(entry,0,first);
    });
    canvas.addEventListener('pointermove',event=>{const entry=active.get(event.pointerId);if(!entry||!enabled())return;const size=api.getSize();if(size.width!==entry.size.width||size.height!==entry.size.height){cancel();return;}const next=point(event);if(!next)return;queued.set(event.pointerId,{point:next,pressure:pressure(event)});if(frame===null)frame=requestAnimationFrame(flush);});
    canvas.addEventListener('pointerup',event=>{const entry=active.get(event.pointerId);if(!entry)return;const end=point(event);if(end)entry.last=end;releasePointer(event.pointerId);});
    canvas.addEventListener('pointercancel',event=>releasePointer(event.pointerId));canvas.addEventListener('lostpointercapture',event=>releasePointer(event.pointerId));
    canvas.addEventListener('contextmenu',event=>{if(enabled()&&resolve(event).kind!=='ignore')event.preventDefault();});
    canvas.addEventListener('auxclick',event=>{if(enabled()&&resolve(event).kind!=='ignore')event.preventDefault();});
    canvas.addEventListener('wheel',event=>{if(!enabled())return;const position=point(event);if(!position)return;event.preventDefault();const scale=event.deltaMode===1?3:event.deltaMode===2?1:100;api.send({type:'scroll',...position,...api.getSize(),horizontal:Math.max(-8,Math.min(8,-event.deltaX/scale)),vertical:Math.max(-8,Math.min(8,-event.deltaY/scale))});},{passive:false});
    window.addEventListener('blur',()=>cancel());document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel();});
    return {cancel,get pointerCount(){return [...active.values()].reduce((sum,entry)=>sum+entry.ids.length,0);}};
  }
  window.MirrorTools = { configure, setConnected, receive, reset, bindCanvas, canvasPoint, pinchPoint, virtualPoint };
})();
