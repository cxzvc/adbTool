import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../public/file-location-tools.js',import.meta.url),'utf8');
function fixture(handler,{shared=true}={}){
  let dialog;const calls=[],states=[],explained=[];
  function element(tag='div'){
    const e={tagName:tag.toUpperCase(),children:new Map(),appended:[],open:false,value:'',textContent:'',hidden:false,disabled:false,checked:false,attributes:{},classList:{toggle(){}},listeners:new Map(),addEventListener(name,fn){this.listeners.set(name,fn);},append(...items){this.appended.push(...items);},setAttribute(name,value){this.attributes[name]=value;},removeAttribute(name){delete this.attributes[name];},querySelector(selector){if(!this.children.has(selector))this.children.set(selector,element());return this.children.get(selector);},querySelectorAll(){return[];},showModal(){this.open=true;},close(){this.open=false;}};
    let html='';Object.defineProperty(e,'innerHTML',{get(){return html;},set(value){html=value;this.children=new Map();}});return e;
  }
  const window={DeskUI:{formatBytes:value=>value+' B'},DeskFeedback:{start:()=>()=>{},state(host,options){host.feedback=options;host.textContent=[options.title,options.message].filter(Boolean).join(' · ');states.push(options);}},DeviceOps:{refreshJobs(){},browse:()=>assert.fail('must not browse automatically')}};
  if(shared)window.DeskErrors={explain(raw,context){explained.push({raw,context});return{code:/offline/i.test(raw)?'offline':'permission_denied',titleKo:'대상 경로 접근 제한',reasonKo:'현재 연결의 접근 범위로 작업을 확인하지 못했습니다.',requiredAccessKo:'파일 소유자·상위 폴더 권한과 Android 보안 정책의 허용 범위를 확인해야 합니다.',alternativesKo:['공유 저장소의 접근 가능한 위치를 목록에서 선택하세요.','파일 정보에서 소유자와 접근 권한을 읽어 확인하세요.'],rawError:String(raw),recognized:true};}};
  const context={window,URLSearchParams,setTimeout,document:{createElement(tag){const e=element(tag);if(tag==='dialog')dialog=e;return e;},body:{append(){}}},fetch:async(url,options)=>{calls.push({url,options});if(url==='/api/session')return{ok:true,json:async()=>({csrfToken:'fake'})};const answer=await handler(url,options);return{ok:answer.ok!==false,json:async()=>answer.data??answer};}};
  vm.runInNewContext(source,context);
  return{api:window.FileLocations,calls,states,explained,get dialog(){return dialog;},get content(){return dialog.querySelector('[data-fl-content]');}};
}
const scanResult=extra=>({observedFiles:0,checkedFiles:0,hashedFiles:0,hashedBytes:0,limited:false,duplicates:[],equal:null,errors:[],error:null,notice:'조회된 범위만 확인합니다.',...extra});
function scanFixture(result,state='success',options){const f=fixture(async(url)=>url.startsWith('/api/ops/file-duplicates')?{id:'job-1'}:url.startsWith('/api/ops/file-location-result')?{state,message:state==='success'?'검사 작업 완료':'Permission denied',result}:assert.fail(url),options);f.api.openDuplicates({deviceId:'mock',path:'/sdcard/Android/data'});f.content.querySelector('[data-fl-scan-path]').value='/sdcard/Android/data';f.content.querySelector('[data-fl-max-files]').value='200';f.content.querySelector('[data-fl-max-bytes]').value='1000000000';return f;}
const withoutRaw=html=>html.replace(/<details>[\s\S]*?<\/details>/g,'');

test('unreadable storage is a partial access state with Korean explanation and escaped raw diagnostics',async()=>{
  const f=fixture(async()=>({volumes:[{displayName:'내장 저장소',path:'/sdcard/Android/data',kind:'공유 저장소',state:'연결됨',readable:false,capacity:null,reason:'Permission denied <img src=x>'}],warnings:[],notice:'조회 완료'}));await f.api.openVolumes({deviceId:'mock'});
  assert.equal(f.states.at(-1).type,'warning');assert.doesNotMatch(f.states.at(-1).message,/빈 폴더|파일이 없습니다/);assert.match(withoutRaw(f.content.innerHTML),/접근 제한|보안 정책/);assert.doesNotMatch(withoutRaw(f.content.innerHTML),/Permission denied/);assert.match(f.content.innerHTML,/Permission denied &lt;img src=x&gt;/);assert.doesNotMatch(f.content.innerHTML,/<img/);assert.match(f.content.innerHTML,/data-fl-volume="0" disabled/);assert.ok(f.explained.some(row=>row.context.path==='/sdcard/Android/data'));assert.equal(f.calls.length,1);
});

