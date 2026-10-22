import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../public/app-inventory.js',import.meta.url),'utf8'),response=data=>({ok:true,json:async()=>data}),tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(handler,selected,feedback){const elements=[],calls=[];const make=tag=>{const item={tag,children:[],events:{},value:'',setAttribute(){},append(...rows){this.children.push(...rows);},before(){},replaceChildren(...rows){this.children=rows;},addEventListener(type,callback){this.events[type]=callback;},get options(){return this.children;}};elements.push(item);return item;},get=id=>elements.find(item=>item.id===id)||null;make('div').id='apps-list';
  const context={window:{DeskFeedback:feedback,...(selected?{AppBatch:{selectedPackages:selected}}:{})},document:{getElementById:get,createElement:make,querySelectorAll:selector=>selector.includes(':checked')?[{value:'com.visible'}]:[]},URLSearchParams,setTimeout,fetch:async(url,options)=>{const call={url,body:options?.body?JSON.parse(options.body):null};calls.push(call);const custom=handler?.(call);if(custom!==undefined)return custom;if(url==='/api/session')return response({csrfToken:'token'});if(url==='/api/ops/app-labels')return response({id:'labels-job'});if(url.includes('app-labels-result'))return response({state:'success',message:'확인 완료',entries:[],failures:[]});return response({checkedAt:'2026-10-16T00:00:00Z',note:'조회 완료',entries:[],failures:[]});}};
  vm.runInNewContext(source,context);const api=context.window.AppInventory;api.init({getDevice:()=> 'phone',onEnriched:async()=>{}});api.setContext({currentUserId:'10',users:[{id:'10',name:'업무',current:true}],apps:[]});return{api,get,calls};}
for(const [button,route]of [['apps-usage-read','app-usage'],['apps-storage-read','app-storage'],['apps-apk-size-read','app-storage']])test(`starting label enrichment cannot leave concurrent ${button} button disabled forever`,async()=>{let release;const gate=new Promise(resolve=>release=resolve),f=fixture(call=>call.url==='/api/ops/'+route?gate:undefined);const pending=f.get(button).events.click();await tick();assert.equal(f.get(button).disabled,true);await f.get('apps-labels-read').events.click();release(response({checkedAt:'2026-10-16T00:00:00Z',note:'완료',entries:[],failures:[]}));await pending;assert.equal(f.get(button).disabled,false);});
test('name and storage actions use the full cross-page app selection in the selected profile',async()=>{const f=fixture(undefined,['com.previous.page','com.visible']);await f.get('apps-labels-read').events.click();await f.get('apps-storage-read').events.click();for(const route of ['app-labels','app-storage']){const request=f.calls.find(call=>call.url==='/api/ops/'+route);assert.deepEqual(request.body.packages,['com.previous.page','com.visible']);assert.equal(request.body.userId,'10');}});

test('app read feedback separates offline failure and scopes its explicit retry to the current profile',async()=>{const cards=[],starts=[];let finished=0,fail=true;const f=fixture(call=>{if(call.url==='/api/ops/app-storage'&&fail){fail=false;throw new TypeError('Failed to fetch');}},undefined,{start:(label,options)=>{starts.push({label,...options});return()=>finished++;},state:(host,value)=>cards.push(value)});const pending=f.get('apps-storage-read').events.click();assert.equal(starts[0].button.id,'apps-storage-read');assert.equal(f.get('apps-storage-read').disabled,true);await pending;assert.equal(cards.at(-1).type,'offline');await cards.at(-1).onAction();assert.equal(f.calls.filter(item=>item.url==='/api/ops/app-storage').length,2);assert.equal(finished,2);const before=f.calls.length;f.api.reset();await cards[0].onAction();assert.equal(f.calls.length,before);});

test('clearing app filters is local and preserves the selected user scope',()=>{const f=fixture();f.get('apps-user').value='10';f.get('apps-user').events.change();f.get('apps-launch-filter').value='yes';f.get('apps-launch-filter').events.change({target:f.get('apps-launch-filter')});assert.equal(f.api.hasFilters,true);const before=f.calls.length;f.api.resetFilters();assert.equal(f.api.hasFilters,false);assert.equal(f.get('apps-launch-filter').value,'all');assert.equal(f.api.user,'10');assert.equal(f.calls.length,before);});

