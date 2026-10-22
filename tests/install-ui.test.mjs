import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../public/install-ui.js',import.meta.url),'utf8');
function setup({preview=false,fetchImpl,feedback,deviceOps}={}){
  const elements=new Map();const element=id=>{if(!elements.has(id))elements.set(id,{id,value:'',checked:false,files:[],disabled:false,hidden:false,textContent:'',innerHTML:'',classList:{toggle(){}},setAttribute(){},querySelectorAll(){return[];}});return elements.get(id);};
  for(const id of ['apps-install-mode','apps-streaming','apps-fast-deploy','apps-agent-update'])element(id).value='auto';element('apps-replace').checked=true;
  if(preview)element('apps-install-files').insertAdjacentHTML=()=>{};
  const context={document:{getElementById:element},window:{DeskUI:{formatBytes:value=>`${value} B`},DeskFeedback:feedback,DeviceOps:deviceOps},setInterval(){},URLSearchParams,setTimeout,fetch:fetchImpl||(()=>assert.fail('File selection must not make any network request'))};
  vm.runInNewContext(source,context);return{api:context.window.InstallUI,element};
}
const files=[{name:'base.apk',size:100,lastModified:1},{name:'split.apk',size:30,lastModified:2},{name:'other.apk',size:200,lastModified:3}];
const options={installMode:'auto',replace:true,testOnly:false,allowDowngrade:false,grantPermissions:false,instant:false,abi:'',streaming:'auto',fastDeploy:'auto',agentUpdate:'auto'};

test('mirror drop staging uses the real install queue without any upload or install before review',()=>{
  const {api,element}=setup({preview:true});let installs=0;
  api.bind({getDevice:()=> 'phone',getEpoch:()=>1,run:()=>{installs++;}});
  api.stageFiles(files.slice(0,2));
  assert.match(element('apps-install-files').innerHTML,/base\.apk/);assert.match(element('apps-install-files').innerHTML,/split\.apk/);
  assert.match(element('apps-install-note').textContent,/아직 설치하지 않았습니다/);assert.equal(installs,0);
  assert.throws(()=>api.exportPlan(),/파일 분석/);
});
test('invalid mirror APK staging is rejected atomically without losing a previous reviewed selection',()=>{
  const {api,element}=setup();api.bind({getDevice:()=> 'phone',getEpoch:()=>1,run:()=>assert.fail('must not install')});api.stageFiles([files[0]]);const before=element('apps-install-files').innerHTML;
  assert.throws(()=>api.stageFiles([files[1],{name:'wrong.txt',size:10}]),/APK/);assert.equal(element('apps-install-files').innerHTML,before);
});

test('APK file selection stays local until the explicit install button is pressed',async()=>{
  const {api,element}=setup();let calls=0,payload;
  api.bind({getDevice:()=> 'phone',getEpoch:()=>1,run:async(...args)=>{calls++;payload=args;return true;}});
  element('apps-apk-files').files=files.slice(0,2);element('apps-apk-files').onchange();
  assert.equal(calls,0);assert.match(element('apps-install-files').innerHTML,/base\.apk/);assert.equal(element('apps-install-run').disabled,false);
  await element('apps-install-run').onclick();assert.equal(calls,1);assert.equal(payload[0].length,2);assert.equal(payload[1].installMode,'auto');assert.equal(payload[2].device,'phone');assert.equal(element('apps-install-run').disabled,true);
});

test('device epoch change clears pending APKs and chosen partial package before installation',async()=>{
  const {api,element}=setup();let epoch=1,calls=0;api.bind({getDevice:()=> 'phone',getEpoch:()=>epoch,run:async()=>{calls++;return true;}});
  element('apps-apk-files').files=[files[0]];element('apps-apk-files').onchange();epoch++;api.sync();await element('apps-install-run').onclick();
  assert.equal(calls,0);assert.equal(element('apps-install-count').textContent,'0개 APK 선택');assert.equal(element('apps-partial-package').value,'');
});

