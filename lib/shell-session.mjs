import { StringDecoder } from 'node:string_decoder';
import { WebSocketServer, WebSocket } from 'ws';
import { openAdbService, shellPacket, shellWindowSize, ShellPacketReader } from './adb-socket.mjs';

export function attachShell({server,deviceControl,csrfToken,access,openService=openAdbService}){
  const active=new Set(),cleanups=new Map(),wss=new WebSocketServer({noServer:true,maxPayload:32768,perMessageDeflate:false,handleProtocols:p=>p.has('adb-shell')?'adb-shell':false});
  server.on('upgrade',(req,socket,head)=>{
    let url;try{url=new URL(req.url,'http://localhost');}catch{return;}
    if(url.pathname!=='/api/shell')return;
    const protocols=String(req.headers['sec-websocket-protocol']||'').split(',').map(s=>s.trim());
    if(!access.allowedHosts(server.address().port).includes(req.headers.host)||req.headers.origin!==`http://${req.headers.host}`||!protocols.includes(csrfToken)||!protocols.includes('adb-shell')||active.size>=4){socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');socket.destroy();return;}
    wss.handleUpgrade(req,socket,head,ws=>start(ws,url.searchParams.get('deviceId')));
  });
  async function start(ws,deviceId){
    active.add(ws);let channel,closed=false,lastInput=Date.now(),cols=100,rows=28;const abort=new AbortController(),decoders={1:new StringDecoder('utf8'),2:new StringDecoder('utf8')};
    const send=(type,text)=>{if(ws.readyState===WebSocket.OPEN){if(ws.bufferedAmount>1024*1024){ws.close(1008,'Output backlog');cleanup();return;}ws.send(JSON.stringify({type,text}));}};
    const cleanup=()=>{if(closed)return;closed=true;clearInterval(timer);abort.abort();channel?.destroy();active.delete(ws);cleanups.delete(ws);};
    cleanups.set(ws,cleanup);
    const timer=setInterval(()=>{if(Date.now()-lastInput>30*60*1000){send('status','30분 입력이 없어 셸을 닫았습니다.');ws.close();cleanup();}},30000);timer.unref();
    const write=data=>{if(channel?.writable&&!closed){if(channel.writableLength>512*1024){send('error','입력 대기열이 너무 커 셸을 닫았습니다.');ws.close();cleanup();return;}channel.write(data);}};
    ws.on('close',cleanup);ws.on('error',cleanup);
    ws.on('message',(raw,binary)=>{if(binary||closed)return;try{const message=JSON.parse(raw.toString());if(message.type==='resize'){const packet=shellWindowSize(message.cols,message.rows);cols=message.cols;rows=message.rows;write(packet);return;}if(message.type!=='input'||typeof message.text!=='string'||Buffer.byteLength(message.text)>16000)return;lastInput=Date.now();write(shellPacket(0,Buffer.from(message.text,message.binary?'latin1':'utf8')));}catch{send('error','입력 형식 또는 터미널 크기를 확인하세요.');}});
    try{
      if(typeof deviceId!=='string'||!deviceId||deviceId.length>255||/[\x00-\x1f]/.test(deviceId))throw new Error('기기를 선택하세요.');send('status','선택한 기기의 셸 연결을 준비하고 있습니다…');const {serial}=await deviceControl.resolve(deviceId);if(closed||ws.readyState!==WebSocket.OPEN)return;
      channel=await openService(serial,'shell,v2,TERM=xterm-256color,pty:',{signal:abort.signal});if(closed||ws.readyState!==WebSocket.OPEN){channel.destroy();return;}
      const reader=new ShellPacketReader((id,data)=>{if(id===3){for(const decoder of Object.values(decoders)){const last=decoder.end();if(last)send('output',last);}send('status',`셸 종료 (${data.length?data[0]:0})`);ws.close();cleanup();}else{const text=decoders[id].write(data);if(text)send('output',text);}});
      channel.on('data',data=>{try{reader.push(data);}catch(error){send('error',error.message);ws.close();cleanup();}});
      channel.on('error',error=>{send('error',error.message);ws.close();cleanup();});channel.on('close',()=>{if(!closed){try{reader.finish();send('status','기기 셸 연결이 종료되었습니다.');}catch(error){send('error',error.message);}ws.close();cleanup();}});
      write(shellWindowSize(cols,rows));send('ready','기기 셸에 연결했습니다. 명령은 폰에서 실행됩니다.');channel.resume();
    }catch(error){send('error',`대화형 셸을 열지 못했습니다. ${error.message}`);ws.close();cleanup();}
  }
  server.on('close',()=>{for(const ws of [...active]){cleanups.get(ws)?.();ws.close();}wss.close();});
}
