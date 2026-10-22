import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCachedAppSizeFile,parseCachedAppSizes} from '../lib/app-inventory-data.mjs';
import {createInventory} from '../lib/inventory.mjs';
import {createAppInsights,getCachedAppStorage} from '../lib/app-insights.mjs';

const now=Date.UTC(2026,9,19),time=now-3600000;
const cached={queryTime:time,packageNames:['com.test.storage'],appSizes:[100],appDataSizes:[50],cacheSizes:[20]};
test('existing cache file is historical user-0 data with its own timestamp, never APK-only or a current version claim',()=>{
  const row=parseCachedAppSizeFile(JSON.stringify(cached),'0',now).get('com.test.storage');
  assert.equal(row.storageBytes,150);assert.equal(row.apkBytes,null);assert.equal(row.sizeCached,true);
  assert.equal(row.sizeCacheUpdatedAt,new Date(time).toISOString());assert.equal(row.sizeCheckedAt,undefined);
  assert.match(row.sizeSource,/현재 앱 버전.*확인하지 못함/);assert.equal(row.versionCode,undefined);
  assert.equal(parseCachedAppSizeFile(JSON.stringify(cached),'10',now).size,0);
});
test('incomplete, ambiguous, unsafe or future cache files stay unknown instead of producing zero-byte or mixed sizes',()=>{
  for(const value of [
    '{"queryTime":', 'Permission denied', JSON.stringify({...cached,queryTime:null}),
    JSON.stringify({...cached,queryTime:now+120000}),JSON.stringify({...cached,cacheSizes:[]}),
    JSON.stringify({...cached,appSizes:[-1]}),JSON.stringify({...cached,appSizes:[Number.MAX_SAFE_INTEGER],appDataSizes:[1]}),
    JSON.stringify({...cached,packageNames:['com.test.storage','com.test.storage'],appSizes:[1,2],appDataSizes:[1,2],cacheSizes:[0,0]})
  ])assert.equal(parseCachedAppSizeFile(value,'0',now).size,0);
  const zero=parseCachedAppSizeFile(JSON.stringify({...cached,appSizes:[0],appDataSizes:[0],cacheSizes:[0]}),'0',now).get('com.test.storage');
  assert.equal(zero.storageBytes,0);
  assert.equal(parseCachedAppSizes('Package Names: ["com.test.storage"]\nApp Sizes: [9007199254740991]\nApp Data Sizes: [1]\nCache Sizes: [0]','0').size,0);
});
function inventoryFixture(deviceId,{denied=false}={}){
  const calls=[];
  const inventory=createInventory({resolve:async()=>({serial:'mock'}),command:async(_serial,args)=>{
    calls.push(args);const line=args.join(' ');
    if(line==='shell pm list users')return 'Users:\n UserInfo{0:owner:13} running';
    if(line==='shell am get-current-user')return '0';
    if(line==='shell cat /data/system/diskstats_cache.json'){if(denied)throw Error('Permission denied');return JSON.stringify({...cached,queryTime:Date.now()-3600000});}
    if(line==='shell dumpsys package packages')return 'Packages:\n  Package [com.test.storage] (abc):\n    versionCode=42\n    User 0: installed=true';
    if(line.includes('query-activities'))return 'No activities found';
    if(line.includes('pm list packages'))return args.includes('-d')?'':args.includes('--show-versioncode')?'package:com.test.storage versionCode:42':'package:com.test.storage';
    assert.fail('Unexpected command: '+line);
  }});
  return{calls,read:()=>inventory.apps(deviceId,{user:'0'})};
}
test('inventory reads only the existing cache file, and denied cache access has Korean guidance with unknown byte fields',async()=>{
  const f=inventoryFixture('readonly-cache-denied',{denied:true}),result=await f.read(),row=result.apps[0];
  assert.equal(row.storageBytes,null);assert.equal(row.dataBytes,null);assert.equal(row.cacheBytes,null);
  assert.match(result.errors.join(' '),/기존 용량 통계 파일.*시스템 전용/);assert.doesNotMatch(result.errors.join(' '),/Permission denied/);
  assert.ok(f.calls.some(args=>args.join(' ')==='shell cat /data/system/diskstats_cache.json'));
  assert.equal(f.calls.some(args=>args.includes('diskstats')||args.includes('appops')||args.includes('grant')||args.includes('run-as')),false);
});
test('APK-only and unavailable records replace historical whole-app cache fields without mixing results',async()=>{
  const id='readonly-cache-tombstone',core={resolve:async()=>({serial:'mock'}),shell:async(_serial,line)=>line.startsWith('pm list')?'package:com.test.storage versionCode:42':'code: 1000 bytes\ndata: 500 bytes\ncache: 20 bytes'};
  await createAppInsights(core).storage({deviceId:id,userId:'0',packages:['com.test.storage']});
  const records=getCachedAppStorage(id,'0').records;
  records.set('com.test.storage',{package:'com.test.storage',versionCode:'42',storageStatus:'apk-only',apkBytes:70,appBytes:null,dataBytes:null,cacheBytes:null,storageBytes:null,sizeCached:false,sizeIssue:{reasonKo:'사용 정보 접근 제한'}});
  let result=await inventoryFixture(id).read(),row=result.apps[0];assert.equal(row.apkBytes,70);assert.equal(row.storageBytes,null);assert.equal(row.dataBytes,null);assert.equal(row.sizeCached,false);
  records.set('com.test.storage',{package:'com.test.storage',versionCode:'42',storageStatus:'unavailable',apkBytes:null,appBytes:null,dataBytes:null,cacheBytes:null,storageBytes:null,sizeCached:false,sizeIssue:{reasonKo:'읽기 권한 없음'}});
  result=await inventoryFixture(id).read();row=result.apps[0];assert.equal(row.storageStatus,'unavailable');assert.equal(row.storageBytes,null);assert.equal(row.apkBytes,null);
  records.get('com.test.storage').versionCode=null;
  result=await inventoryFixture(id).read();row=result.apps[0];assert.equal(row.storageBytes,null);assert.equal(row.versionCode,'42');
});