for(const [name,result,type]of [['failed',{state:'error',message:'이름 확인 실패',entries:[],failures:[{package:'com.visible',error:'Permission Denial'}]},'error'],['cancelled',{state:'cancelled',message:'중지됨',entries:[],failures:[]},'info'],['partial',{state:'success',message:'일부 확인',entries:[{package:'com.visible',label:'앱'}],failures:[{package:'com.other',error:'APK 미제공'}]},'warning'],['empty',{state:'success',message:'완료',entries:[],failures:[]},'empty']])test(`HTTP 200 ${name} label job gets the correct result card and only an explicit read retry`,async()=>{const cards=[],f=fixture(call=>call.url.includes('app-labels-result')?response(result):undefined,undefined,{state:(host,card)=>cards.push(card)});await f.get('apps-labels-read').events.click();assert.equal(cards.at(-1).type,type);assert.equal(f.calls.filter(call=>call.url==='/api/ops/app-labels').length,1);assert.equal(f.get('apps-labels-read').disabled,false);await cards.at(-1).onAction();assert.equal(f.calls.filter(call=>call.url==='/api/ops/app-labels').length,2);assert.equal(f.calls.some(call=>/install|app-batch-execute|package-action/.test(call.url)),false);});
test('usage with no recorded timestamps differs from permission-denied usage and failed storage',async()=>{for(const [route,body,type]of [['app-usage',{entries:[{package:'com.visible',lastUsedTimestamp:null}],note:'기록이 없다고 미사용으로 단정하지 않습니다'},'empty'],['app-usage',{entries:[{package:'com.visible',lastUsedTimestamp:null}],note:'Permission Denial: 사용 통계 권한 거부'},'error'],['app-storage',{entries:[],failures:[{package:'com.visible',error:'Permission Denial'}],note:'0개 확인'},'error']]){const cards=[],f=fixture(call=>call.url==='/api/ops/'+route?response(body):undefined,undefined,{state:(host,card)=>cards.push(card)});await f.get(route==='app-usage'?'apps-usage-read':'apps-storage-read').events.click();assert.equal(cards.at(-1).type,type);assert.match(cards.at(-1).actionLabel,/다시 조회/);}});

