(() => {
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const manufacturerName=value=>({samsung:'삼성'})[String(value||'').toLowerCase()]||String(value||'제조사');
  const s = { id: null, data: null, epoch: 0, socket: null, decoder: null, config: null, reading: false, changing: false, width: 0, height: 0, frames: 0, frameAt: 0, pointer: null, starting: false };
  let readAbort;
  let mirrorLayoutFrame;
  let audioContext,audioGain,audioDestination,audioAdapter,playbackClock=null;
  const audioSources=new Set();
  function clearScheduledAudio(){for(const source of audioSources){try{source.stop();source.disconnect();}catch{}}audioSources.clear();}
  function playbackStatus(info){let node=$('mirror-sync-status');if(!node){node=document.createElement('span');node.id='mirror-sync-status';node.setAttribute('role','status');$('mirror-metrics').parentElement?.append(node);}node.textContent=info.text;node.title='영상·소리의 기기 PTS를 공통 시계에 맞춥니다. 실제 스피커·디스플레이 지연과 브라우저 호환 재생 오차는 남을 수 있습니다.';node.dataset.limited=String(!!info.limited);}
  function ensurePlaybackClock(){if(!playbackClock){if(!window.MirrorPlaybackClock)throw new Error('재생 시계 모듈을 불러오지 못했습니다. 새로고침해 주세요.');playbackClock=window.MirrorPlaybackClock.create({getAudioContext:()=>audioContext,bufferSeconds:()=>Number(s.activeMedia?.bufferMs??window.MirrorMediaUI?.bufferMs?.()??100)/1000,reset:clearScheduledAudio,status:playbackStatus});}return playbackClock;}
  function stopAudio(){audioAdapter?.close();audioAdapter=null;clearScheduledAudio();playbackClock?.close();playbackClock=null;audioGain=null;audioDestination=null;if(audioContext){audioContext.close().catch(()=>{});audioContext=null;}$('stream-audio-status').textContent='소리 꺼짐';if($('mirror-sync-status'))$('mirror-sync-status').textContent='';}
  function prepareAudio(snapshot=s.activeMedia){
    if(!(snapshot?.audioEnabled??$('stream-audio').checked)||(snapshot?.playbackEnabled??window.MirrorMediaUI?.playbackEnabled?.())===false)return;
    const Context=window.AudioContext||window.webkitAudioContext;if(!Context){$('stream-audio-status').textContent='이 브라우저에서 소리 재생 불가';return;}
    audioContext=new Context({sampleRate:48000,latencyHint:'interactive'});audioGain=audioContext.createGain();audioGain.gain.value=Number($('stream-volume').value)/100;audioGain.connect(audioContext.destination);audioDestination=audioContext.createMediaStreamDestination();audioContext.resume().catch(()=>{});$('stream-audio-status').textContent='소리 연결 준비';
    ensurePlaybackClock();
    if(!window.MirrorAudioDecoder)throw new Error('소리 재생 모듈을 불러오지 못했습니다. 새로고침하거나 PC 소리 재생을 끄세요.');
    audioAdapter=window.MirrorAudioDecoder.create({output:scheduleAudio,error:message=>{const info=window.DeskErrors?.explain(message,{context:'mirror',action:'audio'});$('stream-audio-status').textContent=info?info.reasonKo:message;notice(message,true);}});
  }
  function audioPacket(buffer){audioAdapter?.push(buffer);}
  function scheduleAudio({pts,sampleRate,channels,planes}){
    if(!audioContext||!audioGain||channels!==2||!planes?.[0]?.length||planes[0].length!==planes[1]?.length)return;const count=planes[0].length,plan=ensurePlaybackClock().audioPlan(pts,count/sampleRate);if(plan.drop)return;if(audioSources.size>=128){playbackClock.reset('소리 대기열이 길어 공통 재생 시각을 초기화했습니다.');return;}
    const audioBuffer=audioContext.createBuffer(2,count,sampleRate);audioBuffer.copyToChannel(planes[0],0);audioBuffer.copyToChannel(planes[1],1);
    const source=audioContext.createBufferSource();source.buffer=audioBuffer;source.connect(audioGain);source.connect(audioDestination);audioSources.add(source);source.onended=()=>{audioSources.delete(source);source.disconnect();};source.start(plan.when,plan.offset,plan.duration);$('stream-audio-status').textContent=audioContext.state==='running'?'공통 시각으로 소리 재생 · PC 녹화 포함':'소리 재생 대기 · PC 소리 재개 버튼';
  }
  function fitMirrorCanvas() {
    const canvas=$('phone-canvas'),stage=$('phone-stage');
    if(canvas.hidden||!stage.clientWidth||!stage.clientHeight)return;
    const area=getComputedStyle(stage),border=getComputedStyle(canvas);
    const bx=parseFloat(border.borderLeftWidth)+parseFloat(border.borderRightWidth);
    const by=parseFloat(border.borderTopWidth)+parseFloat(border.borderBottomWidth);
    const width=Math.max(1,stage.clientWidth-parseFloat(area.paddingLeft)-parseFloat(area.paddingRight)-bx);
    const height=Math.max(1,stage.clientHeight-parseFloat(area.paddingTop)-parseFloat(area.paddingBottom)-by);
    const scale=Math.min(width/canvas.width,height/canvas.height);
    canvas.style.width=(canvas.width*scale+bx)+'px';
    canvas.style.height=(canvas.height*scale+by)+'px';
    window.MirrorView?.layout();
  }
  function fitMirrorLayout() {
    if(mirrorLayoutFrame)return;
    mirrorLayoutFrame=requestAnimationFrame(()=>{
      mirrorLayoutFrame=null;
      if(!s.id||$('screen-panel').hidden)return;
      const card=$('mirror-card'),panel=$('screen-panel');
      const viewport=window.visualViewport?.height||window.innerHeight;
      const height=document.fullscreenElement===card?viewport:Math.max(120,viewport-Math.max(0,card.getBoundingClientRect().top)-12);
      const value=Math.floor(height)+'px';
      if(panel.style.getPropertyValue('--mirror-available-height')!==value)panel.style.setProperty('--mirror-available-height',value);
      card.style.minHeight='0px';
      fitMirrorCanvas();
    });
  }
  const inventories = { explorer: { data: null, page: 0, loading: false }, apps: { data: null, page: 0, loading: false } };
  s.category = 'all'; s.query = ''; s.availableOnly = false; s.drafts = new Map(); s.viewOnly = false; s.muxer = null; s.lastPts = null; s.drawTimer = null; s.recording = null;
  const notice = (message, error = false) => { delete $('device-feedback').dataset.source;delete $('device-feedback').dataset.operation; if(error&&message&&window.DeskFeedback?.state){const context=s.tab==='screen'?'mirror':['settings','explorer'].includes(s.tab)?'settings':s.tab==='apps'?'apps':'diagnostics';window.DeskFeedback.state($('device-feedback'),{type:'error',title:'요청을 완료하지 못했습니다',message,rawError:message,errorContext:{context}});return;} $('device-feedback').hidden = !message; $('device-feedback').textContent = message; $('device-feedback').classList.toggle('failure', error); };
  const format = (setting, value) => value === null ? '기기 기본값 (미지정)' : setting.options?.find(option => Number(option.value) === Number(value))?.label || `${value}${setting.unit ? ` ${setting.unit}` : ''}`;
  async function session() {
    const response = await fetch('/api/session', { cache: 'no-store' });
    if (!response.ok) throw new Error('서버 연결을 확인해 주세요.');
    return (await response.json()).csrfToken;
  }
  function tab(name) {
    if($('device-feedback').dataset.source==='inventory'&&$('device-feedback').dataset.inventoryTab!==name)notice('');
    s.tab=name;
    window.DeviceExtensions?.activate(name);
    document.body.classList.toggle('mirror-view',name==='screen');
    for (const key of ['overview', 'screen', 'settings', 'files', 'logs', 'monitor', 'resources', 'explorer', 'apps', 'network', 'connection', 'tools', 'history']) { $(`${key}-panel`).hidden = key !== name; $(`${key}-tab`).setAttribute('aria-selected', String(key === name)); }
    window.FeatureDesk?.activate(name);window.VirtualWorkspace?.activate(name);window.MultiDeviceSettings?.activate(name);window.OverviewTools?.activate(name==='overview');window.NetworkInfo?.activate(name==='network'); window.DeviceOps?.activate(name); window.Workbench?.activate(name); window.ResourceCharts?.activate(name==='resources'||name==='overview',name);
    if(name==='screen')fitMirrorLayout();
    if (name === 'tools') loadInfo(); if(name==='history')DeskFeedback.paint('변경 기록 표시',renderHistory);
    if (name === 'explorer' || name === 'apps') loadInventory(name);
  }
  function status(text, live = false) { const info=!live&&window.DeskErrors?.isFailureText(text)?window.DeskErrors.explain(text,{context:'mirror'}):null;$('mirror-status').textContent=info?info.reasonKo:text;$('mirror-status').title=info?[info.requiredAccessKo,info.alternativesKo].filter(Boolean).join('\n'):''; $('mirror-dot').classList.toggle('streaming', live); }
  function controlEnabled(on) {
    window.MirrorTools?.setConnected(on||s.controlReady,{clipboardSupported:s.mirrorOptions?.source!=='camera',reason:'카메라 영상에서는 폰 클립보드를 읽을 수 없습니다.'}); window.MirrorOptions?.setConnected(on||s.controlReady);
    const inputReady=on||!!s.controlReady&&!!s.mirrorOptions?.controlOnly,blocked=s.viewOnly||window.MirrorView?.inputBlocked||s.mirrorOptions?.source==='camera';
    document.querySelectorAll('[data-phone-key],[data-phone-command],[data-phone-display],#phone-notifications,#phone-paste').forEach(button => { button.disabled = !inputReady || blocked; });
    document.querySelectorAll('[data-phone-scroll]').forEach(button=>button.disabled=!on||blocked);
    document.querySelectorAll('[data-phone-command="reset-video"]').forEach(button=>button.disabled=!on||blocked);
    $('screen-capture').disabled = !on; $('screen-record').disabled = !on;
  }
  function stopMirror(message = '화면 보기를 중지했습니다.') { s.mirrorAttempt=(s.mirrorAttempt||0)+1;s.mirrorFinish?.();s.mirrorFinish=null;
    window.MirrorHid?.release();window.MirrorHid?.disconnect();s.keyboard?.cancel(); s.gestures?.cancel(); window.MirrorTools?.reset(); s.videoPipeline?.close();s.videoPipeline=null;s.controlReady=false;
    window.MirrorMediaUI?.disconnect();
    window.MirrorView?.reset();
    stopRecording();
    stopAudio();
    clearInterval(s.drawTimer); s.drawTimer = null; if (s.videoCallback !== undefined) $('mse-player').cancelVideoFrameCallback?.(s.videoCallback);
    if (s.muxer) { try { s.muxer.destroy(); } catch {} s.muxer = null; }
    $('mse-player').pause(); $('mse-player').removeAttribute('src'); s.lastPts = null;
    s.starting = false;
    if (s.socket) { const socket = s.socket; s.socket = null; socket.close(); }
    if (s.decoder) { try { s.decoder.close(); } catch {} s.decoder = null; }
    s.config = null; s.pointer = null; s.frames = 0; s.width = 0; s.height = 0;
    $('phone-canvas').hidden = true; $('screen-placeholder').hidden = false;
    $('phone-canvas').setAttribute('aria-label','휴대폰 화면. 클릭과 드래그로 조작할 수 있습니다.');
    $('phone-canvas').getContext('2d').clearRect(0, 0, $('phone-canvas').width, $('phone-canvas').height);
    $('mirror-toggle').textContent = '연결 시작'; $('mirror-toggle').disabled = false; $('stream-apply').disabled = true;
    s.activeMedia=null;s.activeStream=null;window.MirrorDiagnostics?.stop(); $('mirror-metrics').textContent = 'H.264 · 화질 선택 가능'; status(message); controlEnabled(false);
  }
  function send(message) { const readOnly=['get-clipboard','reset-video'].includes(message.type);if ((!s.viewOnly || readOnly) && (!window.MirrorView?.inputBlocked||readOnly) && s.socket?.readyState === WebSocket.OPEN && (s.width||s.controlReady)) { if(s.mirrorOptions?.source==='camera'&&['touch','scroll','key','key-event','paste','start-app','rotate','get-clipboard'].includes(message.type))return false;s.socket.send(JSON.stringify(message)); return true; } return false; }
  function drawVideo(source, width, height) { s.mirrorFinish?.();s.mirrorFinish=null;
    if(window.MirrorView?.paused){window.MirrorDiagnostics?.skip('PC 일시정지');return;}
    const canvas = $('phone-canvas');
    const needsFit=canvas.hidden||canvas.width!==width||canvas.height!==height;
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    canvas.getContext('2d', { alpha: false }).drawImage(source, 0, 0, width, height);
    canvas.hidden = false; $('screen-placeholder').hidden = true; if(needsFit)fitMirrorCanvas(); s.frames++;window.MirrorDiagnostics?.display();
    window.MirrorView?.frame(width,height);
    const now = performance.now();
    if (now - s.frameAt > 1000) { $('mirror-metrics').textContent = `${width} × ${height} · ${Math.max(1, Math.round(s.frames * 1000 / (now - s.frameAt)))}fps · ${s.fallback ? 'LAN 호환 재생' : '저지연 재생'}`; s.frameAt = now; s.frames = 0; }
    status('실시간 화면 연결됨', true); controlEnabled(true);
  }
  function queueVideo(source,width,height){
    const clock=ensurePlaybackClock();if(window.MirrorView?.paused){window.MirrorDiagnostics?.skip('PC 일시정지');clock.clearVideo();playbackStatus({text:'PC 화면 일시정지 · 소리 재생은 계속됩니다.',limited:true});return;}
    if(typeof source.clone!=='function'||!Number.isSafeInteger(source.timestamp)){clock.clearVideo();playbackStatus({text:'영상 시각을 확인하지 못해 즉시 표시합니다. 동기화가 제한됩니다.',limited:true});drawVideo(source,width,height);return;}
    if(s.queuedWidth!==width||s.queuedHeight!==height){clock.clearVideo();s.queuedWidth=width;s.queuedHeight=height;}
    const copy=source.clone();let drawn=false;clock.video({pts:copy.timestamp,bytes:width*height*4,draw:()=>{drawn=true;drawVideo(copy,width,height);},dispose:()=>{if(!drawn)window.MirrorDiagnostics?.skip('표시 시각·대기열');copy.close();}});
  }
  function createMse() {
    if (s.muxer) s.muxer.destroy();
    clearInterval(s.drawTimer);
    const video = $('mse-player'); if (s.videoCallback !== undefined) video.cancelVideoFrameCallback?.(s.videoCallback); video.muted = true;video.playbackRate=1;ensurePlaybackClock().setVideoMode('mse');
    const attempt=s.mirrorAttempt;let muxer,earlyError=false;
    const current=()=>attempt===s.mirrorAttempt&&s.muxer===muxer;
    const failed=()=>{if(muxer===undefined){earlyError=true;return;}if(!current())return;stopMirror('영상 호환 재생을 시작하지 못했습니다.');notice('이 브라우저의 H.264 재생 지원을 확인해 주세요.',true);};
    muxer = new JMuxer({ node: video, mode: 'video', fps: Number($('stream-fps').value)||60, flushingTime: 100, maxDelay: 1000, clearBuffer: true, debug: false,
      onError:failed });s.muxer=muxer;if(earlyError){failed();return;}
    video.oncanplay = () => { if(current())video.play().catch(() => {}); };
    let lastFrame = -1;
    const draw = mediaTime => { const frame = video.getVideoPlaybackQuality?.().totalVideoFrames ?? video.currentTime; if (video.readyState >= 2 && video.videoWidth && lastFrame !== frame) { lastFrame = frame;const plan=playbackClock?.msePlan(Number.isFinite(mediaTime)?mediaTime:video.currentTime);if(plan){video.playbackRate=plan.rate;if(plan.seekTo!==undefined){let allowed=false;for(let i=0;i<video.buffered.length;i++)if(plan.seekTo>=video.buffered.start(i)&&plan.seekTo<video.buffered.end(i)-.02)allowed=true;if(allowed){try{video.currentTime=plan.seekTo;}catch{playbackStatus({text:'호환 영상 위치 보정 실패 · 영상·소리 동기화가 제한됩니다.',limited:true});}}}}drawVideo(video, video.videoWidth, video.videoHeight); } };
    if (video.requestVideoFrameCallback) { const next = (_now,metadata) => { if (!current()) return; draw(metadata?.mediaTime); s.videoCallback = video.requestVideoFrameCallback(next); }; s.videoCallback = video.requestVideoFrameCallback(next); }
    else s.drawTimer = setInterval(()=>{if(current())draw();}, 16);
  }
  function initializeVideo() {
    s.videoPipeline?.close();window.MirrorDiagnostics?.start();
    ensurePlaybackClock().setVideoMode('webcodecs');
    s.videoPipeline=window.MirrorVideo.create({metrics:window.MirrorDiagnostics,hardwareAcceleration:s.decoderPreference,draw:queueVideo,fallback:reason=>{s.fallback=true;window.MirrorDiagnostics?.mode('MSE');notice('H.264 호환 재생으로 전환했습니다. '+reason);},resetMse:()=>{s.lastPts=null;createMse();},feedMse:frame=>{const duration=s.lastPts===null?1000/(Number($('stream-fps').value)||60):Math.min(1000,Math.max(1,(frame.pts-s.lastPts)/1000));s.lastPts=frame.pts;playbackClock?.mseFeed(frame.pts,duration);s.muxer?.feed({video:frame.data,duration,isLastVideoFrameComplete:true});},requestKeyFrame:()=>send({type:'reset-video'}),fatal:message=>{stopMirror('영상 재생 오류');notice(message,true);}});
    s.videoPipeline.setCodec(s.videoCodec||'h264');
  }
  function framePacket(buffer) {s.videoPipeline?.packet(buffer);}
  async function applyMirrorSelection() {
    if (!s.socket || s.starting) return notice('연결 시작을 누르면 선택한 옵션으로 연결합니다.');
    // Reject invalid local choices before disrupting the current connection.
    try {
      const extra = window.MirrorSessionOptions?.params?.() || new URLSearchParams();
      const controlOnly = extra.get('controlOnly') === '1';
      const media = controlOnly ? new URLSearchParams() : (window.MirrorMediaUI?.params?.() || new URLSearchParams());
      if (controlOnly) window.MirrorOptions?.controlParams?.();
      else if (media.get('audioOnly') === '1') window.MirrorOptions?.commonParams?.();
      else window.MirrorOptions?.params?.();
    } catch (error) { notice(error.message, true); return; }
    const old = s.socket, deviceId = s.id, epoch = s.epoch;
    stopMirror('선택 옵션을 적용하는 중…');
    const attempt = s.mirrorAttempt;
    if (old.readyState !== WebSocket.CLOSED) await new Promise(resolve => {
      let timer;
      const done = () => { clearTimeout(timer); old.removeEventListener('close', done); resolve(); };
      old.addEventListener('close', done, { once: true }); timer = setTimeout(done, 800);
      if (old.readyState === WebSocket.CLOSED) done();
    });
    if (deviceId !== s.id || epoch !== s.epoch || attempt !== s.mirrorAttempt || s.socket || s.starting) return;
    startMirror();
  }
  async function startMirror() {
    if (s.socket || s.starting || !s.id) return;
    let extraOptions,mediaOptions,selectedOptions,controlOnly,audioOnly,audioEnabled,streamOptions,mediaSnapshot;
    try {
      extraOptions=window.MirrorSessionOptions?.params?.()||new URLSearchParams();
      controlOnly=extraOptions.get('controlOnly')==='1';
      mediaOptions=controlOnly?new URLSearchParams():(window.MirrorMediaUI?.params?.()||new URLSearchParams());
      audioOnly=mediaOptions.get('audioOnly')==='1';if(audioOnly)$('stream-audio').checked=true;
      selectedOptions=controlOnly?(window.MirrorOptions?.controlParams?.()||new URLSearchParams()):audioOnly?(window.MirrorOptions?.commonParams?.()||new URLSearchParams()):(window.MirrorOptions?.params?.()||new URLSearchParams());
      audioEnabled=!controlOnly&&!!$('stream-audio').checked;
      streamOptions=new URLSearchParams(['size','fps','bitrate'].map(name=>[name,$('stream-'+name).value]));
      mediaSnapshot={audioEnabled,playbackEnabled:window.MirrorMediaUI?.playbackEnabled?.()!==false,audioCodec:mediaOptions.get('audioCodec')||'raw',bufferMs:Number(window.MirrorMediaUI?.bufferMs?.()||100)};
    }catch(error){notice(error.message,true);return;}
    s.activeMedia=mediaSnapshot;s.activeStream=streamOptions;
    s.fallback = !('VideoDecoder' in window);
    s.mirrorFinish=DeskFeedback.start('실시간 화면 연결');s.starting = true; const epoch = s.epoch,deviceId=s.id,attempt=s.mirrorAttempt=(s.mirrorAttempt||0)+1;
    const current=()=>epoch===s.epoch&&attempt===s.mirrorAttempt&&deviceId===s.id&&s.starting;
    $('mirror-toggle').disabled = false; $('mirror-toggle').textContent = '연결 취소'; $('stream-apply').disabled = true; status('연결 중…'); notice('');
    try {
      if(!controlOnly){await window.MirrorMediaUI?.preflight?.(mediaSnapshot);if(!current())return;prepareAudio(mediaSnapshot);}
      s.previewVideo=!audioOnly&&!controlOnly&&selectedOptions.get('preview')!=='0';s.videoCodec=selectedOptions.get('codec')||'h264';s.decoderPreference=selectedOptions.get('decoder')||'no-preference';if(s.previewVideo){if(s.fallback&&!('MediaSource'in window))throw new Error('이 브라우저는 영상을 재생할 수 없습니다. 미리보기를 끄면 원본 녹화를 사용할 수 있습니다.');await window.MirrorOptions?.probe(s.videoCodec);if(!current())return;initializeVideo();}
      const token = await session();
      if (!current()) return;
      const url = new URL('/api/mirror', location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'; url.searchParams.set('deviceId', deviceId);
      for (const [name,value] of streamOptions) url.searchParams.set(name,value);
      for(const [key,value]of selectedOptions)url.searchParams.set(key,value);
      for(const [key,value]of mediaOptions)url.searchParams.set(key,value);
      for(const [key,value]of extraOptions)url.searchParams.set(key,value);
      if(audioEnabled)url.searchParams.set('audio','1');
      url.searchParams.set('channels','1');
      const socket = new WebSocket(url, ['adb-desk', token]); s.socket = socket; socket.binaryType = 'arraybuffer'; s.frameAt = performance.now();
      socket.onopen = () => { if (s.socket !== socket) return; s.starting = false; $('mirror-toggle').disabled = false; $('stream-apply').disabled = false; $('mirror-toggle').textContent = controlOnly?'조작 연결 중지':audioOnly?'소리 전달 중지':selectedOptions.get('source')==='camera'?'카메라 연결 중지':'화면 보기 중지';window.MirrorMediaUI?.setConnection(socket,{deviceId:s.id,audioOnly,controlOnly,codec:s.videoCodec}); };
      socket.onmessage = event => {
        if (s.socket !== socket) return;
        try {
          if (typeof event.data !== 'string') { const channel=new Uint8Array(event.data)[0];if(channel===0)framePacket(event.data.slice(1));else if(channel===1)audioPacket(event.data.slice(1));return; }
          const message = JSON.parse(event.data);
          window.MirrorMediaUI?.onMessage(message);
          window.MirrorHid?.receive(message);
          window.MirrorOptions?.receive(message);
          if(message.type==='session-options'){s.mirrorOptions=message.options;window.MirrorMediaUI?.setConnection(socket,{deviceId:s.id,...message.options});}
          if(message.type==='video-codec'){s.videoCodec=message.codec;s.videoPipeline?.setCodec(message.codec);}
          if(message.type==='control-ready'){s.controlReady=true;controlEnabled(!!s.width);if(s.mirrorOptions?.controlOnly){s.mirrorFinish?.();s.mirrorFinish=null;window.MirrorSessionOptions?.showControlPad();status('영상 없이 조작 연결됨',true);$('mirror-metrics').textContent='키보드·클립보드·UHID · 영상·소리 전송 없음';}else if(s.mirrorOptions?.newDisplay&&!s.width){s.mirrorFinish?.();s.mirrorFinish=null;status('가상 화면 연결됨 · 앱을 열면 영상이 나타납니다.',true);}}
          if (message.type === 'dimensions') { if (s.fallback && s.muxer && s.width && (s.width !== message.width || s.height !== message.height)) { s.muxer.destroy(); s.muxer = null; s.lastPts = null; } s.width = message.width; s.height = message.height; s.gestures?.cancel(); s.pointer = null;if(!s.previewVideo){s.mirrorFinish?.();s.mirrorFinish=null;status('원본 스트림 연결됨 · 미리보기 꺼짐',true);$('mirror-metrics').textContent=`${s.width} × ${s.height} · 서버 원본 녹화 가능`;} }
          else if (message.type === 'status') status(message.message);
          else if (message.type === 'error') { stopMirror(message.message); notice(message.message, true); }
          else if (message.type === 'control-error') { notice(message.message, true); window.MirrorTools?.receive(message); }
          else if(message.type==='control-status')notice(message.message);
          else if (message.type === 'clipboard') window.MirrorTools?.receive(message);
          else if(message.type==='audio-error'){const info=window.DeskErrors?.explain(message.message,{context:'mirror',action:'audio'});$('stream-audio-status').textContent=info?info.reasonKo:message.message;notice(message.message,true);}
          else if(message.type==='audio-format'){audioAdapter?.configure(message);$('stream-audio-status').textContent=`${(message.codec||'raw').toUpperCase()} 소리 연결됨${s.activeMedia?.playbackEnabled===false?' · PC 재생 꺼짐 · 원본 저장 가능':''}`;if(audioOnly){s.mirrorFinish?.();s.mirrorFinish=null;status('오디오 전용 연결됨',true);$('mirror-metrics').textContent='오디오 전용 · 영상 전송 없음';}}
        } catch (error) { stopMirror('화면 보기가 중단되었습니다.'); notice(error.message, true); }
      };
      socket.onerror = () => { if (s.socket === socket) { stopMirror('화면 연결을 시작하지 못했습니다.'); notice('화면 연결 오류입니다. 기기 연결 상태를 확인한 뒤 다시 시도해 주세요.', true); } };
      socket.onclose = () => { if (s.socket === socket) stopMirror('화면 연결이 종료되었습니다.'); };
    } catch (error) { if (current()) { stopMirror('화면 보기 대기'); notice(error.message, true); } }
  }
  function download(blob, filename) {
    const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  function stopRecording() {
    clearTimeout(s.recordTimer);
    if (s.recording && s.recording.state !== 'inactive') {
      try { s.recording.stop(); } catch (error) { s.recordingAbort?.(error); }
    }
  }
  function toggleRecording() {
    if (s.recording) { stopRecording(); return; }
    if (!window.MediaRecorder || !$('phone-canvas').captureStream) { notice('이 브라우저는 화면 녹화를 지원하지 않습니다.', true); return; }
    let stream, recorder, mimeType, finished = false, failure = '', errorTimer;
    const chunks = []; let bytes = 0;
    const finish = () => {
      if (finished) return; finished = true; clearTimeout(errorTimer); clearTimeout(s.recordTimer);
      stream?.getTracks().forEach(track => track.stop());
      if (!s.recording || s.recording === recorder) {
        s.recording = null; s.recordingAbort = null; $('stream-audio').disabled = false;
        $('screen-record').textContent = 'PC 화면 녹화'; $('screen-record').classList.remove('recording');
      }
      if (chunks.length) download(new Blob(chunks, { type: mimeType }), `adb-screen-${Date.now()}${failure ? '-partial' : ''}.webm`);
    };
    const abort = error => {
      failure = error?.message || '브라우저 녹화 오류';
      notice('녹화가 중단되었습니다. ' + failure + (chunks.length ? ' 받은 부분은 별도 파일로 저장합니다.' : ''), true);
      try { if (recorder && recorder.state !== 'inactive') recorder.stop(); } catch {}
      // The error event normally precedes dataavailable/stop; retain that final chunk when supplied.
      if (!finished) errorTimer = setTimeout(finish, 250);
    };
    try {
      stream = $('phone-canvas').captureStream(Number(s.activeStream?.get('fps')??$('stream-fps').value)||60);
      if (audioDestination) for (const track of audioDestination.stream.getAudioTracks()) stream.addTrack(track.clone());
      mimeType = [...(audioDestination ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus'] : []), 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(type => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error('이 브라우저는 WebM 녹화를 지원하지 않습니다.');
      recorder = new MediaRecorder(stream, { mimeType });
      recorder.ondataavailable = event => { if (!finished && event.data.size) { chunks.push(event.data); bytes += event.data.size; if (bytes > 200 * 1024 * 1024) stopRecording(); } };
      recorder.onstop = finish; recorder.onerror = event => abort(event.error);
      s.recording = recorder; s.recordingAbort = abort; $('stream-audio').disabled = true;
      recorder.start(1000);
      s.recordTimer = setTimeout(stopRecording, 5 * 60 * 1000);
      $('screen-record').textContent = '● PC 녹화 저장'; $('screen-record').classList.add('recording'); notice('화면 녹화 중입니다. 최대 5분 또는 200MB에서 저장합니다.');
    } catch (error) { failure = error.message; finish(); notice('녹화를 시작하지 못했습니다. ' + failure, true); }
  }
  function toolBatteryLabel(battery={}) {
    const flag=v=>v===true||v==='true'?true:v===false||v==='false'?false:null;
    const sources=[['유선 AC',battery.ac],['USB',battery.usb],['무선',battery.wireless]],connected=sources.filter(([,v])=>flag(v)===true).map(([label])=>label);
    const status=({2:'충전 중',3:'방전 중',4:'전원 연결 · 충전하지 않음',5:'충전 완료'})[Number(battery.status)];
    return status?status+(connected.length?' · '+connected.join(', '):''):connected.length?'전원 연결 · '+connected.join(', '):sources.every(([,v])=>flag(v)===false)?'외부 전원 연결 안 됨':'충전 상태 확인 불가';
  }
  async function loadInfo() {
    if(!s.id)return;const finish=DeskFeedback.start('기기 도구 정보 조회',{button:$('tools-refresh')}),epoch=s.epoch,request=s.infoRequest=(s.infoRequest||0)+1;const current=()=>epoch===s.epoch&&request===s.infoRequest;
    $('tools-refresh').disabled=true;
    if(DeskFeedback.state)DeskFeedback.state($('device-info-grid'),{type:'loading',title:'기기 상태를 읽고 있습니다',message:'배터리·화면·가동 시간을 조회합니다.'});
    try {
      const response=await fetch(`/api/device/info?id=${encodeURIComponent(s.id)}`),data=await response.json();if(!response.ok)throw new Error(data.error);if(!current())return;
      const battery=data.battery||{},level=Number(battery.level),scale=Number(battery.scale),percent=battery.percent!=null?Number(battery.percent):battery.level!=null&&battery.scale!=null&&scale>0&&level>=0&&level<=scale?level/scale*100:null;
      const values=[['배터리',percent!==null&&Number.isFinite(percent)?`${Math.round(percent*10)/10}%`:'조회 불가'],['배터리 온도',battery.temperature!=null&&Number.isFinite(Number(battery.temperature))?`${battery.temperature}°C`:'조회 불가'],['충전 상태',toolBatteryLabel(battery)],['화면 크기',data.size||'조회 불가'],['화면 밀도',data.density||'조회 불가'],['가동 시간',Number.isFinite(data.uptimeSeconds)?`${Math.floor(data.uptimeSeconds/3600)}시간 ${Math.floor(data.uptimeSeconds%3600/60)}분`:'조회 불가']];
      $('device-info-grid').innerHTML=values.map(([label,value])=>`<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('');
      if(data.unavailable?.length&&DeskFeedback.state){const host=document.createElement('div');host.className='tool-read-notice';$('device-info-grid').append(host);DeskFeedback.state(host,{type:'warning',title:'일부 정보를 읽지 못했습니다',message:data.unavailable.join(' · '),actionLabel:'기기 상태 다시 조회',onAction:()=>current()?loadInfo():undefined});}
    } catch(error){if(current()){if(DeskFeedback.state)DeskFeedback.state($('device-info-grid'),{type:'error',title:'기기 상태를 읽지 못했습니다',message:error.message,actionLabel:'기기 상태 다시 조회',onAction:()=>current()?loadInfo():undefined});else if(s.tab==='tools')notice(error.message,true);}}
    finally{finish();if(current())$('tools-refresh').disabled=false;}
  }
  async function openPhoneSettings(target) {
    const finish=DeskFeedback.start('폰 설정 화면 열기');const deviceId = s.id, epoch = s.epoch;
    try { const token = await session(); if (epoch !== s.epoch) return; const response = await fetch('/api/device/tool', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-ADB-Desk-Token': token }, body: JSON.stringify({ deviceId, target }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error); if (epoch === s.epoch) notice(result.message); }
    catch (error) { if (epoch === s.epoch) notice(error.message, true); } finally {finish();}
  }
  const appScope=()=>String(window.AppInventory?.user??'current');
  const resolvedAppUser=()=>appScope()==='current'?String(window.AppInventory?.currentUser??'current'):appScope();
  async function loadInventory(kind, refresh = false) {
    const item = inventories[kind]; if (!s.id) return;if(item.loading){if(refresh)item.refreshQueued=true;return;}
    const user=kind==='apps'?appScope():null,deviceId=s.id;
    const inventoryFeedback=(errors,type='warning')=>{if(s.tab!==kind)return;const host=$('device-feedback');if(!errors?.length){if(host.dataset.source==='inventory'&&host.dataset.inventoryTab===kind)notice('');return;}const epoch=s.epoch;host.dataset.source='inventory';host.dataset.inventoryTab=kind;if(DeskFeedback.state)DeskFeedback.state(host,{type,title:kind==='apps'?'앱 목록의 일부 정보를 확인하지 못했습니다':'설정 목록 조회 안내',message:errors.join(' · '),rawError:errors.join('\n'),errorContext:{context:kind==='apps'?'apps':'settings'},actionLabel:'목록 다시 조회',onAction:()=>epoch===s.epoch&&deviceId===s.id&&s.tab===kind&&(kind!=='apps'||user===appScope())?loadInventory(kind,true):undefined});else{notice(errors.join(' · '),true);host.dataset.source='inventory';host.dataset.inventoryTab=kind;}};
    if (item.data && !refresh && (kind!=='apps'||item.user===user)) { DeskFeedback.paint('목록 표시',()=>{renderInventory(kind);inventoryFeedback(item.errors);}); return; }
    const finish=DeskFeedback.start(kind==='apps'?'설치 앱 목록 조회':'설정 목록·설명 조회',{button:$(`${kind}-refresh`)});
    const epoch = s.epoch, requestId=(item.requestId||0)+1; item.requestId=requestId; item.loading = true; $(`${kind}-refresh`).disabled = true;
    if(DeskFeedback.state)DeskFeedback.state($(`${kind}-list`),{type:'loading',title:kind==='apps'?'앱 목록을 읽고 있습니다':'설정 목록을 읽고 있습니다',message:'선택한 기기·사용자의 조회가 끝나면 목록을 표시합니다.'});else $(`${kind}-list`).innerHTML='<div class="empty-state">기기에서 목록을 읽고 있습니다…</div>';
    try {
      const params=new URLSearchParams({id:deviceId});if(kind==='apps')params.set('user',user);
      const response = await fetch(`/api/device/${kind === 'apps' ? 'apps' : 'inventory'}?${params}`);
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      if (epoch !== s.epoch || requestId !== item.requestId || kind==='apps'&&user!==appScope()) return;
      if(kind==='apps'){item.user=user;window.AppInventory?.setContext(data);window.AppBatch?.setUser(String(data.userId??resolvedAppUser()));}
      item.data = kind === 'apps' ? data.apps.map(row=>({...row,userId:String(row.userId??data.userId??resolvedAppUser())})) : data.entries; item.page = 0; item.reference=false; item.firmwareReview=data.firmwareReview||null; if(kind==='explorer')$('explorer-reference-note').hidden=true; renderInventory(kind);
      item.errors=data.errors||[];inventoryFeedback(item.errors);
    } catch (error) { if (epoch === s.epoch && requestId === item.requestId) { if(DeskFeedback.state)DeskFeedback.state($(`${kind}-list`),{type:/offline|끊|연결.*없/i.test(error.message)?'offline':'error',title:'목록을 읽지 못했습니다',message:error.message+(kind==='explorer'?' 현재 값이 필요 없으면 오프라인 설명사전을 열 수 있습니다.':''),actionLabel:'다시 조회',onAction:()=>epoch===s.epoch&&deviceId===s.id?loadInventory(kind,true):undefined});else $(`${kind}-list`).textContent='목록을 읽지 못했습니다. 연결 후 다시 조회하세요.'; $(`${kind}-count`).textContent='연결 확인 필요'; if(kind==='explorer')$('explorer-help-summary').textContent='현재 기기에서 목록을 읽지 못했습니다.'; inventoryFeedback([error.message],'error'); } }
    finally {finish(); if (epoch === s.epoch && requestId === item.requestId) { item.loading = false; $(`${kind}-refresh`).disabled = false;if(item.refreshQueued){item.refreshQueued=false;loadInventory(kind,true);} } }
  }
  function renderEvidence(row) {
    return window.SettingFirmwareUI?.details(row,{inventory:true})||'';
  }
  function renderSettingInventoryRow(row) {
    const config={inventory:true},restricted=window.SettingFirmwareUI?.restricted(row)===true;
    const editor=restricted||row.valueUnavailable||row.redacted?'':row.editable?`<button data-edit-known="${esc(row.key)}">편집 위치</button>`:`<button data-edit-raw="${esc(row.key)}" data-namespace="${esc(row.namespace)}">직접 편집</button>`;
    return `<article class="inventory-row setting-inventory-row"><div class="inventory-main"><div class="setting-row-title"><strong>${esc(row.title)}</strong>${row.manufacturer?`<span class="manufacturer-tag">${esc(manufacturerName(row.manufacturer))} 전용</span>`:''}${window.SettingFirmwareUI?.badge(row,config)||''}</div><p>${esc(row.description)}</p>${row.valueGuide?`<p class="setting-value-guide">${esc(row.valueGuide)}</p>`:''}${renderEvidence(row)}</div><div class="inventory-current"><small>현재 값</small><code class="inventory-value">${esc(row.valueUnavailable?'실시간 값 미조회':row.redacted?'민감값 숨김':row.value??'(미지정)')||'(빈 값)'}</code></div>${editor}</article>`;
  }
  function renderAppRow(row){
    const selected=window.DeviceTargets?.app?.package===row.package,label=row.label||row.package,user=String(row.userId??resolvedAppUser());
    const kind=row.kind==='user'?'사용자 앱':row.kind==='system'?'시스템 앱':'앱 종류 미확인',enabled=row.enabled===true?'활성':row.enabled===false?'비활성':'활성 상태 미확인';
    const metadata=[...(window.AppInventory?.describe(row)||[]),row.uid!=null?`UID ${row.uid}`:null].filter(Boolean),reference=!row.label&&row.knowledge?.found&&row.knowledge.title!==row.package?row.knowledge.title:null;
    let icon=null;const candidate=row.iconDataUrl;
    if(typeof candidate==='string'&&candidate.length<=400000&&/^data:image\/(?:png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(candidate)){try{const prefix=candidate.slice(0,candidate.indexOf(',')),bytes=atob(candidate.slice(candidate.indexOf(',')+1,candidate.indexOf(',')+33));if(prefix==='data:image/png;base64'&&bytes.startsWith('\x89PNG\r\n\x1a\n')||prefix==='data:image/webp;base64'&&bytes.startsWith('RIFF')&&bytes.slice(8,12)==='WEBP')icon=candidate;}catch{}}
    const avatar=icon?`<img src="${esc(icon)}" alt="" width="28" height="28" loading="lazy" decoding="async">`:esc((row.label||row.package.split('.').pop()).slice(0,1).toUpperCase());
    return `<article class="inventory-row app-row ${selected?'target-selected':''}" data-app-row="${esc(row.package)}" data-app-user="${esc(user)}"><div class="app-monogram">${avatar}</div><div class="inventory-main"><button class="app-select-target" data-select-package="${esc(row.package)}" aria-pressed="${selected}"><strong>${esc(label)}</strong></button>${row.label?`<code class="app-package-id">${esc(row.package)}</code>`:''}${reference?`<small class="app-list-description">참고 자료명: ${esc(reference)}</small>`:''}<p><span class="namespace-tag ${row.kind==='user'?'system':'global'}">${kind}</span> ${enabled}${row.suspended===true?' · 일시중지':''}</p>${metadata.length?`<p class="app-list-metadata">${metadata.map(esc).join(' · ')}</p>`:''}</div><button data-app-action="open" data-package="${esc(row.package)}" data-user="${esc(user)}" ${row.enabled===false||row.launchable===false?'disabled':''} title="${row.launchable===false?'실행 화면이 없는 앱':'선택한 사용자에서 앱 열기'}">앱 열기</button><button data-app-action="settings" data-package="${esc(row.package)}" data-user="${esc(user)}">앱 설정</button><button class="app-manage-button" data-manage-package="${esc(row.package)}" data-user="${esc(user)}">관리</button></article>`;
  }
  function renderInventory(kind) {
    if(kind==='apps'&&inventories.apps.data)window.DeviceTargets?.updateApps(inventories.apps.data);
    const item = inventories[kind], query = $(`${kind}-search`).value.toLowerCase().trim(), scope = $(`${kind}-scope`).value;
    if (!item.data) { $(`${kind}-count`).textContent='조회 중…'; if(kind==='explorer')$('explorer-help-summary').textContent='설정 설명을 읽는 중…'; return; }
    const rows = kind==='apps'?(window.AppInventory?.filter(item.data,{query,scope})??item.data.filter(row=>(scope==='all'||scope==='disabled'&&row.enabled===false||row.kind===scope)&&[row.package,row.label,row.knowledge?.title].join(' ').toLowerCase().includes(query))):item.data.filter(row => (scope === 'all' || row.namespace === scope) && [row.key,row.title,row.category,row.description,row.valueGuide,row.value].join(' ').toLowerCase().includes(query) && ($('explorer-help-level').value === 'all' || row.descriptionLevel === $('explorer-help-level').value) && (window.SettingFirmwareUI?.matches(row,$('explorer-firmware').value) ?? true) && (!item.focusedKey || row.key===item.focusedKey));
    item.filtered = rows;
    const pageSize = kind === 'apps' ? 60 : Number($('explorer-page-size').value);
    const pages = Math.max(1, Math.ceil(rows.length / pageSize)); item.page = Math.max(0, Math.min(item.page, pages - 1));
    $(`${kind}-count`).textContent = `${rows.length} / ${item.data?.length || 0}개`;
    $(`${kind}-page`).textContent = `${item.page + 1} / ${pages}`;
    $(`${kind}-prev`).disabled = item.page === 0; $(`${kind}-next`).disabled = item.page >= pages - 1;
    if (kind === 'explorer') {
      $('explorer-firmware-summary').textContent=window.SettingFirmwareUI?.summary(item.firmwareReview)||'';
      $('explorer-page-top').textContent = `${item.page + 1} / ${pages}`;
      $('explorer-prev-top').disabled = item.page === 0; $('explorer-next-top').disabled = item.page >= pages - 1;
      const labels={all:'전체',verified:'공식 소스',device_code:'기기 코드',described:'한글 설명',inferred:'추정',internal:'미확인'};
      $('explorer-help-summary').innerHTML=Object.entries(labels).map(([level,label])=>`<button class="${level} ${$('explorer-help-level').value===level?'selected':''}" aria-pressed="${$('explorer-help-level').value===level}" data-help-filter="${level}">${label}<b>${level==='all'?item.data?.length||0:(item.data||[]).filter(r=>r.descriptionLevel===level).length}</b></button>`).join('');
    }
    $(`${kind}-list`).innerHTML = rows.slice(item.page * pageSize, (item.page + 1) * pageSize).map(row => kind === 'apps' ? renderAppRow(row) : renderSettingInventoryRow(row)).join('') || '<div class="empty-state">일치하는 항목이 없습니다.</div>';
    if(!rows.length&&DeskFeedback.state){const epoch=s.epoch,id=s.id,empty=!item.data.length;DeskFeedback.state($(`${kind}-list`),{type:'empty',title:empty?(kind==='apps'?'조회된 앱이 없습니다':'조회된 설정이 없습니다'):'검색 조건에 맞는 항목이 없습니다',message:empty?'선택한 사용자와 연결 상태를 확인한 뒤 목록을 다시 조회하세요.':'검색어·분류 조건을 해제해 보세요. 현재 사용자·프로필은 유지됩니다.',actionLabel:empty?'다시 조회':'검색·필터 해제',onAction:()=>{if(epoch!==s.epoch||id!==s.id)return;if(empty)return loadInventory(kind,true);$(`${kind}-search`).value='';$(`${kind}-scope`).value='all';item.focusedKey=null;if(kind==='apps')window.AppInventory?.resetFilters?.();else {$('explorer-help-level').value='all';$('explorer-firmware').value='all';}renderInventory(kind);}});}
  }
  async function actOnApp(button) {
    const finish=DeskFeedback.start('앱 화면 열기',{button});const epoch = s.epoch, deviceId = s.id, action=button.dataset.appAction, targetPackage=button.dataset.package,user=String(button.dataset.user??resolvedAppUser()),scope=appScope(); button.disabled = true;
    try {
      const token = await session(); if (epoch !== s.epoch||scope!==appScope()) return;
      const response = await fetch('/api/device/app', { method: 'POST', headers: { 'Content-Type':'application/json', 'X-ADB-Desk-Token':token }, body: JSON.stringify({ deviceId, action, package:targetPackage,user }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error); if (epoch === s.epoch&&scope===appScope()) notice(data.message);
    } catch (error) { if (epoch === s.epoch&&scope===appScope()) notice(error.message, true); }
    finally {finish(); if (epoch === s.epoch&&scope===appScope()) button.disabled = button.dataset.selectedAppAction ? !window.DeviceTargets?.app || (button.dataset.selectedAppAction==='open'&&(window.DeviceTargets.app.enabled===false||window.DeviceTargets.app.launchable===false)) : false; }
  }
  function renderHistory() {
    const history = s.data?.history || [];
    $('settings-history').innerHTML = history.length ? history.map(item => {
      const setting = s.data.settings.find(setting => setting.key === item.key)||{},reason=item.undoEligible===false?(item.undoReason||'정확한 이전 값을 확인할 수 없어 이 기록으로 복원할 수 없습니다.'):'';
      return `<article class="history-row"><div><strong>${esc(item.title)}</strong><p>${esc(item.before===undefined?'저장값 미확인':format(setting, item.before))} → ${esc(item.after===undefined?'저장값 미확인':format(setting, item.after))}</p><small>${esc(new Date(item.at).toLocaleString('ko-KR'))}</small>${reason?`<p class="history-undo-reason">${esc(reason)}</p>`:''}</div><button class="secondary-button" data-undo="${esc(item.id)}" ${reason?`title="${esc(reason)}"`:''} ${item.undone || item.undoEligible===false || s.changing || s.settingsState==='loading' || s.settingsState==='error' ? 'disabled' : ''}>${item.undone ? '복원 완료' : '변경 전으로 되돌리기'}</button></article>`;
    }).join('') : '<div class="empty-state"><h3>아직 변경한 설정이 없습니다</h3><p>적용한 항목의 이전 값과 변경 시간이 여기에 표시됩니다.</p></div>';
  }
  function renderSettings() {
    if (!s.data) return;
    const all = s.data.settings;
    const readState={loading:s.settingsState==='loading',error:s.settingsState==='error'};
    const categories = [{id:'all',title:'전체'}, ...s.data.categories];
    $('settings-categories').innerHTML = categories.map(category => `<button data-category="${category.id}" class="${s.category === category.id ? 'selected' : ''}">${esc(category.title)} <span>${category.id === 'all' ? all.length : all.filter(item => item.category === category.id).length}</span></button>`).join('');
    const query = s.query.toLowerCase().trim();
    const filtered = all.filter(item => (s.category === 'all' || item.category === s.category) && (!s.availableOnly || item.available) && [item.title,item.key,item.description,item.namespace].join(' ').toLowerCase().includes(query));
    $('settings-summary').textContent = `전체 ${all.length}개 · 현재 값 조회 ${all.filter(item => item.value !== null).length}개 · 표시 ${filtered.length}개`;
    const reviewSummary=window.SettingFirmwareUI?.summary(s.data.firmwareReview);if(reviewSummary)$('settings-summary').textContent+=' · '+reviewSummary;
    $('settings-groups').innerHTML = s.data.categories.map(category => {
      const items = filtered.filter(item => item.category === category.id); if (!items.length) return '';
      return `<section class="setting-category"><div class="category-heading"><h3>${esc(category.title)}</h3><p>${esc(category.description)}</p></div>${items.map(item => {
        const value = s.drafts.has(item.key) ? s.drafts.get(item.key) : item.value;
        const restricted=item.firmwareReview?.writeBlocked===true||item.firmwareReview?.application?.writeBlocked===true||item.firmwareReview?.unsupported===true;
        const canEdit=item.available===true&&!restricted&&!readState.loading&&!readState.error;
        const options = item.options ? `${value === null ? '<option value="" selected disabled>미지정</option>' : item.options.some(option => Number(option.value) === Number(value)) ? '' : `<option value="${esc(value)}" selected>현재 (${esc(value)})</option>`}${item.options.map(option => `<option value="${esc(option.value)}" ${value !== null && Number(option.value) === Number(value) ? 'selected' : ''}>${esc(option.label)}</option>`).join('')}` : '';
        return `<article class="setting-row ${!item.available ? 'unavailable' : ''}" data-setting-card="${esc(item.key)}"><div class="setting-main"><div class="setting-row-title"><strong>${esc(item.title)}</strong>${item.manufacturer ? `<span class="manufacturer-tag">${esc(manufacturerName(item.manufacturer))} 전용</span>` : ''}${window.SettingFirmwareUI?.badge(item,readState)||''}</div><p>${esc(item.description)}</p>${window.SettingFirmwareUI?.details(item,readState)||''}</div><div class="setting-current"><small>${readState.loading||readState.error?'이전 조회값':'저장값'}</small><strong>${esc(item.readable===true||item.available ? restricted?(item.value===null?'저장값 없음':String(item.value)):format(item,item.value) : '미조회')}</strong></div><div class="setting-edit">${restricted ? '' : item.options ? `<select id="setting-${esc(item.key)}" aria-label="${esc(item.title)}" ${!canEdit ? 'disabled' : ''}>${options}</select>` : `<input id="setting-${esc(item.key)}" type="number" min="${item.min}" max="${item.max}" step="${item.step}" value="${esc(value ?? '')}" placeholder="${item.min}~${item.max}" aria-label="${esc(item.title)}" ${!canEdit ? 'disabled' : ''}>`}</div><button class="setting-apply" data-apply-setting="${esc(item.key)}" ${!canEdit || s.changing ? 'disabled' : ''}>값 저장</button></article>`;

      }).join('')}</section>`;
    }).join('') || '<div class="empty-state">일치하는 설정이 없습니다.</div>';
    if(!filtered.length&&DeskFeedback.state)DeskFeedback.state($('settings-groups'),{type:'empty',title:all.length?'검색 조건에 맞는 설정이 없습니다':'조회된 설정이 없습니다',message:all.length?'검색·분류·사용 가능 조건을 해제해 보세요.':'연결을 확인한 뒤 현재 값을 다시 조회하세요.',actionLabel:all.length?'검색·필터 초기화':'현재 값 다시 조회',onAction:()=>{if(!all.length)return loadSettings();s.query='';s.category='all';s.availableOnly=false;$('settings-search').value='';$('settings-available').checked=false;renderSettings();}});
    renderHistory();
  }
  async function loadSettings() {
    if (!s.id || s.reading) return;const finish=DeskFeedback.start('현재 ADB 설정값 조회',{button:$('settings-refresh')});
    const epoch = s.epoch; s.reading = true; s.settingsState='loading'; if(s.data)renderSettings(); $('settings-refresh').disabled = true;if($('device-feedback').dataset.source==='settings-read')notice('');if(!s.data&&DeskFeedback.state)DeskFeedback.state($('settings-groups'),{type:'loading',title:'현재 설정값을 읽고 있습니다',message:'연결된 기기와 현재 사용자 값을 확인합니다.'});
    readAbort?.abort(); readAbort = new AbortController();
    try {
      const response = await fetch(`/api/device?id=${encodeURIComponent(s.id)}`, { signal: readAbort.signal, cache: 'no-store' });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      if (epoch !== s.epoch) return;
      s.data = data;s.settingsState='ready';if($('device-feedback').dataset.source==='settings-read')notice(''); s.drafts.clear(); $('setting-total').textContent = data.settings.length; $('device-identity').textContent = `${data.device.model} · ${data.device.endpoint || data.device.hardwareSerial || data.device.id}`;
      window.dispatchEvent(new CustomEvent('device-loaded', { detail: data.device })); renderSettings();
    } catch (error) {
      if (epoch === s.epoch && error.name !== 'AbortError') { s.settingsState='error'; $('device-identity').textContent='기기 연결 확인 필요 · '+s.id; if(DeskFeedback.state&&$('settings-panel').hidden){DeskFeedback.state($('device-feedback'),{type:/연결|offline|끊/i.test(error.message)?'offline':'error',title:'기기 연결·설정값을 확인하지 못했습니다',message:error.message,actionLabel:'현재 값 다시 조회',onAction:()=>epoch===s.epoch?loadSettings():undefined});$('device-feedback').dataset.source='settings-read';}else notice(''); if(DeskFeedback.state)DeskFeedback.state($('settings-groups'),{type:'error',title:'설정값을 읽지 못했습니다',message:error.message,actionLabel:'현재 값 다시 조회',onAction:()=>epoch===s.epoch?loadSettings():undefined});else $('settings-groups').textContent='설정을 읽지 못했습니다. 현재 값 새로고침으로 다시 확인하세요.'; }
    } finally {finish(); if (epoch === s.epoch) { s.reading = false; $('settings-refresh').disabled = false; } }
  }
  async function changeSetting(body) {
    if (!s.id||!s.data||s.changing||s.settingsState==='loading'||s.settingsState==='error') return;const expectedUserId=String(s.data.userId??'');if(!/^(?:0|[1-9]\d{0,4})$/.test(expectedUserId)){notice('사용자 정보를 확인하려면 현재 값을 새로고침하세요.',true);return;}const finish=DeskFeedback.start('설정 적용·결과 확인');
    const epoch = s.epoch, deviceId = s.id; s.changing = true; notice('기기에 적용한 뒤 실제 값을 확인하고 있습니다…');
    document.querySelectorAll('[data-apply-setting],[data-undo]').forEach(button => { button.disabled = true; });
    try {
      const token = await session();
      if (epoch !== s.epoch) return;
      const response = await fetch('/api/device/settings', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-ADB-Desk-Token': token }, body: JSON.stringify({ deviceId, ...body, expectedUserId }), signal: AbortSignal.timeout(35000) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || result.message);
      if (epoch !== s.epoch) return;
      const index = s.data.settings.findIndex(item => item.key === result.setting.key); s.data.settings[index] = result.setting;
      s.drafts.delete(result.setting.key);
      s.data.history = result.history; notice(result.message);
    } catch (error) { if (epoch === s.epoch) notice(error.name === 'TimeoutError' ? '적용 결과를 확인하지 못했습니다. 현재 값 새로고침으로 확인해 주세요.' : error.message, true); }
    finally {finish(); if (epoch === s.epoch) { s.changing = false; renderSettings(); } }
  }
  window.DeviceDesk = {
    navigate(name,path){if(name==='files'&&path)window.DeviceOps?.prepareBrowse(path);tab(name);},
    refreshApps(){inventories.apps.data=null;return loadInventory('apps',true);},
    open(id) {
      if (s.id === id) return;
      this.close(); window.AppInventory?.reset(); document.body.classList.add('device-mode'); s.id = id; window.DeviceExtensions?.open(id);window.FeatureDesk?.open(id);window.VirtualWorkspace?.open(id);window.MultiDeviceSettings?.open(id); window.OverviewTools?.open(id); window.MirrorMediaUI?.setDevice(id);window.MirrorOptions?.setDevice?.(id); window.NetworkInfo?.open(id); window.DeviceOps?.open(id); window.ResourceCharts?.open(id); window.Workbench?.open(id); window.DeviceTargets?.open(id); s.data = null; s.category = 'all'; s.drafts.clear(); tab('overview'); notice('');
      $('device-identity').textContent = '기기 정보를 불러오는 중'; $('settings-groups').innerHTML = '<div class="empty-state">설정값을 읽고 있습니다…</div>';
      $('settings-history').innerHTML = ''; loadSettings();
    },
    close() {window.DeviceExtensions?.close();window.MirrorDrop?.close();window.GpsIndicator?.close();window.PrivacyIndicators?.close();window.FeatureDesk?.close();window.VirtualWorkspace?.close();DeskFeedback.clear('device'); $('explorer-reference-note').hidden=true; window.MultiDeviceSettings?.close();window.OverviewTools?.close();window.MirrorMediaUI?.setDevice(null);window.MirrorOptions?.setDevice?.(null);window.AppInventory?.reset();window.NetworkInfo?.close(); window.DeviceOps?.close(); window.ResourceCharts?.close(); window.Workbench?.close(); window.DeviceTargets?.close(); for (const item of Object.values(inventories)) { item.data = null; item.filtered=null; item.focusedKey=null; item.firmwareReview=null; item.reference=false; item.refreshQueued=false;item.requestId=(item.requestId||0)+1; item.page = 0; item.loading = false; } document.body.classList.remove('device-mode','mirror-view'); s.epoch++; s.id = null; s.data = null; s.settingsState=null; s.reading = false; s.changing = false; readAbort?.abort(); stopMirror('화면 보기 대기'); }
  };
  document.addEventListener('DOMContentLoaded', () => {
    // Connection options remain local until the common Start/Apply action is used.
    $('stream-volume').oninput=()=>{if(audioGain)audioGain.gain.value=Number($('stream-volume').value)/100;};
    $('stream-audio-resume').onclick=()=>audioContext?.resume().catch(()=>{});
    const mirrorResize=new ResizeObserver(fitMirrorLayout);
    for(const node of [$('mirror-card'),$('phone-stage'),document.querySelector('.remote-panel'),document.querySelector('.device-tabs'),document.querySelector('.page-heading'),$('ops-jobs'),$('device-feedback'),document.querySelector('.device-breadcrumb'),$('error-banner'),$('device-busy')])if(node)mirrorResize.observe(node);
    window.addEventListener('resize',fitMirrorLayout);
    document.addEventListener('fullscreenchange',fitMirrorLayout);
    for (const name of ['overview', 'screen', 'settings', 'files', 'logs', 'monitor', 'resources', 'explorer', 'apps', 'network', 'connection', 'tools', 'history']) $(`${name}-tab`).addEventListener('click', () => tab(name));
    window.AppInventory?.init({getDevice:()=>s.id,onEnriched:()=>loadInventory('apps',true),onChange:()=>{inventories.apps.page=0;renderInventory('apps');},onUserChange:()=>{const item=inventories.apps;item.requestId=(item.requestId||0)+1;item.loading=false;item.data=null;item.filtered=null;item.page=0;item.user=null;item.refreshQueued=false;window.DeviceTargets?.appScopeChanged();window.AppBatch?.setUser(resolvedAppUser());window.DeviceOps?.appScopeChanged();window.Workbench?.appScopeChanged?.();loadInventory('apps',true);}});
    for (const kind of ['explorer', 'apps']) {
      $(`${kind}-refresh`).addEventListener('click', () => loadInventory(kind, true));
      $(`${kind}-search`).addEventListener('input', () => { inventories[kind].page = 0; inventories[kind].focusedKey=null; DeskFeedback.paint('목록 필터 적용',()=>renderInventory(kind)); });
      $(`${kind}-scope`).addEventListener('change', () => { inventories[kind].page = 0; inventories[kind].focusedKey=null; DeskFeedback.paint('목록 필터 적용',()=>renderInventory(kind)); });
      const showPageStart = () => { const target=kind==='explorer'?$('explorer-help-summary'):$('apps-search');target.style.scrollMarginTop=(document.querySelector('.device-tabs').offsetHeight+14)+'px';target.scrollIntoView({block:'start'}); };
      $(`${kind}-prev`).addEventListener('click', () => { inventories[kind].page--; renderInventory(kind); showPageStart(); });
      $(`${kind}-next`).addEventListener('click', () => { inventories[kind].page++; renderInventory(kind); showPageStart(); });
    }
    $('explorer-firmware').addEventListener('change',()=>{inventories.explorer.page=0;inventories.explorer.focusedKey=null;DeskFeedback.paint('펌웨어 검증 필터 적용',()=>renderInventory('explorer'));});
    document.addEventListener('click',event=>{const button=event.target.closest('[data-setting-alternative]');if(!button||!s.id)return;const target=button.dataset.settingAlternative,split=target.indexOf(':'),namespace=target.slice(0,split),key=target.slice(split+1);if(!['system','secure','global'].includes(namespace)||!key)return;if(s.data?.settings?.some(row=>row.key===key&&row.namespace===namespace)||inventories.explorer.data?.some(row=>row.key===key&&row.namespace===namespace&&row.editable===true)){s.query=key;s.category='all';s.availableOnly=false;$('settings-search').value=key;$('settings-available').checked=false;tab('settings');renderSettings();document.querySelector('[data-setting-card="'+key+'"]')?.scrollIntoView?.({block:'center'});return;}$('explorer-search').value=key;$('explorer-scope').value=namespace;$('explorer-help-level').value='all';$('explorer-firmware').value='all';inventories.explorer.page=0;inventories.explorer.focusedKey=key;tab('explorer');if(inventories.explorer.data)renderInventory('explorer');});
    $('explorer-help-level').addEventListener('change', () => { inventories.explorer.page = 0; inventories.explorer.focusedKey=null; DeskFeedback.paint('설명 필터 적용',()=>renderInventory('explorer')); });
    $('explorer-list').addEventListener('click', event => { const button = event.target.closest('[data-edit-known]'); if (button) { s.query = button.dataset.editKnown; s.category = 'all'; $('settings-search').value = s.query; tab('settings'); renderSettings(); } });
    $('explorer-list').addEventListener('click',event=>{const button=event.target.closest('[data-edit-raw]');if(button){const row=inventories.explorer.data?.find(r=>r.key===button.dataset.editRaw&&r.namespace===button.dataset.namespace);window.Workbench?.openAction('settings-put',{namespace:button.dataset.namespace,key:button.dataset.editRaw,value:row?.valueUnavailable?'':row?.value||''});}});
    $('app-selection').addEventListener('click',event=>{const button=event.target.closest('[data-selected-app-action]');if(button&&!button.disabled&&window.DeviceTargets?.app){button.dataset.appAction=button.dataset.selectedAppAction;button.dataset.package=window.DeviceTargets.app.package;button.dataset.user=String(window.DeviceTargets.app.userId??resolvedAppUser());actOnApp(button);}});
    $('apps-list').addEventListener('click', event => { if(event.target.closest('[data-app-batch-check]'))return; const manage = event.target.closest('[data-manage-package]'); if (manage) { window.DeviceOps.manage(manage.dataset.managePackage,undefined,manage.dataset.user); return; } const button = event.target.closest('[data-app-action]'); if (button && !button.disabled){actOnApp(button);return;}const row=event.target.closest('[data-app-row]');if(row)window.DeviceTargets?.selectApp(row.dataset.appRow); });
    $('settings-search').addEventListener('input', event => { s.query = event.target.value; renderSettings(); });
    $('settings-available').addEventListener('change', event => { s.availableOnly = event.target.checked; renderSettings(); });
    $('settings-categories').addEventListener('click', event => { const button = event.target.closest('[data-category]'); if (button) { s.category = button.dataset.category; renderSettings(); } });
    $('settings-groups').addEventListener('input', event => { if (event.target.id.startsWith('setting-')) s.drafts.set(event.target.id.slice(8), event.target.value); });
    $('settings-export').addEventListener('click', () => { if (s.data) download(new Blob([JSON.stringify({ device: s.data.device.model, at: new Date().toISOString(), settings: s.data.settings.map(({ key, namespace, title, value }) => ({ key, namespace, title, value })) }, null, 2)], { type: 'application/json' }), `adb-settings-${Date.now()}.json`); });
    $('tools-refresh').addEventListener('click', loadInfo);
    $('battery-history-open').addEventListener('click',async()=>{const epoch=s.epoch;tab('monitor');await window.DeviceOps?.waitForStatus?.();if(epoch===s.epoch&&s.tab==='monitor')window.DeviceDomains?.show?.('battery');});
    document.querySelectorAll('[data-device-tool]').forEach(button => button.addEventListener('click', () => openPhoneSettings(button.dataset.deviceTool)));
    $('stream-apply').addEventListener('click', applyMirrorSelection);
    $('view-only').addEventListener('change', event => { window.MirrorHid?.release();s.keyboard?.cancel();s.gestures?.cancel(); s.viewOnly = event.target.checked; controlEnabled(!!s.width); });
    $('screen-fullscreen').addEventListener('click', async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await $('mirror-card').requestFullscreen(); } catch { notice('이 브라우저에서는 전체화면을 사용할 수 없습니다.', true); } });
    $('screen-fullscreen-exit').addEventListener('click',()=>document.fullscreenElement&&document.exitFullscreen().catch(()=>{}));
    window.visualViewport?.addEventListener('resize',fitMirrorLayout);
    $('screen-capture').addEventListener('click', () => $('phone-canvas').toBlob(blob => { if (blob) download(blob, `adb-screen-${Date.now()}.png`); }, 'image/png'));
    $('screen-record').addEventListener('click', toggleRecording);
    document.querySelectorAll('[data-phone-command]').forEach(button => button.addEventListener('click', () => send({ type: button.dataset.phoneCommand })));
    document.querySelectorAll('[data-phone-display]').forEach(button => button.addEventListener('click', () => send({ type: 'display-power', on: button.dataset.phoneDisplay === 'true' })));
    $('mirror-toggle').addEventListener('click', () => s.socket || s.starting ? stopMirror() : startMirror());
    $('settings-refresh').addEventListener('click', () => { notice(''); loadSettings();window.DeviceExtensions?.refreshPrivacy?.(); });
    $('settings-groups').addEventListener('click', event => {
      const button = event.target.closest('[data-apply-setting]'); if (!button || button.disabled) return;
      const item = s.data.settings.find(item => item.key === button.dataset.applySetting); const input = $(`setting-${item.key}`);
      if (!input.value || !input.reportValidity()) return;
      changeSetting({ action: 'set', key: item.key, value: input.value, expected: item.value });
    });
    $('settings-history').addEventListener('click', event => { const button = event.target.closest('[data-undo]'); if (button && !button.disabled) changeSetting({ action: 'undo', historyId: button.dataset.undo }); });
    document.querySelectorAll('[data-phone-scroll]').forEach(button=>button.onclick=()=>send({type:'scroll',x:Math.floor(s.width/2),y:Math.floor(s.height/2),width:s.width,height:s.height,vertical:Number(button.dataset.phoneScroll),horizontal:0}));
    document.querySelectorAll('[data-phone-key]').forEach(button => button.addEventListener('click', () => send({ type: 'key', keycode: Number(button.dataset.phoneKey) })));
    $('phone-notifications').addEventListener('click', () => send({ type: 'notifications' }));
    $('phone-paste').addEventListener('click', () => { const text = $('phone-text').value; if (!text) return; send({ type: 'paste', text }); $('phone-text').value = ''; notice('폰에 텍스트 붙여넣기를 요청했습니다.'); });
    const canvas = $('phone-canvas');
    window.MirrorTools?.configure({ send });
    window.MirrorView?.configure({canvas,stage:$('phone-stage'),releaseInputs:()=>{window.MirrorHid?.release();s.keyboard?.cancel();s.gestures?.cancel();},changed:()=>{s.frames=0;s.frameAt=performance.now();controlEnabled(!!s.width);if(s.width)status(window.MirrorView.paused?'PC 표시 일시정지 · 폰은 계속 동작':'실시간 화면 연결됨',true);}});
    window.MirrorOptions?.configure({send,getDeviceId:()=>s.id,restart:()=>s.socket?$('stream-apply').click():startMirror()});
    window.MirrorSessionOptions?.configure({canvas,fit:fitMirrorCanvas,restart:()=>s.socket?$('stream-apply').click():startMirror()});
    window.MirrorPresets?.configure();
    window.MirrorCompare?.configure({getDeviceId:()=>s.id});
    const inputReady=()=>!!(s.width||s.controlReady&&s.mirrorOptions?.controlOnly)&&s.socket?.readyState===WebSocket.OPEN&&s.mirrorOptions?.source!=='camera';
    s.gestures = window.MirrorTools?.bindCanvas(canvas, { send, isReady: inputReady, isViewOnly: () => s.viewOnly, getSize: () => ({ width: s.width, height: s.height }) });
    s.keyboard=window.MirrorKeyboard?.bind(canvas,{send,isReady:inputReady,isViewOnly:()=>s.viewOnly});
    window.MirrorHid?.configure({send,isReady:()=>!!s.controlReady&&s.mirrorOptions?.source!=='camera',isViewOnly:()=>s.viewOnly||!!window.MirrorView?.inputBlocked,mount:$('mirror-tools'),canvas,cancelSdk:()=>{s.keyboard?.cancel();s.gestures?.cancel();}});
    window.MirrorLayout?.configure();
    controlEnabled(false);
  });
  for(const referenceId of ['explorer-reference','explorer-reference-oneui9'])$(referenceId).addEventListener('click',async()=>{
    if(window.DeviceExtensions?.allows('firmwareReference')!==true){notice('이 기기에서 활성화된 제조사 설명 확장이 없습니다. 확장 설정을 확인해 주세요.',true);return;}
    const finish=DeskFeedback.start('오프라인 설명사전 조회');const epoch=s.epoch;const item=inventories.explorer;item.requestId=(item.requestId||0)+1;const requestId=item.requestId;item.loading=false;$('explorer-refresh').disabled=false;const button=$(referenceId);button.disabled=true;
    try{const response=await fetch('/api/help-reference?'+new URLSearchParams({id:s.id,edition:referenceId==='explorer-reference-oneui9'?'current':'previous'}),{cache:'no-store'});const data=await response.json();if(!response.ok)throw new Error(data.error);if(epoch!==s.epoch||requestId!==item.requestId)return;
      inventories.explorer.data=data.entries;inventories.explorer.page=0;inventories.explorer.reference=true;inventories.explorer.focusedKey=null;inventories.explorer.firmwareReview=data.firmwareReview||null;$('explorer-firmware').value='all';
      $('explorer-reference-note').hidden=false;$('explorer-reference-note').textContent=`오프라인 설명사전 · ${data.profile.model} / ${data.profile.build}에서 확인한 키 목록입니다. 보관된 분석 자료이며 현재 기기의 설정값은 조회하지 않습니다.`;notice('');renderInventory('explorer');
    }catch(error){if(epoch===s.epoch&&requestId===item.requestId)notice(error.message,true);}finally{finish();button.disabled=false;}
  });
  $('explorer-page-size').addEventListener('change',()=>{inventories.explorer.page=0;renderInventory('explorer');});
  $('explorer-prev-top').addEventListener('click',()=>$('explorer-prev').click());
  $('explorer-next-top').addEventListener('click',()=>$('explorer-next').click());
  $('explorer-help-summary').addEventListener('click',event=>{const b=event.target.closest('[data-help-filter]');if(b){$('explorer-help-level').value=b.dataset.helpFilter;inventories.explorer.page=0;inventories.explorer.focusedKey=null;renderInventory('explorer');}});
  $('explorer-export').addEventListener('click',()=>{if(!inventories.explorer.data)return;const rows=inventories.explorer.filtered||[];const url=URL.createObjectURL(new Blob([JSON.stringify({deviceId:s.id,reference:!!inventories.explorer.reference,exportedAt:new Date().toISOString(),entries:rows},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='adb-setting-descriptions.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);});
  let referenceRefresh=0;
  document.addEventListener('adb-reference-updated',async()=>{const revision=++referenceRefresh;const item=inventories.apps,rows=item.data,id=s.id,epoch=s.epoch,requestId=item.requestId,user=appScope();if(!Array.isArray(rows)||!window.AppReference?.refreshInventory)return;try{const updated=await AppReference.refreshInventory(rows);if(revision===referenceRefresh&&id===s.id&&epoch===s.epoch&&requestId===item.requestId&&rows===item.data&&user===appScope()){item.data=updated;renderInventory('apps');}}catch(error){if(revision===referenceRefresh&&id===s.id&&epoch===s.epoch&&requestId===item.requestId&&user===appScope())notice('참고 자료는 저장됐지만 앱 목록 설명을 갱신하지 못했습니다. '+error.message,true);}});
  window.addEventListener('pagehide', () => window.DeviceDesk.close());
})();
