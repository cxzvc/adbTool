import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../public/target-ui.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
  const nodes=new Map(),requests=[],stack=[],changes=[];
  let document;
  class Element{
    constructor(id='',tag='DIV'){this.id=id;this.tagName=tag;this.value='';this.dataset={};this.children=[];this.parentElement=null;this.hidden=false;this.disabled=false;this.inert=false;this.open=false;this.isConnected=true;this.textContent='';this.innerHTML='';this.listeners=new Map();this.classList={toggle(){},add(){}};if(id)nodes.set(id,this);}
    addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(fn);}
    removeEventListener(type,fn){this.listeners.set(type,(this.listeners.get(type)||[]).filter(item=>item!==fn));}
    dispatchEvent(event){event.target??=this;this['on'+event.type]?.(event);for(const fn of this.listeners.get(event.type)||[])fn(event);if(event.bubbles)this.parentElement?.dispatchEvent(event);if(event.type==='change')changes.push(this.id);return true;}
    append(...items){for(const item of items){item.parentElement=this;this.children.push(item);}}
    after(...items){const parent=this.parentElement;if(!parent)throw new Error('no parent');const index=parent.children.indexOf(this)+1;for(const item of items)item.parentElement=parent;parent.children.splice(index,0,...items);}
    closest(selector){for(let node=this;node;node=node.parentElement)if(selector==='dialog'&&node.tagName==='DIALOG')return node;return null;}
    getClientRects(){return [];}
    setAttribute(name,value){this.attributes??=new Map();this.attributes.set(name,String(value));}
    getAttribute(name){return this.attributes?.get(name)??null;}
    removeAttribute(name){this.attributes?.delete(name);}
    focus(){document.activeElement=this;}
    showModal(){assert.equal(this.open,false);this.open=true;this.previousFocus=document.activeElement;stack.push(this);document.activeElement=this;}
    close(){if(!this.open)return;this.open=false;const index=stack.indexOf(this);if(index>=0)stack.splice(index,1);document.activeElement=this.previousFocus;this.dispatchEvent({type:'close'});}
  }
  for(const [,id]of source.matchAll(/\$\('([^']+)'\)/g))if(!id.startsWith('wb-'))new Element(id,id==='target-picker'?'DIALOG':'DIV');
  for(const id of ['app-selection-stop','app-selection-remove','app-selection-backup'])new Element(id,'BUTTON');
  const body=new Element('body');document={activeElement:body,getElementById:id=>nodes.get(id)||null,createElement:tag=>new Element('',tag.toUpperCase()),querySelectorAll:()=>[],querySelector:selector=>selector==='dialog[open]'?stack.at(-1)||null:null};
  const scope={user:'0',currentUser:'0'};
  const window={AppInventory:scope,Workbench:{refreshTargets(){}},AppKnowledge:{clear(){},show(){}}};
  const context={window,document,URLSearchParams,AbortController,DeskUI:{formatBytes:n=>`${n} bytes`},Event:class{constructor(type,options={}){this.type=type;Object.assign(this,options);}},fetch:(url,options={})=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});requests.push({url,options,resolve:data=>resolve({ok:true,json:async()=>data}),reject});return promise;}};
  vm.runInNewContext(source,context);
  const node=id=>nodes.get(id),make=(id,tag='DIV',parent=body)=>{const element=new Element(id,tag);parent.append(element);return element;};
  const click=(index,open=false)=>node('target-picker-list').onclick({target:{closest:selector=>selector===(open?'[data-pick-open]':'[data-pick-index]')?{dataset:open?{pickOpen:String(index)}:{pickIndex:String(index)}}:null}});
  const api=window.DeviceTargets;api.open('phone');
  return {api,node,make,requests,scope,changes,document,stack,click,window};
}
const listing=(path,entries=[],parent='/sdcard')=>({path,parent,entries});
const directory=(path)=>({path,name:path.split('/').at(-1),type:'directory'});
const file=(path)=>({path,name:path.split('/').at(-1),type:'file',size:20});

