import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { DeviceMessageParser, encodeControl } from '../lib/mirror.mjs';

const clipboard = text => { const data = Buffer.from(text), header = Buffer.alloc(5); header.writeUInt32BE(data.length, 1); return Buffer.concat([header, data]); };
test('clipboard read uses COPY_KEY_NONE and does not synthesize copy/cut keys', () => {
  assert.deepEqual(encodeControl({ type: 'get-clipboard' }, {}), Buffer.from([8, 0]));
  assert.deepEqual(encodeControl({ type: 'get-clipboard', copyKey: 2 }, {}), Buffer.from([8, 0]));
});
test('device control parser handles fragmented UTF8 clipboard, ACK and UHID frames in order', () => {
  const ack = Buffer.alloc(9); ack[0] = 1; ack.writeBigUInt64BE(123n, 1);
  const uhid = Buffer.from([2, 0, 7, 0, 2, 10, 20]), rows = [], parser = new DeviceMessageParser(message => rows.push(message));
  for (const byte of Buffer.concat([clipboard('한글 🎉'), ack, uhid, clipboard('')])) parser.push(Buffer.from([byte]));
  assert.deepEqual(rows[0], { type: 'clipboard', text: '한글 🎉' }); assert.deepEqual(rows[1], { type: 'clipboard-ack', sequence: '123' });
  assert.equal(rows[2].id, 7); assert.deepEqual(rows[2].data, Buffer.from([10, 20])); assert.deepEqual(rows[3], { type: 'clipboard', text: '' }); assert.equal(parser.buffer.length, 0);
});
test('parser enforces each frame bound while allowing multiple maximum frames in one TCP chunk', () => {
  const rows = [], parser = new DeviceMessageParser(message => rows.push(message));
  const packet = clipboard('a'.repeat(262139)); parser.push(Buffer.concat([packet, packet])); assert.equal(rows.length, 2); assert.equal(parser.buffer.length, 0);
  const oversized = Buffer.alloc(5); oversized.writeUInt32BE(262140, 1);
  assert.throws(() => new DeviceMessageParser(() => {}).push(oversized), /256KB/);
  assert.throws(() => new DeviceMessageParser(() => {}).push(Buffer.from([2, 0, 1, 0x10, 1])), /너무 큽니다/);
  assert.throws(() => new DeviceMessageParser(() => {}).push(Buffer.from([99])), /지원하지 않는/);
  assert.throws(() => new DeviceMessageParser(() => {}).push(Buffer.from([0, 0, 0, 0, 1, 0xff])), /encoded data|encoding/i);
});
test('touch packets support ten stable IDs and cancel becomes an UP that releases scrcpy state', () => {
  const size = { width: 596, height: 1280 };
  for (let pointerId=0;pointerId<10;pointerId++) { const packet = encodeControl({ type: 'touch', action: 0, pointerId, x: 10, y: 20, ...size }, size); assert.equal(packet.readBigUInt64BE(2), BigInt(pointerId)); assert.equal(packet.readUInt16BE(22), 65535); }
  const release = encodeControl({ type: 'touch', action: 3, pointerId: 1, x: 10, y: 20, ...size }, size); assert.equal(release[1], 1); assert.equal(release.readUInt16BE(22), 0);
  for (const pointerId of [-1, 10, '1', 1.5]) assert.throws(() => encodeControl({ type: 'touch', action: 0, pointerId, x: 10, y: 20, ...size }, size));
});
test('touch pressure preserves reported fraction and rejects invalid numeric fields',()=>{const size={width:596,height:1280},body={type:'touch',action:2,pointerId:9,x:10,y:20,...size};assert.equal(encodeControl({...body,pressure:.5},size).readUInt16BE(22),32768);assert.equal(encodeControl({...body,pressure:0},size).readUInt16BE(22),0);assert.equal(encodeControl({...body,action:1,pressure:1},size).readUInt16BE(22),0);for(const pressure of [-1,1.1,NaN,Infinity,'0.5'])assert.throws(()=>encodeControl({...body,pressure},size));});