test('storage restrictions show Korean reasons and required access while keeping the original error in a technical disclosure',async()=>{
  const raw='SecurityException: Package android.uid.shell:2000 from UID 2000 blocked by mode 1',cards=[];
  const f=fixture(call=>call.url==='/api/ops/app-storage'?response({entries:[],failures:[{package:'com.visible',error:raw}]}):undefined,undefined,{state:(_host,card)=>cards.push(card)});
  await f.get('apps-storage-read').events.click();
  assert.equal(cards.at(-1).type,'error');assert.doesNotMatch(cards.at(-1).message,/SecurityException|blocked by mode/);
  const list=f.get('apps-inventory-note').children.find(el=>el.className==='app-storage-issues'),item=list.children[0];
  assert.match(item.children[1].textContent,/ADB shell.*사용 정보 접근/);
  assert.match(item.children[2].textContent,/GET_USAGE_STATS.*기본 모드.*PACKAGE_USAGE_STATS/);
  assert.equal(item.children.at(-1).tag,'details');assert.equal(item.children.at(-1).children[1].textContent,raw);
});
test('a failed storage refresh invalidates old displayed sizes through inventory refresh and never writes phone permissions',async()=>{
  const cards=[],f=fixture(call=>call.url==='/api/ops/app-storage'?response({entries:[],failures:[{package:'com.visible',reasonKo:'사용 정보 접근이 차단되어 있습니다.',requiredAccessKo:'조회 주체의 사용 정보 접근 허용이 필요합니다.'}]}):undefined,undefined,{state:(_host,card)=>cards.push(card)});
  let refreshed=0;f.api.init({onEnriched:()=>{refreshed++;}});await f.get('apps-storage-read').events.click();
  assert.equal(refreshed,1);assert.equal(f.calls.filter(call=>call.url==='/api/ops/app-storage').length,1);
  await cards.at(-1).onAction();assert.equal(refreshed,2);
  assert.equal(f.calls.some(call=>/appops|permission|install|package-action/.test(call.url)),false);
});
test('APK-only storage results are partial, and retry does not silently target a changed app selection',async()=>{
  const cards=[],selected=['com.visible'],f=fixture(call=>call.url==='/api/ops/app-storage'?response({entries:[{package:'com.visible',storageStatus:'apk-only',sizeKind:'apk-files',apkBytes:123,storageBytes:null,dataBytes:null,cacheBytes:null}],failures:[{package:'com.visible',reasonKo:'전체 용량 접근 제한',requiredAccessKo:'조회 권한 필요'}]}):undefined,selected,{state:(_host,card)=>cards.push(card)});
  await f.get('apps-storage-read').events.click();const card=cards.at(-1);
  assert.equal(card.type,'warning');assert.match(card.message,/전체 용량 0개.*APK 크기만 1개.*조회 불가 0개/);
  selected[0]='com.other';await card.onAction();assert.equal(f.calls.filter(call=>call.url==='/api/ops/app-storage').length,1);
  assert.equal(cards.at(-1).title,'조회 대상이 변경되었습니다');
});
test('row metadata distinguishes APK files, blocked totals and historical cache timestamps',()=>{
  const f=fixture(),partial=f.api.describe({package:'com.visible',storageStatus:'apk-only',apkBytes:1200,apkFileCount:2,storageBytes:null,appBytes:null,dataBytes:null,cacheBytes:null,sizeIssue:{reasonKo:'사용 정보 접근 제한',requiredAccessKo:'조회 주체의 접근 허용 필요'}}).join(' ');
  assert.match(partial,/APK 파일 합계.*2개 파일.*앱 전체 용량 아님.*데이터·캐시 미확인/);assert.doesNotMatch(partial,/저장소 0|데이터 0/);assert.match(partial,/필요한 접근/);
  const cached=f.api.describe({storageStatus:'cached',storageBytes:100,sizeCached:true,sizeCacheUpdatedAt:'2026-10-16T00:00:00Z'}).join(' ');
  assert.match(cached,/과거 통계 참고값.*작성.*2026/);assert.match(cached,/업데이트·재설치/);
});

const descendants=root=>[root,...(root.children||[]).flatMap(descendants)];
const apkChoice=f=>descendants(f.get('apps-inventory-note')).filter(el=>el.tag==='button'&&el.textContent==='APK 파일 크기만 조회').at(-1);
test('storage denial offers a pinned APK-only choice beside its access label and does not rerun full statistics',async()=>{
  const cards=[],f=fixture(call=>call.url==='/api/ops/app-storage'?response(call.body.readMode==='apk-only'?{userId:'10',entries:[{package:'com.visible',storageStatus:'apk-only',apkBytes:123}],failures:[]}:{userId:'10',entries:[],failures:[{package:'com.visible',code:'usage-access-denied',reasonKo:'전체 용량 접근 제한',requiredAccessKo:'GET_USAGE_STATS 허용 필요'}]}):undefined,['com.visible'],{state:(_host,card)=>cards.push(card)});
  assert.match(descendants(f.get('app-identity-tools')).find(el=>el.className==='app-storage-access').title,/GET_USAGE_STATS.*PACKAGE_USAGE_STATS/);
  await f.get('apps-storage-read').events.click();assert.equal(f.calls.filter(call=>call.url==='/api/ops/app-storage').length,1);
  const choice=apkChoice(f);assert.ok(choice);assert.match(choice.title,/com.visible.*사용자 10/);assert.equal(choice.disabled,undefined);
  const pending=choice.events.click();assert.equal(choice.disabled,true);assert.equal(f.get('apps-storage-read').disabled,true);assert.equal(f.get('apps-apk-size-read').disabled,true);await pending;
  const requests=f.calls.filter(call=>call.url==='/api/ops/app-storage');assert.equal(requests.length,2);assert.equal(requests[1].body.readMode,'apk-only');assert.equal(requests[1].body.userId,'10');assert.deepEqual(requests[1].body.packages,['com.visible']);
  assert.equal(cards.at(-1).type,'success');assert.match(cards.at(-1).message,/APK 합계.*앱 데이터·캐시·최적화 파일이 포함되지 않습니다/);assert.equal(f.calls.some(call=>/permission|appops|install|package-action/.test(call.url)),false);
});

