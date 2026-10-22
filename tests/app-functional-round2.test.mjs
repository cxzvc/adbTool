import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {describeAppKnowledge,lookupAppKnowledge} from '../lib/app-knowledge.mjs';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const reference=JSON.parse(read('data/uad-package-reference.json'));
const supplement=JSON.parse(read('data/app-functional-supplement.json'));

test('public explanations separate community and independent sources without a personal installed-app report',()=>{
  const names=new Set([...Object.entries(reference.packages).filter(([,item])=>item.functionReview).map(([pkg])=>pkg),...Object.keys(supplement.packages)]);
  assert.ok(names.size>0);assert.ok(Object.values(reference.packages).some(item=>item.functionReview));assert.ok(Object.keys(supplement.packages).length>0);
  for(const key of ['installedScope','deviceId','hardwareSerial']){assert.equal(Object.hasOwn(reference,key),false);assert.equal(Object.hasOwn(supplement,key),false);}
  for(const [pkg,row]of Object.entries(supplement.packages)){assert.equal(row.functionStatus,'source-confirmed');assert.ok(row.titleKo.trim().length>0);for(const field of ['functionKo','removalImpactKo','alternativeKo'])assert.match(row[field],/[가-힣]/);assert.ok(row.sources.length>0,pkg);for(const source of row.sources)assert.equal(new URL(source).protocol,'https:');assert.equal(row.firmwareVerified,false);assert.equal(row.impactStatus,'reasoned-not-device-tested');}
});
test('apps outside UAD receive official functional explanations without fabricated removal grades or GPL provenance',async()=>{
  const toss=await lookupAppKnowledge('viva.republica.toss');assert.equal(toss.found,true);assert.equal(toss.communityReferenceFound,false);assert.equal(toss.translationStatus,'source-reviewed');assert.equal(toss.removal,null);assert.equal(toss.source.kind,'official-functional');assert.equal(toss.source.licenseUrl,undefined);assert.match(toss.functionKo,/송금/);assert.match(toss.alternativeKo,/인증/);assert.equal(toss.functionReview.firmwareVerified,false);assert.match(toss.notes.join(' '),/비활성화.*데이터 삭제/);
  const saved=toss.functionReview.officialFunctionUrls[0];toss.functionReview.officialFunctionUrls[0]='https://evil.example/';assert.equal((await lookupAppKnowledge('viva.republica.toss')).functionReview.officialFunctionUrls[0],saved);
});
test('confusing package identifiers are grounded in application identity and source, rather than identifier translations',async()=>{
  const battery=await lookupAppKnowledge('com.samsung.android.statsd'),delivery=await lookupAppKnowledge('com.sampleapp'),access=await lookupAppKnowledge('bluen.homein');
  assert.equal(battery.title,'Battery Guardian');assert.match(battery.functionKo,/절전/);assert.match(battery.alternativeKo,/일반 statsd.*단정|일반 statsd.*설명하지/);
  assert.equal(delivery.title,'배달의민족');assert.match(delivery.functionKo,/주문/);assert.match(access.functionKo,/공동현관/);assert.match(access.alternativeKo,/실물 출입 카드/);
  assert.equal(supplement.packages['com.samsung.android.statsd'].packageIdentityEvidence.label,'Battery Guardian');
});
test('platform corrections distinguish remote key provisioning and MTP host from the inaccurate community shorthand',async()=>{
  const rkp=await lookupAppKnowledge('com.google.android.rkpdapp'),mtp=await lookupAppKnowledge('com.android.mtp');assert.match(rkp.functionKo,/기기 증명/);assert.match(rkp.notes.join(' '),/정정/);assert.match(rkp.functionReview.sourceUrl,/source.android.com/);assert.match(mtp.functionKo,/USB 호스트/);assert.match(mtp.alternativeKo,/모든 USB 파일 전송/);assert.equal(rkp.removal.communityOnly,true);
});
test('unpublished internal apps stay unconfirmed even when an APK label is known separately',async()=>{
  for(const pkg of ['org.example.privateapp','org.example.privateapp.test','org.example.privateapp.manager']){const item=await lookupAppKnowledge(pkg);assert.equal(item.found,false);assert.match(item.summaryKo,/미확인/);assert.equal(item.functionReview,undefined);}
});
test('inventory searches include consequences and alternatives and can filter either source family or all structured explanations',()=>{
  const context={window:{},document:{getElementById:()=>null}};vm.runInNewContext(read('public/app-inventory.js'),context);const api=context.window.AppInventory;
  const official={package:'app.official',kind:'user',knowledge:{translationStatus:'source-reviewed',functionalExplanationStatus:'reviewed-source',alternative:'복구 코드 준비'}},community={package:'app.community',kind:'system',knowledge:{translationStatus:'community-summary',functionalExplanationStatus:'reviewed-community',removalImpact:'인쇄 대기열 중단'}},unknown={package:'app.unknown',knowledge:{translationStatus:'unavailable'}};
  assert.equal(api.matches(official,{query:'복구 코드'}),true);assert.equal(api.matches(community,{query:'인쇄'}),true);assert.equal(api.matches(official,{translation:'any-reviewed'}),true);assert.equal(api.matches(community,{translation:'any-reviewed'}),true);assert.equal(api.matches(unknown,{translation:'any-reviewed'}),false);assert.equal(api.matches(community,{translation:'source-reviewed'}),false);
});

class Node{constructor(tag){this.tag=tag;this.children=[];this.textContent='';this.attributes={};}append(...values){this.children.push(...values);}replaceChildren(...values){this.children=values;this.textContent='';}setAttribute(key,value){this.attributes[key]=value;}removeAttribute(key){delete this.attributes[key];}flatten(){return this.textContent+this.children.map(child=>child.flatten?.()||'').join('\n');}}
test('official-only app panels show all Korean sections and source links without a fictitious community original or license',async()=>{
  const root=new Node('div'),requests=[];const item=await lookupAppKnowledge('viva.republica.toss');const context={window:{},document:{getElementById:id=>id==='app-knowledge'?root:null,createElement:tag=>new Node(tag)},AbortController,fetch:async(url,options)=>{requests.push({url,options});return{ok:true,json:async()=>item};}};
  vm.runInNewContext(read('public/app-knowledge.js'),context);await context.window.AppKnowledge.show(item.package);const text=root.flatten();for(const label of ['실제 기능','삭제·비활성화 영향','대체·사용 조건','공식 기능 자료'])assert.ok(text.includes(label),label);assert.ok(!text.includes('GPL-3.0'));assert.ok(!text.includes('커뮤니티 원문 ·'));assert.equal(requests.length,1);assert.equal(requests[0].options.method,undefined);assert.match(requests[0].url,/^\/api\/ops\/app-knowledge\?/);
});