async function browserFixture() {
  const nodes = new Map(), docEvents = new Map(), winEvents = new Map(), timers = new Map(), frames = new Map(), sent = [],feedbackTasks=[],feedbackStates=[]; let next = 0, copies = 0, selected = 0;
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { dataset: {}, attributes:{},setAttribute(name,value){this.attributes[name]=value;}, value: '', disabled: false, hidden: false, checked: false, textContent: '', classList: { toggle() {} }, listeners: new Map(), addEventListener(name, callback) { this.listeners.set(name, callback); }, focus() {}, select() { selected++; } });
    return nodes.get(id);
  };
  const context = { window: { addEventListener: (name, cb) => winEvents.set(name, cb), isSecureContext: false }, document: { getElementById: node, addEventListener: (name, cb) => docEvents.set(name, cb), execCommand: () => { copies++; return false; }, hidden: false }, navigator: {},
    setTimeout: fn => { timers.set(++next, fn); return next; }, clearTimeout: id => timers.delete(id), requestAnimationFrame: fn => { frames.set(++next, fn); return next; }, cancelAnimationFrame: id => frames.delete(id), getComputedStyle: () => ({ borderLeftWidth: '10px', borderRightWidth: '10px', borderTopWidth: '10px', borderBottomWidth: '10px' }) };
  vm.runInNewContext(await readFile(new URL('../public/mirror-tools.js', import.meta.url), 'utf8'), context);
  context.window.DeskFeedback={start(label,{button}={}){const task={label,button,finished:0};feedbackTasks.push(task);return()=>{task.finished++;};},state(host,info){host.dataset.state=info.type;host.textContent=(info.title?info.title+' · ':'')+info.message;host.feedback=info;feedbackStates.push(info);}};
  const tools = context.window.MirrorTools; tools.configure({ send: message => { sent.push(message); return true; } });
  node('mirror-mouse-shortcuts').checked = true;
  return { tools, nodes, node, sent, context, timers, frames, winEvents, docEvents,feedbackTasks,feedbackStates, get copies() { return copies; }, get selected() { return selected; } };
}
test('clipboard is neither read nor copied automatically and unsolicited device data is discarded', async () => {
  const f = await browserFixture(); f.tools.setConnected(true); f.tools.receive({ type: 'clipboard', text: 'private' });
  assert.equal(f.sent.length, 0); assert.equal(f.node('mirror-clipboard-text').value, ''); assert.equal(f.copies, 0);
  f.node('mirror-clipboard-read').onclick(); assert.deepEqual(JSON.parse(JSON.stringify(f.sent)), [{ type: 'get-clipboard' }]);
  f.tools.receive({ type: 'clipboard', text: '사용자가 요청한 내용' }); assert.equal(f.node('mirror-clipboard-text').value, '사용자가 요청한 내용'); assert.equal(f.copies, 0);
  await f.node('mirror-clipboard-copy').onclick(); assert.equal(f.copies, 1); assert.equal(f.selected, 1); assert.match(f.node('mirror-clipboard-status').textContent, /Ctrl\+C/);
  f.tools.reset(); assert.equal(f.node('mirror-clipboard-text').value, ''); assert.equal(f.sent.length, 1);
});
test('empty clipboard timeout and disconnect clear pending reads without leaking stale text', async () => {
  const f = await browserFixture(); f.tools.setConnected(true); f.node('mirror-clipboard-read').onclick(); f.node('mirror-clipboard-read').onclick(); assert.equal(f.sent.length, 1);
  [...f.timers.values()][0](); assert.match(f.node('mirror-clipboard-status').textContent, /응답을 확인하지 못했습니다/);
  f.node('mirror-clipboard-read').onclick(); f.tools.setConnected(false); f.tools.receive({ type: 'clipboard', text: 'late result' });
  assert.equal(f.node('mirror-clipboard-text').value, ''); assert.equal(f.node('mirror-clipboard-read').disabled, true);
});
test('canvas coordinates exclude borders and clamp reflected fingers to actual pixels', async () => {
  const f = await browserFixture(); const size = { width: 1000, height: 2000 }, rect = { left: 50, top: 100, width: 520, height: 1020 }, border = { left: 10, right: 10, top: 10, bottom: 10 };
  assert.deepEqual(JSON.parse(JSON.stringify(f.tools.canvasPoint({ clientX: 310, clientY: 610 }, rect, border, size))), { x: 500, y: 1000 });
  assert.deepEqual(JSON.parse(JSON.stringify(f.tools.canvasPoint({ clientX: 0, clientY: 99999 }, rect, border, size))), { x: 0, y: 1999 });
  assert.deepEqual(JSON.parse(JSON.stringify(f.tools.pinchPoint({ x: 0, y: 1999 }, size))), { x: 999, y: 0 });
});
async function gestureFixture() {
  const f = await browserFixture(); let ready = true, viewOnly = false, size = { width: 1000, height: 2000 };
  const canvas = f.node('canvas'); canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 520, height: 1020 }); canvas.setPointerCapture = () => {}; canvas.hasPointerCapture = () => true; canvas.releasePointerCapture = () => {};
  const binding = f.tools.bindCanvas(canvas, { send: message => f.sent.push(message), isReady: () => ready, isViewOnly: () => viewOnly, getSize: () => size });
  const event = (name, values = {}) => canvas.listeners.get(name)?.({ button: 0, pointerId: 9, clientX: 110, clientY: 210, preventDefault() {}, ...values });
  return { ...f, binding, event, setViewOnly: value => viewOnly = value, setReady: value => ready = value, setSize: value => size = value };
}
test('Ctrl drag sends two real pointer lifecycles and keeps pinch mode after Ctrl is released', async () => {
  const f = await gestureFixture(); f.event('pointerdown', { ctrlKey: true });
  assert.deepEqual(f.sent.map(x => [x.action, x.pointerId, x.x, x.y]), [[0, 0, 200, 400], [0, 1, 799, 1599]]);
  f.event('pointermove', { ctrlKey: false, clientX: 210, clientY: 310 }); [...f.frames.values()][0]();
  assert.deepEqual(f.sent.slice(2).map(x => [x.action, x.pointerId]), [[2, 0], [2, 1]]);
  f.event('pointerup', { clientX: 210, clientY: 310 }); assert.deepEqual(f.sent.slice(-2).map(x => [x.action, x.pointerId]), [[1, 1], [1, 0]]);
});
test('cancel and blur release both fingers once, with latest display dimensions', async () => {
  const f = await gestureFixture(); f.event('pointerdown', { ctrlKey: true }); f.setSize({ width: 200, height: 100 }); f.binding.cancel(); f.winEvents.get('blur')();
  assert.equal(f.sent.length, 4); assert.deepEqual(f.sent.slice(-2).map(x => [x.action, x.pointerId, x.x, x.y, x.width, x.height]), [[1, 1, 0, 0, 200, 100], [1, 0, 199, 99, 200, 100]]);
  f.event('pointerdown', { ctrlKey: true }); f.event('pointercancel'); assert.deepEqual(f.sent.slice(-2).map(x => x.action), [1, 1]);
});
test('right and middle clicks map to Back/Home while view-only and disconnected input are blocked', async () => {
  const f = await gestureFixture(); f.event('pointerdown', { button: 2 }); f.event('pointerdown', { button: 1 }); assert.deepEqual(f.sent.map(x => x.keycode), [4, 3]);
  f.setViewOnly(true); f.event('pointerdown', { ctrlKey: true }); f.event('pointerdown', { button: 2 }); f.event('wheel', { deltaX: 0, deltaY: 100 }); assert.equal(f.sent.length, 2);
  f.setViewOnly(false); f.setReady(false); f.event('pointerdown'); assert.equal(f.sent.length, 2);
});
test('fullscreen Escape handler exits the browser view before any phone key handling', async () => {
  const source = await readFile(new URL('../public/mirror-keyboard.js', import.meta.url), 'utf8');
  let handler, exited = 0, sent = 0;
  const context={window:{addEventListener(){}},document:{addEventListener(){},fullscreenElement:{},exitFullscreen:()=>{exited++;return Promise.resolve();}}};
  vm.runInNewContext(source,context);context.window.MirrorKeyboard.bind({addEventListener:(name,callback)=>{if(name==='keydown')handler=callback;}},{send:()=>sent++,isReady:()=>true,isViewOnly:()=>false});
  handler({ key: 'Escape', preventDefault() {} }); assert.equal(exited, 1); assert.equal(sent, 0);
});
test('view-only permits an explicit clipboard read while blocking touch, keys and paste', async () => {
  const source = await readFile(new URL('../public/device.js', import.meta.url), 'utf8'), calls = [];
  const start = source.indexOf('  function send(message)'), end = source.indexOf('  function drawVideo', start);
  const context = { window:{}, s: { viewOnly: true, width: 500, socket: { readyState: 1, send: value => calls.push(JSON.parse(value)) } }, WebSocket: { OPEN: 1 } };
  vm.runInNewContext(source.slice(start, end) + '\nthis.sendMessage = send;', context);
  assert.equal(context.sendMessage({ type: 'touch', action: 0 }), false); assert.equal(context.sendMessage({ type: 'key', keycode: 4 }), false); assert.equal(context.sendMessage({ type: 'paste', text: 'test' }), false);
  assert.equal(context.sendMessage({ type: 'get-clipboard' }), true); assert.deepEqual(calls, [{ type: 'get-clipboard' }]);
});

