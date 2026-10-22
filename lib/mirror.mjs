import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { EncodedAudioParser } from './mirror-audio-codecs.mjs';
import { normalizeMirrorOptions, videoServerArgs } from './mirror-options.mjs';
import { normalizeAudioOptions, audioServerArgs, createMirrorMedia } from './mirror-media.mjs';
import { createHidState, encodeHidControl, releaseHidControl, isHidRelease } from './mirror-hid.mjs';
import { createMirrorSharing } from './mirror-sharing.mjs';
import { normalizeSessionOptions, sessionServerArgs, scrcpyServerCommand, mirrorChannelPlan } from './mirror-session-options.mjs';
import { snapshotSessionSettings, confirmSessionRestored, finishMirrorProcess } from './mirror-cleanup.mjs';
const execute = promisify(execFile);
const VERSION = '5.0.1';
export function mirrorOptions(params) {
  const options=normalizeMirrorOptions(params);const sessionId=params.get('sessionId');if(sessionId){if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(sessionId)||!options.newDisplay||options.observer||params.get('controlOnly')==='1'||params.get('audioOnly')==='1')throw new Error('독립 세션은 새 가상 화면에서만 시작할 수 있습니다.');for(const key of ['showTouches','stayAwake','powerOn','startScreenOff','powerOffOnClose','screenOffTimeoutMs','startForceStop'])if(params.has(key)&&params.get(key)!=='0')throw new Error('독립 가상 화면은 폰 전체의 전원·설정·앱 종료 옵션을 변경할 수 없습니다.');options.sessionId=sessionId;}if(options.observer)return options;const base={...options,...(params.get('controlOnly')==='1'?{}:normalizeAudioOptions(params))};const result={...base,...normalizeSessionOptions(params,base)};if(result.sessionId&&(['showTouches','stayAwake','powerOn','startScreenOff','powerOffOnClose','screenOffTimeoutMs','startForceStop','audio'].some(key=>result[key])))throw new Error('독립 화면에서는 폰 전체 설정·전원·앱 강제 종료·소리 공유를 사용하지 않습니다.');return result;
}

export class VideoParser {
  constructor(onMessage, onCodec = () => {}) { this.buffer = Buffer.alloc(0); this.codecRead = false; this.onMessage = onMessage; this.onCodec = onCodec; }
  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (!this.codecRead && this.buffer.length >= 4) {
      const codec = this.buffer.subarray(0, 4).toString('ascii').replace(/^\0+/, '');
      if (!['h264', 'h265', 'av1', 'vp8', 'vp9'].includes(codec)) throw new Error('지원하지 않는 영상 형식입니다.');
      this.buffer = this.buffer.subarray(4); this.codecRead = true; this.onCodec(codec);
    }
    if (!this.codecRead) return;
    while (this.buffer.length >= 12) {
      if (this.buffer[0] & 0x80) {
        const width = this.buffer.readUInt32BE(4), height = this.buffer.readUInt32BE(8);
        if (!width || !height || width > 8192 || height > 8192) throw new Error('잘못된 영상 크기입니다.');
        this.onMessage({ type: 'dimensions', width, height }); this.buffer = this.buffer.subarray(12); continue;
      }
      const length = this.buffer.readUInt32BE(8);
      if (length > 8 * 1024 * 1024) throw new Error('영상 패킷이 너무 큽니다.');
      if (this.buffer.length < length + 12) break;
      this.onMessage(this.buffer.subarray(0, length + 12)); this.buffer = this.buffer.subarray(length + 12);
    }
  }
}