test('an APK-only choice refuses changed package or profile selection without dispatching a request',async()=>{
  for(const change of ['package','profile']){
    const selected=['com.visible'],cards=[],f=fixture(call=>call.url==='/api/ops/app-storage'?response({userId:'10',entries:[],failures:[{package:'com.visible',code:'usage-access-denied',reasonKo:'전체 용량 접근 제한'}]}):undefined,selected,{state:(_host,card)=>cards.push(card)});
    await f.get('apps-storage-read').events.click();const choice=apkChoice(f),before=f.calls.length;
    if(change==='package')selected[0]='com.other';else{f.get('apps-user').value='0';f.get('apps-user').events.change();}
    await choice.events.click();assert.equal(f.calls.length,before);if(change==='package')assert.equal(cards.at(-1).title,'조회 대상이 변경되었습니다');
  }
});

test('an APK-only request cannot leave the client after a delayed token when its package selection changed',async()=>{
  const selected=['com.visible'];let delay=false,release;const gate=new Promise(resolve=>release=resolve),f=fixture(call=>{
    if(call.url==='/api/session'&&delay)return gate;
    if(call.url==='/api/ops/app-storage')return response({userId:'10',entries:[],failures:[{package:'com.visible',code:'usage-access-denied',reasonKo:'접근 제한'}]});
  },selected);
  await f.get('apps-storage-read').events.click();delay=true;const pending=apkChoice(f).events.click();await tick();selected[0]='com.other';release(response({csrfToken:'token'}));await pending;
  assert.equal(f.calls.filter(call=>call.url==='/api/ops/app-storage').length,1);assert.equal(f.get('apps-storage-read').disabled,false);
});

test('stale APK-only responses cannot enrich the current app list or disable its next query',async()=>{
  const selected=['com.visible'];let release;const gate=new Promise(resolve=>release=resolve),cards=[],f=fixture(call=>call.url==='/api/ops/app-storage'?(call.body.readMode==='apk-only'?gate:response({userId:'10',entries:[],failures:[{package:'com.visible',code:'usage-access-denied',reasonKo:'접근 제한'}]})):undefined,selected,{state:(_host,card)=>cards.push(card)});
  let enriched=0;f.api.init({onEnriched:()=>{enriched++;}});await f.get('apps-storage-read').events.click();const before=cards.length,pending=apkChoice(f).events.click();await tick();selected[0]='com.other';release(response({userId:'10',entries:[{package:'com.visible',storageStatus:'apk-only',apkBytes:200}],failures:[]}));await pending;
  assert.equal(enriched,1);assert.equal(cards.length,before);assert.equal(f.get('apps-storage-read').disabled,false);
});

test('offline, missing profiles, missing packages and unresolved current-user failures do not offer an APK read',async()=>{
  for(const result of [{userId:'10',code:'device-offline'},{userId:'10',code:'user-not-found'},{userId:'10',code:'package-not-installed'},{userId:'current',code:'usage-access-denied'}]){
    const f=fixture(call=>call.url==='/api/ops/app-storage'?response({userId:result.userId,entries:[],failures:[{package:'com.visible',code:result.code,reasonKo:'조회 실패'}]}):undefined,['com.visible']);
    if(result.userId==='current')f.api.setContext({users:[],apps:[]});await f.get('apps-storage-read').events.click();assert.equal(apkChoice(f),undefined);
  }
});