test('independent physical touch pointers use ten slots with pressure and scoped release',async()=>{const f=await gestureFixture();for(let pointerId=1;pointerId<=11;pointerId++)f.event('pointerdown',{pointerId,pointerType:'touch',pressure:.4,ctrlKey:true});assert.equal(f.sent.length,10);assert.equal(f.binding.pointerCount,10);assert.deepEqual(f.sent.map(row=>row.pointerId),[0,1,2,3,4,5,6,7,8,9]);assert.ok(f.sent.every(row=>row.pressure===.4));f.event('pointerup',{pointerId:4,pointerType:'touch'});assert.equal(f.sent.at(-1).pointerId,3);assert.equal(f.sent.at(-1).action,1);f.event('pointerdown',{pointerId:12,pointerType:'pen',pressure:.7});assert.equal(f.sent.at(-1).pointerId,3);f.binding.cancel();assert.equal(f.binding.pointerCount,0);assert.equal(f.sent.filter(row=>row.action===1).length,11);});
test('MirrorView null coordinates never fall back and pointer release uses last valid location',async()=>{const f=await gestureFixture();f.context.window.MirrorView={point:()=>null,inputBlocked:false};f.event('pointerdown');assert.equal(f.sent.length,0);f.context.window.MirrorView.point=()=>({x:22,y:44});f.event('pointerdown');assert.equal(f.sent.length,1);f.context.window.MirrorView.point=()=>null;f.event('pointermove');f.event('pointerup');assert.deepEqual(f.sent.map(row=>[row.action,row.x,row.y]),[[0,22,44],[1,22,44]]);});
test('custom mouse and Shift actions are looked up without replacing physical multitouch',async()=>{const f=await gestureFixture();f.context.window.MirrorInputMap={getAction:event=>event.pointerType==='touch'?{kind:'touch'}:event.shiftKey?{kind:'command',message:{type:'key',keycode:187}}:{kind:'ignore'}};f.event('pointerdown',{button:2});assert.equal(f.sent.length,0);f.event('pointerdown',{button:2,shiftKey:true});assert.equal(f.sent[0].keycode,187);f.event('pointerdown',{button:0,pointerType:'touch',shiftKey:true});assert.equal(f.sent.at(-1).type,'touch');});
test('SDK mouse map validates choices, stores only locally, and keeps explicit Shift selection',async()=>{const values=new Map(),context={window:{},localStorage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)}};vm.runInNewContext(await readFile(new URL('../public/mirror-input-map.js',import.meta.url),'utf8'),context);const api=context.window.MirrorInputMap;assert.equal(api.getAction({button:2}).message.keycode,4);const map=api.getMapping();map.shift[2]='recent';map.shift[0]='touch';api.setMapping(map);assert.equal(api.getAction({button:2,shiftKey:true}).message.keycode,187);assert.equal(api.getAction({button:0,shiftKey:true,ctrlKey:true}).explicitShift,true);assert.equal(api.getAction({button:2,pointerType:'pen',shiftKey:true}).kind,'touch');assert.equal(values.size,1);map.normal[0]='arbitrary-command';assert.throws(()=>api.setMapping(map),/선택/);});
test('Shift vertical tilt reflects only x and freezes its mode until both pointers release',async()=>{const f=await gestureFixture();f.event('pointerdown',{shiftKey:true});assert.deepEqual(f.sent.map(row=>[row.pointerId,row.x,row.y]),[[0,200,400],[1,799,400]]);f.event('pointermove',{shiftKey:false,clientX:210,clientY:310});[...f.frames.values()][0]();assert.deepEqual(f.sent.slice(2).map(row=>[row.pointerId,row.x,row.y]),[[0,400,600],[1,599,600]]);f.event('pointerup',{clientX:210,clientY:310});assert.deepEqual(f.sent.slice(-2).map(row=>[row.action,row.pointerId,row.x,row.y]),[[1,1,599,600],[1,0,400,600]]);});
test('Ctrl+Shift horizontal tilt reflects only y after the PC coordinate transform',async()=>{const f=await gestureFixture();f.context.window.MirrorView={point:()=>({x:35,y:80}),inputBlocked:false};f.event('pointerdown',{ctrlKey:true,shiftKey:true});assert.deepEqual(f.sent.map(row=>[row.pointerId,row.x,row.y]),[[0,35,80],[1,35,1919]]);f.context.window.MirrorView.point=()=>null;f.event('pointermove',{ctrlKey:false,shiftKey:false});f.event('pointerup');assert.deepEqual(f.sent.slice(-2).map(row=>[row.action,row.pointerId,row.x,row.y]),[[1,1,35,1919],[1,0,35,80]]);});
test('custom command and disabled Shift maps precede tilt, while explicit tilt ignores modifier changes',async()=>{const f=await gestureFixture();let mode={kind:'command',message:{type:'key',keycode:3}};f.context.window.MirrorInputMap={getAction:()=>mode};f.event('pointerdown',{shiftKey:true,ctrlKey:true});assert.deepEqual(f.sent.map(row=>row.type),['key']);mode={kind:'ignore'};f.event('pointerdown',{shiftKey:true});assert.equal(f.sent.length,1);mode={kind:'tilt-vertical'};f.event('pointerdown',{button:2,ctrlKey:true});assert.deepEqual(f.sent.slice(1).map(row=>[row.x,row.y]),[[200,400],[799,400]]);f.binding.cancel();assert.equal(f.binding.pointerCount,0);});
test('tilt never invents an extra pointer for real touch and respects the total ten-slot limit',async()=>{const f=await gestureFixture();for(let pointerId=1;pointerId<=9;pointerId++)f.event('pointerdown',{pointerId,pointerType:'touch',shiftKey:true,ctrlKey:true});assert.equal(f.sent.length,9);f.event('pointerdown',{pointerId:20,pointerType:'mouse',shiftKey:true});assert.equal(f.sent.length,9);f.event('pointerup',{pointerId:5,pointerType:'touch'});f.event('pointerdown',{pointerId:20,pointerType:'mouse',shiftKey:true});assert.equal(f.binding.pointerCount,10);const down=f.sent.slice(-2);assert.equal(down[0].y,down[1].y);f.winEvents.get('blur')();assert.equal(f.binding.pointerCount,0);});

