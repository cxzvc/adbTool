import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Duplex, PassThrough } from 'node:stream';
import http from 'node:http';
import { WebSocket } from 'ws';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { normalizeVideoCodecOptions, normalizeAudioCodecOptions, normalizeCameraAspectRatio, normalizeSessionOptions, sessionServerArgs, scrcpyServerCommand, mirrorChannelPlan } from '../lib/mirror-session-options.mjs';
import { mirrorOptions, attachMirroring, encodeControl } from '../lib/mirror.mjs';
import { snapshotSessionSettings, confirmSessionRestored, finishMirrorProcess } from '../lib/mirror-cleanup.mjs';

function parseOfficialOptionStrings(text){let escape=false,buf='',rows=[];for(const c of text){if(c==='\\'){if(escape){buf+='\\';escape=false;}else escape=true;}else if(c===','){if(escape){buf+=c;escape=false;}else{rows.push(buf);buf='';}}else buf+=c;}if(buf)rows.push(buf);return rows.map(row=>{const at=row.indexOf('='),prefix=row.slice(0,at).split(':');return{key:prefix[0],type:prefix[1]||'int',value:row.slice(at+1)};});}
function splitQuoted(command){const tokens=[];let value='',quote=false,used=false;for(let i=0;i<command.length;i++){const c=command[i];if(c==="'"){quote=!quote;used=true;}else if(c==='\\'&&!quote){value+=command[++i];used=true;}else if(/\s/.test(c)&&!quote){if(used){tokens.push(value);value='';used=false;}}else{value+=c;used=true;}}assert.equal(quote,false);if(used)tokens.push(value);return tokens;}
test('typed codec options retain exact long values and escaped strings through official grammar',()=>{
  const rows=[{key:'i-frame-interval',type:'float',value:'0.5'},{key:'vendor.long',type:'long',value:'9223372036854775807'},{key:'vendor.text',type:'string',value:"a,b\\c ' ; $(echo not-executed)"}];
  const parsed=normalizeVideoCodecOptions(rows);assert.deepEqual(parseOfficialOptionStrings(parsed.serialized),rows);
  const command=scrcpyServerCommand('/data/local/tmp/adb-desk-1234abcd.jar',[`video_codec_options=${parsed.serialized}`,'cleanup=true']),words=splitQuoted(command);
  assert.deepEqual(words,['CLASSPATH=/data/local/tmp/adb-desk-1234abcd.jar','app_process','/','com.genymobile.scrcpy.Server','5.0.1',`video_codec_options=${parsed.serialized}`,'cleanup=true']);
});
test('invalid type ranges, reserved geometry keys, duplicates and oversized codec data are rejected',()=>{
  for(const row of [{key:'a',type:'bool',value:'1'},{key:'width',type:'int',value:'1200'},{key:'a;echo',type:'int',value:'1'},{key:'a',type:'int',value:'2147483648'},{key:'a',type:'long',value:'9223372036854775808'},{key:'a',type:'long',value:9223372036854775807},{key:'a',type:'float',value:'Infinity'},{key:'a',type:'float',value:'1e99'},{key:'a',type:'float',value:'1e-99'},{key:'a',type:'string',value:'a\nb'}])assert.throws(()=>normalizeVideoCodecOptions([row]));
  assert.throws(()=>normalizeVideoCodecOptions([{key:'a',type:'int',value:'1'},{key:'a',type:'int',value:'2'}]));assert.throws(()=>normalizeVideoCodecOptions(Array.from({length:17},(_,i)=>({key:'k'+i,type:'int',value:'1'}))));assert.throws(()=>normalizeVideoCodecOptions(Array.from({length:5},(_,i)=>({key:'k'+i,type:'string',value:'a'.repeat(500)}))));
});
test('advanced options default to no changes and official restoration flags use milliseconds',()=>{
  assert.deepEqual(normalizeSessionOptions(new URLSearchParams(),{}),{});assert.deepEqual(sessionServerArgs({}),[]);
  const options=normalizeSessionOptions(new URLSearchParams('captureAngle=23.5&downsize=off&sessionShowTouches=1&sessionStayAwake=1&sessionScreenTimeout=300&sessionPowerOn=1&sessionScreenOff=1&sessionPowerOffOnClose=1&startForceStop=1'),{startApp:'com.example'});
  const args=sessionServerArgs(options);for(const value of ['angle=23.5','downsize_on_error=false','show_touches=true','stay_awake=true','screen_off_timeout=300000','power_on=true','power_off_on_close=true'])assert.ok(args.includes(value));assert.equal(options.startScreenOff,true);assert.equal(options.startForceStop,true);
  assert.throws(()=>normalizeSessionOptions(new URLSearchParams('captureAngle=NaN')));assert.throws(()=>normalizeSessionOptions(new URLSearchParams('sessionScreenTimeout=0')));assert.throws(()=>normalizeSessionOptions(new URLSearchParams('startForceStop=1')));
});
test('channel plans isolate video, audio-only, observer and control-only modes',()=>{
  assert.deepEqual(mirrorChannelPlan({audio:true}),['video','audio','control']);assert.deepEqual(mirrorChannelPlan({audioOnly:true,audio:true}),['audio']);assert.deepEqual(mirrorChannelPlan({observer:true}),['video']);
  const control=mirrorOptions(new URLSearchParams('controlOnly=1&audio=1&channels=1'));assert.equal(control.audio,false);assert.equal(control.audioOnly,false);assert.deepEqual(mirrorChannelPlan(control),['control']);
  for(const query of ['controlOnly=1&newDisplay=1','controlOnly=1&source=camera','controlOnly=1&audioOnly=1'])assert.throws(()=>mirrorOptions(new URLSearchParams(query)));
  const observer=mirrorOptions(new URLSearchParams('observer=1&controlOnly=1&sessionShowTouches=1'));assert.equal(observer.controlOnly,undefined);assert.equal(observer.showTouches,undefined);
});
test('alignment, camera ratio and encoder constraints use official arguments with bounded inputs',()=>{
  const options=mirrorOptions(new URLSearchParams('source=camera&cameraAr=16:9&minSizeAlignment=8&ignoreVideoEncoderConstraints=1'));const args=sessionServerArgs(options);for(const arg of ['camera_ar=16:9','min_size_alignment=8','ignore_video_encoder_constraints=true'])assert.ok(args.includes(arg));
  for(const ar of ['sensor','4:3','1.6','.01']){if(ar==='.01')assert.throws(()=>normalizeCameraAspectRatio(ar));else assert.equal(normalizeCameraAspectRatio(ar),ar);}
  for(const ar of ['0','-1','1:0','16:9:1','NaN','1000','2;reboot'])assert.throws(()=>normalizeCameraAspectRatio(ar));
  for(const query of ['minSizeAlignment=3','minSizeAlignment=32','cameraAr=4:3','source=camera&cameraSize=640x480&cameraAr=sensor'])assert.throws(()=>mirrorOptions(new URLSearchParams(query)));
  assert.deepEqual(normalizeSessionOptions(new URLSearchParams('minSizeAlignment=8&ignoreVideoEncoderConstraints=1'),{audioOnly:true}),{});
});
test('audio codec options share typed escaping and reject every transport-contract override',()=>{
  const rows=[{key:'complexity',type:'int',value:'5'},{key:'vendor.custom',type:'string',value:'a,b\\c'}],p=new URLSearchParams({audio:'1',audioCodec:'opus',audioCodecOptions:JSON.stringify(rows)}),options=mirrorOptions(p);
  assert.deepEqual(parseOfficialOptionStrings(options.audioCodecOptions),rows);assert.ok(sessionServerArgs(options).includes('audio_codec_options='+options.audioCodecOptions));
  for(const key of ['mime','bitrate','sample-rate','channel-count','channel-mask','pcm-encoding','aac-profile','profile','csd-0','bit-depth','encoder-delay'])assert.throws(()=>normalizeAudioCodecOptions([{key,type:'int',value:'2'}]),key);
  for(const audioCodec of ['raw',''])assert.throws(()=>mirrorOptions(new URLSearchParams({audio:'1',audioCodec,audioCodecOptions:JSON.stringify(rows)})),/압축 코덱/);
  assert.throws(()=>mirrorOptions(new URLSearchParams({audioCodec:'opus',audioCodecOptions:JSON.stringify(rows)})),/소리 전달/);
});
test('the UI exposes every official rotation/flip lock combination accepted by the backend',async()=>{const source=await readFile(new URL('../public/mirror-options-ui.js',import.meta.url),'utf8');for(const value of ['90','180','270','flip0','flip90','flip180','flip270','@','@0','@90','@180','@270','@flip0','@flip90','@flip180','@flip270']){assert.equal(mirrorOptions(new URLSearchParams({orientation:value})).orientation,value);assert.ok(source.includes("['"+value+"',"),value);}});
test('force-stop startup is a bounded plus-prefixed official START_APP name',()=>{
  const bytes=encodeControl({type:'start-app',package:'com.example',forceStop:true},{});assert.equal(bytes[0],16);assert.equal(bytes[1],12);assert.equal(bytes.subarray(2).toString(),'+com.example');
  assert.throws(()=>encodeControl({type:'start-app',package:'com.example',forceStop:'true'},{}));assert.throws(()=>encodeControl({type:'start-app',package:'x'.repeat(255),forceStop:true},{}));
});
test('advanced UI has no automatic actions and validates rows before connection',async()=>{let commands=0;const context={TextEncoder,URLSearchParams,window:{},document:{getElementById:()=>null}};vm.runInNewContext(await readFile(new URL('../public/mirror-session-options.js',import.meta.url),'utf8'),context);const ui=context.window.MirrorSessionOptions;ui.configure({restart:()=>commands++});assert.equal(ui.params().size,0);assert.equal(ui.controlOnly(),false);assert.equal(ui.forceStopBeforeStart(),false);assert.throws(()=>ui.validateRows([{key:'width',type:'int',value:'1200'}]));assert.equal(commands,0);});
test('control-only enables logical key/paste actions but keeps coordinate, reset, capture and recording disabled',async()=>{const text=await readFile(new URL('../public/device.js',import.meta.url),'utf8'),start=text.indexOf('  function controlEnabled(on)'),end=text.indexOf('  function stopMirror(',start),elements=new Map(),key={},paste={},reset={},scroll={};const context={window:{},s:{controlReady:true,viewOnly:false,mirrorOptions:{controlOnly:true}},document:{querySelectorAll:selector=>selector.includes('data-phone-scroll')?[scroll]:selector.includes('="reset-video"')?[reset]:[key,paste,reset]},$:id=>{if(!elements.has(id))elements.set(id,{});return elements.get(id);}};vm.runInNewContext(text.slice(start,end)+'\nthis.update=controlEnabled;',context);context.update(false);assert.equal(key.disabled,false);assert.equal(paste.disabled,false);for(const item of [reset,scroll,elements.get('screen-capture'),elements.get('screen-record')])assert.equal(item.disabled,true);context.s.viewOnly=true;context.update(false);assert.equal(key.disabled,true);assert.equal(paste.disabled,true);context.s.viewOnly=false;context.window.MirrorView={inputBlocked:true};context.update(false);assert.equal(key.disabled,true);});
test('control-only focus pad is a local illustration and never executes a phone operation',async()=>{let commands=0,fit=0;const written=[],canvas={hidden:true,setAttribute(){},getContext:()=>({fillRect(){},fillText:text=>written.push(text)})};const context={TextEncoder,URLSearchParams,window:{},document:{getElementById:()=>null}};vm.runInNewContext(await readFile(new URL('../public/mirror-session-options.js',import.meta.url),'utf8'),context);context.window.MirrorSessionOptions.configure({canvas,restart:()=>commands++,fit:()=>fit++});context.window.MirrorSessionOptions.showControlPad();assert.equal(canvas.hidden,false);assert.equal(canvas.width,640);assert.equal(canvas.height,420);assert.equal(fit,1);assert.equal(commands,0);assert.ok(written.some(text=>text.includes('영상 없이')));});