test('folder picker navigates, clears the old folder search and returns the displayed folder after going up',async()=>{
  const f=fixture(),promise=f.api.pick('folder',{startPath:'/sdcard'});
  assert.equal(f.node('target-picker-choose').disabled,true);assert.equal(f.node('target-picker-list').inert,true);
  f.requests[0].resolve(listing('/sdcard',[directory('/sdcard/Download')],'/'));await tick();
  f.node('target-picker-search').value='download';f.node('target-picker-search').oninput();f.click(0);
  assert.equal(new URL(f.requests[1].url,'http://fake').searchParams.get('path'),'/sdcard/Download');
  assert.equal(f.node('target-picker-choose').disabled,true);
  f.requests[1].resolve(listing('/sdcard/Download',[directory('/sdcard/Download/Photos'),file('/sdcard/Download/a.txt')]));await tick();
  assert.equal(f.node('target-picker-search').value,'');assert.match(f.node('target-picker-list').innerHTML,/Photos/);assert.doesNotMatch(f.node('target-picker-list').innerHTML,/a\.txt/);
  f.node('target-picker-up').onclick();f.requests[2].resolve(listing('/sdcard',[directory('/sdcard/Download')],'/'));await tick();
  f.node('target-picker-choose').onclick();assert.equal((await promise).path,'/sdcard');assert.equal(f.node('target-picker').open,false);
});

test('Esc closes only the nested picker, resolves cancellation and restores focus to the still-open parent',async()=>{
  const f=fixture(),parent=f.make('parent','DIALOG'),button=f.make('choose-target','BUTTON',parent);parent.showModal();button.focus();
  const promise=f.api.pick('folder');assert.equal(f.stack.at(-1).id,'target-picker');let prevented=false;
  f.node('target-picker').dispatchEvent({type:'cancel',preventDefault(){prevented=true;}});
  assert.equal(await promise,null);assert.equal(prevented,true);assert.equal(parent.open,true);assert.equal(f.stack.at(-1),parent);assert.equal(f.document.activeElement,button);assert.equal(f.requests[0].options.signal.aborted,true);
  f.requests[0].resolve(listing('/stale',[directory('/stale/no')]));await tick();assert.notEqual(f.node('target-picker-path').textContent,'/stale');
});

test('external dialog close resolves its pending picker and an old close event cannot cancel a newly opened picker',async()=>{
  const f=fixture(),first=f.api.pick('folder');f.node('target-picker').close();assert.equal(await first,null);
  const second=f.api.pick('folder');f.node('target-picker').dispatchEvent({type:'close'});assert.equal(f.node('target-picker').open,true);
  f.requests[1].resolve(listing('/sdcard',[],'/'));await tick();f.node('target-picker-choose').onclick();assert.equal((await second).path,'/sdcard');
});

test('switching the device directly cancels the old picker and cannot reuse its late directory response',async()=>{
  const f=fixture(),old=f.api.pick('folder');f.api.open('second');assert.equal(await old,null);assert.equal(f.node('target-picker').open,false);
  const next=f.api.pick('folder');assert.equal(new URL(f.requests[1].url,'http://fake').searchParams.get('deviceId'),'second');
  f.requests[0].resolve(listing('/old-device',[directory('/old-device/old')]));f.requests[1].resolve(listing('/new-device',[],'/'));await tick();
  assert.equal(f.node('target-picker-path').textContent,'/new-device');f.node('target-picker-choose').onclick();assert.equal((await next).path,'/new-device');
});

test('the current-user alias cannot reuse cached apps from a previously resolved Android user',async()=>{
  const f=fixture();f.scope.user='current';f.scope.currentUser='0';f.api.updateApps([{package:'old.app',userId:'0',kind:'user'}]);f.scope.currentUser='10';
  const promise=f.api.pick('app');assert.equal(f.requests.length,1);assert.equal(new URL(f.requests[0].url,'http://fake').searchParams.get('user'),'10');
  f.requests[0].resolve({userId:'10',apps:[{package:'new.app',userId:'10',kind:'user'}]});await tick();
  assert.doesNotMatch(f.node('target-picker-list').innerHTML,/old\.app/);f.click(0);f.node('target-picker-choose').onclick();assert.equal((await promise).userId,'10');
});