test('explicit Shift touch mapping overrides Ctrl/Shift shortcuts and the pinch checkbox',async()=>{
  const f=await gestureFixture();f.context.window.MirrorInputMap={getAction:()=>({kind:'touch',explicitShift:true})};f.node('mirror-pinch-mode').checked=true;
  f.event('pointerdown',{shiftKey:true,ctrlKey:true});assert.equal(f.binding.pointerCount,1);assert.equal(f.sent.length,1);f.event('pointerup');assert.deepEqual(f.sent.map(row=>[row.action,row.pointerId]),[[0,0],[1,0]]);
});

test('SDK wheel units normalize pixel, line and page events consistently',async()=>{
  const f=await gestureFixture();for(const [deltaMode,delta]of [[0,100],[1,3],[2,1]])f.event('wheel',{deltaMode,deltaX:delta,deltaY:delta});
  assert.deepEqual(f.sent.map(row=>[row.horizontal,row.vertical]),[[-1,-1],[-1,-1],[-1,-1]]);
});

for(const reject of [false,true])test(`late PC clipboard ${reject?'failure':'success'} cannot overwrite a new device status or copy its text`,async()=>{
  const f=await browserFixture();let finish;f.context.window.isSecureContext=true;f.context.navigator.clipboard={writeText:()=>new Promise((resolve,fail)=>finish=reject?()=>fail(new Error('permission denied')):resolve)};
  f.tools.setConnected(true);f.node('mirror-clipboard-read').onclick();f.tools.receive({type:'clipboard',text:'first device'});const copying=f.node('mirror-clipboard-copy').onclick();
  f.tools.setConnected(false);f.tools.setConnected(true);f.node('mirror-clipboard-read').onclick();f.tools.receive({type:'clipboard',text:'second device'});const status=f.node('mirror-clipboard-status').textContent;
  finish();await copying;assert.equal(f.copies,0);assert.equal(f.selected,0);assert.equal(f.node('mirror-clipboard-text').value,'second device');assert.equal(f.node('mirror-clipboard-status').textContent,status);
});

