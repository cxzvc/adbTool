import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../public/popup-help.js',import.meta.url),'utf8');

function harness({explain}={}){
  const calls=[];
  class Element {
    constructor(){this.children=[];this.dataset={};this.listeners={};this.innerHTML='';this.open=false;}
    setAttribute(){}
    after(child){const parent=this.parent;child.parent=parent;parent.children.splice(parent.children.indexOf(this)+1,0,child);}
    prepend(child){child.parent=this;this.children.unshift(child);}
    remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);}
    addEventListener(type,callback){(this.listeners[type]??=[]).push(callback);}
    querySelector(){return this.header||null;}
    close(){this.open=false;for(const callback of this.listeners.close||[])callback();}
  }
  const window={...(explain?{DeskErrors:{explain}}:{})};vm.runInNewContext(source,{window,document:{createElement:()=>new Element()},fetch:()=>{calls.push('fetch');throw new Error('Unexpected request');}});
  const dialog=(header=true)=>{const d=new Element();d.open=true;if(header){d.header=new Element();d.header.parent=d;d.children.push(d.header);}return d;};
  const content=d=>d.children.find(child=>child.className==='popup-help')?.innerHTML||'';
  return{api:window.PopupHelp,dialog,content,calls};
}

test('all dedicated surfaces and reused file modes explain purpose, usage, effect and support without a request',()=>{
  const h=harness();
  const expected=['server-info','device-info','wireless-pair','process-stop','package-manager','file-manager','target-picker','device-alias','device-bookmark','file-batch','file-gallery','file-volumes','file-mkdir-preview','file-duplicates','file-compare','file-preview','archive-list','archive-create','mirror-compare'];
  assert.deepEqual([...h.api.keys],expected);
  for(const key of expected){const dialog=h.dialog();assert.equal(h.api.show(dialog,key,{deviceId:'PHONE'}),true);const text=h.content(dialog);for(const label of ['기능·현재 상태·사용법','<dt>기능</dt>','<dt>사용법</dt>','<dt>실행 영향</dt>','<dt>지원·제한</dt>','상세 상태 미조회'])assert.ok(text.includes(label),key+' '+label);assert.ok(!text.includes('<input'));}
  assert.deepEqual(h.calls,[]);
});

test('only a real supplied read timestamp is presented as a snapshot and unknown support is not success',()=>{
  const h=harness(),d=h.dialog();h.api.show(d,'process-stop',{deviceId:'P',pid:10,status:'현재 프로세스 조회 중'});
  assert.match(h.content(d),/지원 조건 확인/);assert.match(h.content(d),/선택 정보 · 상세 상태 미조회/);assert.doesNotMatch(h.content(d),/조회 시각/);
  h.api.update(d,{status:'종료 권한 없음',supported:false,supportReason:'다른 UID의 프로세스에 신호를 보낼 권한이 없습니다.',checkedAt:'2026-10-20T02:00:00Z'});
  assert.match(h.content(d),/현재 사용 불가/);assert.match(h.content(d),/다른 UID/);assert.match(h.content(d),/조회 시각/);
});

test('changing a target drops stale success, reason and snapshot without triggering a read or execution',()=>{
  const h=harness(),d=h.dialog();h.api.show(d,'file-manager',{deviceId:'P',path:'/old',supported:true,status:'기존 파일 확인 완료',supportReason:'기존 파일 읽기 가능',checkedAt:'2026-10-20T02:00:00Z'});
  h.api.update(d,{path:'/new'});const text=h.content(d);assert.match(text,/위치 \/new/);assert.doesNotMatch(text,/기존 파일|조회 시각|조회로 확인한 범위/);assert.match(text,/상세 상태 미조회/);assert.deepEqual(h.calls,[]);
});

test('arbitrary target, state and reason text is escaped and never becomes a control',()=>{
  const h=harness(),d=h.dialog(),evil='<img src=x onerror="run()">';h.api.show(d,'package-manager',{deviceId:evil,package:evil,userId:evil,status:'현재 '+evil,supportReason:'이유 '+evil,effect:'영향 '+evil});
  const text=h.content(d);assert.doesNotMatch(text,/<img|<script|<input|<button/);assert.match(text,/&lt;img src=x onerror=&quot;run\(\)&quot;&gt;/);assert.deepEqual(h.calls,[]);
});