test('an app response from another user remains an error and cannot become a selectable target',async()=>{
  const f=fixture(),promise=f.api.pick('app');f.requests[0].resolve({userId:'10',apps:[{package:'wrong.user.app',userId:'10'}]});await tick();
  assert.equal(f.node('target-picker-list').dataset.state,'error');assert.match(f.node('target-picker-list').innerHTML,/사용자/);assert.equal(f.node('target-picker-choose').disabled,true);f.api.cancelPicker();assert.equal(await promise,null);
});
test('changing the resolved current user during app loading cancels even when the scope alias stays current',async()=>{
  const f=fixture();f.scope.user='current';const promise=f.api.pick('app');f.scope.currentUser='10';
  f.requests[0].resolve({userId:'0',apps:[{package:'previous.profile',userId:'0'}]});await tick();
  assert.equal(await promise,null);assert.equal(f.node('target-picker').open,false);assert.doesNotMatch(f.node('target-picker-list').innerHTML,/previous\.profile/);
});

test('an app picked inside the workbench updates package and user together, and clearing it emits dependency refresh',async()=>{
  const f=fixture();f.scope.user='20';f.scope.currentUser='20';const owner=f.make('wb','DIALOG'),box=f.make('workbench-fields','DIV',owner),pkg=f.make('wb-field-package','INPUT',box),user=f.make('wb-field-user','SELECT',box);user.value='10';owner.showModal();
  f.api.decorate({id:'logs-capture',group:'logs',fields:[{name:'package',required:false},{name:'user'}]},{});
  const choose=box.children.find(node=>node.textContent==='앱 목록에서 선택'),clear=box.children.find(node=>node.textContent==='전체 앱');choose.focus();const pending=choose.onclick();
  f.requests[0].resolve({userId:'20',apps:[{package:'right.app',userId:'20'}]});await tick();f.click(0);f.node('target-picker-choose').onclick();await pending;
  assert.equal(pkg.value,'right.app');assert.equal(pkg.dataset.user,'20');assert.equal(user.value,'20');assert.equal(f.changes.filter(id=>id==='wb-field-package').length,1);
  clear.onclick();assert.equal(pkg.value,'');assert.equal(pkg.dataset.user,undefined);assert.equal(f.changes.filter(id=>id==='wb-field-package').length,2);assert.equal(owner.open,true);
});

test('prepare cannot copy a just-resolved selection into a different device before its await resumes',async()=>{
  const f=fixture(),pending=f.api.prepare({id:'file-rename',group:'files',fields:[{name:'path'}]},{});
  f.requests[0].resolve(listing('/sdcard',[file('/sdcard/old.txt')]));await tick();f.click(0);f.node('target-picker-choose').onclick();f.api.open('new-phone');
  assert.equal(await pending,null);assert.equal(f.api.file,null);
});

test('failed navigation keeps selection disabled and stale row clicks cannot confirm the previous folder',async()=>{
  const f=fixture(),promise=f.api.pick('folder');f.requests[0].resolve(listing('/sdcard',[directory('/sdcard/locked')],'/'));await tick();f.click(0);
  assert.doesNotThrow(()=>f.click(999));f.node('target-picker-choose').onclick();assert.equal(f.node('target-picker').open,true);
  f.requests[1].reject(new Error('access denied'));await tick();assert.equal(f.node('target-picker-choose').disabled,true);assert.match(f.node('target-picker-error').textContent,/access denied/);
  f.api.cancelPicker();assert.equal(await promise,null);
});

test('closing the parent dialog prevents a loaded nested picker from committing into its hidden form',async()=>{
  const f=fixture(),parent=f.make('owner','DIALOG'),trigger=f.make('trigger','BUTTON',parent);parent.showModal();trigger.focus();const promise=f.api.pick('folder');
  f.requests[0].resolve(listing('/sdcard',[],'/'));await tick();parent.close();f.node('target-picker-choose').onclick();assert.equal(await promise,null);assert.equal(f.node('target-picker').open,false);
});
test('an unrelated dialog cannot cancel another dialog\'s nested picker',async()=>{
  const f=fixture(),parent=f.make('owner','DIALOG'),other=f.make('other','DIALOG'),trigger=f.make('trigger','BUTTON',parent);parent.showModal();trigger.focus();const promise=f.api.pick('folder');
  f.api.cancelPicker(other);assert.equal(f.node('target-picker').open,true);f.api.cancelPicker(parent);assert.equal(await promise,null);assert.equal(parent.open,true);
});