test('clipboard read immediately marks its button busy and distinguishes an explicit empty response',async()=>{
  const f=await browserFixture();f.tools.setConnected(true);const button=f.node('mirror-clipboard-read');button.onclick();
  assert.equal(button.disabled,true);assert.equal(button.attributes['aria-busy'],'true');assert.match(button.textContent,/읽는 중/);assert.equal(f.node('mirror-clipboard-status').dataset.state,'loading');assert.equal(f.feedbackTasks[0].button,button);assert.equal(f.feedbackTasks[0].finished,0);
  button.onclick();assert.equal(f.sent.length,1);f.tools.receive({type:'clipboard',text:''});
  assert.equal(button.disabled,false);assert.equal(button.attributes['aria-busy'],'false');assert.equal(f.node('mirror-clipboard-copy').disabled,true);assert.equal(f.node('mirror-clipboard-status').dataset.state,'empty');assert.match(f.node('mirror-clipboard-status').textContent,/클립보드가 비어/);assert.equal(f.feedbackTasks[0].finished,1);assert.equal(f.timers.size,0);assert.equal(f.sent.length,1);
});

test('clipboard timeout ends progress and retries only through a fresh user action',async()=>{
  const f=await browserFixture();f.tools.setConnected(true);f.node('mirror-clipboard-read').onclick();const staleTimer=[...f.timers.values()][0];staleTimer();
  assert.equal(f.feedbackTasks[0].finished,1);assert.equal(f.node('mirror-clipboard-read').disabled,false);assert.equal(f.node('mirror-clipboard-read').attributes['aria-busy'],'false');assert.equal(f.node('mirror-clipboard-status').dataset.state,'error');assert.match(f.node('mirror-clipboard-status').textContent,/응답 확인 안 됨/);assert.equal(f.sent.length,1);
  const retry=f.feedbackStates.at(-1).onAction;assert.equal(typeof retry,'function');const retrying=retry();let settled=false;retrying.then(()=>settled=true);await Promise.resolve();assert.equal(settled,false);assert.equal(f.sent.length,2);staleTimer();assert.equal(f.node('mirror-clipboard-status').dataset.state,'loading');assert.equal(f.feedbackTasks[1].finished,0);f.tools.receive({type:'clipboard',text:'retry result'});await retrying;assert.equal(settled,true);assert.equal(f.feedbackTasks[1].finished,1);
});

