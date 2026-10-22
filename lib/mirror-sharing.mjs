const OPEN=1;
const MAX_CACHE=16*1024*1024,MAX_FRAMES=600,MAX_VIEWERS=8;
export function createMirrorSharing(){
  const sources=new Map();
  function write(ws,data){if(ws.readyState!==OPEN)return false;if(ws.bufferedAmount>4*1024*1024){ws.close(1013,'Viewer too slow');return false;}ws.send(data,{binary:Buffer.isBuffer(data)});return true;}
  const json=(ws,message)=>write(ws,JSON.stringify(message));
  function register({key,deviceId,options,requestKeyFrame}){
    if(sources.has(key))throw new Error('동일 영상 원본이 이미 등록되었습니다.');
    const source={key,deviceId,options,codec:options.codec||'h264',dimensions:null,config:null,gop:[],bytes:0,viewers:new Set(),requestKeyFrame,lastRequest:0};sources.set(key,source);
    return {
      metadata(message){if(message.type==='video-codec')source.codec=message.codec;else if(message.type==='dimensions'){const changed=!source.dimensions||source.dimensions.width!==message.width||source.dimensions.height!==message.height;source.dimensions={type:'dimensions',width:message.width,height:message.height};if(changed){source.config=null;source.gop=[];source.bytes=0;}}else return;for(const ws of source.viewers)json(ws,message);},
      packet(packet){if(!Buffer.isBuffer(packet)||packet.length<12||packet.readUInt32BE(8)!==packet.length-12)throw new Error('잘못된 공유 영상 패킷입니다.');const flags=packet.readBigUInt64BE(0),config=!!(flags&(1n<<62n)),keyframe=!!(flags&(1n<<61n));if(config){source.config=Buffer.from(packet);source.gop=[];source.bytes=0;}else if(keyframe||source.gop.length){if(keyframe){source.gop=[];source.bytes=0;}source.gop.push(Buffer.from(packet));source.bytes+=packet.length;if(source.bytes>MAX_CACHE||source.gop.length>MAX_FRAMES){source.gop=[];source.bytes=0;}}const message=Buffer.concat([Buffer.from([0]),packet]);for(const ws of source.viewers)write(ws,message);},
      close(message='원본 화면 연결이 종료되었습니다.'){if(sources.get(key)!==source)return;sources.delete(key);for(const ws of [...source.viewers]){json(ws,{type:'error',message});ws.close(1000,'Source ended');}source.viewers.clear();source.gop=[];source.config=null;},
    };
  }
  function attach(ws,deviceId){
    const candidates=[...sources.values()].filter(s=>s.deviceId===deviceId&&!s.options.sessionId&&!s.options.audioOnly&&!s.options.controlOnly).sort((a,b)=>Number(!!a.options.observer)-Number(!!b.options.observer));
    const source=candidates[0];if(!source)return false;if(source.viewers.size>=MAX_VIEWERS)throw new Error('한 영상 원본을 함께 볼 수 있는 추가 뷰어는 최대 8개입니다.');source.viewers.add(ws);
    let alive=true;const timer=setInterval(()=>{if(!alive){ws.terminate();return;}alive=false;if(ws.readyState===OPEN)ws.ping();},15000);timer.unref();
    const cleanup=()=>{clearInterval(timer);source.viewers.delete(ws);};ws.on('pong',()=>alive=true);ws.on('close',cleanup);ws.on('error',cleanup);
    ws.on('message',()=>{json(ws,{type:'control-error',message:'공유 뷰어는 화면 보기만 가능합니다.'});ws.close(1008,'Read only viewer');});
    json(ws,{type:'session-options',options:{codec:source.codec,source:source.options.source||'display',display:source.options.display??0,newDisplay:source.options.newDisplay||null,size:source.options.size,fps:source.options.fps,audio:false,audioOnly:false,channels:true,observer:true,preview:true}});
    json(ws,{type:'viewer-state',readOnly:true,shared:true,deviceId,source:source.options.source||'display'});json(ws,{type:'video-codec',codec:source.codec});if(source.dimensions)json(ws,source.dimensions);
    if(source.config)write(ws,Buffer.concat([Buffer.from([0]),source.config]));for(const packet of source.gop)write(ws,Buffer.concat([Buffer.from([0]),packet]));
    if(!source.gop.length){json(ws,{type:'status',message:'원본 영상의 다음 키프레임을 기다리고 있습니다.'});if(Date.now()-source.lastRequest>2000){source.lastRequest=Date.now();source.requestKeyFrame?.();}}
    return true;
  }
  return{register,attach,close(){for(const source of [...sources.values()]){for(const ws of source.viewers)ws.close(1001,'Server closed');source.viewers.clear();}sources.clear();},snapshot(){return[...sources.values()].map(s=>({key:s.key,deviceId:s.deviceId,viewers:s.viewers.size,cachedBytes:s.bytes,frames:s.gop.length,readOnly:!!s.options.observer}));}};
}
