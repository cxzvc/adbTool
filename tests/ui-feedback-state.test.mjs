import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/ui-feedback.js',import.meta.url),'utf8');
function fixture(errorHelper=false){
 class Node{constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.attrs={};this.className='';this.hidden=false;this.disabled=false;this.textContent='';this.parent=null;this.root=false;this.classList={toggle:(name,on)=>{const set=new Set(this.className.split(/\s+/).filter(Boolean));if(on)set.add(name);else set.delete(name);this.className=[...set].join(' ');},contains:name=>this.className.split(/\s+/).includes(name)};}setAttribute(k,v){this.attrs[k]=String(v);}getAttribute(k){return this.attrs[k]??null;}removeAttribute(k){delete this.attrs[k];}append(...nodes){for(const n of nodes){this.children.push(n);n.parent=this;}}replaceChildren(...nodes){for(const n of this.children)n.parent=null;this.children=[];this.append(...nodes);}contains(node){return node===this||this.children.some(n=>n.contains(node));}get isConnected(){return this.root||!!this.parent?.isConnected;}}
 const nodes=new Map();for(const id of ['device-busy','device-busy-label','button','host']){const n=new Node();n.root=true;nodes.set(id,n);}nodes.get('button').textContent='새로고침';
 const context={window:{},document:{getElementById:id=>nodes.get(id)||null,querySelector:()=>null,createElement:tag=>new Node(tag)},requestAnimationFrame:fn=>fn()};if(errorHelper)vm.runInNewContext(errorHelper,context);vm.runInNewContext(source,context);return{api:context.window.DeskFeedback,nodes};
}
test('button feedback appears synchronously and leaves labels and disabled ownership unchanged',()=>{const f=fixture(),button=f.nodes.get('button');button.disabled=true;const done=f.api.start('조회 중',{button});assert.equal(button.getAttribute('aria-busy'),'true');assert.equal(button.classList.contains('desk-pending'),true);assert.equal(button.textContent,'새로고침');assert.equal(button.disabled,true);assert.equal(f.nodes.get('device-busy').getAttribute('aria-busy'),'true');done();assert.equal(button.getAttribute('aria-busy'),null);assert.equal(button.disabled,true);assert.equal(button.textContent,'새로고침');});
test('overlapping button tasks keep processing until the last task completes',()=>{const f=fixture(),button=f.nodes.get('button'),a=f.api.start('첫 조회',{button}),b=f.api.start('다른 조회',{button});a();assert.equal(button.getAttribute('aria-busy'),'true');b();assert.equal(button.getAttribute('aria-busy'),null);a();assert.equal(button.getAttribute('aria-busy'),null);});
test('device cleanup preserves a global wireless query and stale completion cannot clear a newer task',()=>{const f=fixture(),button=f.nodes.get('button'),global=f.api.start('무선 조회',{scope:'global',button}),old=f.api.start('옛 기기');f.api.clear('device');assert.equal(f.nodes.get('device-busy-label').textContent,'무선 조회');const newer=f.api.start('새 기기',{button});old();assert.equal(button.getAttribute('aria-busy'),'true');global();assert.equal(button.getAttribute('aria-busy'),'true');newer();assert.equal(button.getAttribute('aria-busy'),null);});
test('state cards never start a retry automatically and keep one retry pending without changing its text',async()=>{const f=fixture(),host=f.nodes.get('host');let calls=0,release;const pending=new Promise(r=>release=r);const card=f.api.state(host,{type:'error',title:'조회 실패',message:'연결 확인',actionLabel:'다시 조회',onAction:async()=>{calls++;await pending;}});assert.equal(calls,0);const button=card.children.find(n=>n.tagName==='BUTTON'),run=button.onclick({});assert.equal(calls,1);assert.equal(button.disabled,true);assert.equal(button.getAttribute('aria-busy'),'true');assert.equal(f.nodes.get('device-busy').getAttribute('aria-busy'),'false');await button.onclick({});assert.equal(calls,1);release();await run;assert.equal(button.disabled,false);assert.equal(button.textContent,'다시 조회');});
test('detached state actions cannot run and clearing removes the card',async()=>{const f=fixture(),host=f.nodes.get('host');let calls=0;const card=f.api.state(host,{type:'empty',title:'빈 목록',actionLabel:'다시 조회',onAction:()=>calls++});const button=card.children.find(n=>n.tagName==='BUTTON');f.api.state(host,null);await button.onclick({});assert.equal(calls,0);assert.equal(host.hidden,true);assert.equal(host.children.length,0);});
test('failed retry stays actionable and renders error text without interpreting HTML',async()=>{const f=fixture(),host=f.nodes.get('host');const card=f.api.state(host,{type:'offline',title:'연결 끊김',actionLabel:'다시 조회',onAction:async()=>{throw Error('<script>not executed</script>');}});await card.children.find(n=>n.tagName==='BUTTON').onclick({});const updated=host.children[0];assert.equal(updated.getAttribute('data-state'),'error');assert.equal(updated.children[0].children[1].textContent,'<script>not executed</script>');assert.equal(updated.children.filter(n=>n.tagName==='BUTTON').length,1);});
test('loading, empty, disconnected and unsupported retain distinct accessible state',()=>{const f=fixture(),host=f.nodes.get('host');for(const type of ['loading','empty','disconnected','unsupported']){const card=f.api.state(host,{type,title:type});assert.equal(card.getAttribute('data-state'),type);assert.equal(card.children.some(n=>n.tagName==='PROGRESS'),type==='loading');assert.equal(card.getAttribute('role'),type==='disconnected'?'alert':'status');}});