test('clipboard send failure or synchronous exception cannot leave pending progress behind',async()=>{
  for(const throws of [false,true]){const f=await browserFixture();f.tools.configure({send(){if(throws)throw new Error('socket closed');return false;}});f.tools.setConnected(true);assert.doesNotThrow(()=>f.node('mirror-clipboard-read').onclick());
    assert.equal(f.node('mirror-clipboard-read').disabled,false);assert.equal(f.node('mirror-clipboard-read').attributes['aria-busy'],'false');assert.equal(f.timers.size,0);assert.equal(f.feedbackTasks[0].finished,1);assert.equal(f.node('mirror-clipboard-status').dataset.state,'error');
  }
});

test('unsupported clipboard mode stops pending work and never reads until explicitly supported again',async()=>{
  const f=await browserFixture();f.tools.setConnected(true);f.node('mirror-clipboard-read').onclick();f.tools.setConnected(true,{clipboardSupported:false,reason:'카메라 영상에서는 클립보드를 읽을 수 없습니다.'});
  assert.equal(f.feedbackTasks[0].finished,1);assert.equal(f.timers.size,0);assert.equal(f.node('mirror-clipboard-read').disabled,true);assert.equal(f.node('mirror-clipboard-read').attributes['aria-busy'],'false');assert.equal(f.node('mirror-clipboard-status').dataset.state,'warning');assert.match(f.node('mirror-clipboard-status').textContent,/카메라/);
  f.node('mirror-clipboard-read').onclick();f.tools.receive({type:'clipboard',text:'late'});assert.equal(f.sent.length,1);assert.equal(f.node('mirror-clipboard-text').value,'');f.tools.setConnected(true,{clipboardSupported:true});assert.equal(f.node('mirror-clipboard-read').disabled,false);assert.equal(f.sent.length,1);f.node('mirror-clipboard-read').onclick();assert.equal(f.sent.length,2);f.tools.reset();
});