const stateAction=f=>f.node('target-picker-list').onclick({target:{closest:selector=>selector==='[data-picker-state-action]'?{}:null}});
test('navigation immediately replaces old rows with loading and failed paths have an explicit read-only retry',async()=>{
  const f=fixture(),promise=f.api.pick('folder');
  assert.equal(f.node('target-picker-list').dataset.state,'loading');assert.equal(f.node('target-picker-count').textContent,'조회 중');
  f.requests[0].resolve(listing('/sdcard',[directory('/sdcard/locked')],'/'));await tick();f.click(0);
  assert.equal(f.node('target-picker-path').textContent,'/sdcard/locked');assert.equal(f.node('target-picker-list').dataset.state,'loading');assert.doesNotMatch(f.node('target-picker-list').innerHTML,/data-pick-index/);
  f.node('target-picker-search').value='old';f.node('target-picker-search').oninput();assert.equal(f.node('target-picker-list').dataset.state,'loading');
  f.requests[1].reject(new Error('permission denied'));await tick();
  assert.match(f.node('target-picker-selected').textContent,/조회하지 못한 폴더: \/sdcard\/locked/);assert.match(f.node('target-picker-list').innerHTML,/다시 조회/);assert.equal(f.node('target-picker-choose').disabled,true);assert.equal(f.requests.length,2);
  stateAction(f);stateAction(f);assert.equal(f.requests.length,3);assert.equal(new URL(f.requests[2].url,'http://fake').searchParams.get('path'),'/sdcard/locked');
  f.requests[2].resolve(listing('/sdcard/locked',[],'/sdcard'));await tick();f.node('target-picker-choose').onclick();assert.equal((await promise).path,'/sdcard/locked');
  assert.ok(f.requests.every(request=>!request.options.method||request.options.method==='GET'));
});

test('up after failed navigation goes to the failed path parent instead of skipping the last good folder',async()=>{
  const f=fixture(),promise=f.api.pick('folder',{startPath:'/sdcard/Download'});f.requests[0].resolve(listing('/sdcard/Download',[directory('/sdcard/Download/locked')],'/sdcard'));await tick();f.click(0);
  f.requests[1].reject(new Error('denied'));await tick();f.node('target-picker-up').onclick();
  assert.equal(new URL(f.requests[2].url,'http://fake').searchParams.get('path'),'/sdcard/Download');assert.equal(f.node('target-picker-up').getAttribute('aria-busy'),'true');
  f.requests[2].resolve(listing('/sdcard/Download',[],'/sdcard'));await tick();assert.equal(f.node('target-picker-up').getAttribute('aria-busy'),null);f.api.cancelPicker();assert.equal(await promise,null);
});

test('empty folders, missing eligible folders and zero search results have different states and search reset does not fetch',async()=>{
  const f=fixture(),promise=f.api.pick('folder');f.requests[0].resolve(listing('/sdcard',[directory('/sdcard/Download')],'/'));await tick();
  f.node('target-picker-search').value='unmatched';f.node('target-picker-search').oninput();assert.match(f.node('target-picker-list').innerHTML,/검색 결과가 없습니다/);assert.match(f.node('target-picker-list').innerHTML,/검색어 지우기/);
  stateAction(f);assert.equal(f.requests.length,1);assert.equal(f.node('target-picker-search').value,'');assert.match(f.node('target-picker-list').innerHTML,/Download/);
  f.node('target-picker-home').onclick();f.requests[1].resolve(listing('/sdcard',[file('/sdcard/a.txt')],'/'));await tick();assert.match(f.node('target-picker-list').innerHTML,/선택할 하위 폴더가 없습니다/);assert.doesNotMatch(f.node('target-picker-list').innerHTML,/빈 폴더입니다/);assert.equal(f.node('target-picker-choose').disabled,false);
  stateAction(f);f.requests[2].resolve(listing('/sdcard',[],'/'));await tick();assert.match(f.node('target-picker-list').innerHTML,/빈 폴더입니다/);f.node('target-picker-choose').onclick();assert.equal((await promise).path,'/sdcard');
});