test('APK-only reading is always available beside full statistics and remains available after full statistics succeed',async()=>{
  const cards=[],f=fixture(call=>call.url==='/api/ops/app-storage'?response({userId:'10',entries:[call.body.readMode==='apk-only'?{package:'com.visible',storageStatus:'apk-only',sizeKind:'apk-files',apkBytes:123}:{package:'com.visible',storageStatus:'full',storageBytes:456}],failures:[]}):undefined,['com.visible'],{state:(_host,card)=>cards.push(card)});
  const button=f.get('apps-apk-size-read'),group=descendants(f.get('app-identity-tools')).find(el=>el.className==='app-storage-tools');
  assert.equal(group.children[0],f.get('apps-storage-read'));assert.equal(group.children[1],button);assert.equal(button.textContent,'APK 크기만 조회');
  assert.match(button.title,/앞 10개.*기본·분할 APK.*앱 데이터·캐시·최적화 파일.*ADB 파일 읽기.*폰 설정은 변경하지/);
  assert.match(descendants(f.get('app-identity-tools')).find(el=>el.className==='app-storage-scope').textContent,/최대 10개.*앱 데이터·캐시·최적화 파일은 제외/);
  await f.get('apps-storage-read').events.click();assert.equal(button.disabled,false);await button.events.click();
  const requests=f.calls.filter(call=>call.url==='/api/ops/app-storage');assert.equal(requests.length,2);assert.equal(requests[0].body.readMode,undefined);assert.equal(requests[1].body.readMode,'apk-only');
  assert.equal(cards.at(-1).type,'success');assert.match(cards.at(-1).message,/전체 용량 0개.*APK 크기만 1개.*데이터·캐시·최적화 파일이 포함되지 않습니다/);
  assert.equal(f.calls.some(call=>/permission|appops|install|package-action/.test(call.url)),false);
});

test('direct APK reads keep the selected profile and first ten cross-page targets, and lock both storage actions',async()=>{
  const selected=Array.from({length:12},(_,index)=>'com.page'+index);let release;const gate=new Promise(resolve=>release=resolve),f=fixture(call=>call.url==='/api/ops/app-storage'?gate:undefined,selected),button=f.get('apps-apk-size-read');
  f.get('apps-user').value='10';f.get('apps-user').events.change();const pending=button.events.click();
  assert.equal(button.disabled,true);assert.equal(f.get('apps-storage-read').disabled,true);assert.match(f.get('apps-inventory-note').textContent,/10개 앱 · 사용자 10.*기본·분할 APK.*선택 12개 중 앞 10개/);
  await tick();await f.get('apps-storage-read').events.click();await button.events.click();
  const requests=f.calls.filter(call=>call.url==='/api/ops/app-storage');assert.equal(requests.length,1);assert.equal(requests[0].body.readMode,'apk-only');assert.equal(requests[0].body.userId,'10');assert.deepEqual(requests[0].body.packages,selected.slice(0,10));
  release(response({userId:'10',entries:[],failures:[]}));await pending;assert.equal(button.disabled,false);assert.equal(f.get('apps-storage-read').disabled,false);
});

test('storage requests share their lock with previously rendered fallback APK choices',async()=>{
  for(const source of ['apps-storage-read','apps-apk-size-read','fallback']){
    let delay=false,release;const gate=new Promise(resolve=>release=resolve),f=fixture(call=>call.url==='/api/ops/app-storage'?(delay?gate:response({userId:'10',entries:[],failures:[{package:'com.visible',code:'usage-access-denied',reasonKo:'전체 용량 접근 제한'}]})):undefined,['com.visible']);
    await f.get('apps-storage-read').events.click();const choice=apkChoice(f);delay=true;const button=source==='fallback'?choice:f.get(source),pending=button.events.click();await tick();
    assert.equal(f.get('apps-storage-read').disabled,true);assert.equal(f.get('apps-apk-size-read').disabled,true);
    await f.get('apps-storage-read').events.click();await f.get('apps-apk-size-read').events.click();await choice.events.click();assert.equal(f.calls.filter(call=>call.url==='/api/ops/app-storage').length,2);
    release(response({userId:'10',entries:[],failures:[]}));await pending;assert.equal(f.get('apps-storage-read').disabled,false);assert.equal(f.get('apps-apk-size-read').disabled,false);
  }
});

