import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../public/privacy-indicators.js',import.meta.url),'utf8');
const compatibilitySource=readFileSync(new URL('../../../public/compatibility-ui.js',import.meta.url),'utf8');
const fingerprint='mock-reviewed-fingerprint';
const snapshot=(extra={})=>({deviceId:'PHONE',fingerprint,profileMatches:true,sourceBuild:'MOCK_BUILD',stored:{exists:true,value:'false'},settingEnabled:false,storageStatus:'stored',canWrite:true,effectVerified:false,...extra});
const response=(data,ok=true)=>({ok,json:async()=>data});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const settle=()=>new Promise(resolve=>setImmediate(resolve));

function harness({compatibility=true}={}){
  const elements=new Map(),calls=[],pending=[],timers=new Map(),starts=[],documentListeners=new Map();let timerId=0,document;
  class Element{
    constructor(tag='div'){this.tagName=tag.toUpperCase();this.dataset={};this.disabled=false;this.hidden=false;this.children=[];this.listeners=new Map();this.attributes=new Map();this._html='';this._text='';this.open=false;this.clickCount=0;this.scrollCount=0;}
    set textContent(value){this._text=value;this._html='';this.children=[];}
    get textContent(){return this._text+this._html.replace(/<[^>]*>/g,'')+this.children.filter(child=>!child.fromHTML).map(child=>child.textContent).join('');}
    set innerHTML(value){
      this._html=value;this._text='';this.children=[];
      if(this===root){for(const match of value.matchAll(/<([a-z]+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)){
        const element=new Element(match[1]);element.id=match[3];element.disabled=/\bdisabled(?:\s|>|$)/.test(match[2]);element.hidden=/\bhidden(?:\s|>|$)/.test(match[2]);elements.set(element.id,element);
      }
      this.setButtons=[...value.matchAll(/<button\b([^>]*\bdata-privacy-set="([^"]+)"[^>]*)>/g)].map(match=>{const element=new Element('button');element.dataset.privacySet=match[2];element.disabled=/\bdisabled(?:\s|>|$)/.test(match[1]);return element;});}
      for(const match of value.matchAll(/<button\b[^>]*data-compatibility-details="([^"]+)"[^>]*>([^<]*)<\/button>/g)){const button=new Element('button');button.dataset.compatibilityDetails=match[1];button.textContent=match[2];button.fromHTML=true;this.children.push(button);}
    }
    get innerHTML(){return this._html;}
    querySelectorAll(selector){assert.equal(selector,'[data-privacy-set]');return this.setButtons||[];}
    setAttribute(name,value){this.attributes.set(name,value);}
    addEventListener(name,listener){this.listeners.set(name,listener);}
    append(...children){this.children.push(...children);for(const child of children)if(child.id)elements.set(child.id,child);}
    closest(selector){return selector==='[data-compatibility-details]'&&this.dataset.compatibilityDetails?this:null;}
    focus(){document.activeElement=this;}
    showModal(){this.open=true;}
    close(){this.open=false;this.listeners.get('close')?.();}
    scrollIntoView(){this.scrollCount++;}
    async click(){if(this.disabled)return;this.clickCount++;const result=this.listeners.get('click')?.({target:this,currentTarget:this});documentListeners.get('click')?.({target:this});return result;}
  }
  const root=new Element();root.id='privacy-indicators-panel';elements.set(root.id,root);
  for(const id of ['apps-tab','gps-indicator-panel']){const element=new Element(id==='apps-tab'?'button':'div');element.id=id;elements.set(id,element);}
  document={getElementById:id=>elements.get(id)||null,createElement:tag=>new Element(tag),body:new Element('body'),addEventListener:(name,fn)=>documentListeners.set(name,fn),activeElement:null};
  const context={document,AbortController,
    setTimeout:(callback,delay)=>{const id=++timerId;timers.set(id,{callback,delay});return id;},clearTimeout:id=>timers.delete(id),
    fetch:async(url,options={})=>{calls.push({url,options});if(url==='/api/session')return response({csrfToken:'MOCK_CSRF'});assert.ok(pending.length,'Missing mock response for '+url);const next=pending.shift();return typeof next==='function'?next(url,options):next;},
    window:{DeskFeedback:{start:(title,options)=>{const entry={title,options,finished:false};starts.push(entry);return()=>{entry.finished=true;};},state:(host,options)=>{host.options=options;host.hidden=!options;host.textContent=options?[options.title,options.message,options.requiredAccessKo].filter(Boolean).join(' '):'';host.children=[];}}},
  };
  if(compatibility)vm.runInNewContext(compatibilitySource,context);
  vm.runInNewContext(source,context);
  return{api:context.window.PrivacyIndicators,ui:context.window.CompatibilityUI,document,root,elements,calls,pending,timers,starts,element:id=>elements.get(id),buttons:root.setButtons,
    details:async(id='privacy-compatibility')=>{await elements.get(id).children.find(child=>child.dataset.compatibilityDetails).click();return elements.get('compatibility-detail-dialog');},
    enqueue:data=>pending.push(response(data)),enqueueError:data=>pending.push(response(data,false)),
    writes:()=>calls.filter(call=>call.options.method==='POST'),reads:()=>calls.filter(call=>call.url.startsWith('/api/device/privacy-indicators')&&call.options.method==='GET')};
}

test('opening a device mounts both indicators without fetching or changing anything',()=>{
  const h=harness();h.api.open('PHONE');
  assert.equal(h.calls.length,0);assert.match(h.root.innerHTML,/초록 카메라·마이크 표시/);assert.match(h.root.innerHTML,/파란 위치\(GPS\) 표시/);assert.match(h.root.innerHTML,/실제 표시 효과 미확인/);assert.match(h.root.innerHTML,/전체 제어 미제공/);
  assert.equal(h.element('privacy-location-unavailable'),undefined);assert.equal(h.element('privacy-location-apps').disabled,false);assert.ok(h.buttons.every(button=>button.disabled));assert.equal(h.element('privacy-indicators-refresh').disabled,true);assert.equal(h.element('privacy-camera-status').textContent,'조회 전');
});

test('activating the settings tab starts a visible read-only request and enables green controls only after a valid response',async()=>{
  const h=harness(),wait=deferred();h.api.open('PHONE');h.pending.push(wait.promise);const loading=h.api.activate(true);
  assert.equal(h.reads().length,1);assert.equal(h.writes().length,0);assert.equal(h.element('privacy-indicator-progress').hidden,false);assert.ok(h.buttons.every(button=>button.disabled));assert.equal(h.element('privacy-indicators-refresh').disabled,true);assert.equal(h.starts.length,1);
  wait.resolve(response(snapshot()));await loading;
  assert.equal(h.element('privacy-camera-value').textContent,'꺼짐으로 저장됨');assert.ok(h.buttons.every(button=>!button.disabled));assert.equal(h.element('privacy-indicator-progress').hidden,true);assert.equal(h.element('privacy-location-unavailable'),undefined);assert.equal(h.timers.size,0);assert.equal(h.element('privacy-camera-status').textContent,'변경 요청 가능');
  await h.api.activate(true);assert.equal(h.calls.length,1);
});

test('only an explicit green button click posts its chosen value with CSRF and the exact saved-state precondition',async()=>{
  const h=harness();h.api.open('PHONE');h.enqueue(snapshot());await h.api.activate(true);assert.equal(h.writes().length,0);
  h.enqueue(snapshot({ok:true,stored:{exists:true,value:'true'},message:'저장값을 확인했습니다. 실제 표시 효과는 미확인입니다.'}));await h.buttons.find(button=>button.dataset.privacySet==='true').click();
  assert.equal(h.writes().length,1);assert.equal(h.calls.filter(call=>call.url==='/api/session').length,1);
  const write=h.writes()[0];assert.equal(write.url,'/api/device/privacy-indicators');assert.equal(write.options.headers['X-ADB-Desk-Token'],'MOCK_CSRF');assert.equal(write.options.headers['Content-Type'],'application/json');
  assert.deepEqual(JSON.parse(write.options.body),{deviceId:'PHONE',indicator:'camera-microphone',value:true,expected:{exists:true,value:'false'},expectedFingerprint:fingerprint});
  assert.equal(h.element('privacy-camera-value').textContent,'켜짐으로 저장됨');assert.equal(h.element('privacy-location-unavailable'),undefined);
});

test('ordinary refresh is GET-only and presents a progress state immediately',async()=>{
  const h=harness();h.api.open('PHONE');h.enqueue(snapshot());await h.api.activate(true);const wait=deferred();h.pending.push(wait.promise);const loading=h.element('privacy-indicators-refresh').click();
  assert.equal(h.reads().length,2);assert.equal(h.writes().length,0);assert.equal(h.element('privacy-indicator-progress').hidden,false);assert.ok(h.buttons.every(button=>button.disabled));
  wait.resolve(response(snapshot({stored:{exists:true,value:'true'}})));await loading;assert.equal(h.element('privacy-camera-value').textContent,'켜짐으로 저장됨');assert.equal(h.writes().length,0);
});

test('permission errors show Korean guidance and retry performs a fresh GET instead of changing the phone',async()=>{
  const h=harness();h.api.open('PHONE');h.enqueueError({error:'Permission denied',requiredAccessKo:'필요 권한: READ_DEVICE_CONFIG',rawError:'<script>Permission denied</script>'});await h.api.activate(true);
  const feedback=h.element('privacy-indicator-feedback');assert.match(feedback.textContent,/[가-힣]/);assert.doesNotMatch(feedback.textContent,/READ_DEVICE_CONFIG|Permission denied/);assert.match(feedback.options.actionLabel,/다시 조회/);assert.equal(typeof feedback.options.onAction,'function');assert.ok(h.buttons.every(button=>button.disabled));
  const details=await h.details();assert.equal(details.tagName,'DIALOG');assert.equal(details.open,true);assert.match(details.textContent,/READ_DEVICE_CONFIG/);assert.match(details.innerHTML,/&lt;script&gt;Permission denied&lt;\/script&gt;/);assert.doesNotMatch(details.innerHTML,/<script>/);assert.equal(h.writes().length,0);
  h.enqueue(snapshot());await feedback.options.onAction();assert.equal(h.reads().length,2);assert.equal(h.writes().length,0);assert.ok(h.buttons.every(button=>!button.disabled));
});

test('retry after an uncertain failed write only re-reads the saved value and never resubmits the POST',async()=>{
  const h=harness();h.api.open('PHONE');h.enqueue(snapshot());await h.api.activate(true);
  h.enqueueError({error:'저장 후 값을 확인하지 못했습니다.',mayHaveChanged:true,requiredAccessKo:'현재 연결을 확인하세요.'});await h.buttons[0].click();
  const feedback=h.element('privacy-indicator-feedback');assert.match(feedback.textContent,/전달됐을 수/);assert.ok(h.buttons.every(button=>button.disabled));assert.equal(h.writes().length,1);assert.equal(h.element('privacy-camera-value').textContent,'현재 값 미확인');assert.equal(h.element('privacy-camera-previous').hidden,false);assert.equal(h.element('privacy-camera-previous').textContent,'이전 조회값: 꺼짐으로 저장됨');
  h.enqueue(snapshot({stored:{exists:true,value:'true'}}));await feedback.options.onAction();assert.equal(h.writes().length,1);assert.equal(h.reads().length,2);assert.equal(h.element('privacy-camera-value').textContent,'켜짐으로 저장됨');
});

test('a definite DeviceConfig allowlist rejection preserves the known value and blocks green actions until a later read allows writing',async()=>{
  const h=harness();h.api.open('PHONE');h.enqueue(snapshot());await h.api.activate(true);
  const rejection={code:'privacy_indicator_allowlist_denied',error:'현재 펌웨어의 허용 목록에 없어 표시 설정 저장이 거부됐습니다. 기존 저장값은 변경되지 않았습니다.',mayHaveChanged:false,writeBlocked:true,requiredAccessKo:'필요 접근: 제조사 DeviceConfig 허용 목록에 등록된 키만 shell에서 변경할 수 있습니다.',rawError:'Permission denial: must add flag to the allowlist'};
  h.enqueueError(rejection);await h.buttons[0].click();
  const feedback=h.element('privacy-indicator-feedback');
  assert.equal(h.element('privacy-camera-value').textContent,'꺼짐으로 저장됨');assert.ok(h.buttons.every(button=>button.disabled));assert.equal(h.element('privacy-indicators-refresh').disabled,false);assert.equal(h.writes().length,1);
  assert.equal(feedback.options.title,'변경 요청 거부');assert.match(feedback.textContent,/기존 저장값은 변경되지 않았습니다/);assert.doesNotMatch(feedback.textContent,/전달됐을 수|저장값 형식 확인 필요|DeviceConfig/);assert.equal(h.element('privacy-camera-status').textContent,'조회만 가능');assert.match(h.element('privacy-compatibility').textContent,/현재 ADB 허용 목록/);assert.match((await h.details()).textContent,/제조사 DeviceConfig 허용 목록/);
  const deniedSnapshot=snapshot({canWrite:false,writeAccess:{state:'denied',code:rejection.code,reasonKo:rejection.error,requiredAccessKo:rejection.requiredAccessKo}});
  h.enqueue(deniedSnapshot);await feedback.options.onAction();assert.equal(h.reads().length,2);assert.equal(h.writes().length,1);assert.ok(h.buttons.every(button=>button.disabled));assert.equal(feedback.options,null);assert.match(h.element('privacy-compatibility').textContent,/현재 ADB 허용 목록/);assert.doesNotMatch(h.element('privacy-compatibility').textContent,/저장값 형식/);
  await h.buttons[0].click();assert.equal(h.writes().length,1);
  h.enqueue(snapshot());await h.element('privacy-indicators-refresh').click();assert.equal(h.reads().length,3);assert.equal(h.writes().length,1);assert.ok(h.buttons.every(button=>!button.disabled));assert.equal(h.element('privacy-camera-status').textContent,'변경 요청 가능');
});

test('a read response with denied write access explains firmware policy while retaining default or stored values',async()=>{
  for(const extra of [{},{storageStatus:'default',stored:{exists:false,value:null}},{canWrite:true}]){
    const h=harness();h.api.open('PHONE');h.enqueue(snapshot({canWrite:false,...extra,writeAccess:{state:'denied',code:'privacy_indicator_allowlist_denied',reasonKo:'이 기기의 허용 목록에서 초록 표시 설정의 ADB 쓰기를 차단합니다.',requiredAccessKo:'필요 접근: 펌웨어의 DeviceConfig 쓰기 허용 목록 변경은 일반 ADB에서 제공되지 않습니다.'}}));await h.api.activate(true);
    assert.ok(h.buttons.every(button=>button.disabled));assert.equal(h.element('privacy-location-unavailable'),undefined);assert.equal(h.writes().length,0);
    assert.equal(h.element('privacy-camera-value').textContent,extra.storageStatus==='default'?'저장값 없음':'꺼짐으로 저장됨');assert.equal(h.element('privacy-indicator-feedback').options,null);assert.match(h.element('privacy-compatibility').textContent,/허용 목록/);assert.doesNotMatch(h.element('privacy-compatibility').textContent,/저장값 형식 확인 필요|켜짐·꺼짐으로 해석할 수 없는/);assert.equal(h.element('privacy-camera-status').textContent,'조회만 가능');assert.match((await h.details()).textContent,/DeviceConfig 쓰기 허용 목록/);
  }
});

test('a failed retry read cannot erase a previously confirmed write block or turn green actions back on',async()=>{
  const h=harness();h.api.open('PHONE');h.enqueue(snapshot({canWrite:false,writeAccess:{state:'denied',reasonKo:'펌웨어 허용 목록으로 쓰기가 차단됐습니다.'}}));await h.api.activate(true);
  h.enqueueError({error:'연결이 끊어져 다시 조회하지 못했습니다.'});await h.element('privacy-indicators-refresh').click();
  assert.equal(h.element('privacy-camera-value').textContent,'현재 값 미확인');assert.equal(h.element('privacy-camera-previous').textContent,'이전 조회값: 꺼짐으로 저장됨');assert.equal(h.element('privacy-camera-status').textContent,'조회 실패');assert.match(h.element('privacy-indicator-feedback').textContent,/현재 상태를 읽지 못했습니다/);assert.match((await h.details()).textContent,/연결이 끊어져/);assert.ok(h.buttons.every(button=>button.disabled));assert.equal(h.writes().length,0);assert.equal(h.element('privacy-indicators-refresh').disabled,false);
});

test('unverified firmware write policy explains its reason separately from stored-value format and retries with GET only',async()=>{
  for(const [code,reasonKo] of [['privacy_indicator_policy_hash_mismatch','현재 DeviceConfig 시스템 모듈이 대조한 코드와 달라 쓰기 허용 여부를 확인하지 못했습니다.'],['privacy_indicator_policy_query_failed','허용 목록 정책 조회가 실패해 쓰기 허용 여부를 확인하지 못했습니다.']]){
    const h=harness();h.api.open('PHONE');h.enqueue(snapshot({storageStatus:'default',stored:{exists:false,value:null},canWrite:false,writeAccess:{state:'unverified',code,reasonKo,requiredAccessKo:'필요 접근: 현재 펌웨어의 DeviceConfig 쓰기 정책을 조회할 수 있어야 합니다.'}}));await h.api.activate(true);
    const feedback=h.element('privacy-indicator-feedback');assert.equal(h.element('privacy-camera-value').textContent,'저장값 없음');assert.ok(h.buttons.every(button=>button.disabled));assert.equal(h.element('privacy-location-unavailable'),undefined);assert.equal(feedback.options,null);assert.match(h.element('privacy-compatibility').textContent,/현재 변경 권한을 확인하지 못해/);assert.doesNotMatch(h.element('privacy-compatibility').textContent,/저장값 형식 확인 필요|켜짐·꺼짐으로 해석할 수 없는/);assert.equal(h.element('privacy-camera-status').textContent,'조회만 가능');assert.equal(h.writes().length,0);const details=await h.details();assert.match(details.textContent,new RegExp(reasonKo));assert.match(details.textContent,/DeviceConfig 쓰기 정책/);
    h.enqueue(snapshot());await h.element('privacy-indicators-refresh').click();assert.equal(h.reads().length,2);assert.equal(h.writes().length,0);assert.ok(h.buttons.every(button=>!button.disabled));assert.equal(h.element('privacy-camera-status').textContent,'변경 요청 가능');
  }
});

test('unmatched builds, unknown raw values and unreviewed defaults keep both green actions disabled',async()=>{
  for(const data of [snapshot({profileMatches:false,canWrite:false}),snapshot({storageStatus:'unexpected',stored:{exists:true,value:'1'},settingEnabled:null,canWrite:false}),snapshot({profileMatches:false,storageStatus:'default',stored:{exists:false,value:null},settingEnabled:null,canWrite:false})]){
    const h=harness();h.api.open('PHONE');h.enqueue(data);await h.api.activate(true);assert.ok(h.buttons.every(button=>button.disabled));assert.equal(h.element('privacy-location-unavailable'),undefined);assert.equal(h.writes().length,0);assert.equal(h.element('privacy-indicator-feedback').options,null);assert.match(h.element('privacy-compatibility').textContent,/[가-힣]/);assert.equal(h.element('privacy-camera-status').textContent,data.profileMatches?'조회만 가능':'현재 빌드 확인 필요');
  }
});

test('leaving the tab aborts the pending read and a late response cannot enable hidden controls',async()=>{
  const h=harness(),wait=deferred();h.api.open('PHONE');h.pending.push(wait.promise);const loading=h.api.activate(true);const signal=h.calls[0].options.signal;
  h.api.activate(false);assert.equal(signal.aborted,true);assert.equal(h.element('privacy-indicator-progress').hidden,true);assert.ok(h.buttons.every(button=>button.disabled));
  wait.resolve(response(snapshot()));await loading;assert.equal(h.element('privacy-camera-value').textContent,'조회 전');assert.ok(h.buttons.every(button=>button.disabled));assert.equal(h.writes().length,0);
});

test('a previous device response cannot overwrite or finish the next device loading state',async()=>{
  const h=harness(),first=deferred(),second=deferred();h.api.open('PHONE');h.pending.push(first.promise);const firstLoad=h.api.activate(true);
  h.api.open('OTHER');h.pending.push(second.promise);const secondLoad=h.api.activate(true);assert.match(h.calls.at(-1).url,/id=OTHER$/);
  first.resolve(response(snapshot({stored:{exists:true,value:'true'}})));await firstLoad;assert.equal(h.element('privacy-camera-value').textContent,'조회 중…');assert.equal(h.element('privacy-indicator-progress').hidden,false);assert.ok(h.buttons.every(button=>button.disabled));
  second.resolve(response(snapshot({deviceId:'OTHER'})));await secondLoad;assert.equal(h.element('privacy-camera-value').textContent,'꺼짐으로 저장됨');assert.equal(h.element('privacy-indicator-progress').hidden,true);assert.ok(h.buttons.every(button=>!button.disabled));
});

test('closing a device invalidates late successes and failures without producing new requests or retry UI',async()=>{
  for(const failed of [false,true]){
    const h=harness(),wait=deferred();h.api.open('PHONE');h.pending.push(wait.promise);const loading=h.api.activate(true);h.api.close();
    wait.resolve(response(failed?{error:'조회 실패'}:snapshot(),!failed));await loading;
    assert.equal(h.element('privacy-camera-value').textContent,'조회 전');assert.ok(h.buttons.every(button=>button.disabled));assert.equal(h.element('privacy-indicator-feedback').options,null);assert.equal(h.element('privacy-indicator-progress').hidden,true);assert.equal(h.element('privacy-indicators-refresh').disabled,true);assert.equal(h.calls.length,1);
  }
});

test('duplicate button clicks during a pending save do not send a second mutation',async()=>{
  const h=harness();h.api.open('PHONE');h.enqueue(snapshot());await h.api.activate(true);const wait=deferred();h.pending.push(wait.promise);const save=h.buttons[0].click();await settle();
  assert.equal(h.writes().length,1);assert.ok(h.buttons.every(button=>button.disabled));await h.buttons[0].click();assert.equal(h.writes().length,1);
  wait.resolve(response(snapshot({ok:true,stored:{exists:true,value:'true'},message:'저장값 확인 · 실제 효과 미확인'})));await save;assert.equal(h.writes().length,1);
});

test('the compact green card has one status, one effect hint and keeps technical scope behind details',async()=>{
  const h=harness();h.api.open('PHONE');h.enqueue(snapshot({storageStatus:'default',stored:{exists:false,value:null}}));await h.api.activate(true);
  assert.equal(h.element('privacy-camera-value').textContent,'저장값 없음');const status=h.element('privacy-camera-status'),summary=h.element('privacy-compatibility');assert.equal((status.innerHTML.match(/class="compatibility-badge /g)||[]).length,1);assert.equal((summary.innerHTML.match(/class="compatibility-badge /g)||[]).length,0);assert.equal((summary.textContent.match(/실제 효과 미확인/g)||[]).length,1);assert.doesNotMatch(status.textContent+summary.textContent,/DeviceConfig|camera_mic_icons_enabled|MOCK_BUILD|기본값은 켜짐/);
  const details=await h.details();assert.match(details.textContent,/분석한 코드의 기본값은 켜짐/);assert.match(details.textContent,/MOCK_BUILD/);assert.match(details.textContent,/camera_mic_icons_enabled/);assert.equal((details.innerHTML.match(/<button\b/g)||[]).length,1);assert.equal(h.writes().length,0);
});

test('unreviewed missing values do not inherit the reviewed build default',async()=>{
  const h=harness();h.api.open('PHONE');h.enqueue(snapshot({profileMatches:false,storageStatus:'default',stored:{exists:false,value:null},canWrite:false}));await h.api.activate(true);assert.equal(h.element('privacy-camera-value').textContent,'저장값 없음');assert.equal(h.element('privacy-camera-status').textContent,'현재 빌드 확인 필요');const details=await h.details();assert.match(details.textContent,/현재 빌드의 기본값은 미확인/);assert.doesNotMatch(details.textContent,/기본값은 켜짐/);assert.ok(h.buttons.every(button=>button.disabled));assert.equal(h.writes().length,0);
});

test('closing a read-only detail dialog restores focus without a phone request',async()=>{
  const h=harness();h.api.open('PHONE');h.enqueue(snapshot());await h.api.activate(true);const trigger=h.element('privacy-compatibility').children.find(child=>child.dataset.compatibilityDetails),requests=h.calls.length;await trigger.click();const dialog=h.element('compatibility-detail-dialog');assert.equal(dialog.open,true);h.ui.closeDetails();assert.equal(dialog.open,false);assert.equal(h.document.activeElement,trigger);assert.equal(h.calls.length,requests);assert.equal(h.writes().length,0);
});

test('the GPS action opens the app tab and selected panel without invoking unavailable global writes',async()=>{
  const h=harness();h.api.open('PHONE');h.enqueue(snapshot());await h.api.activate(true);const requests=h.calls.length,details=await h.details('privacy-location-details');assert.match(details.textContent,/0x100/);assert.match(details.textContent,/위치 권한 자체는 유지/);assert.equal(h.element('privacy-location-unavailable'),undefined);
  await h.element('privacy-location-apps').click();assert.equal(h.element('apps-tab').clickCount,1);assert.equal(h.element('gps-indicator-panel').scrollCount,1);assert.equal(details.open,false);assert.equal(h.calls.length,requests);assert.equal(h.writes().length,0);
});

test('a failed read preserves any previous value separately and requires a successful GET before writing',async()=>{
  const h=harness();h.api.open('PHONE');h.enqueue(snapshot());await h.api.activate(true);const wait=deferred();h.pending.push(wait.promise);const loading=h.api.refresh();assert.equal(h.element('privacy-camera-value').textContent,'조회 중…');assert.ok(h.buttons.every(button=>button.disabled));wait.resolve(response({error:'device offline'},false));await loading;
  assert.equal(h.element('privacy-camera-value').textContent,'현재 값 미확인');assert.equal(h.element('privacy-camera-previous').hidden,false);assert.equal(h.element('privacy-camera-previous').textContent,'이전 조회값: 꺼짐으로 저장됨');assert.equal(h.element('privacy-camera-status').textContent,'조회 실패');assert.ok(h.buttons.every(button=>button.disabled));await h.buttons[0].click();assert.equal(h.writes().length,0);
  h.enqueue(snapshot({stored:{exists:true,value:'true'}}));await h.element('privacy-indicator-feedback').options.onAction();assert.equal(h.element('privacy-camera-previous').hidden,true);assert.equal(h.element('privacy-camera-value').textContent,'켜짐으로 저장됨');assert.equal(h.element('privacy-indicator-feedback').options,null);assert.ok(h.buttons.every(button=>!button.disabled));assert.equal(h.writes().length,0);
});

test('read-only fallback remains compact when the shared renderer is unavailable',async()=>{
  const h=harness({compatibility:false});h.api.open('PHONE');h.enqueue(snapshot({canWrite:false,writeAccess:{state:'denied',code:'privacy_indicator_allowlist_denied',requiredAccessKo:'WRITE_DEVICE_CONFIG'}}));await h.api.activate(true);assert.equal(h.element('privacy-camera-status').textContent,'조회만 가능');assert.match(h.element('privacy-compatibility').textContent,/현재 ADB 허용 목록/);assert.doesNotMatch(h.element('privacy-compatibility').textContent,/WRITE_DEVICE_CONFIG|기능:|검증:/);assert.ok(h.buttons.every(button=>button.disabled));assert.equal(h.element('privacy-indicator-feedback').options,null);assert.equal(h.writes().length,0);
});

test('a wrong-device or contradictory success response cannot replace current state or enable changes',async()=>{
  for(const invalid of [snapshot({deviceId:'OTHER'}),snapshot({storageStatus:'stored',stored:{exists:true,value:'unknown'}}),snapshot({storageStatus:'default',stored:{exists:true,value:'true'}})]){
    const h=harness();h.api.open('PHONE');h.enqueue(snapshot());await h.api.activate(true);
    h.enqueue(invalid);await h.api.refresh();
    assert.equal(h.element('privacy-camera-value').textContent,'현재 값 미확인');assert.equal(h.element('privacy-camera-previous').textContent,'이전 조회값: 꺼짐으로 저장됨');assert.equal(h.element('privacy-camera-status').textContent,'조회 실패');assert.ok(h.buttons.every(button=>button.disabled));assert.equal(h.writes().length,0);
    h.enqueue(snapshot());await h.element('privacy-indicator-feedback').options.onAction();assert.ok(h.buttons.every(button=>!button.disabled));
  }
});