export class DeviceMessageParser {
  constructor(onMessage) { this.frame = Buffer.alloc(9); this.used = 0; this.total = 0; this.onMessage = onMessage; }
  get buffer() { return this.frame.subarray(0, this.used); }
  push(chunk) {
    // Consume one bounded frame at a time even when a TCP chunk contains several frames.
    let offset = 0;
    while (offset < chunk.length) {
      if (!this.used) { this.frame[0] = chunk[offset++]; this.used = 1; }
      const type = this.frame[0];
      if (![0, 1, 2].includes(type)) throw new Error('지원하지 않는 기기 응답 형식입니다.');
      const header = type === 1 ? 9 : 5, target = this.total || header;
      const count = Math.min(target - this.used, chunk.length - offset);
      if (count) { chunk.copy(this.frame, this.used, offset, offset + count); this.used += count; offset += count; }
      if (this.used < header) continue;
      if (!this.total) {
        this.total = header;
        if (type === 0) { const length = this.frame.readUInt32BE(1); if (length > 262139) throw new Error('클립보드 응답이 256KB 한도를 초과했습니다.'); this.total += length; }
        if (type === 2) { const length = this.frame.readUInt16BE(3); if (length > 4096) throw new Error('입력 장치 응답이 너무 큽니다.'); this.total += length; }
        // Allocate at most once per frame; byte-sized fragments cannot cause quadratic copying.
        if (this.total > this.frame.length) { const frame = Buffer.alloc(this.total); this.frame.copy(frame, 0, 0, this.used); this.frame = frame; }
      }
      if (this.used < this.total) continue;
      const message = this.frame.subarray(0, this.total); this.frame = Buffer.alloc(9); this.used = 0; this.total = 0;
      if (type === 0) this.onMessage({ type: 'clipboard', text: new TextDecoder('utf-8', { fatal: true }).decode(message.subarray(5)) });
      else if (type === 1) this.onMessage({ type: 'clipboard-ack', sequence: message.readBigUInt64BE(1).toString() });
      else this.onMessage({ type: 'uhid-output', id: message.readUInt16BE(1), data: message.subarray(5) });
    }
  }
}