test('empty APK-only results retry the same mode and targets through the visible APK action',async()=>{
  const cards=[],starts=[],selected=['com.previous.page','com.visible'],f=fixture(call=>call.url==='/api/ops/app-storage'?response({userId:'10',entries:[],failures:[]}):undefined,selected,{start:(_label,options)=>{starts.push(options);return()=>{};},state:(_host,card)=>cards.push(card)});
  await f.get('apps-apk-size-read').events.click();assert.equal(cards.at(-1).type,'empty');await cards.at(-1).onAction();
  const requests=f.calls.filter(call=>call.url==='/api/ops/app-storage');assert.equal(requests.length,2);for(const request of requests){assert.equal(request.body.readMode,'apk-only');assert.equal(request.body.userId,'10');assert.deepEqual(request.body.packages,selected);}assert.equal(starts.at(-1).button,f.get('apps-apk-size-read'));
  selected[0]='com.other';await cards.at(-1).onAction();assert.equal(f.calls.filter(call=>call.url==='/api/ops/app-storage').length,2);assert.equal(cards.at(-1).title,'조회 대상이 변경되었습니다');
});

test('profile changes and resets release both storage actions without letting stale reads unlock a newer read',async()=>{
  for(const change of ['profile','reset']){
    let releaseOld,releaseNew,requestCount=0;const oldGate=new Promise(resolve=>releaseOld=resolve),newGate=new Promise(resolve=>releaseNew=resolve),cards=[],f=fixture(call=>call.url==='/api/ops/app-storage'?(++requestCount===1?oldGate:newGate):undefined,['com.visible'],{state:(_host,card)=>cards.push(card)});
    let enriched=0;f.api.init({onEnriched:()=>{enriched++;}});const first=f.get('apps-apk-size-read').events.click();await tick();
    if(change==='profile'){f.get('apps-user').value='0';f.get('apps-user').events.change();}else{f.api.reset();f.api.setContext({currentUserId:'10',users:[{id:'10',name:'업무',current:true}],apps:[]});}
    assert.equal(f.get('apps-storage-read').disabled,false);assert.equal(f.get('apps-apk-size-read').disabled,false);const second=f.get('apps-apk-size-read').events.click();await tick();const note=f.get('apps-inventory-note').textContent;
    releaseOld(response({userId:'10',entries:[{package:'com.visible',storageStatus:'apk-only',apkBytes:111}],failures:[]}));await first;
    assert.equal(enriched,0);assert.equal(cards.length,0);assert.equal(f.get('apps-inventory-note').textContent,note);assert.equal(f.get('apps-storage-read').disabled,true);assert.equal(f.get('apps-apk-size-read').disabled,true);
    releaseNew(response({userId:change==='profile'?'0':'10',entries:[{package:'com.visible',storageStatus:'apk-only',apkBytes:222}],failures:[]}));await second;
    assert.equal(enriched,1);assert.equal(cards.at(-1).type,'success');assert.equal(f.get('apps-storage-read').disabled,false);assert.equal(f.get('apps-apk-size-read').disabled,false);
  }
});

test('a direct APK read cannot dispatch after selection or profile changes during its token request',async()=>{
  for(const change of ['selection','profile']){
    const selected=['com.visible'];let release;const gate=new Promise(resolve=>release=resolve),f=fixture(call=>call.url==='/api/session'?gate:undefined,selected),pending=f.get('apps-apk-size-read').events.click();
    if(change==='selection')selected[0]='com.other';else{f.get('apps-user').value='0';f.get('apps-user').events.change();}release(response({csrfToken:'token'}));await pending;
    assert.equal(f.calls.filter(call=>call.url==='/api/ops/app-storage').length,0);assert.equal(f.get('apps-storage-read').disabled,false);assert.equal(f.get('apps-apk-size-read').disabled,false);
  }
});