test('APK groups preserve indices and reject missing, duplicated or invalid assignments before upload',()=>{
  const {api}=setup();const planned=api.plan(files,{...options,installMode:'atomic'},[[0,1],[2]]);
  assert.equal(JSON.stringify(planned.groupIndices),'[[0,1],[2]]');
  for(const groups of [[[0],[2]],[[0,1],[1]],[[0,1],[3]],[[0,1],[]]])assert.throws(()=>api.plan(files,{...options,installMode:'atomic'},groups));
  assert.throws(()=>api.plan(files,{...options,installMode:'atomic',streaming:'on'},[[0,1],[2]]),/자동/);
  assert.throws(()=>api.plan(files, {...options,fastDeploy:'on'}, []),/빠른 설치/);
  assert.throws(()=>api.plan(files, {...options,partialPackage:'com.example',replace:false}, []),/분할 APK 추가/);
  assert.throws(()=>api.plan(files, {...options,abi:'invalid'}, []),/프로세서/);
  assert.throws(()=>api.plan(files, {...options,streaming:'invalid'}, []),/전송/);
});

test('multi-app UI grouping does not submit commands when modes or groups change',()=>{
  const {api,element}=setup();let calls=0;api.bind({getDevice:()=> 'phone',getEpoch:()=>1,run:()=>{calls++;}});
  element('apps-apk-files').files=files;element('apps-apk-files').onchange();element('apps-install-mode').value='batch';element('apps-install-mode').onchange();
  assert.equal(calls,0);assert.match(element('apps-install-files').innerHTML,/data-install-group="2"/);assert.equal(element('apps-group-tools').hidden,false);
});
test('container analysis only uploads to the PC and requires a second explicit install with staged IDs',async()=>{
  const requests=[];let installs=0,submitted;
  const analyzed={files:[{uploadId:'staged-base',name:'base.apk',size:100,inspection:'verified',signatureStatus:'verified',metadata:{package:'com.test.app',versionCode:'1',abis:[],densities:[],locales:[]}}],groups:[{package:'com.test.app',uploadIds:['staged-base']}],warnings:[],notice:'PC 분석 완료'};
  const {api,element}=setup({preview:true,fetchImpl:async(url,init)=>{requests.push({url,init});return{ok:true,json:async()=>url==='/api/session'?{csrfToken:'test-token'}:url.startsWith('/api/ops/upload')?{uploadId:'archive-id'}:analyzed};}});
  api.bind({getDevice:()=> 'phone',getEpoch:()=>1,run:async(files,request)=>{installs++;submitted=request;return true;}});element('apps-apk-files').files=[{name:'app.apks',size:200,lastModified:1}];element('apps-apk-files').onchange();assert.equal(requests.length,0);await element('apps-install-run').onclick();assert.equal(installs,0);assert.equal(requests.length,3);assert.ok(requests.every(item=>!item.url.includes('device')));assert.match(element('apps-install-files').innerHTML,/com.test.app/);await element('apps-install-run').onclick();assert.equal(installs,1);assert.equal(JSON.stringify(submitted.stagedUploadIds),'["staged-base"]');
});
test('a failed APK signature cannot be submitted even when the missing-tool acknowledgement is selected',async()=>{
  const analyzed={files:[{uploadId:'bad',name:'bad.apk',size:100,inspection:'verified',signatureStatus:'invalid',metadata:{package:'com.test.app',versionCode:'1'}}],groups:[{package:'com.test.app',uploadIds:['bad']}],warnings:[],notice:'실패'};
  const {api,element}=setup({preview:true,fetchImpl:async url=>({ok:true,json:async()=>url==='/api/session'?{csrfToken:'token'}:url.startsWith('/api/ops/upload')?{uploadId:'u'}:analyzed})});let installs=0;api.bind({getDevice:()=> 'phone',getEpoch:()=>1,run:async()=>{installs++;}});element('apps-apk-files').files=[files[0]];element('apps-apk-files').onchange();await element('apps-apk-preview').onclick();element('apps-install-unverified').checked=true;await element('apps-install-run').onclick();assert.equal(installs,0);assert.match(element('apps-install-note').textContent,/검증에 실패/);
});
test('installed app comparison is a separate explicit action and never submits installation',async()=>{
  const requests=[],analyzed={files:[{uploadId:'u',name:'base.apk',size:100,inspection:'verified',signatureStatus:'verified',metadata:{package:'com.test.app',versionCode:'43'}}],groups:[{package:'com.test.app',uploadIds:['u']}],warnings:[],notice:'분석'};
  const {api,element}=setup({preview:true,fetchImpl:async(url,options)=>{requests.push({url,options});return{ok:true,json:async()=>url==='/api/session'?{csrfToken:'token'}:url.startsWith('/api/ops/upload')?{uploadId:'u'}:url==='/api/ops/apk-preview'?analyzed:url==='/api/ops/apk-compare'?{id:'comparison'}:{state:'success',message:'비교 완료',comparisons:[{package:'com.test.app',version:'upgrade',signature:'same',deviceSdk:35,sdkSupported:true,uploaded:{versionCode:'43',minSdk:'26'},installed:{versionCode:'42',minSdk:'26'},permissionsKnown:true,addedPermissions:[],removedPermissions:[],notes:[]}],failures:[]}};}});let installs=0;api.bind({getDevice:()=> 'phone',getEpoch:()=>1,run:()=>{installs++;}});element('apps-apk-files').files=[files[0]];element('apps-apk-files').onchange();await element('apps-apk-preview').onclick();assert.equal(requests.some(item=>item.url==='/api/ops/apk-compare'),false);await element('apps-apk-compare').onclick();const request=JSON.parse(requests.find(item=>item.url==='/api/ops/apk-compare').options.body);assert.equal(request.deviceId,'phone');assert.equal(request.uploadIds[0],'u');assert.equal(installs,0);assert.match(element('apps-apk-comparison').innerHTML,/업데이트/);
});
test('changing device during the comparison session lookup prevents an old-phone read job',async()=>{let epoch=1,block=false,release;const gate=new Promise(resolve=>release=resolve),requests=[],analyzed={files:[{uploadId:'u',name:'base.apk',size:100,inspection:'verified',signatureStatus:'verified',metadata:{package:'com.test',versionCode:'1'}}],groups:[{package:'com.test',uploadIds:['u']}],warnings:[],notice:'분석'};const {api,element}=setup({preview:true,fetchImpl:async url=>{requests.push(url);if(url==='/api/session'&&block)return gate;return{ok:true,json:async()=>url==='/api/session'?{csrfToken:'token'}:url.startsWith('/api/ops/upload')?{uploadId:'u'}:analyzed};}});api.bind({getDevice:()=> 'phone',getEpoch:()=>epoch,run:()=>assert.fail('no install')});element('apps-apk-files').files=[files[0]];element('apps-apk-files').onchange();await element('apps-apk-preview').onclick();block=true;const pending=element('apps-apk-compare').onclick();epoch++;api.sync();release({ok:true,json:async()=>({csrfToken:'token'})});await pending;assert.equal(requests.includes('/api/ops/apk-compare'),false);});

