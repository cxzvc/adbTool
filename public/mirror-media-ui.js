(() => {
  const $=id=>document.getElementById(id),s={socket:null,options:{},active:false,activeId:null,deviceId:null,poll:null,revision:0,refreshRequest:0,encoderRequest:0,preflightRequest:0,encoders:[],formats:null,listFinish:null,encoderFinish:null};
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const sources=[['playback','앱 재생 · 폰 스피커 유지 가능 (13+)'],['output','기기 전체 출력 · 폰 소리는 PC로'],['mic','마이크'],['mic-unprocessed','마이크 · 가공 최소'],['mic-camcorder','마이크 · 카메라 방향'],['mic-voice-recognition','마이크 · 음성 인식'],['mic-voice-communication','마이크 · 통화용 처리'],['voice-performance','실시간 공연 · 마이크+재생'],['voice-call','통화 양쪽 · 기기 권한 필요'],['voice-call-uplink','통화 내 목소리 · 기기 권한 필요'],['voice-call-downlink','통화 상대 목소리 · 기기 권한 필요']];
  function build(){
    if($('mirror-media-options'))return;const anchor=document.querySelector('.stream-audio-controls');if(!anchor)return;
    const section=document.createElement('section');section.id='mirror-media-options';section.className='mirror-media-options';
    section.innerHTML=`
      <section class="media-subsection" data-media-section="connection" aria-label="소리 연결 옵션">
        <h3>소리 연결 옵션</h3><p>변경 후 상단 적용으로 반영합니다.</p>
        <div class="media-grid">
          <label>소리 입력<select id="media-source">${sources.map(([value,label])=>`<option value="${value}">${label}</option>`).join('')}</select></label>
          <label>전송 형식<select id="media-audio-codec"><option value="raw">PCM · 호환 전송</option><option value="opus">Opus · 압축</option><option value="aac">AAC · 압축</option><option value="flac">FLAC · 무손실</option></select></label>
          <label>압축 음질<select id="media-audio-bitrate"><option value="64">64Kbps</option><option value="96">96Kbps</option><option value="128" selected>128Kbps</option><option value="192">192Kbps</option><option value="256">256Kbps</option><option value="320">320Kbps</option></select></label>
          <label>폰 인코더<select id="media-audio-encoder"><option value="">기기 자동 선택</option></select></label>
        </div>
        <div class="media-checks">
          <label title="영상 없이 소리만 연결합니다."><input id="media-audio-only" type="checkbox">소리만 연결</label>
          <label title="앱 재생 입력·Android 13 이상에서 지원합니다."><input id="media-duplicate" type="checkbox" checked>폰에서도 재생</label>
          <label title="폰의 소리 캡처·전송 실패에 적용합니다. 소리만 연결은 실패 시 항상 종료합니다."><input id="media-audio-required" type="checkbox">소리 실패 시 영상도 중지</label>
        </div>
        <div class="media-buttons"><button id="media-load-encoders" type="button">인코더 조회</button><button id="media-use-raw" type="button">PCM 선택</button></div>
        <p id="media-source-help">Android 13+ · 캡처를 허용한 앱의 소리.</p><p id="media-codec-help">PCM은 호환성이 높은 비압축 전송입니다.</p><div id="media-encoder-state" role="status"></div>
      </section>
      <section class="media-subsection" data-media-section="playback" aria-label="PC 재생 설정">
        <h3>PC 재생 설정</h3>
        <div class="media-grid"><label>재생 버퍼<select id="media-buffer"><option value="50">50ms · 빠르게</option><option value="100" selected>100ms · 기본</option><option value="200">200ms · 안정적으로</option><option value="500">500ms · 감상용</option></select></label></div>
        <label title="끄면 PC 소리와 브라우저 녹화의 소리가 빠집니다. 원본 녹화는 계속 가능합니다."><input id="media-audio-playback" type="checkbox" checked>PC 재생 · 브라우저 녹화에 소리 포함</label>
        <small>재생 여부·버퍼는 상단 적용 후 반영합니다. 원본 녹화는 PC 음량과 무관합니다.</small>
      </section>
      <section class="media-subsection" data-media-section="recording" aria-label="원본 녹화">
        <h3>원본 녹화</h3><p>폰 원본 저장 · 브라우저 녹화와 별도입니다.</p>
        <div class="media-grid">
          <label>저장 형식<select id="media-format"><option value="mkv">MKV · 원본 영상·소리</option><option value="mp4">MP4 · 원본 영상+AAC</option><option value="webm">WebM · VP8·VP9·AV1+Opus</option><option value="m4a">M4A · 소리만 AAC</option><option value="flac">FLAC · 소리만 무손실</option><option value="opus">Opus · 소리만 압축</option><option value="wav">WAV · 소리만 PCM</option></select></label>
          <label>최대 시간<select id="media-minutes"><option value="5">5분</option><option value="15">15분</option><option value="30" selected>30분</option><option value="60">60분</option><option value="120">120분</option></select></label>
          <label>최대 용량<select id="media-maxmb"><option value="128">128MB</option><option value="512" selected>512MB</option><option value="1024">1GB</option><option value="2048">2GB</option></select></label>
        </div>
        <div class="media-buttons"><button id="media-start" type="button" disabled>원본 녹화 시작</button><button id="media-stop" type="button" disabled>녹화 종료·저장</button><button id="media-cancel" type="button" disabled>녹화 취소</button><button id="media-refresh" type="button">저장 파일</button></div>
        <p id="media-record-state" role="status" aria-live="polite">영상·소리 연결 후 시작하세요.</p><div id="media-list-state" role="status"></div><div id="media-recordings" class="media-recordings"></div>
        <small title="VP8은 MKV·WebM, VP9은 MKV·WebM·MP4를 지원합니다. 기기 인코더와 재생 앱의 지원이 필요합니다.">MKV: 원본 · MP4: AAC 소리 · WebM: Opus 소리(1ms).</small>
      </section>`;
    anchor.after(section);
    $('media-audio-codec').onchange=renderEncoders;
    $('media-use-raw').onclick=()=>{$('media-audio-codec').value='raw';$('media-audio-codec').dispatchEvent(new Event('change',{bubbles:true}));$('media-codec-help').textContent='PCM 선택됨 · 상단 적용 후 반영합니다.';};
    $('media-load-encoders').onclick=loadEncoders;renderEncoders();
    $('media-source').onchange=()=>{const playback=$('media-source').value==='playback';$('media-duplicate').disabled=!playback;$('media-source-help').textContent=playback?'Android 13+ · 캡처를 허용한 앱의 소리.':$('media-source').value==='output'?'Android 11+ · 전체 소리를 PC로 전달해 폰이 조용해질 수 있습니다.':'Android 11+ · 마이크·통화 입력은 기기 지원·권한이 필요합니다.';};
    $('media-audio-only').onchange=()=>{if($('media-audio-only').checked)$('stream-audio').checked=true;};
    $('stream-audio').addEventListener('change',()=>{if(!$('stream-audio').checked)$('media-audio-only').checked=false;});
    $('media-start').onclick=()=>{if(send({type:'media-start',format:$('media-format').value,maxMinutes:Number($('media-minutes').value),maxMB:Number($('media-maxmb').value)})){s.active=true;s.activeId=null;state('원본 녹화를 준비하고 있습니다…');update();}};
    $('media-stop').onclick=()=>{if(send({type:'media-stop'})){state('받은 프레임을 파일로 마무리하고 있습니다…');$('media-stop').disabled=true;}};
    $('media-cancel').onclick=()=>{if(send({type:'media-cancel'})){state('녹화를 취소하고 임시 파일을 정리하고 있습니다…');$('media-cancel').disabled=true;}};
    $('media-refresh').onclick=refresh;$('media-format').onchange=update;
  }
  function state(text,error=false){const host=$('media-record-state');if(!host)return;if(error&&window.DeskFeedback?.state){window.DeskFeedback.state(host,{type:'error',title:'녹화 결과를 확인해 주세요',message:text,rawError:text,errorContext:{context:'mirror',action:'recording'}});return;}host.textContent=text;}
  function readState(id,type,title,message='',onAction){const host=$(id);if(!host)return;if(window.DeskFeedback?.state)window.DeskFeedback.state(host,{type,title,message,errorContext:{context:id==='media-list-state'?'history':'mirror'},...(['error','offline','warning'].includes(type)?{rawError:message}:{}),...(onAction?{actionLabel:'다시 읽기',onAction}:{})});else{host.hidden=false;host.textContent=title+(message?' '+message:'');}}
  const readError=error=>/offline|not connected|no devices|Failed to fetch|NetworkError|연결.*끊|오프라인|기기를 찾을/i.test(error.message||'')?'offline':/unsupported|not supported|지원하지|미지원/i.test(error.message||'')?'warning':'error';
  function update(){if(!$('media-start'))return;const connected=s.socket?.readyState===1,controlOnly=connected&&s.options.controlOnly===true,codec=s.options.codec||'h264',audioOnly=!!s.options.audioOnly;for(const option of $('media-format').options){option.disabled=!!s.formats&&!s.formats.includes(option.value)||!!connected&&!audioOnly&&(option.value==='mp4'&&codec==='vp8'||option.value==='webm'&&!['vp8','vp9','av1'].includes(codec));}const invalid=[...$('media-format').options].some(option=>option.value===$('media-format').value&&option.disabled);$('media-start').disabled=!connected||s.active||controlOnly||invalid;$('media-stop').disabled=!connected||!s.active;$('media-cancel').disabled=!connected||!s.active;for(const id of ['media-format','media-minutes','media-maxmb'])$(id).disabled=s.active||controlOnly;if(connected&&controlOnly)state('영상·소리 없는 조작 전용 연결은 녹화하지 않습니다.');else if(invalid&&!s.active)state(codec==='vp8'?'VP8은 MP4 원본 저장을 지원하지 않습니다. MKV 또는 WebM을 선택하세요.':'현재 코덱·서버에서 지원하는 저장 형식을 선택하세요. WebM 원본 영상은 VP8·VP9·AV1입니다.');}
  function send(message){if(s.socket?.readyState!==1){state('실시간 영상 또는 소리를 먼저 연결하세요.');return false;}s.socket.send(JSON.stringify(message));return true;}
  async function refresh({background=false}={}){
    if(!s.deviceId||!$('media-recordings')){readState('media-list-state','info','기기를 먼저 선택하세요.','선택한 기기의 PC 저장 파일을 표시합니다.');return;}
    const revision=s.revision,request=++s.refreshRequest,id=s.deviceId,button=$('media-refresh');clearTimeout(s.poll);s.listFinish?.();button.disabled=true;
    const finish=background?undefined:window.DeskFeedback?.start('PC 원본 녹화 파일 조회',{button});s.listFinish=finish;if(!background)readState('media-list-state','loading','PC 저장 파일을 읽는 중입니다.');
    try{const response=await fetch(`/api/mirror-recordings?deviceId=${encodeURIComponent(id)}`,{cache:'no-store'});if(!response.ok)throw new Error('저장 목록을 불러오지 못했습니다.');const data=await response.json();if(revision!==s.revision||request!==s.refreshRequest)return;
      if(!Array.isArray(data.items))throw new Error('저장 파일 목록의 응답 형식을 확인하지 못했습니다.');
      $('media-recordings').innerHTML=data.items.length?data.items.map(item=>`<div title="${esc(item.message||'')}${item.expiresAt?' · '+esc(new Date(item.expiresAt).toLocaleString('ko-KR'))+'까지 보관':''}"><span>${item.state==='complete'?esc(new Date(item.created).toLocaleTimeString('ko-KR'))+' · '+esc((item.bytes/1024/1024).toFixed(1))+'MB':esc(({preparing:'준비 중',waiting:'키프레임 대기',recording:'기록 중',saving:'저장 중',interrupted:'중단 · 부분 파일',error:'실패',cancelled:'취소됨'})[item.state]||item.state)}</span>${/^\/api\/mirror-recordings\/[\da-f-]{36}\?deviceId=/.test(item.url)?`<a href="${esc(item.url)}" download>${esc(item.name)}</a>`:''}</div>`).join(''):'';
      if(Array.isArray(data.formats)){s.formats=data.formats;update();}
      readState('media-list-state',data.items.length?'success':'empty',data.items.length?`PC 저장 항목 ${data.items.length}개를 읽었습니다.`:'저장된 원본 녹화가 없습니다.',data.items.length?'저장 중인 항목은 완료되면 내려받을 수 있습니다.':'영상·소리 연결 후 원본 녹화를 시작하고 저장하면 여기에 표시됩니다.');
      if(data.items.some(item=>['preparing','waiting','recording','saving'].includes(item.state)))s.poll=setTimeout(()=>refresh({background:true}),2000);
    }catch(error){if(revision===s.revision&&request===s.refreshRequest)readState('media-list-state',readError(error),'PC 저장 파일을 읽지 못했습니다.',error.message+' 이전 목록이 남아 있다면 최신 상태가 아닐 수 있습니다.',()=>{if(id===s.deviceId)return refresh();});}
    finally{finish?.();if(s.listFinish===finish)s.listFinish=null;if(revision===s.revision&&request===s.refreshRequest)button.disabled=false;}
  }
  function renderEncoders(){const codec=$('media-audio-codec')?.value||'raw';if(!$('media-audio-encoder'))return;const selected=$('media-audio-encoder').value;$('media-audio-encoder').innerHTML='<option value="">기기 자동 선택</option>'+s.encoders.filter(e=>e.kind==='audio'&&e.codec===codec).map(e=>`<option value="${esc(e.name)}">${esc(e.name)}</option>`).join('');if(s.encoders.some(e=>e.kind==='audio'&&e.codec===codec&&e.name===selected))$('media-audio-encoder').value=selected;$('media-audio-encoder').disabled=codec==='raw';$('media-audio-bitrate').disabled=!['aac','opus'].includes(codec);$('media-codec-help').textContent=codec==='raw'?'PCM · 호환성이 높은 비압축 전송.':codec==='flac'?'FLAC · 무손실 압축, 비트레이트 지정 없음.':'폰에서 압축합니다. 재생 미지원 시 PCM 또는 PC 재생 끄기를 선택하세요.';}
  function setCapabilities(data){s.encoders=Array.isArray(data?.encoders)?data.encoders:[];renderEncoders();}
  async function loadEncoders(){
    const id=s.deviceId,revision=s.revision;if(!id){readState('media-encoder-state','info','기기를 먼저 선택하세요.','연결된 기기를 선택한 뒤 인코더를 읽을 수 있습니다.');return;}
    const request=++s.encoderRequest,button=$('media-load-encoders');s.encoderFinish?.();button.disabled=true;const finish=window.DeskFeedback?.start('소리 인코더 목록',{button});s.encoderFinish=finish;readState('media-encoder-state','loading','기기의 소리 인코더를 읽는 중입니다.');
    try{const response=await fetch('/api/mirror/capabilities?'+new URLSearchParams({deviceId:id,kind:'encoders'}),{cache:'no-store'}),data=await response.json();if(!response.ok)throw new Error(data.error||'인코더 목록을 읽지 못했습니다.');if(revision!==s.revision||request!==s.encoderRequest)return;
      if(!Array.isArray(data.encoders))throw new Error('인코더 목록의 응답 형식을 확인하지 못했습니다.');setCapabilities(data);const count=s.encoders.filter(e=>e.kind==='audio').length;readState('media-encoder-state',count?'success':'empty',count?`소리 인코더 ${count}개를 읽었습니다.`:'기기가 소리 인코더 목록을 제공하지 않았습니다.',count?'전송 코덱을 고르면 해당 인코더가 표시됩니다.':'PCM은 인코더를 사용하지 않습니다. 빈 목록만으로 소리 전달 미지원으로 판단하지 않습니다.');
    }catch(error){if(revision===s.revision&&request===s.encoderRequest){const type=readError(error);readState('media-encoder-state',type,type==='offline'?'기기 연결을 확인해 주세요.':type==='warning'?'이 기기에서 인코더 정보를 확인할 수 없습니다.':'소리 인코더를 읽지 못했습니다.',error.message,()=>{if(id===s.deviceId)return loadEncoders();});}}
    finally{finish?.();if(s.encoderFinish===finish)s.encoderFinish=null;if(revision===s.revision&&request===s.encoderRequest)button.disabled=false;}
  }
  function params(){build();const p=new URLSearchParams();if(!$('media-source'))return p;const only=$('media-audio-only').checked;if(only){p.set('audioOnly','1');p.set('audio','1');}p.set('audioSource',$('media-source').value);p.set('audioDup',$('media-duplicate').checked?'1':'0');p.set('audioCodec',$('media-audio-codec').value);if($('media-audio-required').checked)p.set('audioRequired','1');if($('media-audio-encoder').value)p.set('audioEncoder',$('media-audio-encoder').value);if(!$('media-audio-bitrate').disabled)p.set('audioBitrate',$('media-audio-bitrate').value);return p;}
  async function preflight(snapshot){build();const revision=s.revision,request=++s.preflightRequest,audioEnabled=snapshot?snapshot.audioEnabled:!!$('stream-audio')?.checked||!!$('media-audio-only')?.checked,playback=snapshot?snapshot.playbackEnabled:playbackEnabled(),codec=snapshot?.audioCodec||$('media-audio-codec')?.value||'raw';if(!audioEnabled||!playback||codec==='raw')return;try{if(!window.MirrorAudioDecoder)throw new Error('압축 소리 기능을 불러오지 못했습니다. 새로고침하거나 PCM을 선택하세요.');await window.MirrorAudioDecoder.preflight(codec);}catch(error){if(revision===s.revision&&request===s.preflightRequest)readState('media-codec-help','error','브라우저 소리 재생을 준비하지 못했습니다',error.message);throw error;}}
  function playbackEnabled(){return $('media-audio-playback')?.checked!==false;}
  function setConnection(socket,options={}){build();s.socket=socket;s.options=options;if(options.deviceId&&s.deviceId!==options.deviceId){s.revision++;s.deviceId=options.deviceId;s.active=false;$('media-recordings').replaceChildren();}if(!s.deviceId&&socket?.url){try{s.deviceId=new URL(socket.url).searchParams.get('deviceId');}catch{}}socket?.addEventListener('open',update,{once:true});update();refresh();}
  function setDevice(id){build();if(s.deviceId===id)return;s.listFinish?.();s.listFinish=null;s.encoderFinish?.();s.encoderFinish=null;for(const name of ['media-list-state','media-encoder-state']){const host=$(name);if(host){window.DeskFeedback?.state?.(host,null);host.textContent='';}}if($('media-refresh'))$('media-refresh').disabled=!id;s.deviceId=id;s.revision++;s.encoderRequest++;s.preflightRequest++;if($('media-load-encoders'))$('media-load-encoders').disabled=false;s.active=false;s.activeId=null;s.encoders=[];renderEncoders();clearTimeout(s.poll);$('media-recordings')?.replaceChildren();state('폰 원본 저장 · 브라우저 녹화와 별도입니다.');update();if(id)refresh();}
  function disconnect(){s.preflightRequest++;s.socket=null;s.active=false;s.activeId=null;update();clearTimeout(s.poll);s.poll=setTimeout(refresh,500);}
  function onMessage(message){if(message.type!=='media-recording')return;if(s.activeId&&message.id&&message.id!==s.activeId){if(['complete','error','cancelled'].includes(message.state))refresh();return;}const unboundError=s.active&&s.activeId&&!message.id&&message.state==='error';if(!unboundError){s.active=['preparing','waiting','recording','saving'].includes(message.state);if(s.active&&message.id)s.activeId=message.id;else if(!s.active)s.activeId=null;}const text=({preparing:'녹화 준비',waiting:'다음 영상 키프레임 대기',recording:'원본 기록 중',saving:'PC에 저장 중',complete:'저장 완료',cancelled:'취소 완료',error:'녹화 오류'})[message.state]||message.state;state(`${text}${message.seconds!==undefined?' · '+message.seconds+'초 · '+(message.bytes/1024/1024).toFixed(1)+'MB':''}${message.message?' · '+message.message:''}`,message.state==='error');update();if(message.state==='saving')$('media-stop').disabled=true;if(!s.active)refresh();}
  window.MirrorMediaUI={params,setConnection,disconnect,onMessage,setDevice,setCapabilities,preflight,playbackEnabled,bufferMs:()=>Number($('media-buffer')?.value||100)};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',build,{once:true});else build();
})();