export function encodeControl(message, size, hidState) {
  if (!message || typeof message !== 'object') throw new Error('잘못된 조작 요청입니다.');
  const hid=encodeHidControl(message,hidState);if(hid)return hid;
  if (message.type === 'touch') {
    const { action, x, y, width, height, pointerId = 0, pressure = 1 } = message;
    if (![0, 1, 2, 3].includes(action) || !Number.isInteger(pointerId)||pointerId<0||pointerId>9||!Number.isFinite(pressure)||pressure<0||pressure>1 || width !== size.width || height !== size.height || !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= width || y >= height) throw new Error('화면 크기·터치 포인터·압력을 확인하세요. 새 화면에서 다시 조작하세요.');
    // scrcpy releases its pointer bookkeeping on UP; a bare CANCEL does not remove the pointer.
    const buffer = Buffer.alloc(32); buffer[0] = 2; buffer[1] = action === 3 ? 1 : action;
    buffer.writeBigUInt64BE(BigInt(pointerId), 2); buffer.writeInt32BE(x, 10); buffer.writeInt32BE(y, 14);
    buffer.writeUInt16BE(width, 18); buffer.writeUInt16BE(height, 20); buffer.writeUInt16BE(action === 1 || action === 3 ? 0 : Math.round(pressure*65535), 22);
    return buffer;
  }
  if (message.type === 'key') {
    if (![3, 4, 19, 20, 21, 22, 24, 25, 26, 61, 66, 67, 82, 84, 85, 86, 87, 88, 92, 93, 111, 112, 122, 123, 164, 187, 224, 277, 278, 279].includes(message.keycode)) throw new Error('지원하지 않는 키입니다.');
    const buffer = Buffer.alloc(28);
    for (const action of [0, 1]) { const offset = action * 14; buffer[offset] = 0; buffer[offset + 1] = action; buffer.writeUInt32BE(message.keycode, offset + 2); }
    return buffer;
  }
  if (message.type === 'key-event') {
    const allowed = new Set([3,4,19,20,21,22,23,24,25,26,82,84,85,86,87,88,92,93,164,187,224,277,278,279]);
    for (const [from,to] of [[7,16],[29,76],[111,125],[131,163]]) for (let key=from;key<=to;key++) allowed.add(key);
    const action=message.action, key=message.keycode, repeat=message.repeat??0, meta=message.metaState??0, allowedMeta=1|2|4|8|16|32|64|128|4096|8192|16384|65536|131072|262144|1048576|2097152|4194304;
    if (![0,1].includes(action)||!allowed.has(key)||!Number.isInteger(repeat)||repeat<0||repeat>1000||!Number.isInteger(meta)||meta<0||(meta & ~allowedMeta)!==0) throw new Error('잘못된 키 입력 상태입니다.');
    const packet=Buffer.alloc(14);packet[1]=action;packet.writeUInt32BE(key,2);packet.writeUInt32BE(action===1?0:repeat,6);packet.writeUInt32BE(meta,10);return packet;
  }
  if (message.type === 'start-app') {
    if (typeof message.package !== 'string' || !/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/.test(message.package) || Buffer.byteLength(message.package)>255) throw new Error('앱 목록에서 대상을 선택하세요.');
    if(message.forceStop!==undefined&&typeof message.forceStop!=='boolean')throw new Error('앱 강제 종료 옵션이 올바르지 않습니다.');const text=Buffer.from((message.forceStop?'+':'')+message.package);if(text.length>255)throw new Error('앱 실행 요청 이름이 너무 깁니다.');return Buffer.concat([Buffer.from([16,text.length]),text]);
  }
  if (message.type === 'resize-display') {
    if (![message.width,message.height].every(v=>Number.isInteger(v)&&v>=200&&v<=8192)) throw new Error('가상 화면 크기는 200~8192 픽셀입니다.');
    const packet=Buffer.alloc(5);packet[0]=21;packet.writeUInt16BE(message.width,1);packet.writeUInt16BE(message.height,3);return packet;
  }
  if (message.type === 'camera-torch' && typeof message.on === 'boolean') return Buffer.from([18,message.on?1:0]);
  if (message.type === 'camera-zoom' && [-1,1].includes(message.direction)) return Buffer.from([message.direction===1?19:20]);
  if (message.type === 'paste') {
    if (typeof message.text !== 'string' || !message.text || Buffer.byteLength(message.text) > 6000) throw new Error('붙여넣을 텍스트는 6KB 이하로 입력하세요.');
    const text = Buffer.from(message.text, 'utf8'); const buffer = Buffer.alloc(14 + text.length);
    buffer[0] = 9; buffer.writeBigUInt64BE(0n, 1); buffer[9] = 1; buffer.writeUInt32BE(text.length, 10); text.copy(buffer, 14); return buffer;
  }
  if (message.type === 'get-clipboard') return Buffer.from([8, 0]);
  if (message.type === 'notifications') return Buffer.from([5]);
  if (message.type === 'quick-settings') return Buffer.from([6]);
  if (message.type === 'collapse-panels') return Buffer.from([7]);
  if (message.type === 'rotate') return Buffer.from([11]);
  if (message.type === 'reset-video') return Buffer.from([17]);
  if (message.type === 'display-power' && typeof message.on === 'boolean') return Buffer.from([10, message.on ? 1 : 0]);
  if (message.type === 'scroll') {
    const { x, y, width, height, horizontal = 0, vertical = 0 } = message;
    if (width !== size.width || height !== size.height || !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= width || y >= height || !Number.isFinite(horizontal) || !Number.isFinite(vertical) || Math.abs(horizontal) >= 16 || Math.abs(vertical) >= 16) throw new Error('잘못된 스크롤 좌표입니다.');
    const out = Buffer.alloc(21); out[0] = 3; out.writeInt32BE(x, 1); out.writeInt32BE(y, 5); out.writeUInt16BE(width, 9); out.writeUInt16BE(height, 11); out.writeInt16BE(Math.round(horizontal * 2048), 13); out.writeInt16BE(Math.round(vertical * 2048), 15); return out;
  }
  throw new Error('지원하지 않는 조작입니다.');
}

async function firstSocket(port, isClosed,connectSocket=net.createConnection) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline && !isClosed()) {
    try {
      return await new Promise((resolve, reject) => {
        const socket = connectSocket({ host: '127.0.0.1', port });
        const fail = () => { socket.destroy(); reject(new Error('영상 서버를 기다리는 중입니다.')); };
        socket.setTimeout(800, fail); socket.once('error', fail); socket.once('close', fail);
        socket.once('data', data => {
          socket.pause(); socket.setTimeout(0); socket.removeListener('error', fail); socket.removeListener('close', fail);
          if (data[0] !== 0) { fail(); return; }
          if (data.length > 1) socket.unshift(data.subarray(1));
          socket.on('error', () => {}); resolve(socket);
        });
      });
    } catch { await new Promise(resolve => setTimeout(resolve, 120)); }
  }
  throw new Error('폰의 화면 스트림에 연결하지 못했습니다. 화면 잠금과 ADB 연결을 확인하세요.');
}