test('device switch releases install controls and an old completion cannot unlock a newer operation',async()=>{const {api,element}=setup();let epoch=1;const pending=[];api.bind({getDevice:()=> 'phone',getEpoch:()=>epoch,run:()=>new Promise(resolve=>pending.push(resolve))});element('apps-apk-files').files=[files[0]];element('apps-apk-files').onchange();const old=element('apps-install-run').onclick();assert.equal(pending.length,1);epoch++;api.sync();element('apps-apk-files').files=[files[2]];element('apps-apk-files').onchange();assert.equal(element('apps-install-run').disabled,false);const newer=element('apps-install-run').onclick();assert.equal(pending.length,2);pending[0](true);await old;assert.equal(element('apps-install-run').disabled,true);assert.match(element('apps-install-files').innerHTML,/other.apk/);pending[1](true);await newer;assert.equal(element('apps-install-count').textContent,'0개 APK 선택');});

test('clearing every analyzed APK checkbox disables install and compare without sending a request',async()=>{const calls=[],analyzed={files:[{uploadId:'u',name:'base.apk',size:100,inspection:'verified',signatureStatus:'verified',metadata:{package:'com.test',versionCode:'1'}}],groups:[{package:'com.test',uploadIds:['u']}],warnings:[],notice:'분석'};const {api,element}=setup({preview:true,fetchImpl:async url=>{calls.push(url);return{ok:true,json:async()=>url==='/api/session'?{csrfToken:'token'}:url.startsWith('/api/ops/upload')?{uploadId:'u'}:analyzed};}});api.bind({getDevice:()=> 'phone',getEpoch:()=>1,run:()=>assert.fail('selection must not install')});element('apps-apk-files').files=[files[0]];element('apps-apk-files').onchange();await element('apps-apk-preview').onclick();const before=calls.length;const check={dataset:{installCheck:'0'},checked:false};element('apps-install-files').onchange({target:{closest:selector=>selector==='[data-install-check]'?check:null}});assert.equal(element('apps-install-run').disabled,true);assert.equal(element('apps-apk-compare').disabled,true);assert.equal(element('apps-install-count').textContent,'0개 APK 선택');assert.equal(calls.length,before);});

