import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../public/overview-tools.js',import.meta.url),'utf8');
const jobId='12345678-1234-1234-1234-123456789012';
const ok=data=>({ok:true,json:async()=>data});
function png(width=720,height=1280){const bytes=new Uint8Array(33);bytes.set([137,80,78,71,13,10,26,10]);bytes.set([73,72,68,82],12);const view=new DataView(bytes.buffer);view.setUint32(16,width);view.setUint32(20,height);return bytes;}
function fixture({stored={},fetch}={}){
  const nodes=new Map(),requests=[],revoked=[],navigated=[],blobs=[];
  function element(id){if(!nodes.has(id))nodes.set(id,{hidden:false,textContent:'',value:'',disabled:false,dataset:{},classList:{add(){}},removeAttribute(key){delete this[key];},set innerHTML(value){this._html=value;for(const match of value.matchAll(/\bid="([^"]+)"/g))element(match[1]);},get innerHTML(){return this._html||'';}});return nodes.get(id);}
  element('overview-tools');
  class LocalURL extends URL{static createObjectURL(blob){blobs.push(blob);return 'blob:test/'+blobs.length;}static revokeObjectURL(url){revoked.push(url);}}
  const context={document:{getElementById:element},window:{addEventListener(){},DeviceDesk:{navigate:(...values)=>navigated.push(values)}},localStorage:{getItem:key=>stored[key]??null},URL:LocalURL,URLSearchParams,Blob,Uint8Array,DataView,AbortController,setTimeout,clearTimeout,fetch:async(url,options)=>{requests.push({url,options});if(!fetch)assert.fail('No automatic network or phone request expected.');return fetch(url,options);}};
  vm.runInNewContext(source,context);return {api:context.window.OverviewTools,node:element,context,requests,revoked,navigated,blobs};
}

test('opening the overview only reads local favorite paths and never queries the phone',()=>{
  const f=fixture({stored:{'adb-desk-file-shortcuts:phone':JSON.stringify({favorites:['/sdcard/Download','/sdcard/../private','//remote/path','/sdcard/Download','/sdcard/Photo<1>']})}});
  f.api.open('phone');f.api.activate(true);assert.equal(f.requests.length,0);const html=f.node('overview-bookmarks').innerHTML;assert.match(html,/Download/);assert.doesNotMatch(html,/private|remote\/path/);assert.match(html,/Photo&lt;1&gt;/);
  f.node('overview-bookmarks').onclick({target:{closest:()=>({dataset:{overviewFolder:'/sdcard/Download'}})}});assert.deepEqual(f.navigated,[['files','/sdcard/Download']]);
  f.api.close();assert.equal(f.requests.length,0);assert.doesNotMatch(f.node('overview-bookmarks').innerHTML,/Download/);
});

test('explicit capture validates ownership and PNG bytes before creating a local preview',async()=>{
  const f=fixture({fetch:async url=>url==='/api/session'?ok({csrfToken:'test'}):url==='/api/ops/workbench'?ok({id:jobId,deviceId:'phone',kind:'screen-native-capture',state:'success',finishedAt:'2026-10-16T00:00:00Z'}):{ok:true,headers:new Headers({'Content-Type':'application/octet-stream'}),arrayBuffer:async()=>png().buffer}});
  f.api.open('phone');f.api.activate(true);await f.node('overview-screen-read').onclick();assert.equal(f.requests.length,3);const submitted=JSON.parse(f.requests[1].options.body);assert.equal(submitted.deviceId,'phone');assert.equal(submitted.action,'screen-native-capture');assert.equal(f.blobs[0].type,'image/png');assert.equal(f.node('overview-screen-image').src,'blob:test/1');assert.match(f.node('overview-screen-status').textContent,/720 × 1280/);
  f.api.open('other');assert.deepEqual(f.revoked,['blob:test/1']);assert.equal(f.node('overview-screen-image').hidden,true);assert.equal(f.node('overview-screen-save').hidden,true);
});

test('capture rejects wrong-device jobs, active content MIME, and excessive dimensions',async()=>{
  for(const scenario of ['other-device','html','large']){
    const f=fixture({fetch:async url=>url==='/api/session'?ok({csrfToken:'test'}):url==='/api/ops/workbench'?ok({id:jobId,deviceId:scenario==='other-device'?'other':'phone',kind:'screen-native-capture',state:'success'}):{ok:true,headers:new Headers({'Content-Type':scenario==='html'?'text/html':'image/png'}),arrayBuffer:async()=>png(12000,12000).buffer}});
    f.api.open('phone');f.api.activate(true);await f.node('overview-screen-read').onclick();assert.equal(f.blobs.length,0);assert.equal(f.node('overview-screen-read').disabled,false);assert.match(f.node('overview-screen-status').textContent,scenario==='other-device'?/선택한 기기/:scenario==='html'?/형식/:/크기/);
  }
});

test('capture checks declared and streamed byte limits before retaining image data',async()=>{
  for(const advertised of [true,false]){
    let cancelled=false,read=false;const f=fixture({fetch:async url=>url==='/api/session'?ok({csrfToken:'test'}):url==='/api/ops/workbench'?ok({id:jobId,deviceId:'phone',kind:'screen-native-capture',state:'success'}):{ok:true,headers:new Headers({'Content-Type':'image/png',...(advertised?{'Content-Length':String(25*1024*1024)}:{})}),body:{getReader:()=>({read:async()=>{read=true;return{done:false,value:{byteLength:25*1024*1024}};},cancel:async()=>{cancelled=true;},releaseLock(){}})}}});
    f.api.open('phone');f.api.activate(true);await f.node('overview-screen-read').onclick();assert.equal(f.blobs.length,0);assert.equal(read,!advertised);assert.equal(cancelled,!advertised);assert.match(f.node('overview-screen-status').textContent,/24MB|크기 한도/);
  }
});

test('changing devices while the capture session token is pending never submits a stale capture',async()=>{
  let complete;const pending=new Promise(resolve=>complete=resolve),f=fixture({fetch:()=>pending});f.api.open('phone');f.api.activate(true);const capture=f.node('overview-screen-read').onclick();f.api.open('other');complete(ok({csrfToken:'late'}));await capture;assert.equal(f.requests.length,1);assert.equal(f.requests[0].url,'/api/session');assert.equal(f.node('overview-screen-status').textContent,'아직 캡처하지 않았습니다.');
});

test('Wi-Fi summary is requested only on click and late device responses are discarded',async()=>{
  let complete;const pending=new Promise(resolve=>complete=resolve);const f=fixture({fetch:()=>pending});f.api.open('phone');f.api.activate(true);assert.equal(f.requests.length,0);
  const task=f.node('overview-network-read').onclick();assert.equal(f.requests.length,1);assert.match(f.requests[0].url,/network-info\?deviceId=phone/);f.api.open('other');
  complete(ok({deviceId:'phone',sections:[{id:'wifi',items:[{label:'네트워크 이름 (SSID)',status:'ok',value:'old-network'}]}]}));await task;assert.doesNotMatch(f.node('overview-network-values').innerHTML,/old-network/);assert.equal(f.node('overview-network-status').textContent,'자동 조회하지 않습니다.');
});

test('Wi-Fi values distinguish off from missing data and escape network names',async()=>{
  const f=fixture({fetch:async()=>ok({deviceId:'phone',sections:[{id:'wifi',items:[{label:'Wi-Fi 상태',value:'꺼짐',status:'ok'},{label:'접속 상태',value:'연결되지 않음',status:'ok'},{label:'네트워크 이름 (SSID)',value:'<script>network</script>',status:'ok'},{label:'수신 신호 (RSSI)',value:null,status:'unavailable'}]},{id:'network',tables:[{title:'인터페이스·주소',rows:[{name:'wlan0',ipv4:'192.0.2.64/24'}]}]}]})});
  f.api.open('phone');f.api.activate(true);await f.node('overview-network-read').onclick();const html=f.node('overview-network-values').innerHTML;assert.match(html,/꺼짐/);assert.match(html,/확인 불가/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);assert.match(html,/192\.0\.2\.64/);
});

test('leaving overview during CSRF lookup prevents a capture POST and returning allows a fresh capture',async()=>{
  let resolveOld;let sessionCalls=0;
  const f=fixture({fetch:async url=>{
    if(url==='/api/session'){if(++sessionCalls===1)return new Promise(resolve=>resolveOld=resolve);return ok({csrfToken:'fresh'});}
    if(url==='/api/ops/workbench')return ok({id:jobId,deviceId:'phone',kind:'screen-native-capture',state:'success'});
    return {ok:true,headers:new Headers({'Content-Type':'image/png'}),arrayBuffer:async()=>png().buffer};
  }});
  f.api.open('phone');f.api.activate(true);const old=f.node('overview-screen-read').onclick();f.api.activate(false);resolveOld(ok({csrfToken:'old'}));await old;
  assert.equal(f.requests.length,1);assert.equal(f.node('overview-screen-read').disabled,false);assert.equal(f.node('overview-screen-progress').hidden,true);
  f.api.activate(true);await f.node('overview-screen-read').onclick();assert.equal(f.requests.filter(request=>request.url==='/api/ops/workbench').length,1);assert.equal(f.blobs.length,1);
});

test('late overview network response is discarded after tab switch and retry works on return',async()=>{
  let finishOld,count=0;const f=fixture({fetch:async()=>{if(++count===1)return new Promise(resolve=>finishOld=resolve);return ok({deviceId:'phone',sections:[{id:'wifi',items:[{label:'네트워크 이름 (SSID)',value:'new-network',status:'ok'}]}]});}});
  f.api.open('phone');f.api.activate(true);const old=f.node('overview-network-read').onclick();f.api.activate(false);f.api.activate(true);
  await f.node('overview-network-read').onclick();finishOld(ok({deviceId:'phone',sections:[{id:'wifi',items:[{label:'네트워크 이름 (SSID)',value:'old-network',status:'ok'}]}]}));await old;
  assert.match(f.node('overview-network-values').innerHTML,/new-network/);assert.doesNotMatch(f.node('overview-network-values').innerHTML,/old-network/);assert.equal(f.node('overview-network-read').disabled,false);
});

test('overview buttons cannot start hidden-tab requests and navigation buttons stay correctly routed',async()=>{
  const f=fixture();f.api.open('phone');await f.node('overview-screen-read').onclick();await f.node('overview-network-read').onclick();assert.equal(f.requests.length,0);
  f.api.activate(true);f.node('overview-screen-open').onclick();f.node('overview-network-open').onclick();f.node('overview-files-open').onclick();
  assert.deepEqual(f.navigated,[['screen',undefined],['network',undefined],['files','/sdcard']]);assert.equal(f.requests.length,0);
});

test('capture failure offers an explicit same-place retry but never replays the capture automatically',async()=>{
  let posts=0;const starts=[];
  const f=fixture({fetch:async url=>{
    if(url==='/api/session')return ok({csrfToken:'mock'});
    if(url==='/api/ops/workbench'){if(++posts===1)return {ok:false,json:async()=>({error:'기기 연결이 끊겼습니다.'})};return ok({id:jobId,deviceId:'phone',kind:'screen-native-capture',state:'success'});}
    return {ok:true,headers:new Headers({'Content-Type':'image/png'}),arrayBuffer:async()=>png().buffer};
  }});
  f.context.window.DeskFeedback={start(label,options){const record={label,...options,done:false};starts.push(record);return()=>{record.done=true;};},state(host,options){host.card=options;host.hidden=!options;}};
  f.api.open('phone');f.api.activate(true);await f.node('overview-screen-read').onclick();assert.equal(posts,1);assert.equal(starts[0].button,f.node('overview-screen-read'));assert.equal(starts[0].done,true);assert.equal(f.node('overview-screen-state').card.type,'offline');
  f.api.activate(false);f.api.activate(true);assert.equal(posts,1);const retry=f.node('overview-screen-state').card;await retry.onAction();assert.equal(posts,2);assert.equal(f.blobs.length,1);
  f.api.open('other');f.api.activate(true);await retry.onAction();assert.equal(posts,2);
});

test('network summary distinguishes unsupported, empty and explicitly-off data with no automatic retries',async()=>{
  for(const [items,type] of [[[{label:'Wi-Fi 상태',value:null,status:'unsupported'}],'warning'],[[],'empty'],[[{label:'Wi-Fi 상태',value:'꺼짐',status:'ok'}],null]]){
    const f=fixture({fetch:async()=>ok({deviceId:'phone',sections:[{id:'wifi',items}]})});f.context.window.DeskFeedback={start(){return()=>{};},state(host,options){host.card=options;}};
    f.api.open('phone');f.api.activate(true);await f.node('overview-network-read').onclick();assert.equal(f.requests.length,1);assert.equal(f.node('overview-network-state').card?.type||null,type);
    if(type){await f.node('overview-network-state').card.onAction();assert.equal(f.requests.length,2);}
  }
});

test('overview button feedback ends immediately on tab exit even while a mocked fetch ignores abort',async()=>{
  let complete,ended=0;const f=fixture({fetch:()=>new Promise(resolve=>complete=resolve)});f.context.window.DeskFeedback={start(){return()=>{ended++;};},state(){}};
  f.api.open('phone');f.api.activate(true);const capture=f.node('overview-screen-read').onclick();assert.equal(ended,0);f.api.activate(false);assert.equal(ended,1);complete(ok({csrfToken:'old'}));await capture;assert.equal(ended,1);assert.equal(f.requests.length,1);
});
