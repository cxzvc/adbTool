import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../public/gps-indicator.js',import.meta.url),'utf8');
const compatibilitySource=readFileSync(new URL('../../../public/compatibility-ui.js',import.meta.url),'utf8');
const response=(data,ok=true)=>({ok,json:async()=>data});
const snapshot=(extra={})=>({package:'org.example.maps',userId:0,label:'지도',uid:10123,fingerprint:'MOCK_BUILD',profileMatches:true,flags:768,sensitiveBit:256,granted:true,canHide:true,canRestore:false,reasonKo:'',requiredAccessKo:'필요 권한: shell의 GRANT_RUNTIME_PERMISSIONS 또는 REVOKE_RUNTIME_PERMISSIONS',writeAccessGranted:true,original:null,snapshotToken:'SNAPSHOT_A',sharedPackages:['org.example.maps'],effectVerified:false,...extra});
const app={package:'org.example.maps',label:'지도',userId:0};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const settle=()=>new Promise(resolve=>setImmediate(resolve));

function harness({picker,linkedSelection=false,feedback=true,compatibility=false}={}){
  const elements=new Map(),calls=[],pending=[],timers=new Map(),starts=[],selections=[],documentListeners=new Map();let timerId=0,document;
  class Element{
    constructor(tag='div'){this.tagName=tag.toUpperCase();this.disabled=false;this.hidden=false;this.checked=false;this.children=[];this.listeners=new Map();this.attributes=new Map();this._html='';this._text='';this.dataset={};this.open=false;}
    set textContent(value){this._text=value;this._html='';this.children=[];}
    get textContent(){return this._text+this._html.replace(/<[^>]*>/g,'')+this.children.filter(child=>!child.fromHTML).map(child=>child.textContent).join('');}
    set innerHTML(value){this._html=value;this._text='';this.children=[];if(this===root){for(const match of value.matchAll(/<([a-z]+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)){const element=new Element(match[1]);element.id=match[3];element.disabled=/\bdisabled(?:\s|>|$)/.test(match[2]);element.hidden=/\bhidden(?:\s|>|$)/.test(match[2]);elements.set(element.id,element);}}
      for(const match of value.matchAll(/<button\b[^>]*data-compatibility-details="([^"]+)"[^>]*>([^<]*)<\/button>/g)){const button=new Element('button');button.dataset.compatibilityDetails=match[1];button.textContent=match[2];button.fromHTML=true;this.children.push(button);}}
    get innerHTML(){return this._html;}
    setAttribute(name,value){this.attributes.set(name,value);}
    addEventListener(name,listener){this.listeners.set(name,listener);}
    append(...children){this.children.push(...children);for(const child of children)if(child.id)elements.set(child.id,child);}
    closest(selector){return selector==='[data-compatibility-details]'&&this.dataset.compatibilityDetails?this:null;}
    focus(){document.activeElement=this;}
    showModal(){this.open=true;}
    close(){this.open=false;this.listeners.get('close')?.();}
    async click(){if(this.disabled)return;const result=this.listeners.get('click')?.({target:this,currentTarget:this});documentListeners.get('click')?.({target:this});return result;}
    change(){return this.listeners.get('change')?.({target:this,currentTarget:this});}
  }
  const root=new Element();root.id='gps-indicator-panel';elements.set(root.id,root);
  const window={AppInventory:{currentUser:0},DeviceTargets:{pick:picker||(()=>Promise.resolve(null)),selectApp:value=>{selections.push(value);if(linkedSelection)window.GpsIndicator.selectApp(value,value.userId);}}};
  if(feedback)window.DeskFeedback={start:(title,options)=>{const entry={title,options,finished:false};starts.push(entry);return()=>{entry.finished=true;};},state:(host,options)=>{host.options=options;host.hidden=!options;host.textContent=options?[options.title,options.message,options.requiredAccessKo].filter(Boolean).join(' '):'';host.children=[];}};
  document={getElementById:id=>elements.get(id)||null,createElement:tag=>new Element(tag),body:new Element('body'),addEventListener:(name,fn)=>documentListeners.set(name,fn),activeElement:null};
  const context={document,AbortController,URLSearchParams,window,
    setTimeout:(callback,delay)=>{const id=++timerId;timers.set(id,{callback,delay});return id;},clearTimeout:id=>timers.delete(id),
    fetch:async(url,options={})=>{calls.push({url,options});if(url==='/api/session')return response({csrfToken:'MOCK_CSRF'});assert.ok(pending.length,'Missing mock response for '+url);const next=pending.shift();return typeof next==='function'?next(url,options):next;}
  };
  if(compatibility)vm.runInNewContext(compatibilitySource,context);
  vm.runInNewContext(source,context);
  return{api:window.GpsIndicator,ui:window.CompatibilityUI,document,root,elements,calls,pending,timers,starts,selections,element:id=>elements.get(id),
    enqueue:data=>pending.push(response(data)),enqueueError:data=>pending.push(response(data,false)),
    writes:()=>calls.filter(call=>call.options.method==='POST'),reads:()=>calls.filter(call=>call.url.startsWith('/api/device/gps-indicator?')&&call.options.method==='GET'),
    async ready(data=snapshot()){window.GpsIndicator.open('PHONE');window.GpsIndicator.activate(true);pending.push(response(data));await window.GpsIndicator.selectApp(app,0);},
    async consent(action='hide'){await elements.get('gps-indicator-'+action).click();elements.get('gps-indicator-ack').checked=true;elements.get('gps-indicator-ack').change();return elements.get('gps-indicator-confirm-run').click();}
  };
}

test('opening and activating without an app never reads or writes the phone',()=>{
  const h=harness();h.api.open('PHONE');h.api.activate(true);assert.equal(h.calls.length,0);assert.equal(h.element('gps-indicator-app').textContent,'앱을 선택하세요');assert.equal(h.element('gps-indicator-hide').disabled,true);assert.equal(h.element('gps-indicator-restore').disabled,true);assert.doesNotMatch(h.root.innerHTML,/0x100|GRANT_RUNTIME|S918/);assert.match(h.element('gps-indicator-status').textContent,/실제 표시 효과 미확인/);assert.equal(h.element('gps-indicator-pick').disabled,false);
});

test('selecting an app starts visible read-only progress and displays the exact user and permission state',async()=>{
  const h=harness(),wait=deferred();h.api.open('PHONE');h.api.activate(true);h.pending.push(wait.promise);const loading=h.api.selectApp(app,0);
  assert.equal(h.reads().length,1);const url=new URL(h.reads()[0].url,'http://mock');assert.equal(url.searchParams.get('package'),app.package);assert.equal(url.searchParams.get('user'),'0');assert.equal(h.element('gps-indicator-progress').hidden,false);assert.equal(h.element('gps-indicator-hide').disabled,true);assert.equal(h.writes().length,0);
  wait.resolve(response(snapshot()));await loading;assert.equal(h.element('gps-indicator-progress').hidden,true);assert.equal(h.element('gps-indicator-app').textContent,'지도');assert.match(h.element('gps-indicator-target-info').textContent,/org.example.maps · 사용자 0 · UID 10123/);assert.match(h.element('gps-indicator-permission').textContent,/허용됨 · 변경 대상 아님/);assert.match(h.element('gps-indicator-value').textContent,/분류 적용/);assert.equal(h.element('gps-indicator-hide').disabled,false);assert.equal(h.element('gps-indicator-restore').disabled,true);assert.equal(h.timers.size,0);
});

test('hide needs explicit inline confirmation and acknowledgement before posting one masked action',async()=>{
  const h=harness();await h.ready();await h.element('gps-indicator-hide').click();assert.equal(h.writes().length,0);assert.equal(h.element('gps-indicator-confirm').hidden,false);assert.equal(h.element('gps-indicator-confirm-run').disabled,true);assert.match(h.element('gps-indicator-confirm-target').textContent,/org.example.maps/);
  await h.element('gps-indicator-confirm-run').click();assert.equal(h.writes().length,0);h.element('gps-indicator-ack').checked=true;h.element('gps-indicator-ack').change();assert.equal(h.element('gps-indicator-confirm-run').disabled,false);
  h.enqueue(snapshot({sensitiveBit:0,flags:512,canHide:false,canRestore:true,snapshotToken:'SNAPSHOT_B',original:{bit:256,state:'hidden',createdAt:'2026-10-20T00:00:00.000Z'},message:'원래 비트를 보관하고 현재 위치 권한을 유지했습니다.'}));await h.element('gps-indicator-confirm-run').click();
  assert.equal(h.writes().length,1);assert.equal(h.calls.filter(call=>call.url==='/api/session').length,1);const write=h.writes()[0];assert.equal(write.options.headers['X-ADB-Desk-Token'],'MOCK_CSRF');assert.deepEqual(JSON.parse(write.options.body),{deviceId:'PHONE',package:app.package,userId:0,action:'hide',expected:'SNAPSHOT_A'});assert.equal(h.element('gps-indicator-hide').disabled,true);assert.equal(h.element('gps-indicator-restore').disabled,false);assert.match(h.element('gps-indicator-original').textContent,/분류 적용/);assert.equal(h.element('gps-indicator-confirm').hidden,true);
});

test('restore uses the PC-backed token without accepting a manually entered original bit',async()=>{
  const h=harness();await h.ready(snapshot({flags:512,sensitiveBit:0,canHide:false,canRestore:true,original:{bit:256,state:'hidden'},snapshotToken:'HIDDEN'}));h.enqueue(snapshot({canHide:true,canRestore:false,original:{bit:256,state:'restored'},snapshotToken:'RESTORED',message:'PC에 보관한 원래 비트로 복원했습니다.'}));await h.consent('restore');
  assert.deepEqual(JSON.parse(h.writes()[0].options.body),{deviceId:'PHONE',package:app.package,userId:0,action:'restore',expected:'HIDDEN'});assert.match(h.element('gps-indicator-original').textContent,/복원 확인/);assert.equal(h.element('gps-indicator-restore').disabled,true);assert.equal(h.element('gps-indicator-hide').disabled,false);assert.doesNotMatch(h.root.innerHTML,/<input[^>]+(?:package|path|bit)/);
});

test('restoring the original bit never requires re-granting a location permission revoked after hiding',async()=>{
  const h=harness();await h.ready(snapshot({granted:false,sensitiveBit:0,flags:512,canHide:false,canRestore:true,original:{bit:256,state:'hidden'},snapshotToken:'REVOKED'}));assert.equal(h.element('gps-indicator-hide').disabled,true);assert.equal(h.element('gps-indicator-restore').disabled,false);assert.match(h.element('gps-indicator-permission').textContent,/현재 미허용 · 복원 시에도 유지/);h.enqueue(snapshot({granted:false,sensitiveBit:256,flags:768,canHide:false,canRestore:false,original:{bit:256,state:'restored'}}));await h.consent('restore');assert.equal(JSON.parse(h.writes()[0].options.body).action,'restore');assert.match(h.element('gps-indicator-permission').textContent,/현재 미허용/);
});

test('apps without a fine-location flag are valid read results with a Korean ineligibility reason',async()=>{
  const h=harness();await h.ready(snapshot({flags:null,sensitiveBit:null,granted:null,canHide:false,canRestore:false,reasonKo:'이 앱은 정확한 위치 권한을 요청하지 않아 표시 분류 변경 대상이 아닙니다.'}));assert.match(h.element('gps-indicator-value').textContent,/조회 대상 아님/);assert.match(h.element('gps-indicator-status').textContent,/정확한 위치 권한을 요청하지 않아/);assert.doesNotMatch(h.element('gps-indicator-feedback').textContent,/조회 응답이 일치하지/);assert.equal(h.element('gps-indicator-hide').disabled,true);assert.equal(h.element('gps-indicator-restore').disabled,true);assert.equal(h.writes().length,0);
});

test('normal restrictions use one persistent reason and do not repeat permission names in an error card',async()=>{
  const h=harness({compatibility:true});await h.ready(snapshot({flags:null,sensitiveBit:null,granted:null,canHide:false,canRestore:false,reasonKo:'정확한 위치 권한을 요청하지 않은 앱입니다.'}));
  assert.equal(h.element('gps-indicator-feedback').options,null);assert.match(h.element('gps-indicator-status').textContent,/조회만 가능/);assert.doesNotMatch(h.element('gps-indicator-status').textContent,/GRANT_RUNTIME_PERMISSIONS|0x100/);
  h.enqueue(snapshot({writeAccessGranted:false,canHide:false,reasonKo:'현재 shell에 변경 권한이 없습니다.'}));await h.api.refresh();assert.equal(h.element('gps-indicator-feedback').options,null);assert.match(h.element('gps-indicator-status').textContent,/현재 ADB 권한으로는/);
});

test('a confirmed write with history storage failure keeps the saved original and warns without invalidating a safe restore',async()=>{
  const h=harness();await h.ready();h.enqueue(snapshot({flags:512,sensitiveBit:0,canHide:false,canRestore:true,original:{bit:256,state:'hidden'},snapshotToken:'HIDDEN',message:'표시 분류와 위치 권한을 확인했습니다.',historyError:'원래 비트 기록은 보관됐지만 변경 이력을 저장하지 못했습니다.'}));await h.consent();const feedback=h.element('gps-indicator-feedback');assert.equal(feedback.options.type,'warning');assert.match(feedback.textContent,/원래 비트 기록은 보관됐지만 변경 이력을 저장하지 못했습니다/);assert.match(h.element('gps-indicator-original').textContent,/분류 적용/);assert.equal(h.element('gps-indicator-restore').disabled,false);assert.equal(h.writes().length,1);
});

test('cancelling the confirmation sends no mutation and clears its acknowledgement',async()=>{
  const h=harness();await h.ready();await h.element('gps-indicator-hide').click();h.element('gps-indicator-ack').checked=true;h.element('gps-indicator-ack').change();await h.element('gps-indicator-confirm-cancel').click();assert.equal(h.element('gps-indicator-confirm').hidden,true);assert.equal(h.element('gps-indicator-ack').checked,false);assert.equal(h.writes().length,0);await h.element('gps-indicator-hide').click();assert.equal(h.element('gps-indicator-confirm-run').disabled,true);
});

test('refresh invalidates an open confirmation and only re-reads the selected app',async()=>{
  const h=harness();await h.ready();await h.element('gps-indicator-hide').click();h.enqueue(snapshot({snapshotToken:'NEW'}));await h.element('gps-indicator-refresh').click();assert.equal(h.element('gps-indicator-confirm').hidden,true);assert.equal(h.writes().length,0);assert.equal(h.reads().length,2);assert.equal(h.element('gps-indicator-hide').disabled,false);
});

test('permission, unsupported firmware and shared UID restrictions always disable both mutation buttons',async()=>{
  for(const extra of [{granted:false,canHide:false,canRestore:false,reasonKo:'정확한 위치 권한이 허용되지 않았습니다.'},{profileMatches:false,reasonKo:'대조한 빌드와 현재 펌웨어가 다릅니다.'},{sharedPackages:['org.example.maps','org.example.peer'],reasonKo:'같은 UID를 사용하는 앱이 있어 변경하지 않습니다.'},{snapshotToken:null,canHide:false,canRestore:false,reasonKo:'변경 전 상태 토큰을 확인하지 못했습니다.'}]){
    const h=harness();await h.ready(snapshot({...extra,canRestore:extra.canRestore??true}));assert.equal(h.element('gps-indicator-hide').disabled,true);assert.equal(h.element('gps-indicator-restore').disabled,true);assert.match(h.element('gps-indicator-status').textContent,/[가-힣]/);assert.equal(h.element('gps-indicator-feedback').options,null);await h.element('gps-indicator-hide').click();assert.equal(h.writes().length,0);
  }
});

test('English read errors keep the Korean retry visible and raw permission details in the read-only dialog',async()=>{
  const h=harness({compatibility:true});h.api.open('PHONE');h.api.activate(true);h.enqueueError({error:'Permission denied',requiredAccessKo:'필요 권한: GRANT_RUNTIME_PERMISSIONS',rawError:'<script>SecurityException</script>'});await h.api.selectApp(app,0);
  const feedback=h.element('gps-indicator-feedback');assert.match(feedback.textContent,/연결 또는 서버 응답/);assert.doesNotMatch(feedback.textContent,/GRANT_RUNTIME_PERMISSIONS|SecurityException/);assert.equal(h.element('gps-indicator-hide').disabled,true);
  const trigger=h.element('gps-indicator-status').children.find(child=>child.dataset.compatibilityDetails);await trigger.click();const dialog=h.element('compatibility-detail-dialog');assert.equal(dialog.open,true);assert.match(dialog.innerHTML,/&lt;script&gt;SecurityException&lt;\/script&gt;/);assert.doesNotMatch(dialog.innerHTML,/<script>/);assert.match(dialog.textContent,/GRANT_RUNTIME_PERMISSIONS/);h.ui.closeDetails();assert.equal(h.document.activeElement,trigger);
  h.enqueue(snapshot());await feedback.options.onAction();assert.equal(h.writes().length,0);assert.equal(h.reads().length,2);assert.equal(h.element('gps-indicator-hide').disabled,false);
});

test('uncertain write errors preserve the known backup, disable actions and never auto-retry a mutation',async()=>{
  const h=harness();await h.ready(snapshot({original:{bit:256,state:'hidden'}}));h.enqueueError({error:'변경 후 현재 값을 확인하지 못했습니다.',mayHaveChanged:true,rawError:'offline'});await h.consent();const feedback=h.element('gps-indicator-feedback');assert.match(feedback.textContent,/같은 작업을 반복하지 말고/);assert.match(h.element('gps-indicator-original').textContent,/분류 적용/);assert.equal(h.element('gps-indicator-hide').disabled,true);assert.equal(h.element('gps-indicator-restore').disabled,true);assert.equal(h.writes().length,1);
  h.enqueue(snapshot({flags:512,sensitiveBit:0,canHide:false,canRestore:true,original:{bit:256,state:'hidden'},snapshotToken:'RECOVERED'}));await feedback.options.onAction();assert.equal(h.writes().length,1);assert.equal(h.reads().length,2);assert.equal(h.element('gps-indicator-restore').disabled,false);
});

test('uncertain success response is a warning and also requires a fresh read before more actions',async()=>{
  const h=harness();await h.ready();h.enqueue(snapshot({sensitiveBit:0,flags:512,canHide:false,canRestore:true,mayHaveChanged:true,message:'기록은 저장했으나 결과를 확인하지 못했습니다.'}));await h.consent();assert.equal(h.element('gps-indicator-feedback').options.type,'warning');assert.equal(h.element('gps-indicator-restore').disabled,true);assert.equal(h.element('gps-indicator-refresh').disabled,false);assert.equal(h.writes().length,1);
});

test('changing the selected app aborts an old request and ignores its late response',async()=>{
  const h=harness(),old=deferred(),next=deferred();h.api.open('PHONE');h.api.activate(true);h.pending.push(old.promise);const first=h.api.selectApp(app,0);const oldSignal=h.calls[0].options.signal;h.pending.push(next.promise);const second=h.api.selectApp({package:'org.example.other',label:'다른 앱',userId:10},10);assert.equal(oldSignal.aborted,true);
  old.resolve(response(snapshot()));await first;assert.equal(h.element('gps-indicator-app').textContent,'다른 앱');assert.equal(h.element('gps-indicator-progress').hidden,false);assert.equal(h.element('gps-indicator-hide').disabled,true);
  next.resolve(response(snapshot({package:'org.example.other',userId:10})));await second;assert.match(h.element('gps-indicator-target-info').textContent,/사용자 10/);assert.equal(h.element('gps-indicator-progress').hidden,true);assert.equal(h.writes().length,0);
});

test('switching the user for the same package performs a fresh guarded query',async()=>{
  const h=harness();await h.ready();h.enqueue(snapshot({userId:10,snapshotToken:'USER10'}));await h.api.selectApp({...app,userId:10},10);assert.equal(h.reads().length,2);assert.equal(new URL(h.reads()[1].url,'http://mock').searchParams.get('user'),'10');h.enqueue(snapshot({userId:10,sensitiveBit:0,flags:512,canHide:false,canRestore:true}));await h.consent();assert.equal(JSON.parse(h.writes()[0].options.body).userId,10);assert.equal(JSON.parse(h.writes()[0].options.body).expected,'USER10');
});

test('leaving the tab or closing a device invalidates late responses and keeps hidden actions disabled',async()=>{
  for(const close of [false,true]){const h=harness(),wait=deferred();h.api.open('PHONE');h.api.activate(true);h.pending.push(wait.promise);const loading=h.api.selectApp(app,0);const signal=h.calls[0].options.signal;if(close)h.api.close();else h.api.activate(false);assert.equal(signal.aborted,true);wait.resolve(response(snapshot()));await loading;assert.equal(h.element('gps-indicator-hide').disabled,true);assert.equal(h.element('gps-indicator-progress').hidden,true);assert.equal(h.element('gps-indicator-feedback').options,null);assert.equal(h.writes().length,0);}
});

test('wrong-app or wrong-user responses cannot arm either action',async()=>{
  for(const extra of [{package:'org.example.wrong'},{userId:10},{sensitiveBit:128},{granted:null}]){const h=harness();await h.ready(snapshot(extra));assert.equal(h.element('gps-indicator-hide').disabled,true);assert.equal(h.element('gps-indicator-restore').disabled,true);assert.match(h.element('gps-indicator-feedback').textContent,/선택한 앱과 조회 응답/);assert.equal(h.writes().length,0);}
});

test('the existing app picker selects a list entry and a linked hook cannot trigger a duplicate read',async()=>{
  let argumentsSeen;const h=harness({picker:async(...args)=>{argumentsSeen=args;return app;},linkedSelection:true});h.api.open('PHONE');h.api.activate(true);h.enqueue(snapshot());await h.element('gps-indicator-pick').click();await settle();assert.equal(argumentsSeen[0],'app');assert.equal(argumentsSeen[1].title,'위치 표시를 관리할 앱 선택');assert.equal(h.selections.length,1);assert.equal(h.reads().length,1);assert.equal(h.writes().length,0);assert.equal(h.element('gps-indicator-hide').disabled,false);
});

test('a picker result from a previous device cannot become the current target',async()=>{
  const wait=deferred(),h=harness({picker:()=>wait.promise});h.api.open('PHONE');h.api.activate(true);const picking=h.element('gps-indicator-pick').click();h.api.open('OTHER');h.api.activate(true);wait.resolve(app);await picking;assert.equal(h.selections.length,0);assert.equal(h.reads().length,0);assert.equal(h.element('gps-indicator-app').textContent,'앱을 선택하세요');assert.equal(h.element('gps-indicator-progress').hidden,true);
});

test('repeated consent clicks while a save is pending produce one POST and visible progress',async()=>{
  const h=harness(),wait=deferred();await h.ready();h.pending.push(wait.promise);const writing=h.consent();await settle();assert.equal(h.writes().length,1);assert.equal(h.element('gps-indicator-progress').hidden,false);assert.equal(h.element('gps-indicator-confirm-run').disabled,true);await h.element('gps-indicator-confirm-run').click();assert.equal(h.writes().length,1);wait.resolve(response(snapshot({sensitiveBit:0,flags:512,canHide:false,canRestore:true})));await writing;assert.equal(h.writes().length,1);assert.equal(h.element('gps-indicator-progress').hidden,true);
});

test('the shared renderer keeps one status and effect hint while technical values stay in a read-only dialog',async()=>{
  const h=harness({compatibility:true});await h.ready();const status=h.element('gps-indicator-status');
  assert.equal((status.innerHTML.match(/class="compatibility-badge /g)||[]).length,1);assert.match(status.textContent,/변경 요청 가능/);assert.equal((status.textContent.match(/실제 효과 미확인/g)||[]).length,1);assert.doesNotMatch(status.textContent,/0x100|GRANT_RUNTIME|MOCK_BUILD/);
  assert.equal(h.element('gps-indicator-value').textContent,'분류 적용');assert.equal(h.element('gps-indicator-original').textContent,'보관 기록 없음');assert.equal(h.element('gps-indicator-feedback').options,null);
  const trigger=status.children.find(child=>child.dataset.compatibilityDetails);await trigger.click();const dialog=h.element('compatibility-detail-dialog');assert.equal(dialog.open,true);assert.match(dialog.textContent,/0x100 켜짐/);assert.match(dialog.textContent,/MOCK_BUILD/);assert.match(dialog.textContent,/GRANT_RUNTIME_PERMISSIONS/);assert.equal((dialog.innerHTML.match(/<button\b/g)||[]).length,1);assert.equal(h.writes().length,0);
  h.ui.closeDetails();assert.equal(h.document.activeElement,trigger);assert.equal(h.writes().length,0);
});

test('the common status reflects server write denial even if a stale individual action flag is true',async()=>{
  const h=harness({compatibility:true});await h.ready(snapshot({compatibility:{support:{state:'supported',labelKo:'지원'},access:{state:'denied',labelKo:'권한 제한'},evidence:{state:'current',labelKo:'현재 코드 확인'},effect:{state:'untested',labelKo:'실제 효과 미시험'},canRead:true,canWrite:false},writeAccessGranted:false,canHide:true,canRestore:true}));
  assert.match(h.element('gps-indicator-status').textContent,/조회만 가능/);assert.match(h.element('gps-indicator-status').textContent,/현재 ADB 권한으로는/);assert.equal(h.element('gps-indicator-feedback').options,null);assert.equal(h.element('gps-indicator-hide').disabled,true);assert.equal(h.element('gps-indicator-restore').disabled,true);assert.equal(h.writes().length,0);
});

test('an updated build is shown as unverified rather than a permission failure',async()=>{
  const h=harness({compatibility:true});await h.ready(snapshot({profileMatches:false,canHide:false,canRestore:false,reasonKo:'현재 펌웨어와 대조 자료가 다릅니다.'}));assert.match(h.element('gps-indicator-status').textContent,/현재 빌드 확인 필요/);assert.match(h.element('gps-indicator-status').textContent,/표시 제어 경로를 검증하지 못해/);assert.equal(h.element('gps-indicator-feedback').options,null);assert.equal(h.element('gps-indicator-refresh').disabled,false);assert.equal(h.writes().length,0);
});

test('a failed refresh labels preserved values as previous and only a fresh success re-enables actions',async()=>{
  const h=harness({compatibility:true}),wait=deferred();await h.ready();await h.element('gps-indicator-status').children.find(child=>child.dataset.compatibilityDetails).click();h.pending.push(wait.promise);const loading=h.api.refresh();assert.equal(h.element('compatibility-detail-dialog').open,false);assert.equal(h.element('gps-indicator-stale').hidden,false);assert.match(h.element('gps-indicator-status').textContent,/조회 중/);assert.equal(h.element('gps-indicator-hide').disabled,true);
  wait.resolve(response({error:'기기 연결이 끊겼습니다.'},false));await loading;assert.equal(h.element('gps-indicator-value').textContent,'분류 적용');assert.equal(h.element('gps-indicator-stale').hidden,false);assert.match(h.element('gps-indicator-status').textContent,/조회 실패/);assert.equal(h.element('gps-indicator-hide').disabled,true);assert.equal(h.element('gps-indicator-refresh').disabled,false);
  h.enqueue(snapshot());await h.element('gps-indicator-feedback').options.onAction();assert.equal(h.element('gps-indicator-stale').hidden,true);assert.match(h.element('gps-indicator-status').textContent,/변경 요청 가능/);assert.equal(h.element('gps-indicator-hide').disabled,false);assert.equal(h.writes().length,0);
});

test('a failed app picker retries selection rather than an ineffective query without an app',async()=>{
  let count=0;const h=harness({compatibility:true,picker:async()=>{if(++count===1)throw new Error('앱 목록을 읽지 못했습니다.');return app;}});h.api.open('PHONE');h.api.activate(true);await h.element('gps-indicator-pick').click();assert.equal(h.element('gps-indicator-feedback').options.actionLabel,'앱 선택 다시 열기');assert.equal(h.reads().length,0);h.enqueue(snapshot());await h.element('gps-indicator-feedback').options.onAction();assert.equal(count,2);assert.equal(h.reads().length,1);assert.equal(h.writes().length,0);assert.match(h.element('gps-indicator-status').textContent,/변경 요청 가능/);
});

test('an unreadable permission result never claims the app did not request location',async()=>{
  const h=harness({compatibility:true});await h.ready(snapshot({granted:null,flags:null,sensitiveBit:null,canHide:false,reasonKo:'사용자별 정밀 위치 권한의 플래그를 명확히 읽지 못했습니다.'}));assert.match(h.element('gps-indicator-status').textContent,/위치 권한 상태를 확인하지 못해/);assert.doesNotMatch(h.element('gps-indicator-status').textContent,/요청하지 않아/);assert.equal(h.element('gps-indicator-hide').disabled,true);assert.equal(h.writes().length,0);
});
