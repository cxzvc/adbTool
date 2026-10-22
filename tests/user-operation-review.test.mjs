import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {userOperationReview} from '../lib/user-operation-review.mjs';
import {createAppServer} from '../lib/http-app.mjs';
import {ActionError} from '../lib/connections.mjs';
const reviewedId='TEST_DEVICE_001';
async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'adb-evidence-test-')),localRoot=path.join(root,'.local');
 await mkdir(path.join(localRoot,'private-evidence'),{recursive:true});
 const data={live:false,deviceId:reviewedId,sourceLabelKo:'모의 보관 자료 · 현재 조회 결과가 아닙니다.',snapshotAt:'2026-01-01T00:00:00Z',firmware:{fingerprint:'example/device/device:1/TEST/BUILD:user/test-keys'},operations:{'profile-create':{verdict:'conditional',summaryKo:'생성 효과는 미시험입니다.'},'user-start':{verdict:'conditional',targets:[{userId:'0',verdict:'already-running'}]}}};
 const file=path.join(localRoot,'private-evidence','user-operation-review.json');await writeFile(file,JSON.stringify(data));
 t.after(async()=>{assert.ok(root.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(root).startsWith('adb-evidence-test-'));await rm(root,{recursive:true,force:true});});
 return {root,localRoot,file,data};
}

test('personal operation evidence is scoped to the requested device and cloned',async t=>{
 const f=await fixture(t),review=userOperationReview(reviewedId,{localRoot:f.localRoot});
 assert.equal(review.deviceId,reviewedId);assert.equal(review.live,false);
 for(const id of ['',null,'OTHER_DEVICE'])assert.equal(userOperationReview(id,{localRoot:f.localRoot}),null);
 review.live=true;review.operations['profile-create'].verdict='supported';
 assert.equal(userOperationReview(reviewedId,{localRoot:f.localRoot}).live,false);assert.equal(userOperationReview(reviewedId,{localRoot:f.localRoot}).operations['profile-create'].verdict,'conditional');
});
test('private evidence is optional and another project does not inherit it',async t=>{
 const f=await fixture(t);assert.equal(userOperationReview(reviewedId,{localRoot:path.join(f.root,'missing')}),null);
 assert.equal(userOperationReview(reviewedId,{root:path.join(f.root,'other-project')}),null);
});
test('invalid, current-looking and malformed evidence cannot be presented as historical proof',async t=>{
 const f=await fixture(t);
 for(const data of [{...f.data,live:true},{...f.data,firmware:{}},{...f.data,operations:{}},'invalid']){await writeFile(f.file,typeof data==='string'?data:JSON.stringify(data));assert.equal(userOperationReview(reviewedId,{localRoot:f.localRoot}),null);}
});
test('offline user help returns only the selected project historical evidence without changing a device',async t=>{
 const f=await fixture(t);let reads=0;
 const server=createAppServer({root:f.root,deviceControl:{userProfileHelpRead:async id=>{reads++;assert.equal(id,reviewedId);throw new ActionError('기기가 연결되어 있지 않습니다.',409);},mutate:async()=>assert.fail('No setting changes'),tool:async()=>assert.fail('No phone operation')}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await server.cleanupPromise;});
 const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/device/user-profile-help?id='+reviewedId),data=await response.json();
 assert.equal(response.status,409);assert.equal(reads,1);assert.match(data.error,/연결/);assert.equal(data.operationReview.live,false);assert.equal(data.operationReview.operations['profile-create'].verdict,'conditional');assert.equal(data.users,undefined);
});