test('storage discovery warnings with no rows are errors, not an empty storage claim',async()=>{
  const f=fixture(async()=>({volumes:[],warnings:['dumpsys mount: Permission denied'],notice:''}));await f.api.openVolumes({deviceId:'mock'});assert.equal(f.states.at(-1).type,'error');assert.match(f.states.at(-1).reasonKo||f.states.at(-1).message,/접근 범위/);assert.equal(f.states.at(-1).rawError,'dumpsys mount: Permission denied');assert.equal(f.states.at(-1).errorContext.action,'file-volumes');assert.equal(f.calls.length,1);
});

test('zero observed files plus denied results remain incomplete and never claim an empty folder or no duplicates',async()=>{
  const f=scanFixture(scanResult({errors:[{path:'/sdcard/Android/data',message:'Permission denied'}]}));await f.content.querySelector('[data-fl-run]').onclick();assert.equal(f.states.at(-1).type,'warning');assert.doesNotMatch(f.states.at(-1).message,/파일이 없습니다/);const html=f.content.querySelector('[data-fl-results]').innerHTML;assert.match(html,/전체 중복 여부를 확인할 수 없습니다/);assert.doesNotMatch(html,/일치하는 내용의 묶음을 찾지 못했습니다/);assert.doesNotMatch(withoutRaw(html),/Permission denied/);assert.match(html,/<summary>오류 원문<\/summary>/);assert.equal(f.calls.filter(call=>call.options.method==='POST').length,1);
});

test('failed scans with partial zero results do not overwrite the error with an empty-state message',async()=>{
  for(const detail of [scanResult({error:'find: Permission denied'}),scanResult()]){const f=scanFixture(detail,'error');await f.content.querySelector('[data-fl-run]').onclick();assert.equal(f.states.at(-1).type,'error');assert.doesNotMatch(f.states.at(-1).message,/파일이 없습니다/);assert.doesNotMatch(f.content.querySelector('[data-fl-results]').innerHTML,/일치하는 내용의 묶음을 찾지 못했습니다/);}
});

test('a genuinely empty successful scan differs from a scan limited before all data was read',async()=>{
  const empty=scanFixture(scanResult());await empty.content.querySelector('[data-fl-run]').onclick();assert.equal(empty.states.at(-1).type,'empty');assert.match(empty.states.at(-1).message,/파일이 없습니다/);
  const partial=scanFixture(scanResult({limited:true}));await partial.content.querySelector('[data-fl-run]').onclick();assert.equal(partial.states.at(-1).type,'warning');assert.doesNotMatch(partial.states.at(-1).message,/파일이 없습니다/);
});

test('folder preview denial offers only a fresh preview retry and preserves action/path context',async()=>{
  const f=fixture(async(url)=>url.startsWith('/api/ops/file-mkdir-preview')?{ok:false,data:{error:'mkdir preview: Permission denied'}}:assert.fail(url));f.api.openNested({deviceId:'mock',parent:'/sdcard/locked'});f.content.querySelector('[data-fl-parent]').value='/sdcard/locked';f.content.querySelector('[data-fl-name]').value='new';await f.content.querySelector('[data-fl-preview]').onclick();
  assert.equal(f.states.at(-1).type,'error');assert.equal(f.states.at(-1).errorContext.action,'file-mkdir-preview');assert.equal(f.states.at(-1).errorContext.path,'/sdcard/locked');assert.equal(f.states.at(-1).rawError,'mkdir preview: Permission denied');assert.match(f.states.at(-1).requiredAccessKo,/소유자/);await f.states.at(-1).onAction();assert.equal(f.calls.filter(call=>call.url.startsWith('/api/ops/file-mkdir-preview')).length,2);assert.ok(f.calls.every(call=>call.url==='/api/session'||call.url.startsWith('/api/ops/file-mkdir-preview')));
});

test('fallback file errors remain Korean and do not infer that all denied paths require root',async()=>{
  const f=fixture(async()=>({volumes:[{displayName:'USB',path:'/storage/usb',readable:false,reason:'Permission denied'}],warnings:[],notice:''}),{shared:false});await f.api.openVolumes({deviceId:'mock'});const visible=withoutRaw(f.content.innerHTML);assert.match(visible,/소유자.*Android 저장소 정책.*SELinux/);assert.match(visible,/확정할 수 없습니다/);assert.doesNotMatch(visible,/Permission denied|root|루트/i);assert.match(visible,/공유 저장소/);
});