async function fixture(t,{currentUser='0',settings={},onSpawn=()=>{},cleanupTiming}={}){
  const calls=[],spawns=[],sockets=[],ports=new Map();let portSequence=20000;
  const server=http.createServer();const transport={cleanupTiming,
    async execute(_binary,args){calls.push(args);if(args[2]==='forward'&&args[3]==='tcp:0')return{stdout:String(++portSequence)};if(args.includes('get-current-user'))return{stdout:currentUser};if(args.includes('settings'))return{stdout:settings[args.at(-1)]??'null'};return{stdout:''};},
    spawn(_binary,args){const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{child.killed=true;child.stdout.destroy();child.stderr.destroy();queueMicrotask(()=>child.emit('close',0));};spawns.push({args,child});onSpawn({args,child},spawns.length);return child;},
    connect({port}){const socket=new Duplex({read(){},write(chunk,_encoding,callback){socket.writes.push(Buffer.from(chunk));callback();}});socket.writes=[];socket.setTimeout=()=>socket;sockets.push(socket);const index=(ports.get(port)||0)+1;ports.set(port,index);queueMicrotask(()=>{socket.emit('connect');if(index===1)socket.push(Buffer.from([0]));});return socket;},
  };
  attachMirroring({server,root:fileURLToPath(new URL('..',import.meta.url)),adbPath:'NEVER-RUN-ADB',deviceControl:{resolve:async()=>({serial:'mock-phone',device:{android:'16'}})},csrfToken:'mirror-unit-token',access:{allowedHosts:port=>[`127.0.0.1:${port}`],authorized:()=>true},transport});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const clients=[];t.after(async()=>{for(const c of clients)c.terminate();for(const s of sockets)s.destroy();for(const {child}of spawns)child.kill();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  async function connect(query){const c=new WebSocket(`ws://127.0.0.1:${server.address().port}/api/mirror?deviceId=phone&${query}`,['adb-desk','mirror-unit-token'],{headers:{Origin:`http://127.0.0.1:${server.address().port}`}});c.messages=[];c.on('message',data=>{try{c.messages.push(JSON.parse(data));}catch{}});clients.push(c);await new Promise((resolve,reject)=>{c.once('open',resolve);c.once('error',reject);});return c;}
  function wait(c,predicate){const exists=c.messages.find(predicate);if(exists)return Promise.resolve(exists);return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{c.off('message',handler);reject(new Error('Mock WebSocket response timeout'));},5000);const handler=data=>{let value;try{value=JSON.parse(data);}catch{return;}if(predicate(value)){clearTimeout(timeout);c.off('message',handler);resolve(value);}};c.on('message',handler);});}
  return{calls,spawns,sockets,connect,wait};
}
test('control-only real WS flow opens only a control channel and permits keys without video dimensions',async t=>{
  const f=await fixture(t),client=await f.connect('controlOnly=1&keepActive=1');await f.wait(client,m=>m.type==='control-ready');assert.equal(f.sockets.length,1);assert.equal(f.spawns.length,1);
  const command=f.spawns[0].args[3];assert.match(command,/'video=false'/);assert.match(command,/'audio=false'/);assert.match(command,/'control=true'/);assert.match(command,/'keep_active=true'/);assert.ok(!client.messages.some(m=>m.type==='dimensions'));
  client.send(JSON.stringify({type:'key-event',action:0,keycode:61,metaState:1}));client.send(JSON.stringify({type:'get-clipboard'}));await new Promise(resolve=>setTimeout(resolve,20));assert.ok(f.sockets[0].writes.some(b=>b.length===14&&b.readUInt32BE(2)===61&&b.readUInt32BE(10)===1));
  client.send(JSON.stringify({type:'media-start',format:'mkv'}));const error=await f.wait(client,m=>m.type==='media-recording'&&m.state==='error');assert.match(error.message,/조작 전용/);
});
test('restorable setting snapshots are user-scoped, finite and read-only',async()=>{
  const calls=[],read=async(table,key)=>{calls.push([table,key]);return{show_touches:'0',stay_on_while_plugged_in:'3',screen_off_timeout:'30000'}[key];};
  const rows=await snapshotSessionSettings({showTouches:true,stayAwake:true,screenOffTimeoutMs:60000},read,async()=>'0');assert.deepEqual(rows.map(r=>r.value),['0','3','30000']);assert.equal(calls.length,3);
  await assert.rejects(snapshotSessionSettings({showTouches:true},read,async()=>'10'),/기본 사용자 0/);assert.equal(calls.length,3);
  await assert.rejects(snapshotSessionSettings({stayAwake:true},async()=>'null',async()=>'0'),/기존 설정값/);
  assert.deepEqual(await snapshotSessionSettings({showTouches:true,stayAwake:true},async(table,key)=>key==='show_touches'?'1':'7',async()=>'0'),[]);
});
test('restoration waits for all original values and reports failed or unreadable settings',async()=>{
  const rows=[{table:'system',key:'show_touches',value:'0',label:'터치 표시'}];let time=0,reads=0;
  await confirmSessionRestored(rows,async()=>++reads>=3?'0':'1',{timeoutMs:100,intervalMs:10,now:()=>time,delay:async ms=>{time+=ms;}});assert.equal(reads,3);
  time=0;await assert.rejects(confirmSessionRestored(rows,async()=>{throw new Error('offline');},{timeoutMs:20,intervalMs:10,now:()=>time,delay:async ms=>{time+=ms;}}),/설정 복원/);
});
test('process cleanup waits for a natural exit and only kills after its grace period',async()=>{
  let killed=0,finish;const child={kill:()=>{killed++;finish();}},closed=new Promise(resolve=>{finish=resolve;});const wait=finishMirrorProcess(child,closed,{graceMs:50,killWaitMs:20});assert.equal(killed,0);finish();await wait;assert.equal(killed,0);
  const forced=new Promise(resolve=>{finish=resolve;});await finishMirrorProcess(child,forced,{graceMs:5,killWaitMs:20});assert.equal(killed,1);
  await assert.rejects(finishMirrorProcess({kill(){}},new Promise(()=>{}),{graceMs:1,killWaitMs:1}),/아직 종료되지/);
});
test('a reconnect waits for old process exit and setting restoration before starting a new server',async t=>{
  const settings={show_touches:'0'};const f=await fixture(t,{settings,onSpawn:(_child,index)=>{if(index===1)settings.show_touches='1';}}),first=await f.connect('controlOnly=1&sessionShowTouches=1');await f.wait(first,m=>m.type==='control-ready');
  first.close();const second=await f.connect('controlOnly=1&sessionShowTouches=1');await f.wait(second,m=>m.type==='status'&&m.message.includes('복원'));assert.equal(f.spawns.length,1);assert.equal(f.calls.some(args=>args.includes('rm')),false);
  f.spawns[0].child.emit('close',0);await new Promise(resolve=>setTimeout(resolve,40));assert.equal(f.spawns.length,1);assert.equal(f.calls.some(args=>args.includes('rm')),false);
  settings.show_touches='0';await f.wait(second,m=>m.type==='control-ready');assert.equal(f.spawns.length,2);assert.equal(f.spawns[0].child.killed,undefined);assert.ok(f.calls.some(args=>args.includes('--remove')));assert.ok(!f.calls.some(args=>args.includes('rm')),'the official helper must unlink its own JAR after loading');assert.ok(f.calls.filter(args=>args.includes('settings')).every(args=>args.includes('get')&&!args.includes('put')&&args[5]==='0'));
});
test('system session changes refuse a non-owner current user before pushing or spawning',async t=>{
  const f=await fixture(t,{currentUser:'10'}),client=await f.connect('controlOnly=1&sessionShowTouches=1');const error=await f.wait(client,m=>m.type==='error');assert.match(error.message,/기본 사용자 0/);assert.equal(f.spawns.length,0);assert.ok(!f.calls.some(args=>args.includes('push')));
});
test('late process exit after cleanup timeout releases the device reservation and tunnel',async t=>{
  const f=await fixture(t,{cleanupTiming:{graceMs:5,killWaitMs:5},onSpawn:({child},index)=>{if(index===1)child.kill=()=>{child.killed=true;};}}),first=await f.connect('controlOnly=1');await f.wait(first,m=>m.type==='control-ready');first.close();await new Promise(resolve=>setTimeout(resolve,40));
  const blocked=await f.connect('controlOnly=1');const error=await f.wait(blocked,m=>m.type==='error');assert.match(error.message,/이전 화면 서버가 아직 종료/);assert.equal(f.spawns.length,1);
  f.spawns[0].child.emit('close',0);await new Promise(resolve=>setTimeout(resolve,20));const next=await f.connect('controlOnly=1');await f.wait(next,m=>m.type==='control-ready');assert.equal(f.spawns.length,2);assert.ok(f.calls.some(args=>args.includes('--remove')));
});
for(const required of [false,true])test(`phone audio capture failure ${required?'stops the whole session when required':'keeps video by default'}`,async t=>{
  const f=await fixture(t),client=await f.connect('audio=1&channels=1'+(required?'&audioRequired=1':''));await f.wait(client,m=>m.type==='control-ready');f.sockets[1].push(Buffer.alloc(4));await f.wait(client,m=>m.type==='audio-error');
  if(required)await f.wait(client,m=>m.type==='error');else{await new Promise(resolve=>setTimeout(resolve,20));assert.equal(client.readyState,WebSocket.OPEN);assert.ok(!client.messages.some(m=>m.type==='error'));}
});
test('audio-only capture failure is fatal even when audioRequired is omitted',async t=>{
  const f=await fixture(t),client=await f.connect('audio=1&audioOnly=1&channels=1');await f.wait(client,m=>m.type==='session-options');await new Promise(resolve=>setTimeout(resolve,20));f.sockets[0].push(Buffer.alloc(4));await f.wait(client,m=>m.type==='error');
});
test('control-only source is not shared as video and every observer gets control disabled',async t=>{
  const f=await fixture(t),control=await f.connect('controlOnly=1');await f.wait(control,m=>m.type==='control-ready');const observer=await f.connect('observer=1');await f.wait(observer,m=>m.type==='viewer-state');await new Promise(resolve=>setTimeout(resolve,20));assert.equal(f.spawns.length,2);assert.match(f.spawns[1].args[3],/'video=true'/);assert.match(f.spawns[1].args[3],/'control=false'/);observer.send(JSON.stringify({type:'key',keycode:3}));await f.wait(observer,m=>m.type==='control-error');assert.equal(f.sockets[1].writes.length,0);
});
test('app force-stop waits for a matching current user before emitting START_APP',async t=>{
  const f=await fixture(t,{currentUser:'0'}),client=await f.connect('controlOnly=1&startApp=com.example&startAppUser=10&startForceStop=1');await f.wait(client,m=>m.type==='control-error');assert.ok(!f.sockets[0].writes.some(b=>b[0]===16));
  client.send(JSON.stringify({type:'start-app',package:'com.example',userId:0,forceStop:true}));await f.wait(client,m=>m.type==='control-status');assert.ok(f.sockets[0].writes.some(b=>b[0]===16&&b.subarray(2).toString()==='+com.example'));assert.equal(f.calls.filter(args=>args.includes('get-current-user')).length,2);
});