test('closing clears the widget and prevents stale callback updates; reopening uses the new context once',()=>{
  const h=harness(),d=h.dialog();h.api.show(d,'file-manager',{path:'/old'});d.close();assert.equal(h.content(d),'');assert.equal(h.api.update(d,{path:'/stale'}),false);
  d.open=true;h.api.show(d,'package-manager',{package:'com.example.app'});h.api.show(d,'package-manager',{package:'com.example.new'});assert.equal(d.children.filter(n=>n.className==='popup-help').length,1);assert.equal(d.listeners.close.length,1);assert.match(h.content(d),/com.example.new/);assert.doesNotMatch(h.content(d),/\/old/);assert.deepEqual(h.calls,[]);
});

test('local alias and bookmark explain browser storage and links without claiming device state',()=>{
  const h=harness();for(const key of ['device-alias','device-bookmark']){const d=h.dialog();h.api.show(d,key,{local:true,deviceId:'P'});assert.match(h.content(d),/이 브라우저의 저장 정보 · 폰 상세 조회 없음/);assert.doesNotMatch(h.content(d),/조회 시각/);}
  assert.match(h.content((()=>{const d=h.dialog();h.api.show(d,'device-bookmark');return d;})()),/파일 자체를 공유하는 기능이 아닙니다/);
});

test('backups, app-wide stops and mirror server startup are described without calling them harmless queries',()=>{
  const h=harness(),check=key=>{const d=h.dialog();h.api.show(d,key);return h.content(d);};
  assert.match(check('package-manager'),/APK 백업은 설치 파일 보관이며 로그인·앱 내부 데이터 백업이 아닙니다/);
  assert.match(check('process-stop'),/TERM·KILL은 선택 PID만/);assert.match(check('process-stop'),/같은 앱의 모든 프로세스/);
  assert.match(check('mirror-compare'),/화면 전송 서버 실행/);assert.match(check('mirror-compare'),/목록 조회만으로 영상은 시작하지 않습니다/);assert.deepEqual(h.calls,[]);
});

test('an unclassified English error receives a Korean explanation without inventing a missing permission',()=>{
  const h=harness(),d=h.dialog();h.api.show(d,'file-preview',{status:'EIO failed',supportReason:'Bad response'});assert.match(h.content(d),/조회·작업 응답을 확인해야 합니다/);assert.match(h.content(d),/제한 원인은 응답만으로 확정하지 않습니다/);assert.doesNotMatch(h.content(d),/Bad response|EIO failed|루팅 필요/);
});

test('English permission denials use Korean reasons and required access, without guessing root or unsupported',()=>{
  const seen=[],h=harness({explain:(raw,context)=>{seen.push({raw,context});return{recognized:true,reasonKo:'이 경로는 현재 ADB에서 읽을 수 없습니다.',requiredAccessKo:'파일과 상위 폴더 읽기 접근이 필요합니다.'};}}),d=h.dialog();
  h.api.show(d,'file-preview',{deviceId:'P',path:'/data/private',status:'Permission denied',supportReason:'Permission denied'});
  assert.match(h.content(d),/이 경로는 현재 ADB에서 읽을 수 없습니다/);assert.match(h.content(d),/파일과 상위 폴더 읽기 접근이 필요합니다/);assert.match(h.content(d),/지원 조건 확인/);assert.doesNotMatch(h.content(d),/Permission denied|루팅 필요|현재 사용 불가/);assert.ok(seen.every(item=>item.context.context==='files'&&item.context.path==='/data/private'));assert.deepEqual(h.calls,[]);
  const fallback=harness(),plain=fallback.dialog();fallback.api.show(plain,'file-gallery',{status:'Permission denied',supportReason:'EACCES'});assert.match(fallback.content(plain),/현재 ADB 권한/);assert.match(fallback.content(plain),/SELinux 중 어느 제한인지는 오류 문구만으로 확정할 수 없습니다/);
});

test('widgets mount after a header or at the start without wrapping or copying action forms',()=>{
  const h=harness(),d=h.dialog(),first=d.children[0];h.api.show(d,'file-batch');assert.equal(d.children[0],first);assert.equal(d.children[1].className,'popup-help');const plain=h.dialog(false);h.api.show(plain,'file-preview');assert.equal(plain.children[0].className,'popup-help');assert.equal(h.api.show(plain,'missing'),false);assert.equal(h.api.update(null),false);
});

test('a title inside the existing close-button flex row mounts help after that row',()=>{
  const h=harness(),d=h.dialog(false),row={after(node){d.children.push(node);node.parent=d;}},title={closest:selector=>selector==='.dialog-top'?row:null};
  d.querySelector=selector=>selector==='h2, h3'?title:null;h.api.show(d,'target-picker');assert.equal(d.children.length,1);assert.equal(d.children[0].className,'popup-help');assert.deepEqual(h.calls,[]);
});