export function attachMirroring({ server, root, adbPath, deviceControl, csrfToken, access,transport={} }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8192, perMessageDeflate: false, handleProtocols: protocols => protocols.has('adb-desk') ? 'adb-desk' : false });
  const active = new Map();
  const cleaning=new Map(),restorePending=new Map();
  const sharing=createMirrorSharing();
  const sessionLogs=new Map();
  const media = createMirrorMedia({root});
  const executeAdb=transport.execute||execute,spawnAdb=transport.spawn||spawn,connectSocket=transport.connect||net.createConnection;
  const run = async (serial, args,timeout=12000) => (await executeAdb(adbPath, ['-s', serial, ...args], { windowsHide: true, timeout, maxBuffer: 65536, encoding: 'utf8' })).stdout.trim();
  const readSetting=(serial,table,key)=>run(serial,['shell','settings','--user','0','get',table,key],1500);
  server.on('upgrade', (req, socket, head) => {
    const port = server.address().port;
    let url; try { url = new URL(req.url, `http://127.0.0.1:${port}`); } catch { socket.destroy(); return; }
    if(url.pathname==='/api/shell')return;
    const protocols = String(req.headers['sec-websocket-protocol'] || '').split(',').map(s => s.trim());
    if (!access.allowedHosts(port).includes(req.headers.host) || !access.authorized(req) || req.headers.origin !== `http://${req.headers.host}` || url.pathname !== '/api/mirror' || !protocols.includes(csrfToken) || !protocols.includes('adb-desk')) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return;
    }
    let options; try { options = mirrorOptions(url.searchParams); } catch { socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => {const deviceId=url.searchParams.get('deviceId');try{if(options.observer&&sharing.attach(ws,deviceId))return;start(ws,deviceId,options);}catch(error){ws.send(JSON.stringify({type:'error',message:error.message}));ws.close(1013,'Viewer unavailable');}});
  });
  async function start(ws, deviceId, options) {
    let serial, forwardPort, child, video, audio, control, remote, shared, sessionTimer,appRequestBusy=false,closed = false, owns = false, log = '',audioEnabled=false,restoreRows=[];
    let finishPreparing,markChildClosed;const preparingDone=new Promise(resolve=>{finishPreparing=resolve;}),childClosed=new Promise(resolve=>{markChildClosed=resolve;});
    const ownerKey=options.sessionId?`${deviceId}:virtual:${options.sessionId}`:deviceId;
    const activeKey=options.sessionId?ownerKey:`${deviceId}:${options.observer?'observer':'control'}`;
    const diagnostic={id:randomBytes(8).toString('hex'),deviceId,sessionId:options.sessionId||null,newDisplay:options.newDisplay||null,startedAt:new Date().toISOString(),state:'preparing',readOnly:!!options.observer,codec:options.controlOnly||options.audioOnly?'none':options.codec||'h264',source:options.controlOnly?'control-only':options.source||'display',verbosity:options.verbosity||'warn',log:''};sessionLogs.set(diagnostic.id,diagnostic);for(const row of sessionLogs.values()){if(sessionLogs.size<=20)break;if(row.endedAt)sessionLogs.delete(row.id);}
    const size = { width: 0, height: 0 }, pressedKeys = new Set(),hidState=createHidState();
    const send = message => {shared?.metadata(message); if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message)); };
    const requestApp=async(packageName,userId,forceStop=false)=>{if(appRequestBusy)throw new Error('앱 실행 대상을 확인하고 있습니다.');if(!/^\d{1,5}$/.test(String(userId??'')))throw new Error('현재 사용자 앱을 목록에서 다시 선택하세요.');const packet=encodeControl({type:'start-app',package:packageName,forceStop},size);appRequestBusy=true;try{const current=await run(serial,['shell','am','get-current-user']);if(closed||!control||control.destroyed)return;if(String(Number(userId))!==current.trim())throw new Error('폰의 현재 사용자와 선택한 앱의 사용자가 다릅니다. 현재 사용자 앱을 다시 선택하세요.');control.write(packet);send({type:'control-status',message:forceStop?'현재 사용자에서 선택 앱의 강제 종료 후 시작을 요청했습니다.':'현재 사용자에서 선택 앱의 실행을 요청했습니다.'});}finally{appRequestBusy=false;}};
    const recording=media.createSession({deviceId,send,source:options});
    const fail = message => {diagnostic.state='error';diagnostic.message=message; send({ type: 'error', message }); ws.close(1011, 'Mirror stopped'); cleanup(); };
    const cleanup = () => {
      if (closed) return; closed = true;
      clearTimeout(sessionTimer);diagnostic.endedAt=new Date().toISOString();if(diagnostic.state!=='error')diagnostic.state='closed';
      clearInterval(heartbeat); video?.destroy(); audio?.destroy();
      recording.close().catch(()=>{});
      shared?.close();
      if(control&&!control.destroyed){for(const point of pressedPointers.values())control.write(encodeControl({...point,action:1,width:size.width,height:size.height,x:Math.min(size.width-1,point.x),y:Math.min(size.height-1,point.y)},size));for(const keycode of pressedKeys)control.write(encodeControl({type:'key-event',action:1,keycode},size));for(const packet of releaseHidControl(hidState))control.write(packet);control.end();}pressedKeys.clear();pressedPointers.clear();
      if(!owns)return;
      // Keep the device reserved until the official helper has restored changed settings.
      // In particular, do not unlink its JAR while a fast stop/reconnect is starting it.
      const previous=cleaning.get(ownerKey),pending=(async()=>{
        if(previous)await previous;
        await preparingDone;
        const finish=async()=>{
          control?.destroy();
          try{if(child&&restoreRows.length){restorePending.set(ownerKey,{serial,rows:restoreRows});await confirmSessionRestored(restoreRows,(table,key)=>readSetting(serial,table,key));restorePending.delete(ownerKey);}}
          catch(error){diagnostic.state='cleanup-error';diagnostic.message=error.message;}
          finally{if(forwardPort&&serial)await run(serial,['forward','--remove',`tcp:${forwardPort}`]).catch(()=>{});if(remote&&serial&&!child)await run(serial,['shell','rm','-f',remote]).catch(()=>{});if(active.get(activeKey)===ws)active.delete(activeKey);}
        };
        try{await finishMirrorProcess(child,childClosed,transport.cleanupTiming);}
        catch(error){
          diagnostic.state='cleanup-error';diagnostic.message=error.message;
          // A slow child may exit after the grace/kill timeout. Retain its reservation
          // until that event, then finish cleanup instead of permanently blocking it.
          const late=childClosed.then(finish);late.blocked=error.message;cleaning.set(ownerKey,late);
          void late.finally(()=>{if(cleaning.get(ownerKey)===late)cleaning.delete(ownerKey);});return;
        }
        await finish();
      })();cleaning.set(ownerKey,pending);void pending.finally(()=>{if(cleaning.get(ownerKey)===pending)cleaning.delete(ownerKey);});
    };
    let alive = true;
    const heartbeat = setInterval(() => { if (!alive) { ws.terminate(); cleanup(); return; } alive = false; if (ws.readyState === WebSocket.OPEN) ws.ping(); }, 15000);
    heartbeat.unref(); ws.on('pong', () => { alive = true; }); ws.on('close', cleanup); ws.on('error', cleanup);
    let windowAt = Date.now(), events = 0, mediaEvents=0, inputLagWarned=false,clipboardRequestedUntil = 0;
    const pressedPointers = new Map();
    ws.on('message', (data, binary) => {
      if (closed || binary) return;
      if (Date.now() - windowAt > 1000) { windowAt = Date.now(); events = 0;mediaEvents=0;inputLagWarned=false; }
      let message;
      try {
        message = JSON.parse(data.toString());
        if(!message||typeof message!=='object'||typeof message.type!=='string')throw new Error('잘못된 조작 메시지입니다.');
        if(options.observer)throw new Error('비교 뷰어는 화면 보기만 가능합니다.');if(options.sessionId&&(message.type==='start-app'&&message.forceStop||['display-power','notifications','settings','power','rotate'].includes(message.type)||['key','key-event'].includes(message.type)&&[24,25,26,164,224].includes(message.keycode)))throw new Error('이 작업은 폰 전체에 영향을 줄 수 있어 독립 가상 화면에서 실행하지 않습니다.');
        if(['media-start','media-stop','media-cancel'].includes(message.type)){
          if(options.controlOnly){send({type:'media-recording',state:'error',message:'영상·소리 없는 조작 전용 세션은 녹화할 수 없습니다.'});return;}
          if(message.type==='media-start'&&++mediaEvents>4){send({type:'media-recording',state:'error',message:'녹화 시작 요청이 너무 많습니다. 잠시 후 다시 시도하세요.'});return;}
          const result=message.type==='media-start'?recording.start({format:message.format,maxMinutes:message.maxMinutes,maxMB:message.maxMB,audioOnly:!!options.audioOnly}):message.type==='media-stop'?recording.stop():recording.cancel();
          Promise.resolve(result).then(value=>{if(message.type==='media-start'&&value?.state==='waiting'&&control&&!closed)control.write(encodeControl({type:'reset-video'},size));}).catch(error=>send({type:'media-recording',state:'error',message:error.message}));return;
        }
        if(!control)return;
        if(message.type==='start-app'){if(options.source==='camera')throw new Error('카메라 세션에서는 앱을 실행하지 않습니다.');void requestApp(message.package,message.userId,message.forceStop??false).catch(error=>send({type:'control-error',message:error.message}));return;}
        const release = (message.type === 'touch' && [1, 3].includes(message.action) && pressedPointers.has(message.pointerId ?? 0)) || (message.type === 'key-event' && message.action===1 && pressedKeys.has(message.keycode)) || isHidRelease(message);
        // Never leave an accepted touch pressed merely because its final UP crosses the move budget.
        if (++events > 512 && !release) return;
        if(control.writableLength>512*1024&&!release){if(!inputLagWarned){inputLagWarned=true;send({type:'control-error',message:'폰 조작 처리가 지연되어 새 입력을 줄이고 있습니다.'});}return;}
        if(message.type==='resize-display'&&!options.newDisplay)throw new Error('가상 화면 세션에서만 크기를 변경할 수 있습니다.');
        if(message.type.startsWith('camera-')&&options.source!=='camera')throw new Error('카메라 세션에서만 사용할 수 있습니다.');
        if(options.source==='camera'&&(['touch','scroll','key','key-event','paste','start-app','rotate'].includes(message.type)||message.type.startsWith('hid-')))throw new Error('카메라 영상에서는 폰 화면 입력을 보내지 않습니다.');
        const packet = encodeControl(message, size,hidState);
        if (message.type === 'get-clipboard') { if (clipboardRequestedUntil > Date.now()) return; clipboardRequestedUntil = Date.now() + 10000; }
        if (message.type === 'touch') {
          const id=message.pointerId??0;
          if(message.action!==0&&!pressedPointers.has(id))return;
          if(message.action===0&&pressedPointers.has(id))throw new Error('이미 눌린 터치입니다. 손을 뗀 뒤 다시 시도하세요.');
          if([0,2].includes(message.action))pressedPointers.set(id,{...message,pointerId:id});else pressedPointers.delete(id);
        }
        if(message.type==='key-event'){if(message.action===0)pressedKeys.add(message.keycode);else pressedKeys.delete(message.keycode);}
        control.write(packet);
      }
      catch (error) { send({ type: typeof message?.type==='string'&&message.type.startsWith('hid-')?'hid-error':'control-error', message: error.message }); }
    });
    try {
      // A reconnect handshake may beat the old WebSocket's close frame by one turn.
      const existing=active.get(activeKey);if(existing&&!cleaning.has(ownerKey))await new Promise(resolve=>{let timer;const done=()=>{clearTimeout(timer);existing.off('close',done);resolve();};existing.once('close',done);timer=setTimeout(done,120);});
      while(cleaning.has(ownerKey)){const pending=cleaning.get(ownerKey);if(pending.blocked)throw new Error(pending.blocked);send({type:'status',message:'이전 화면 연결의 종료·설정 복원을 기다리고 있습니다…'});await pending;}
      if(closed)return;
      if(restorePending.has(ownerKey)){const previous=restorePending.get(ownerKey);await confirmSessionRestored(previous.rows,(table,key)=>readSetting(previous.serial,table,key));restorePending.delete(ownerKey);}
      if(closed)return;
      if (active.has(activeKey)) throw new Error('이 기기의 조작 화면이 다른 탭에서 열려 있습니다. 비교 보기에서는 화면을 함께 볼 수 있습니다.');
      if (active.size >= 4) throw new Error('동시에 볼 수 있는 화면은 최대 4개입니다.');
      active.set(activeKey, ws); owns = true;if(!options.controlOnly&&!options.audioOnly)shared=sharing.register({key:activeKey,deviceId,options,requestKeyFrame:()=>{if(control&&!closed)control.write(encodeControl({type:'reset-video'},size));}});
      const resolved=await deviceControl.resolve(deviceId);serial=resolved.serial;
      if(closed)return;
      restoreRows=options.sessionId?[]:await snapshotSessionSettings(options,(table,key)=>readSetting(serial,table,key),()=>run(serial,['shell','am','get-current-user']));
      const android=Number.parseInt(resolved.device?.android,10);if(options.source==='camera'&&android<12)throw new Error('카메라 전송은 Android 12 이상이 필요합니다.');if(options.newDisplay&&android<10)throw new Error('가상 화면은 Android 10 이상이 필요합니다.');
      const audioArgs=audioServerArgs(options,android);
      const channelPlan=mirrorChannelPlan(options);
      send({type:'session-options',options});
      if(options.observer)send({type:'viewer-state',readOnly:true,shared:false,deviceId,source:'display'});
      audioEnabled=!!options.audio;
      if (closed) return;
      send({ type: 'status', message: '폰의 화면 전송을 준비하고 있습니다…' });
      const scid = (randomBytes(4).readUInt32BE() & 0x7fffffff).toString(16).padStart(8, '0');
      remote = `/data/local/tmp/adb-desk-${scid}.jar`;
      await run(serial, ['push', path.join(root, 'vendor', `scrcpy-server-v${VERSION}`), remote]);
      if (closed) { await run(serial, ['shell', 'rm', '-f', remote]); return; }
      forwardPort = Number(await run(serial, ['forward', 'tcp:0', `localabstract:scrcpy_${scid}`]));
      if (!Number.isInteger(forwardPort) || forwardPort <= 0) throw new Error('ADB 영상 터널을 열지 못했습니다.');
      if (closed) { await run(serial, ['forward', '--remove', `tcp:${forwardPort}`]); await run(serial, ['shell', 'rm', '-f', remote]); return; }
      const serverArgs=[`scid=${scid}`, `log_level=${options.verbosity||'warn'}`, ...audioArgs, `video=${channelPlan.includes('video')}`, `control=${channelPlan.includes('control')}`, 'tunnel_forward=true', 'send_device_meta=false', 'send_stream_meta=true','send_frame_meta=true',...(!options.controlOnly?videoServerArgs(options):[...(options.display!==undefined?[`display_id=${options.display}`]:[]),...(options.keepActive?['keep_active=true']:[])]),'clipboard_autosync=false','power_on=false','stay_awake=false','cleanup=true',...sessionServerArgs(options)];
      child = spawnAdb(adbPath, ['-s', serial, 'shell',scrcpyServerCommand(remote,serverArgs)], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let hidLogTail='';const serverLog=data=>{const text=data.toString();log=(log+text).slice(-1500);diagnostic.log=Buffer.from(diagnostic.log+text).subarray(-65536).toString('utf8');const lines=(hidLogTail+text).split(/\r?\n/);hidLogTail=(lines.pop()||'').slice(-2048);for(const line of lines)if(/uhid/i.test(line)&&/fail|error|could not|cannot|denied/i.test(line))send({type:'hid-error',message:'기기 UHID 입력 오류: '+line.slice(-700)});};
      child.stdout.on('data', serverLog);child.stderr.on('data', serverLog);
      child.on('error', () => {markChildClosed();fail('화면 전송 프로세스를 시작하지 못했습니다.');});
      child.on('close', () => {markChildClosed();if (!closed) fail('화면 전송이 종료되었습니다. ' + log.slice(-300));});
      const first=await firstSocket(forwardPort,()=>closed,connectSocket);
      if (closed) { first.destroy(); return; }
      diagnostic.state='connected';if(options.limitSeconds){sessionTimer=setTimeout(()=>{diagnostic.message='선택한 최대 연결 시간이 끝났습니다.';send({type:'status',message:diagnostic.message});ws.close(1000,'Session time limit');cleanup();},options.limitSeconds*1000);sessionTimer.unref();}
      if(channelPlan[0]==='audio')audio=first;else if(channelPlan[0]==='control')control=first;else video=first;
      if(audioEnabled){
        if(!audio)audio=connectSocket({host:'127.0.0.1',port:forwardPort});
        const audioFailure=message=>{if(closed)return;send({type:'audio-error',message});if(options.audioOnly||options.requireAudio)fail(message);};
        const parser=new EncodedAudioParser(packet=>{recording.onAudio(packet);if(!closed&&ws.readyState===WebSocket.OPEN&&ws.bufferedAmount<2*1024*1024)ws.send(Buffer.concat([Buffer.from([1]),packet]),{binary:true});},format=>{recording.setAudioFormat(format);send({type:'audio-format',...format});},audioFailure);
        audio.on('data',chunk=>{try{parser.push(chunk);}catch(error){audioFailure(error.message);audio.destroy();}});
        audio.on('error',()=>audioFailure('소리 전송 연결이 끊어졌습니다.'));audio.on('close',()=>{if(!closed&&(options.audioOnly||options.requireAudio))fail('소리 전송이 종료되었습니다.');});
        if(options.audioOnly){audio.on('close',()=>{if(!closed)fail('소리 전송이 종료되었습니다.');});audio.resume();return;}
        await new Promise((resolve,reject)=>{audio.once('connect',resolve);audio.once('error',reject);audio.once('close',()=>reject(new Error('소리 전송이 종료되었습니다.')));});if(closed){audio.destroy();return;}
      }
      if(channelPlan.includes('control')){
      if(!control)control = connectSocket({ host: '127.0.0.1', port: forwardPort });
      const controlReady=()=>{if(closed)return;send({type:'control-ready'});if(options.startScreenOff)control.write(encodeControl({type:'display-power',on:false},size));if(options.startApp&&options.source!=='camera')void requestApp(options.startApp,options.startAppUser,options.startForceStop??false).catch(error=>send({type:'control-error',message:error.message}));};
      if(options.controlOnly)controlReady();else control.once('connect',controlReady);
      const replies = new DeviceMessageParser(message => {
        if (message.type === 'clipboard' && clipboardRequestedUntil >= Date.now()) { clipboardRequestedUntil = 0; send(message); }
        else if(message.type==='uhid-output')send({type:'uhid-output',id:message.id,data:[...message.data]});
      });
      control.on('data', data => { try { replies.push(data); } catch (error) { fail(error.message); } }); control.on('error', () => fail('조작 연결이 끊어졌습니다.')); control.on('close', () => { if (!closed) fail('폰의 조작 연결이 종료되었습니다.'); });
      if(options.controlOnly){control.resume();return;}
      }
      const parser = new VideoParser(message => {
        if (closed || ws.readyState !== WebSocket.OPEN) return;
        if (Buffer.isBuffer(message)) {
          recording.onVideo(message);
          shared?.packet(message);
          if(options.preview===false)return;
          if (ws.bufferedAmount > 4 * 1024 * 1024) { fail('브라우저의 영상 처리가 지연되었습니다. 화면 보기를 다시 시작하세요.'); return; }
          ws.send(options.channels?Buffer.concat([Buffer.from([0]),message]):message, { binary: true });
        } else { size.width = message.width; size.height = message.height;recording.setVideoFormat({width:message.width,height:message.height}); send(message); }
      },codec=>{recording.setVideoFormat({codec});send({type:'video-codec',codec});});
      video.on('data', data => { try { parser.push(data); } catch (error) { fail(error.message); } });
      video.on('error', () => fail('화면 연결이 끊어졌습니다.')); video.on('close', () => { if (!closed) fail('폰의 화면 연결이 종료되었습니다.'); });
      video.resume();
    } catch (error) { if (!closed) fail(error.message || '화면을 시작하지 못했습니다.'); }
    finally{finishPreparing();}
  }
  server.on('close', () => { for (const ws of active.values()) ws.close();sharing.close();wss.close();media.close().catch(()=>{}); });
  return { media, diagnostics:{list(deviceId){return{items:[...sessionLogs.values()].filter(row=>row.deviceId===deviceId).reverse(),sources:sharing.snapshot().filter(row=>row.deviceId===deviceId)};}},close: () => { for (const ws of active.values()) ws.close();sharing.close();media.close().catch(()=>{}); } };
}