test('PC clipboard copy is immediately busy and duplicate clicks cannot submit duplicate writes',async()=>{
  const f=await browserFixture();let writes=0,resolve;f.context.window.isSecureContext=true;f.context.navigator.clipboard={writeText:()=>{writes++;return new Promise(r=>resolve=r);}};
  f.tools.setConnected(true);f.node('mirror-clipboard-read').onclick();f.tools.receive({type:'clipboard',text:'copy me'});const copy=f.node('mirror-clipboard-copy'),copying=copy.onclick();
  assert.equal(copy.disabled,true);assert.equal(copy.attributes['aria-busy'],'true');assert.match(copy.textContent,/복사 중/);assert.equal(f.node('mirror-clipboard-read').disabled,true);assert.equal(f.node('mirror-clipboard-status').dataset.state,'loading');await copy.onclick();assert.equal(writes,1);f.node('mirror-clipboard-read').onclick();assert.equal(f.sent.length,1);
  resolve();await copying;assert.equal(copy.disabled,false);assert.equal(copy.attributes['aria-busy'],'false');assert.equal(f.feedbackTasks.at(-1).finished,1);assert.equal(f.node('mirror-clipboard-status').dataset.state,'success');assert.equal(f.timers.size,0);
});

test('a stalled browser clipboard copy times out without automatic retry or stale completion status',async()=>{
  const f=await browserFixture();let writes=0,resolve;f.context.window.isSecureContext=true;f.context.navigator.clipboard={writeText:()=>{writes++;return new Promise(r=>resolve=r);}};
  f.tools.setConnected(true);f.node('mirror-clipboard-read').onclick();f.tools.receive({type:'clipboard',text:'copy me'});const copying=f.node('mirror-clipboard-copy').onclick();[...f.timers.values()][0]();await copying;
  assert.equal(writes,1);assert.equal(f.node('mirror-clipboard-copy').disabled,false);assert.equal(f.node('mirror-clipboard-copy').attributes['aria-busy'],'false');assert.equal(f.feedbackTasks.at(-1).finished,1);assert.equal(f.node('mirror-clipboard-status').dataset.state,'error');assert.match(f.node('mirror-clipboard-status').textContent,/복사 완료 응답을 확인하지 못/);const status=f.node('mirror-clipboard-status').textContent;
  resolve();await Promise.resolve();await Promise.resolve();assert.equal(f.node('mirror-clipboard-status').textContent,status);assert.equal(f.copies,0);
});