test('APK analysis feedback starts on the clicked button and retry only repeats PC analysis',async()=>{const starts=[],cards=[];let finished=0,failed=true;const calls=[],feedback={start:(label,options)=>{starts.push({label,...options});return()=>finished++;},state:(host,value)=>cards.push({host,...value})},analyzed={files:[{uploadId:'u',name:'base.apk',size:100,inspection:'verified',signatureStatus:'verified',metadata:{package:'com.test',versionCode:'1'}}],groups:[{package:'com.test',uploadIds:['u']}],warnings:[],notice:'분석'};const {api,element}=setup({preview:true,feedback,fetchImpl:async url=>{calls.push(url);if(url==='/api/ops/apk-preview'&&failed){failed=false;return{ok:false,json:async()=>({error:'분석 일시 실패'})};}return{ok:true,json:async()=>url==='/api/session'?{csrfToken:'token'}:url.startsWith('/api/ops/upload')?{uploadId:'u'}:analyzed};}});api.bind({getDevice:()=> 'phone',getEpoch:()=>1,run:()=>assert.fail('analysis must not install')});element('apps-apk-files').files=[files[0]];element('apps-apk-files').onchange();const pending=element('apps-apk-preview').onclick();assert.equal(starts[0].button.id,'apps-apk-preview');assert.equal(element('apps-apk-preview').textContent,'파일 분석 중…');await pending;assert.equal(cards.at(-1).type,'error');assert.equal(cards.at(-1).actionLabel,'분석 다시 시도');await cards.at(-1).onAction();assert.equal(calls.filter(url=>url==='/api/ops/apk-preview').length,2);assert.equal(finished,2);assert.equal(element('apps-apk-preview').textContent,'PC에서 파일 분석');});
test('failed install feedback checks job status instead of resubmitting installation',async()=>{const cards=[],starts=[];let runs=0,checks=0,finished=0;const {api,element}=setup({feedback:{start:(label,options)=>{starts.push(options);return()=>finished++;},state:(host,value)=>cards.push(value)},deviceOps:{refreshJobs:async()=>{checks++;}}});api.bind({getDevice:()=> 'phone',getEpoch:()=>1,run:async()=>{runs++;throw new Error('response lost');}});element('apps-apk-files').files=[files[0]];element('apps-apk-files').onchange();await element('apps-install-run').onclick();assert.equal(starts[0].button.id,'apps-install-run');assert.equal(cards.at(-1).actionLabel,'작업 상태 확인');await cards.at(-1).onAction();assert.equal(runs,1);assert.equal(checks,1);assert.equal(finished,1);});

for(const [result,type]of [[{state:'error',message:'APK 읽기 거부',comparisons:[],failures:[{package:'com.test',error:'Permission Denial'}]},'error'],[{state:'success',message:'조회 완료',comparisons:[],failures:[]},'empty']])test(`completed APK comparison ${type} result offers a read-only retry without installation`,async()=>{const cards=[],calls=[],analyzed={files:[{uploadId:'u',name:'base.apk',size:100,inspection:'verified',signatureStatus:'verified',metadata:{package:'com.test',versionCode:'1'}}],groups:[{package:'com.test',uploadIds:['u']}],warnings:[],notice:'분석'};const {api,element}=setup({preview:true,feedback:{state:(host,card)=>cards.push(card)},fetchImpl:async url=>{calls.push(url);return{ok:true,json:async()=>url==='/api/session'?{csrfToken:'token'}:url.startsWith('/api/ops/upload')?{uploadId:'u'}:url==='/api/ops/apk-preview'?analyzed:url==='/api/ops/apk-compare'?{id:'read-job'}:result};}});api.bind({getDevice:()=> 'phone',getEpoch:()=>1,run:()=>assert.fail('must not install')});element('apps-apk-files').files=[files[0]];element('apps-apk-files').onchange();await element('apps-apk-preview').onclick();await element('apps-apk-compare').onclick();assert.equal(cards.at(-1).type,type);assert.equal(calls.filter(url=>url==='/api/ops/apk-compare').length,1);await cards.at(-1).onAction();assert.equal(calls.filter(url=>url==='/api/ops/apk-compare').length,2);assert.equal(element('apps-apk-compare').disabled,false);});
