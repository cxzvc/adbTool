import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createAppServer} from '../../../lib/http-app.mjs';

const root=fileURLToPath(new URL('../../..',import.meta.url)),route='/api/device/gps-indicator';
async function fixture(t,deviceControl,extra={}){
  // Deliberately omit adbPath. These HTTP tests cannot attach real phone tools.
  const server=createAppServer({root,deviceControl:{resolve:async()=>({serial:'MOCK_ONLY',device:{manufacturer:'Samsung'}}),...deviceControl},...extra});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await server.cleanupPromise;});
  const base=`http://127.0.0.1:${server.address().port}`,{csrfToken}=await(await fetch(base+'/api/session')).json();
  const headers={Origin:base,'Content-Type':'application/json','X-ADB-Desk-Token':csrfToken};
  return {base,headers,get:(query={},extraHeaders={})=>fetch(base+route+'?'+new URLSearchParams({id:'PHONE',package:'com.example.gps',...query}),{headers:extraHeaders}),post:(body,extraHeaders={})=>fetch(base+route,{method:'POST',headers:{...headers,...extraHeaders},body:typeof body==='string'?body:JSON.stringify(body)})};
}

test('GPS indicator GET selects package and user for read only without dispatching any mutation',async t=>{
  const calls=[],result={canHide:true,canRestore:false,effectVerified:false,granted:true,flags:257,snapshotToken:'a'.repeat(64)};
  const api=await fixture(t,{gpsIndicatorRead:async(...args)=>{calls.push(['read',...args]);return result;},gpsIndicatorMutate:async()=>{calls.push(['write']);return {ok:true};}});
  const response=await api.get({id:'PHONE:1234',package:'com.example.gps',user:'0'});assert.equal(response.status,200);assert.deepEqual(await response.json(),result);assert.deepEqual(calls,[['read','PHONE:1234','com.example.gps','0']]);
  await api.get();assert.deepEqual(calls.at(-1),['read','PHONE','com.example.gps','current']);
});

test('GPS indicator GET rejects foreign origins and cross-site fetches before controller access',async t=>{
  let calls=0;const api=await fixture(t,{gpsIndicatorRead:async()=>{calls++;return {};}});
  for(const headers of [{Origin:'https://example.com'},{'Sec-Fetch-Site':'cross-site'}]){const response=await api.get({},headers);assert.equal(response.status,403);assert.match((await response.json()).error,/[가-힣]/);}assert.equal(calls,0);
});

test('GPS hide and restore POST require same origin and current CSRF token',async t=>{
  let calls=0;const api=await fixture(t,{gpsIndicatorMutate:async()=>{calls++;return {ok:true};}}),body={deviceId:'PHONE',package:'com.example.gps',userId:'0',action:'hide',expected:'a'.repeat(64)};
  for(const headers of [{Origin:''},{Origin:'https://example.com'},{'X-ADB-Desk-Token':''},{'X-ADB-Desk-Token':'wrong'},{'Sec-Fetch-Site':'cross-site'}]){const response=await api.post(body,headers);assert.equal(response.status,403);assert.match((await response.json()).error,/[가-힣]/);}assert.equal(calls,0);
});

test('GPS protected POST dispatches exactly the dedicated action without generic settings or app actions',async t=>{
  const calls=[],result={ok:true,granted:true,flags:1,effectVerified:false,message:'0x100 분류만 변경했습니다. 실제 효과는 미확인입니다.'};
  const api=await fixture(t,{gpsIndicatorRead:async()=>{calls.push('read');return {};},gpsIndicatorMutate:async body=>{calls.push(body);return result;},mutate:async()=>{calls.push('settings');},appAction:async()=>{calls.push('app');},tool:async()=>{calls.push('tool');}});
  for(const action of ['hide','restore']){const body={deviceId:'PHONE',package:'com.example.gps',userId:'0',action,expected:'a'.repeat(64)},response=await api.post(body);assert.equal(response.status,200);assert.deepEqual(await response.json(),result);assert.deepEqual(calls.at(-1),body);}assert.equal(calls.length,2);
});

test('GPS mutation rejects wrong methods, non-JSON, malformed and oversized bodies before controller invocation',async t=>{
  let calls=0;const api=await fixture(t,{gpsIndicatorRead:async()=>{calls++;return {};},gpsIndicatorMutate:async()=>{calls++;return {ok:true};}});
  for(const method of ['PUT','PATCH','DELETE']){const response=await fetch(api.base+route,{method,headers:api.headers,body:'{}'});assert.equal(response.status,405);assert.match((await response.json()).error,/[가-힣]/);}
  for(const [body,headers,status] of [['{}',{'Content-Type':'text/plain'},415],['{broken',{},400],[JSON.stringify({unused:'x'.repeat(5000)}),{},413]]){const response=await api.post(body,headers);assert.equal(response.status,status);assert.match((await response.json()).error,/[가-힣]/);}assert.equal(calls,0);
});

test('GPS missing controller is a Korean unavailable response for both viewing and explicit mutation',async t=>{
  const api=await fixture(t,undefined,{adbError:'ADB를 사용할 수 없습니다.'});for(const response of [await api.get(),await api.post({action:'hide'})]){assert.equal(response.status,503);assert.match((await response.json()).error,/ADB|연결/);}
});

test('GPS errors preserve actionable Korean permission guidance, raw diagnostics and mutation uncertainty',async t=>{
  const readError=Object.assign(new Error('ADB 셸 권한으로 이 앱의 플래그를 읽을 수 없습니다.'),{status:403,code:'gps_permission_denied',requiredAccessKo:'GRANT_RUNTIME_PERMISSIONS 또는 REVOKE_RUNTIME_PERMISSIONS',rawError:'SecurityException: Permission denial'});
  const writeError=Object.assign(new Error('변경 결과를 확인하지 못했습니다. 원본 기록으로 다시 복원하세요.'),{status:502,code:'gps_verify_failed',requiredAccessKo:'현재 앱 조회',rawError:'device offline',mayHaveChanged:true});
  const api=await fixture(t,{gpsIndicatorRead:async()=>{throw readError;},gpsIndicatorMutate:async()=>{throw writeError;}});
  for(const [response,error] of [[await api.get(),readError],[await api.post({action:'hide'}),writeError]]){assert.equal(response.status,error.status);const data=await response.json();assert.equal(data.error,error.message);assert.equal(data.code,error.code);assert.equal(data.requiredAccessKo,error.requiredAccessKo);assert.equal(data.rawError,error.rawError);assert.equal(data.mayHaveChanged,error===writeError);}
});

test('GPS dedicated browser assets are served from explicit routes with their correct MIME type',async t=>{
  const api=await fixture(t,{});for(const [asset,mime] of [['/extensions/samsung/gps-indicator.js',/javascript/],['/extensions/samsung/gps-indicator.css',/text\/css/]]){const response=await fetch(api.base+asset);assert.equal(response.status,200);assert.match(response.headers.get('content-type'),mime);assert.ok((await response.text()).length>50);}
});