test('disconnect cancels browser clipboard waiting and ends its feedback immediately',async()=>{
  const f=await browserFixture();f.context.window.isSecureContext=true;f.context.navigator.clipboard={writeText:()=>new Promise(()=>{})};f.tools.setConnected(true);f.node('mirror-clipboard-read').onclick();f.tools.receive({type:'clipboard',text:'private'});const copying=f.node('mirror-clipboard-copy').onclick();
  f.tools.setConnected(false);await copying;assert.equal(f.feedbackTasks.at(-1).finished,1);assert.equal(f.node('mirror-clipboard-copy').attributes['aria-busy'],'false');assert.equal(f.node('mirror-clipboard-read').disabled,true);assert.equal(f.node('mirror-clipboard-text').value,'');assert.equal(f.node('mirror-clipboard-status').dataset.state,'offline');assert.equal(f.timers.size,0);
});

test('legacy feedback absence and unsupported PC copy retain explicit manual copy guidance',async()=>{
  const f=await browserFixture();delete f.context.window.DeskFeedback;f.tools.setConnected(true);f.node('mirror-clipboard-read').onclick();assert.equal(f.node('mirror-clipboard-read').attributes['aria-busy'],'true');f.tools.receive({type:'clipboard',text:'manual'});await f.node('mirror-clipboard-copy').onclick();
  assert.equal(f.node('mirror-clipboard-status').dataset.state,'warning');assert.match(f.node('mirror-clipboard-status').textContent,/Ctrl\+C/);assert.equal(f.node('mirror-clipboard-read').disabled,false);assert.equal(f.copies,1);assert.equal(f.selected,1);assert.equal(f.node('mirror-clipboard-copy').attributes['aria-busy'],'false');
});

test('clipboard error finishes progress once and unrelated scoped control errors do not cancel a read',async()=>{
  const f=await browserFixture();f.tools.setConnected(true);const reading=f.node('mirror-clipboard-read').onclick();f.tools.receive({type:'control-error',operation:'rotate',message:'different operation'});assert.equal(f.node('mirror-clipboard-status').dataset.state,'loading');assert.equal(f.feedbackTasks[0].finished,0);
  f.tools.receive({type:'control-error',operation:'get-clipboard',message:'클립보드 읽기 권한이 없습니다.'});await reading;assert.equal(f.feedbackTasks[0].finished,1);assert.equal(f.timers.size,0);assert.equal(f.node('mirror-clipboard-read').disabled,false);assert.equal(f.node('mirror-clipboard-status').dataset.state,'error');assert.match(f.node('mirror-clipboard-status').textContent,/권한/);assert.equal(f.sent.length,1);
  f.tools.receive({type:'clipboard',text:'late response'});assert.equal(f.node('mirror-clipboard-text').value,'');f.tools.reset();assert.equal(f.feedbackTasks[0].finished,1);
});
