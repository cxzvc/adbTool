(() => {
  // VPx carries decoder metadata in its first keyframe, not in an Annex-B config packet.
  // https://www.w3.org/TR/webcodecs-vp9-codec-registration/
  // https://github.com/webmproject/libvpx/blob/main/vp9/decoder/vp9_decodeframe.c
  function vpxKeyFrame(codec, bytes) {
    const dimensions=(width,height)=>{if(!width||!height||width>8192||height>8192)throw new Error(`${codec.toUpperCase()} 영상 크기가 지원 범위를 벗어났습니다.`);return{codedWidth:width,codedHeight:height};};
    if(codec==='vp8'){
      if(bytes.length<10||(bytes[0]&1)||((bytes[0]>>1)&7)>3||bytes[3]!==0x9d||bytes[4]!==1||bytes[5]!==0x2a)throw new Error('VP8 시작 키프레임 헤더가 올바르지 않습니다.');
      const partition=(bytes[0]|bytes[1]<<8|bytes[2]<<16)>>>5;
      if(!partition||partition+10>bytes.length)throw new Error('VP8 키프레임 데이터가 잘렸습니다.');
      return{codec:'vp8',profile:0,bitDepth:8,...dimensions((bytes[6]|bytes[7]<<8)&0x3fff,(bytes[8]|bytes[9]<<8)&0x3fff)};
    }
    if(codec!=='vp9')throw new Error('지원하지 않는 VPx 코덱입니다.');
    let offset=0;const read=count=>{if(offset+count>bytes.length*8)throw new Error('VP9 키프레임 헤더가 잘렸습니다.');let value=0;for(let n=0;n<count;n++,offset++)value=value*2+((bytes[offset>>3]>>(7-(offset&7)))&1);return value;};
    if(read(2)!==2)throw new Error('VP9 프레임 시작 표시가 올바르지 않습니다.');
    const profile=read(1)+2*read(1);if(profile===3&&read(1))throw new Error('지원하지 않는 VP9 프로필입니다.');
    if(read(1)||read(1))throw new Error('VP9 재생을 시작하려면 새 키프레임이 필요합니다.');
    read(1);read(1);if(read(24)!==0x498342)throw new Error('VP9 키프레임 동기 표시가 올바르지 않습니다.');
    const bitDepth=profile>=2?(read(1)?12:10):8,colorSpace=read(3);let fullRange,x=1,y=1;
    if(colorSpace===6)throw new Error('예약된 VP9 색상 형식은 지원하지 않습니다.');
    if(colorSpace!==7){fullRange=read(1);if(profile&1){x=read(1);y=read(1);if(x&&y||read(1))throw new Error('VP9 프로필의 색상 샘플링이 올바르지 않습니다.');}}
    else{if(!(profile&1))throw new Error('이 VP9 프로필은 RGB 색상을 지원하지 않습니다.');fullRange=1;x=0;y=0;if(read(1))throw new Error('VP9 예약 비트가 올바르지 않습니다.');}
    if(!x&&y)throw new Error('VP9 4:4:0 색상 샘플링은 이 브라우저 재생 경로에서 지원하지 않습니다.');
    const size=dimensions(read(16)+1,read(16)+1);if(read(1)){read(16);read(16);}
    const chroma=x?(y?1:2):3;
    // The bitstream does not carry a VP9 level. 10 is a decoder configuration hint,
    // not measured stream metadata; the actual profile/depth/dimensions are checked.
    // Unspecified BT.601 primaries/transfer remain unspecified rather than guessed.
    const color=[[2,2,2],[2,2,6],[1,1,1],[6,6,6],[7,7,7],[9,bitDepth===12?15:14,9],null,[1,13,0]][colorSpace];
    const fields=[profile,10,bitDepth,chroma,...color,fullRange].map(value=>String(value).padStart(2,'0'));
    return{codec:`vp09.${fields.join('.')}`,profile,bitDepth,colorSpace,fullRange,subsamplingX:x,subsamplingY:y,...size};
  }
  function codecString(codec, bytes) {
    if(codec==='vp8'||codec==='vp9')return vpxKeyFrame(codec,bytes).codec;
    if (codec === 'h265') {
      const starts=[];for(let i=0;i+3<bytes.length;i++){if(bytes[i]===0&&bytes[i+1]===0&&(bytes[i+2]===1||(bytes[i+2]===0&&bytes[i+3]===1))){const start=i+(bytes[i+2]===1?3:4);starts.push({offset:i,start});i=start-1;}}
      for(let n=0;n<starts.length;n++){const nal=bytes.subarray(starts[n].start,n+1<starts.length?starts[n+1].offset:bytes.length);if(((nal[0]>>1)&63)!==33)continue;const rbsp=[];for(let i=2;i<nal.length;i++){if(i>=4&&nal[i]===3&&nal[i-1]===0&&nal[i-2]===0)continue;rbsp.push(nal[i]);}if(rbsp.length<13)throw new Error('H.265 SPS가 잘렸습니다.');const profile=['','A','B','C'][rbsp[1]>>6]+String(rbsp[1]&31),tier=rbsp[1]&32?'H':'L';let compatibility=0;for(let bit=0;bit<32;bit++)if((rbsp[2+(bit>>3)]>>(7-(bit&7)))&1)compatibility+=2**bit;const constraints=rbsp.slice(6,12);while(constraints.length&&constraints.at(-1)===0)constraints.pop();return `hev1.${profile}.${compatibility.toString(16).toUpperCase()}.${tier}${rbsp[12]}.${constraints.length?constraints.map(v=>v.toString(16).padStart(2,'0').toUpperCase()).join('.'):'0'}`;}
      throw new Error('H.265 코덱 정보를 읽지 못했습니다.');
    }
    if (codec === 'av1') return 'av01.0.08M.08';
    for (let i=0;i<bytes.length-7;i++) {
      let nal=-1;if(bytes[i]===0&&bytes[i+1]===0&&bytes[i+2]===1)nal=i+3;else if(bytes[i]===0&&bytes[i+1]===0&&bytes[i+2]===0&&bytes[i+3]===1)nal=i+4;
      if(nal>=0&&(bytes[nal]&31)===7)return 'avc1.'+[...bytes.slice(nal+1,nal+4)].map(n=>n.toString(16).padStart(2,'0')).join('');
    }
    throw new Error('H.264 코덱 정보를 읽지 못했습니다.');
  }
  function create(api) {
    const s={codec:'h264',decoder:null,config:null,generation:0,ready:false,mse:false,gop:[],gopBytes:0,closed:false,waitingKey:false,vpxSignature:null};
    const closeDecoder=()=>{try{s.decoder?.close();}catch{}s.decoder=null;s.ready=false;};
    function fallback(error) {
      if(s.closed)return;
      if(s.codec!=='h264'||!window.MediaSource||s.mse){s.generation++;closeDecoder();s.gop=[];s.gopBytes=0;s.closed=true;api.fatal(`${s.codec.toUpperCase()} 영상을 재생하지 못했습니다. H.264 또는 다른 기기 인코더를 선택하세요. ${error?.message||''}`);return;}
      closeDecoder();s.mse=true;s.generation++;api.fallback(error?.message||'WebCodecs 사용 불가');api.resetMse();
      if(s.gop[0]?.key){for(const frame of s.gop)api.feedMse(frame);s.waitingKey=false;}else{s.waitingKey=true;api.requestKeyFrame();}
    }
    async function configure(bytes,frameConfig=null) {
      s.config=frameConfig?null:bytes.slice();s.gop=[];s.gopBytes=0;s.waitingKey=false;const generation=++s.generation;closeDecoder();
      try {
        if(s.mse){api.resetMse();s.waitingKey=true;return;}
        if(!window.VideoDecoder){fallback(new Error('이 환경에 WebCodecs가 없어 호환 재생을 사용할 수 있는지 확인합니다.'));return;}
        const config={codec:frameConfig?.codec||codecString(s.codec,bytes),...(frameConfig?{codedWidth:frameConfig.codedWidth,codedHeight:frameConfig.codedHeight}:{}),optimizeForLatency:true,hardwareAcceleration:['no-preference','prefer-hardware','prefer-software'].includes(api.hardwareAcceleration)?api.hardwareAcceleration:'prefer-hardware'};
        const support=await VideoDecoder.isConfigSupported(config);if(generation!==s.generation||s.closed)return;if(!support.supported)throw new Error(`브라우저가 실제 영상 형식 ${config.codec}${frameConfig?` (${frameConfig.codedWidth}×${frameConfig.codedHeight})`:''}을 지원하지 않습니다.`);
        const decoder=new VideoDecoder({output(frame){try{if(!s.closed&&s.decoder===decoder)(api.metrics?.decoded(),api.draw(frame,frame.displayWidth,frame.displayHeight));}finally{frame.close();}},error(error){if(s.decoder===decoder)fallback(error);}});
        s.decoder=decoder;decoder.ondequeue=()=>api.metrics?.queue(decoder.decodeQueueSize);decoder.configure(config);s.ready=true;const queued=[...s.gop];if(!queued.length)s.waitingKey=true;for(const frame of queued){if(s.mse||s.closed)break;deliver(frame);}
      }catch(error){if(generation===s.generation&&!s.closed)fallback(error);}
    }
    function deliver(frame) {
      if(s.closed)return;
      if(s.mse){if(s.waitingKey&&!frame.key){api.metrics?.skip('키프레임 대기');return;}s.waitingKey=false;api.feedMse(frame);return;}
      if(!s.ready||!s.decoder)return;
      if(s.waitingKey&&!frame.key){api.metrics?.skip('키프레임 대기');return;}s.waitingKey=false;
      try{if(s.decoder.decodeQueueSize>60)throw new Error('디코딩 대기열이 지연되었습니다.');s.decoder.decode(new EncodedVideoChunk({type:frame.key?'key':'delta',timestamp:frame.pts,data:frame.data}));api.metrics?.queue(s.decoder.decodeQueueSize);}catch(error){fallback(error);}
    }
    function packet(buffer) {
      if(s.closed)return;const view=new DataView(buffer);if(view.byteLength<12||view.getUint32(8)!==view.byteLength-12)throw new Error('잘못된 영상 패킷입니다.');
      const flags=view.getBigUint64(0),bytes=new Uint8Array(buffer,12),vpx=s.codec==='vp8'||s.codec==='vp9';if(flags&(1n<<62n)){if(vpx){s.generation++;closeDecoder();s.vpxSignature=null;s.config=null;s.gop=[];s.gopBytes=0;s.waitingKey=true;}else configure(bytes);return;}
      api.metrics?.receive(bytes.length);const key=!!(flags&(1n<<61n)),pts=Number(flags&((1n<<61n)-1n));if(!Number.isSafeInteger(pts))throw new Error('영상 재생 시각이 올바르지 않습니다.');
      if(vpx){
        if(key){try{const config=vpxKeyFrame(s.codec,bytes),signature=`${config.codec}/${config.codedWidth}/${config.codedHeight}`;if(signature!==s.vpxSignature){s.vpxSignature=signature;configure(bytes,config);}}catch(error){fallback(error);return;}}
        else if(!s.vpxSignature)return;
      }
      if(s.closed)return;
      let data=bytes;if(key&&s.config){data=new Uint8Array(s.config.length+bytes.length);data.set(s.config);data.set(bytes,s.config.length);}
      const frame={key,data:data.slice(),pts};
      if(key){s.gop=[];s.gopBytes=0;}
      if(key||s.gop.length){s.gop.push(frame);s.gopBytes+=data.length;if(s.gop.length>120||s.gopBytes>16*1024*1024){s.gop=[];s.gopBytes=0;if(!s.ready){s.waitingKey=true;api.requestKeyFrame();}}}
      deliver(frame);
    }
    return {packet,setCodec(codec){if(!['h264','h265','av1','vp8','vp9'].includes(codec))throw new Error('지원하지 않는 코덱입니다.');if(s.codec!==codec){s.generation++;closeDecoder();s.config=null;s.gop=[];s.gopBytes=0;s.mse=false;s.waitingKey=false;s.vpxSignature=null;}s.codec=codec;},close(){s.closed=true;s.generation++;closeDecoder();s.gop=[];s.config=null;},get mode(){return s.mse?'mse':'webcodecs';}};
  }
  window.MirrorVideo={create,codecString,vpxKeyFrame};
})();