test('network failures are distinct from empty apps and only an explicit retry issues another read',async()=>{
  const f=fixture(),promise=f.api.pick('app');f.requests[0].reject(new Error('Failed to fetch'));await tick();assert.equal(f.node('target-picker-list').dataset.state,'offline');assert.equal(f.requests.length,1);
  stateAction(f);assert.equal(f.requests.length,2);assert.equal(f.node('target-picker-list').dataset.state,'loading');
  f.requests[1].resolve({userId:'0',apps:[]});await tick();assert.equal(f.node('target-picker-error').hidden,true);assert.equal(f.node('target-picker-list').dataset.state,'empty');assert.match(f.node('target-picker-list').innerHTML,/표시할 앱이 없습니다/);
  f.api.cancelPicker();assert.equal(await promise,null);
});

test('shared feedback finalizes on cancellation and a saved old retry callback cannot query a replacement picker',async()=>{
  const f=fixture(),states=[],progress=[];
  f.window.DeskFeedback={start(label,options){const row={label,button:options.button,done:0};progress.push(row);return()=>row.done++;},state(host,options){host.innerHTML=options.title;states.push(options);}};
  const first=f.api.pick('folder');assert.equal(states.at(-1).type,'loading');assert.equal(progress[0].done,0);f.requests[0].reject(new Error('offline'));await tick();const retry=states.at(-1).onAction;assert.equal(progress[0].done,1);
  f.api.cancelPicker();assert.equal(await first,null);const second=f.api.pick('folder');const count=f.requests.length;retry();assert.equal(f.requests.length,count);
  f.api.cancelPicker();assert.equal(await second,null);assert.equal(progress.at(-1).done,1);f.requests[1].resolve(listing('/late',[],'/'));await tick();assert.notEqual(f.node('target-picker-path').textContent,'/late');assert.equal(progress.at(-1).done,1);
});

test('root picker normalizes legacy double-slash entries before loading and preserves the normalized failed path on retry',async()=>{
  const f=fixture(),promise=f.api.pick('folder',{startPath:'/'});
  f.requests[0].resolve(listing('/',[directory('//data')],null));await tick();f.click(0);
  assert.equal(new URL(f.requests[1].url,'http://fake').searchParams.get('path'),'/data');assert.equal(f.node('target-picker-path').textContent,'/data');
  f.requests[1].reject(new Error('Permission denied'));await tick();assert.match(f.node('target-picker-error').textContent,/Permission denied/);assert.equal(f.node('target-picker-path').textContent,'/data');
  stateAction(f);assert.equal(new URL(f.requests[2].url,'http://fake').searchParams.get('path'),'/data');
  f.api.cancelPicker();assert.equal(await promise,null);
});

test('file picker explains denied reads in Korean and keeps escaped raw diagnostics separate',async()=>{
  const f=fixture(),promise=f.api.pick('folder',{startPath:'/sdcard/Android/data'});f.requests[0].reject(new Error('ls: Permission denied <img src=x>'));await tick();
  const html=f.node('target-picker-list').innerHTML;assert.equal(f.node('target-picker-list').dataset.state,'error');assert.match(html,/접근|권한/);assert.match(html,/소유자.*Android 저장소 정책.*SELinux/);assert.match(html,/공유 저장소/);assert.doesNotMatch(html.split('<details>')[0],/Permission denied/);assert.match(html,/<summary>오류 원문<\/summary>/);assert.match(html,/Permission denied &lt;img src=x&gt;/);assert.doesNotMatch(html,/<img/);assert.equal(f.node('target-picker-choose').disabled,true);assert.equal(f.requests.length,1);f.api.cancelPicker();assert.equal(await promise,null);
});

