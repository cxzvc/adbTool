(() => {
  const rawHint='이 주소·브라우저에서는 압축 소리를 재생할 수 없습니다. PCM 전송을 선택하거나 PC 소리 재생을 꺼서 원본 저장만 사용하세요.';
  const bytes=value=>{if(typeof value!=='string'||value.length>90000||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))throw new Error('소리 설정 정보가 올바르지 않습니다.');return Uint8Array.from(atob(value),c=>c.charCodeAt(0));};
  function config(format){
    if(!['aac','opus','flac'].includes(format.codec)||!Number.isInteger(format.sampleRate)||format.sampleRate<8000||format.sampleRate>192000||format.channels!==2)throw new Error('소리 디코더 설정이 올바르지 않습니다.');
    return{codec:format.codec==='aac'?'mp4a.40.2':format.codec,sampleRate:format.sampleRate,numberOfChannels:format.channels,description:bytes(format.description)};
  }
  async function preflight(codec='raw'){
    if(codec==='raw')return true;
    if(!window.isSecureContext||!window.AudioDecoder?.isConfigSupported||!window.EncodedAudioChunk)throw new Error(rawHint);
    if(!['aac','opus','flac'].includes(codec))throw new Error('지원하는 소리 코덱을 선택하세요.');
    const candidate={codec:codec==='aac'?'mp4a.40.2':codec,sampleRate:48000,numberOfChannels:2};
    if(codec==='aac')candidate.description=new Uint8Array([0x11,0x90]);
    if(codec==='flac'){const d=new Uint8Array(42);d.set([102,76,97,67,128,0,0,34]);d[8]=16;d[10]=16;d[18]=11;d[19]=184;d[20]=2;d[21]=240;candidate.description=d;}
    let supported=false;try{supported=(await window.AudioDecoder.isConfigSupported(candidate)).supported;}catch{}
    if(!supported)throw new Error(`${codec.toUpperCase()} 소리 재생을 지원하지 않습니다. PCM을 선택하거나 PC 소리 재생을 끄세요.`);return true;
  }
  function create({output,error=()=>{}}){
    let decoder=null,current=null,revision=0,closed=false,ready=false,failed=false,queue=[],queuedBytes=0;
    function fail(message){if(failed||closed)return;failed=true;revision++;ready=false;queue=[];queuedBytes=0;try{decoder?.close();}catch{}decoder=null;error(message+' PCM을 선택하거나 PC 소리 재생을 끄세요.');}
    function decoded(frame,epoch){try{if(closed||failed||epoch!==revision)return;const count=frame.numberOfFrames,channels=frame.numberOfChannels;if(!Number.isInteger(count)||count<1||count>192000||channels!==2)throw new Error('디코딩한 소리 크기가 올바르지 않습니다.');const planes=[];for(let i=0;i<channels;i++){const plane=new Float32Array(count);frame.copyTo(plane,{planeIndex:i,format:'f32-planar'});planes.push(plane);}output({pts:frame.timestamp,sampleRate:frame.sampleRate,channels,planes});}catch(e){fail(e.message);}finally{frame.close();}}
    async function configure(format){
      if(closed)return;const epoch=++revision;ready=false;failed=false;queue=[];queuedBytes=0;try{decoder?.close();}catch{}decoder=null;current=format;
      if((format.codec||'raw')==='raw'){ready=true;return;}
      try{await preflight(format.codec);if(closed||epoch!==revision)return;const settings=config(format),support=await window.AudioDecoder.isConfigSupported(settings);if(closed||epoch!==revision)return;if(!support.supported)throw new Error('기기에서 보낸 실제 소리 설정을 브라우저가 지원하지 않습니다.');decoder=new window.AudioDecoder({output:frame=>decoded(frame,epoch),error:e=>{if(epoch===revision)fail(e.message||'압축 소리 디코딩 실패');}});decoder.configure(settings);ready=true;const waiting=queue;queue=[];queuedBytes=0;for(const packet of waiting)push(packet);}catch(e){if(epoch===revision)fail(e.message);}
    }
    function push(buffer){
      if(closed||failed||!current)return;let view;
      try{
        if(ArrayBuffer.isView(buffer))view=new Uint8Array(buffer.buffer,buffer.byteOffset,buffer.byteLength);else view=new Uint8Array(buffer);
        if(view.byteLength<12||view.byteLength>1024*1024+12)throw new Error('소리 패킷 크기가 올바르지 않습니다.');const head=new DataView(view.buffer,view.byteOffset,view.byteLength),length=head.getUint32(8),flags=head.getBigUint64(0);if(length+12!==view.length||flags>>62n)throw new Error('소리 패킷 헤더가 올바르지 않습니다.');const pts=Number(flags&((1n<<61n)-1n));if(!Number.isSafeInteger(pts))throw new Error('소리 재생 시각이 올바르지 않습니다.');
        if(!ready){if(queue.length>=100||queuedBytes+view.length>1024*1024)throw new Error('소리 디코더 준비가 지연되었습니다.');const copy=view.slice();queue.push(copy);queuedBytes+=copy.length;return;}
        if((current.codec||'raw')==='raw'){if(length%4)throw new Error('PCM 샘플 크기가 올바르지 않습니다.');const count=length/4;if(!count)return;const planes=[new Float32Array(count),new Float32Array(count)];for(let i=0;i<count;i++){planes[0][i]=head.getInt16(12+i*4,true)/32768;planes[1][i]=head.getInt16(14+i*4,true)/32768;}output({pts,sampleRate:48000,channels:2,planes});return;}
        if(decoder.decodeQueueSize>100)throw new Error('압축 소리 처리가 지연되었습니다.');decoder.decode(new window.EncodedAudioChunk({type:'key',timestamp:pts,data:view.subarray(12)}));
      }catch(e){fail(e.message);}
    }
    return{configure,push,close(){closed=true;revision++;queue=[];queuedBytes=0;try{decoder?.close();}catch{}decoder=null;}};
  }
  window.MirrorAudioDecoder={create,preflight};
})();