test('shared error cards show Korean access guidance and separate original diagnostic text without executing it',async()=>{
 const f=fixture(await readFile(new URL('../public/error-help.js',import.meta.url),'utf8')),raw='Permission Denial: requires android.permission.DUMP <img src=x onerror=bad()>',host=f.nodes.get('host');let requests=0;
 const card=f.api.state(host,{type:'error',title:'진단 조회 실패',message:raw,errorContext:{context:'diagnostics'},actionLabel:'다시 조회',onAction:()=>requests++});
 const content=card.children[0];assert.match(content.children[1].textContent,/접근 검사.*거부/);assert.doesNotMatch(content.children[1].textContent,/<img/);
 assert.match(content.children.find(n=>n.className==='desk-required-access').textContent,/DUMP/);
 const details=content.children.find(n=>n.tagName==='DETAILS');assert.equal(details.children[1].textContent,raw);assert.equal(details.children.some(n=>n.tagName==='IMG'),false);
 assert.equal(requests,0);await card.children.find(n=>n.tagName==='BUTTON').onclick({});assert.equal(requests,1);
});
test('partial-result counts and caller-supplied access descriptions survive common error rendering',async()=>{
 const f=fixture(await readFile(new URL('../public/error-help.js',import.meta.url),'utf8'));
 const card=f.api.state(f.nodes.get('host'),{type:'warning',title:'일부 진단만 확인했습니다',message:'3개 성공 · 1개 미확인',rawError:'Permission denied',requiredAccessKo:'검증된 서비스 읽기 권한',alternativesKo:'현재 공개된 값 유지',errorContext:{context:'diagnostics'}});
 const content=card.children[0];assert.equal(content.children[1].textContent,'3개 성공 · 1개 미확인');assert.equal(content.children.find(n=>n.className==='desk-required-access').textContent,'필요한 접근: 검증된 서비스 읽기 권한');
});
test('unknown mixed-language vendor errors show Korean uncertainty while partial counts and originals remain accessible',async()=>{
 const f=fixture(await readFile(new URL('../public/error-help.js',import.meta.url),'utf8')),raw='조회 실패: com.vendor.CustomAccessException: vendor status 7';
 let card=f.api.state(f.nodes.get('host'),{type:'error',message:raw,errorContext:{context:'diagnostics'}}),content=card.children[0];
 assert.match(content.children[1].textContent,/확정하지 못했습니다/);assert.doesNotMatch(content.children[1].textContent,/CustomAccessException/);assert.equal(content.children.find(n=>n.tagName==='DETAILS').children[1].textContent,raw);
 card=f.api.state(f.nodes.get('host'),{type:'warning',message:'3개 성공 · 1개 미확인',rawError:raw,errorContext:{context:'diagnostics'}});content=card.children[0];
 assert.equal(content.children[1].textContent,'3개 성공 · 1개 미확인');assert.match(content.children.find(n=>n.className==='desk-error-explanation').textContent,/확정하지 못했습니다/);
});
test('alternative read choices wait for a click, show scope and access, and serialize with the original retry',async()=>{
 const f=fixture(),host=f.nodes.get('host');let calls=0,release;const pending=new Promise(resolve=>release=resolve);
 const card=f.api.state(host,{type:'error',title:'조회 제한',actionLabel:'원래 조회',onAction:()=>calls++,actions:[{label:'공개 정보 조회',description:'보호된 자료와 범위가 다릅니다.',accessLabel:'일반 ADB · 읽기',onAction:async()=>{calls++;await pending;}}]});
 const retry=card.children.find(n=>n.tagName==='BUTTON'),group=card.children.find(n=>n.className==='desk-state-choices'),choice=group.children[0].children[0];
 assert.equal(calls,0);assert.equal(group.getAttribute('aria-label'),'현재 권한에서 가능한 대체 조회');assert.equal(group.children[0].children[1].textContent,'보호된 자료와 범위가 다릅니다.');assert.equal(choice.children[0].textContent,'일반 ADB · 읽기');
 const run=choice.onclick({});assert.equal(calls,1);assert.equal(retry.disabled,true);assert.equal(choice.getAttribute('aria-busy'),'true');await retry.onclick({});assert.equal(calls,1);release();await run;assert.equal(retry.disabled,false);
 f.api.state(host,null);await choice.onclick({});assert.equal(calls,1);
});
test('a failed alternative keeps explicit choices available without automatically retrying',async()=>{
 const f=fixture(),host=f.nodes.get('host');let calls=0;
 const card=f.api.state(host,{type:'warning',actions:[{label:'대체 조회',onAction:()=>{calls++;throw Error('still denied');}}]});
 await card.children.find(n=>n.className==='desk-state-choices').children[0].children[0].onclick({});
 assert.equal(calls,1);const updated=host.children[0];assert.equal(updated.getAttribute('data-state'),'error');assert.equal(updated.children.find(n=>n.className==='desk-state-choices').children.length,1);
});
test('only permission-denial evidence adds named access beside a retry button',async()=>{
 const f=fixture(await readFile(new URL('../public/error-help.js',import.meta.url),'utf8')),host=f.nodes.get('host');
 let card=f.api.state(host,{type:'error',message:'Permission Denial: requires android.permission.DUMP',actionLabel:'진단 다시 조회',onAction(){}});
 assert.equal(card.children.find(n=>n.tagName==='BUTTON').children[0].textContent,'DUMP');
 card=f.api.state(host,{type:'error',message:'Failed to fetch',actionLabel:'조회',onAction(){}});assert.equal(card.children.find(n=>n.tagName==='BUTTON').children.length,0);
});
test('a folder error with a Korean offline cause explains connection loss above the collapsed original',async()=>{
 const f=fixture(await readFile(new URL('../public/error-help.js',import.meta.url),'utf8'));
 const card=f.api.state(f.nodes.get('host'),{type:'offline',title:'폴더 목록을 읽지 못했습니다',message:'/sdcard 위치를 조회하지 못했습니다. 이전에 읽은 폴더는 /sdcard입니다.',rawError:'기기가 연결되어 있지 않습니다. 연결 상태를 확인해 주세요.',errorContext:{context:'files'}}),content=card.children[0];
 assert.match(content.children.find(n=>n.className==='desk-error-explanation').textContent,/ADB 연결/);assert.match(content.children.find(n=>n.className==='desk-required-access').textContent,/정상적인 ADB 연결/);
});
