import path from 'node:path';
import http from 'node:http';
import {once} from 'node:events';
import {createReadStream,createWriteStream} from 'node:fs';
import {writeFile,stat} from 'node:fs/promises';
import {finished} from 'node:stream/promises';
import {ActionError} from './connections.mjs';
import {packageName} from './operations-core.mjs';
import {uploaded,createResultStore,shellArgs,userContext,limitedJson} from './feature-common.mjs';
import {CaptureAccumulator} from './pcap-analysis.mjs';
const CAP=256*1024*1024,PKG='com.emanuelef.remote_capture';
export function captureIntent({action='start',apiKey='',app='',port=8080}={}){
  if(!['start','stop'].includes(action)||typeof apiKey!=='string'||apiKey.length>256||/[\x00-\x1f]/.test(apiKey))throw new ActionError('캡처 요청을 확인하세요.');
  if(app)packageName(app);
  return['am','start','--user','0','-n',PKG+'/.activities.CaptureCtrl','-e','action',action,...(apiKey?['-e','api_key',apiKey]:[]),...(action==='start'?['-e','pcap_dump_mode','http_server','--ei','http_server_port',String(port),'--ez','root_capture','false','--ez','tls_decryption','false','--ez','auto_block_private_dns','false','--ez','dump_extensions','true','--ez','pcapng_format','false','-e','ip_mode','both',...(app?['-e','app_filter',app]:[])]:[])];
}
export function createPcapTools(core,{httpGet=http.get,writeStream=createWriteStream}={}){
  const results=createResultStore(core,'pcap-analysis'),captures=new Map(),reservations=new Map();let closed=false;
  const emptySummary=()=>new CaptureAccumulator().summary();
  function prune(){for(const[id,c]of captures)if(c.ended&&!core.jobs.has(id))captures.delete(id);}
  function assertOpen(){if(closed)throw new ActionError('서버가 종료 중입니다. 다시 연결한 뒤 시도하세요.',503);}
  function analyze(body){assertOpen();return core.startJob(body.deviceId||'pc','pcap-analysis','통신 캡처 파일 로컬 분석',async job=>{
    const u=await uploaded(core,body.uploadId,{max:CAP,extensions:['.pcap','.pcapng','.cap']}),parser=new CaptureAccumulator();let bytes=0;
    for await(const chunk of createReadStream(u.localPath)){if(job.cancelled)throw new Error('분석을 취소했습니다.');parser.feed(chunk);bytes+=chunk.length;job.progress=Math.round(bytes/Math.max(1,u.bytes)*95);}
    const data={...parser.finish(),name:u.name};results.set(job.id,data);return{message:`${data.packets}패킷 · ${data.connections.length}개 통신 분석${data.truncated?' · 끝이 잘린 파일입니다.':''}`};
  });}
  async function capability(deviceId){const{serial}=await core.resolve(deviceId),user=await userContext(core,serial),found=await shellArgs(core,serial,['pm','path','--user',user,PKG]);return{installed:found.includes('package:'),user,ready:user==='0'&&found.includes('package:'),notes:['PCAPdroid 앱과 폰에서의 VPN 승인이 필요합니다. Android 17에서는 로컬 네트워크 접근 권한도 필요할 수 있습니다.','웹에서 승인·설치·권한 부여를 자동으로 수행하지 않습니다. 기존 VPN과 동시에 사용할 수 없을 수 있습니다.']};}
  async function status(deviceId,id){
    const job=core.jobs.get(id);if(!job||job.deviceId!==deviceId||job.kind!=='pcap-capture')throw new ActionError('이 기기의 캡처를 찾지 못했습니다.',404);
    const c=captures.get(id);if(!c)return{id,state:job.state==='running'&&!job.cancelled?'preparing':'stopped',message:job.message||'PC 수신 작업을 준비하고 있습니다.',received:0,summary:emptySummary(),job:core.publicJob(job)};
    const summary=c.parser?c.parser.summary():c.summaryFallback||await limitedJson(c.summaryFile,64*1024*1024);
    return{id:c.id,state:c.state,message:c.message,received:c.bytes,createdAt:c.createdAt,filter:c.filter,summary,job:core.publicJob(job)};
  }
  async function removeForward(c){const port=c.port;c.port=null;if(port)await core.run(c.serial,['forward','--remove','tcp:'+port]).catch(()=>{});}
  function receive(c){
    assertOpen();if(c.ended||c.connecting||c.request||c.stream)throw new ActionError('수신 중이거나 종료된 캡처입니다.',409);
    c.connecting=true;c.state='connecting';c.message='PC에서 폰 캡처 서버 연결 중';
    const pending=(async()=>{
      try{
        if(!c.port){const out=(await core.run(c.serial,['forward','tcp:0','tcp:8080'])).stdout.trim();if(!/^\d{1,5}$/.test(out)||Number(out)<1||Number(out)>65535)throw new Error('포워딩 포트 미확인');c.port=Number(out);}
        // Stop may finish before an outstanding ADB forward resolves. Do not start HTTP afterwards.
        if(c.ended||closed){await removeForward(c);return;}
        await new Promise(resolve=>{
          const req=httpGet({hostname:'127.0.0.1',port:c.port,path:'/',timeout:8000},response=>{
            req.setTimeout(0);c.request=null;
            if(c.ended){response.destroy();resolve();return;}
            if(response.statusCode!==200){response.destroy();c.state='waiting';c.message='폰의 VPN·로컬 네트워크 승인을 확인한 뒤 수신 재시도를 누르세요.';resolve();return;}
            c.stream=response;c.state='receiving';c.message='통신 패킷을 PC에 수신 중';
            response.on('data',chunk=>{
              if(c.ended)return;
              if(c.bytes+chunk.length>CAP){void stopLocal(c,'256MB 한도에 도달해 PC 수신을 종료했습니다. 폰의 캡처 종료 여부는 직접 확인하세요.');return;}
              try{c.parser.feed(chunk);c.bytes+=chunk.length;if(!c.fileStream.write(chunk))response.pause();}
              catch(error){c.failure='캡처 형식을 읽지 못했습니다. '+error.message;void stopLocal(c,c.failure);}
            });
            c.fileStream.on('drain',()=>response.resume());
            response.once('end',()=>void stopLocal(c,'캡처 스트림 수신이 끝났습니다.'));
            const interrupted=()=>{if(!c.ended)void stopLocal(c,'연결이 끊겨 PC 수신을 종료했습니다. 부분 파일을 확인하세요.');};
            response.once('error',interrupted);response.once('aborted',interrupted);response.once('close',()=>{if(!response.complete)interrupted();});resolve();
          });
          c.request=req;req.on('timeout',()=>req.destroy(new Error('연결 대기 시간 초과')));
          req.on('error',()=>{if(c.request===req)c.request=null;if(!c.ended&&!c.stream){c.state='waiting';c.message='폰 캡처 서버에 아직 연결되지 않았습니다. PCAPdroid의 승인 화면·로컬 네트워크 권한을 확인한 뒤 수신만 재시도하세요.';}resolve();});
        });
      }catch{if(!c.ended){c.state='waiting';c.message='ADB 포트 연결을 확인하지 못했습니다. 무선 연결을 확인한 뒤 수신을 재시도하세요.';}}
      finally{c.connecting=false;}
    })();
    c.connectionTask=pending;
    return pending.then(()=>status(c.deviceId,c.id));
  }
  function stopLocal(c,message){
    if(c.stopTask)return c.stopTask;
    c.ended=true;clearTimeout(c.timer);clearInterval(c.cancelTimer);c.request?.destroy();c.stream?.destroy();c.request=null;c.stream=null;
    c.stopTask=(async()=>{
      await c.connectionTask?.catch(()=>{});await removeForward(c);
      c.fileStream.end();try{await finished(c.fileStream);}catch{c.failure='PC 저장 파일을 끝까지 쓰지 못했습니다. 저장된 부분 파일을 확인하세요.';}
      const summary=c.parser.finish();c.summaryFile=path.join(c.directory,'capture-summary.json');
      try{await writeFile(c.summaryFile,JSON.stringify(summary));c.parser=null;}catch{c.summaryFallback=summary;c.parser=null;c.failure||='PC에 캡처 요약을 저장하지 못했습니다.';}
      c.fileStream=null;c.state='stopped';c.message=c.failure||message||'PC 수신을 종료했습니다. 폰의 캡처는 별도로 종료할 수 있습니다.';c.finish();
    })();return c.stopTask;
  }
  async function start(body){
    assertOpen();prune();
    if(typeof body.deviceId!=='string'||!body.deviceId||body.deviceId.length>512)throw new ActionError('캡처할 기기를 선택하세요.');
    const reservation=reservations.get(body.deviceId);
    if(reservation==='starting'||core.jobs.get(reservation)?.state==='running'||[...captures.values()].some(c=>c.deviceId===body.deviceId&&!c.ended))throw new ActionError('이 기기의 PC 수신이 이미 진행 중입니다. 진행 중인 수신을 불러오세요.',409);
    if(body.confirm!==true)throw new ActionError('폰에서 VPN 승인 화면이 열리는 캡처 요청을 확인하세요.');
    reservations.set(body.deviceId,'starting');
    try{
      const args=captureIntent({app:body.package||'',apiKey:body.apiKey||''}),minutes=Number(body.minutes??5);if(!Number.isInteger(minutes)||minutes<1||minutes>30)throw new ActionError('수신 시간은 1~30분입니다.');
      const{serial}=await core.resolve(body.deviceId),user=await userContext(core,serial);if(user!=='0')throw new ActionError('PCAPdroid 캡처 연동은 기본 사용자 0에서 지원합니다. 다른 프로필의 앱을 기본 사용자 앱으로 대신 실행하지 않습니다.');
      if(!(await capability(body.deviceId)).installed)throw new ActionError('PCAPdroid가 설치되지 않았습니다. 앱을 직접 설치한 뒤 다시 확인하세요.');
      const app=body.package?packageName(body.package):'';
      if(app&&!(await shellArgs(core,serial,['pm','list','packages','--user','0',app])).split(/\r?\n/).includes('package:'+app))throw new ActionError('현재 사용자 앱을 목록에서 다시 선택하세요.');
      assertOpen();
      const submitted=core.startJob(body.deviceId,'pcap-capture','PCAPdroid 통신 수신',async job=>{
        job.directory=await core.tempDir();if(closed||job.cancelled)throw new ActionError('캡처 준비를 중단했습니다. 폰에 시작 요청을 보내지 않았습니다.',409);
        const file=path.join(job.directory,'phone-traffic.pcap');let finish;const done=new Promise(resolve=>finish=resolve);
        const c={id:job.id,deviceId:body.deviceId,serial,directory:job.directory,filter:app||null,parser:new CaptureAccumulator(),fileStream:writeStream(file),bytes:0,state:'requesting',message:'폰에 캡처 승인 요청 중',createdAt:new Date().toISOString(),finish};captures.set(c.id,c);
        c.fileStream.on('error',()=>{c.failure='PC 저장 파일을 쓰지 못했습니다.';void stopLocal(c,c.failure);});
        try{if(c.fileStream.pending)await once(c.fileStream,'open');}catch{c.failure='PC 저장 파일을 열지 못했습니다.';await stopLocal(c,c.failure);}
        try{if(!c.ended&&!closed&&!job.cancelled)await shellArgs(core,serial,args);}catch{c.failure='폰이 캡처 요청을 받아들이지 않았습니다. PCAPdroid 제어 권한·API 키·잠금 화면을 확인하세요.';await stopLocal(c,c.failure);}
        if(c.ended||closed||job.cancelled){await stopLocal(c,'작업 중단으로 PC 수신만 종료했습니다. 폰 캡처는 직접 확인하세요.');}
        else{
          c.cancelTimer=setInterval(()=>{if(job.cancelled)void stopLocal(c,'작업 취소로 PC 수신만 종료했습니다. 폰 캡처는 직접 종료하세요.');},1000);c.cancelTimer.unref();
          c.timer=setTimeout(()=>void stopLocal(c,'설정한 시간이 끝나 PC 수신을 종료했습니다. 폰의 캡처 종료 여부는 직접 확인하세요.'),minutes*60000);c.timer.unref();
          await receive(c);
        }
        await done;
        const size=await stat(file).then(x=>x.size).catch(()=>0);if(size){job.artifact=file;job.downloadName=c.failure?'phone-traffic-partial.pcap':'phone-traffic.pcap';}
        if(c.failure)throw new ActionError(c.failure,409);return{message:c.message};
      });reservations.set(body.deviceId,submitted.id);return submitted;
    }catch(error){reservations.delete(body.deviceId);throw error;}
  }
  async function control(body){
    const job=core.jobs.get(body.id);if(!job||job.kind!=='pcap-capture'||job.deviceId!==body.deviceId)throw new ActionError('캡처를 선택하세요.',404);
    const c=captures.get(body.id);
    if(!c){if(body.action==='stop-local'&&job.state==='running'){job.cancelled=true;job.child?.kill();return status(body.deviceId,body.id);}throw new ActionError('PC 수신을 준비 중이거나 시작하지 못했습니다. 상태를 다시 조회하세요.',409);}
    if(body.action==='retry')return receive(c);
    if(body.action==='stop-local'){await stopLocal(c);return status(c.deviceId,c.id);}
    if(body.action==='stop-phone'){
      assertOpen();if(body.confirm!==true)throw new ActionError('폰 캡처 종료 요청을 확인하세요.');
      try{await shellArgs(core,c.serial,captureIntent({action:'stop',apiKey:body.apiKey||''}));}catch{throw new ActionError('PCAPdroid 종료 요청이 거부되었습니다. 폰 앱에서 직접 종료하거나 제어 권한을 확인하세요.');}
      await stopLocal(c,'폰에 캡처 종료를 요청하고 PC 수신을 종료했습니다. 폰에서 최종 상태를 확인하세요.');return status(c.deviceId,c.id);
    }
    throw new ActionError('지원하지 않는 캡처 동작입니다.');
  }
  return{analyze,result:results.get,capability,start,control,status,list(deviceId){prune();return{items:[...core.jobs.values()].filter(j=>j.deviceId===deviceId&&j.kind==='pcap-capture').slice(-20).reverse().map(j=>{const c=captures.get(j.id);return{id:j.id,state:c?.state||(j.state==='running'?'preparing':'stopped'),received:c?.bytes||0,createdAt:c?.createdAt||j.createdAt};})};},async close(){closed=true;await Promise.allSettled([...captures.values()].map(c=>stopLocal(c,'웹 서버가 종료되어 PC 수신만 종료했습니다.')));}};
}
