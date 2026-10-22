import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {compatibility} from '../lib/compatibility.mjs';
const code=name=>readFileSync(new URL('../public/'+name+'.js',import.meta.url),'utf8');
function simple(){const context={window:{}};for(const file of ['compatibility-ui','firmware-review-ui'])vm.runInNewContext(code(file),context);return context.window;}
const current=({readable=true,writeAllowed=false,...rest}={})=>compatibility({readable,writeAllowed,...rest});

test('settings show one action state and retain long evidence only in the details dialog',()=>{
  const ui=simple(),evidence={file:'services/example.java',line:10,note:'사용처',excerpt:'<script>unsafe</script>'};
  const row={title:'설정',key:'demo',namespace:'system',available:false,readable:true,compatibility:current({access:'denied',evidence:'current',reasonKo:'android.permission.EXAMPLE 전체 오류 원문'}),evidence:[evidence],firmwareReview:{currentBuild:true,reason:'긴 코드 근거',application:{writeBlocked:true,status:'managed-state',evidence:[evidence]}}};
  const main=ui.SettingFirmwareUI.badge(row)+ui.SettingFirmwareUI.details(row);
  assert.equal((main.match(/class="compatibility-badge /g)||[]).length,1);
  assert.match(main,/조회만 가능/);assert.match(main,/시스템이 관리하는 상태값/);assert.match(main,/상세 정보/);
  assert.doesNotMatch(main,/android.permission|services\/example|<details|기능:|권한:|검증:/);
  const detail=ui.CompatibilityUI.detailContent(row.compatibility,ui.SettingFirmwareUI.options(row));
  assert.equal((detail.match(/services\/example.java:10/g)||[]).length,1);
  assert.match(detail,/android.permission.EXAMPLE/);assert.match(detail,/&lt;script&gt;/);assert.doesNotMatch(detail,/<script>/);
});

test('previous build related-setting navigation remains outside details and write flags never come from editable',()=>{
  const ui=simple(),row={title:'설정',key:'old',value:'1',editable:true,compatibility:current({evidence:'previous'}),firmwareReview:{currentBuild:false,writeBlocked:true,reference:{correction:{description:'이전 설명'},application:{alternative:'system:new',reason:'이전 조건'}}}};
  const html=ui.SettingFirmwareUI.details(row,{inventory:true});
  assert.match(html,/data-setting-alternative="system:new"/);assert.doesNotMatch(html,/<details|이전 설명/);
  assert.equal(ui.SettingFirmwareUI.options(row).canAct,false);
  assert.equal(ui.SettingFirmwareUI.options(row,{inventory:true}).mode,'read');
  assert.equal(ui.SettingFirmwareUI.options({...row,available:true}).canAct,false);
  const permitted={...row,firmwareReview:null,available:true,compatibility:current({writeAllowed:true})};
  assert.equal(ui.SettingFirmwareUI.options(permitted).canAct,true);
  assert.match(ui.SettingFirmwareUI.badge(permitted),/변경 요청 가능/);
});

function fixture(){
  const nodes=new Map(),listeners=new Map(),requests=[];
  const element=id=>{if(!nodes.has(id)){const handlers=new Map();nodes.set(id,{id,innerHTML:'',textContent:'',hidden:false,value:'',disabled:false,dataset:{},style:{setProperty(){},getPropertyValue(){return'';}},classList:{add(){},remove(){},toggle(){}},setAttribute(){},removeAttribute(){},addEventListener(type,fn){if(!handlers.has(type))handlers.set(type,[]);handlers.get(type).push(fn);},handlers,querySelector(){return null;},querySelectorAll(){return[];},pause(){},getContext(){return{clearRect(){}};},scrollIntoView(){},getBoundingClientRect(){return{top:0};}});}return nodes.get(id);};
  const document={getElementById:element,body:element('body'),querySelector:selector=>element(selector),querySelectorAll:()=>[],addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(fn);}};
  const context={window:{addEventListener(){},dispatchEvent(){}},document,URLSearchParams,AbortController,AbortSignal,clearInterval,setTimeout,clearTimeout,ResizeObserver:class{observe(){}},CustomEvent:class{constructor(type,data){this.type=type;this.detail=data?.detail;}},DeskFeedback:{clear(){},start:()=>()=>{},paint:(_label,fn)=>fn(),state(node,config){node.feedback=config;node.innerHTML='';}},fetch(url,options={}){assert.equal(options.method||'GET','GET');let resolve;const promise=new Promise(done=>resolve=done);requests.push({url,resolve});return promise;}};
  for(const name of ['compatibility-ui','firmware-review-ui','device'])vm.runInNewContext(code(name),context);
  for(const fn of listeners.get('DOMContentLoaded')||[])fn();
  const respond=(index,data,ok=true)=>requests[index].resolve({ok,json:async()=>data});
  return{...context,nodes,element,requests,respond,listeners};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const payload=(title='테스트 설정',extra={})=>({device:{id:'MOCK',model:'테스트 기기'},userId:'0',settings:[{title,key:'demo',namespace:'system',category:'test',description:'화면의 테스트 동작을 설정합니다.',value:'1',available:false,readable:true,compatibility:current({access:'denied',reasonKo:'긴 권한 설명'}),options:[{label:'켜기',value:1}],...extra}],categories:[{id:'test',title:'테스트',description:''}],history:[]});

test('real device and shared presentation modules keep denied settings disabled and current values visible',async()=>{
  const f=fixture();f.window.DeviceDesk.open('MOCK');assert.equal(f.requests.length,1);
  f.respond(0,payload());await tick();
  const html=f.element('settings-groups').innerHTML;
  assert.match(html,/조회만 가능/);assert.match(html,/data-apply-setting="demo" disabled/);assert.match(html,/저장값/);
  assert.equal((html.match(/class="compatibility-badge /g)||[]).length,1);
  assert.doesNotMatch(html,/firmware-review-badge|ADB 키·설명|긴 권한 설명/);
  assert.match(html,/현재 ADB 권한/);
});

test('real settings loader displays retry after failure and rejects an old device response',async()=>{
  const f=fixture();f.window.DeviceDesk.open('MOCK_A');f.window.DeviceDesk.open('MOCK_B');
  f.respond(1,payload('새 기기 설정'));await tick();f.respond(0,payload('이전 기기 설정'));await tick();
  assert.match(f.element('settings-groups').innerHTML,/새 기기 설정/);assert.doesNotMatch(f.element('settings-groups').innerHTML,/이전 기기 설정/);
  f.window.DeviceDesk.open('MOCK_C');f.respond(2,{error:'조회 응답 없음'},false);await tick();
  const state=f.element('settings-groups').feedback;assert.equal(state.type,'error');assert.equal(typeof state.onAction,'function');
  const task=state.onAction();assert.equal(f.requests.length,4);f.respond(3,payload('재조회 설정'));await task;
  assert.match(f.element('settings-groups').innerHTML,/재조회 설정/);
});

test('real explorer preserves raw editor entry without claiming write permission and keeps previous-build restricted rows read-only',async()=>{
  const f=fixture();f.window.DeviceDesk.open('MOCK');f.respond(0,payload());await tick();
  for(const id of ['explorer-scope','explorer-help-level','explorer-firmware'])f.element(id).value='all';f.element('explorer-page-size').value='30';
  f.window.DeviceDesk.navigate('explorer');assert.equal(f.requests.length,2);
  const common={namespace:'system',value:'0',description:'설정 기능 설명',descriptionLevel:'described',compatibility:current()};
  f.respond(1,{entries:[{...common,key:'raw',title:'일반 저장값',editable:false},{...common,key:'locked',title:'이전 빌드 제한',editable:false,firmwareReview:{currentBuild:false,writeBlocked:true,reference:{application:{alternative:'system:raw'}}}}]});await tick();
  const html=f.element('explorer-list').innerHTML;
  assert.match(html,/data-edit-raw="raw"/);assert.doesNotMatch(html,/data-edit-raw="locked"/);assert.match(html,/data-setting-alternative="system:raw"/);
  assert.doesNotMatch(html,/변경 요청 가능|help-level|code-evidence|<details/);
  assert.equal((html.match(/class="compatibility-badge /g)||[]).length,2);
});

test('refreshing or failed settings cannot regain enabled save buttons through filtering old data',async()=>{
  const f=fixture(),allowed={available:true,readable:true,compatibility:current({writeAllowed:true})};
  f.window.DeviceDesk.open('MOCK');f.respond(0,payload('편집 가능한 설정',allowed));await tick();
  assert.match(f.element('settings-groups').innerHTML,/data-apply-setting="demo" >값 저장/);
  f.element('settings-refresh').handlers.get('click')[0]();
  assert.match(f.element('settings-groups').innerHTML,/조회 중/);assert.match(f.element('settings-groups').innerHTML,/이전 조회값/);
  assert.match(f.element('settings-groups').innerHTML,/data-apply-setting="demo" disabled/);
  f.respond(1,{error:'연결 끊김'},false);await tick();
  f.element('settings-search').handlers.get('input')[0]({target:{value:'demo'}});
  let html=f.element('settings-groups').innerHTML;assert.match(html,/조회 실패/);assert.match(html,/이전 조회값/);assert.match(html,/data-apply-setting="demo" disabled/);
  f.element('settings-refresh').handlers.get('click')[0]();f.respond(2,payload('편집 가능한 설정',allowed));await tick();
  html=f.element('settings-groups').innerHTML;assert.match(html,/data-apply-setting="demo" >값 저장/);assert.doesNotMatch(html,/이전 조회값/);
});