test('successful HTTP responses with denied or incomplete zero-entry listings are never treated as empty selectable folders',async()=>{
  for(const extra of [{error:'Permission denied'},{partial:true,warnings:['ls: Permission denied'],errors:[],denied:['/data']},{partial:true,warnings:[],errors:[{path:'/data',operation:'list',message:'조회 거부',rawError:'ls: Permission denied',code:'EACCES'}]}]){
    const f=fixture(),promise=f.api.pick('folder',{startPath:'/data'});f.requests[0].resolve({...listing('/data',[],'/'),...extra});await tick();assert.equal(f.node('target-picker-list').dataset.state,'error');assert.doesNotMatch(f.node('target-picker-list').innerHTML,/빈 폴더입니다/);assert.equal(f.node('target-picker-choose').disabled,true);f.node('target-picker-choose').onclick();assert.equal(f.node('target-picker').open,true);assert.equal(f.requests.length,1);f.api.cancelPicker();assert.equal(await promise,null);
  }
});

test('partial directory listings keep visible navigation but cannot approve the incompletely read folder',async()=>{
  const f=fixture(),promise=f.api.pick('folder',{startPath:'/sdcard'});f.requests[0].resolve({...listing('/sdcard',[directory('/sdcard/Download')],'/'),partial:true,warnings:[],errors:[{path:'/sdcard/private',operation:'stat',message:'일부 항목 확인 불가',rawError:'stat: Permission denied'}],denied:['/sdcard/private']});await tick();
  assert.equal(f.node('target-picker-list').dataset.state,'warning');assert.match(f.node('target-picker-list').innerHTML,/Download/);assert.match(f.node('target-picker-list').innerHTML,/일부/);assert.equal(f.node('target-picker-choose').disabled,true);assert.match(f.node('target-picker-count').textContent,/일부 조회/);
  f.click(0);f.requests[1].resolve(listing('/sdcard/Download',[],'/sdcard'));await tick();assert.equal(f.node('target-picker-choose').disabled,false);f.node('target-picker-choose').onclick();assert.equal((await promise).path,'/sdcard/Download');assert.ok(f.requests.every(request=>!request.options.method||request.options.method==='GET'));
});

test('file picker forwards exact file action and path to the shared Korean error explanation',async()=>{
  const f=fixture(),seen=[],states=[];f.window.DeskErrors={explain(raw,context){seen.push({raw,context});return{code:'scoped_storage',titleKo:'앱 전용 공유 저장소 접근 제한',reasonKo:'현재 연결에서 앱 전용 영역을 읽을 수 없습니다.',requiredAccessKo:'Android 저장소 정책에서 허용하는 조회 범위가 필요합니다.',alternativesKo:['앱의 내보내기로 제공된 공유 파일을 선택하세요.'],rawError:raw,recognized:true};}};f.window.DeskFeedback={state(host,value){host.innerHTML=value.title;states.push(value);}};
  const promise=f.api.pick('folder',{startPath:'/sdcard/Android/data'});f.requests[0].reject(new Error('Permission denied'));await tick();assert.equal(seen[0].raw,'Permission denied');assert.equal(seen[0].context.context,'files');assert.equal(seen[0].context.action,'list');assert.equal(seen[0].context.path,'/sdcard/Android/data');assert.equal(states.at(-1).rawError,'Permission denied');assert.match(states.at(-1).requiredAccessKo,/저장소 정책/);assert.match(states.at(-1).title,/앱 전용/);assert.doesNotMatch(states.at(-1).message,/root|Permission denied/i);assert.equal(f.requests.length,1);f.api.cancelPicker();assert.equal(await promise,null);
});

test('actual shared file error helper preserves transport failures as offline rather than empty results',async()=>{
  const f=fixture();vm.runInNewContext(await readFile(new URL('../public/error-help.js',import.meta.url),'utf8'),{window:f.window});const promise=f.api.pick('folder',{startPath:'/sdcard'});f.requests[0].reject(new Error('Failed to fetch'));await tick();assert.equal(f.node('target-picker-list').dataset.state,'offline');assert.doesNotMatch(f.node('target-picker-list').innerHTML.split('<details>')[0],/Failed to fetch/);assert.equal(f.node('target-picker-choose').disabled,true);assert.equal(f.requests.length,1);f.api.cancelPicker();assert.equal(await promise,null);
});
