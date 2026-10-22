import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,readdirSync} from 'node:fs';

const directory=new URL('../extensions/samsung/data/',import.meta.url);
const optional={skip:!existsSync(directory)};
const read=name=>JSON.parse(readFileSync(new URL(name,directory),'utf8'));
const filenames=['compatibility-profiles.json','device-code-help.json','deviceconfig-write-review.json','oneui9-setting-effects.json','oneui9-setting-review.json','oneui9-setting-review-round2.json','reference-setting-keys.json'];

test('public Samsung evidence excludes private snapshots and verbatim extracted code',optional,()=>{
  assert.deepEqual(readdirSync(directory).filter(name=>name.endsWith('.json')).sort(),[...filenames].sort());
  const banned=new Set(['excerpt','sourceBase','sourceRoot','raw','stdout','stderr','output','snapshotPath','snapshotSha256','deviceId','hardwareSerial','serialNumber','serial_number','liveKeys']);
  function inspect(value){
    if(Array.isArray(value)){value.forEach(inspect);return;}
    if(value&&typeof value==='object'){for(const [key,child]of Object.entries(value)){assert.ok(!banned.has(key),'private field '+key);inspect(child);}return;}
    if(typeof value==='string'){
      assert.doesNotMatch(value,/(?<![A-Za-z0-9])[A-Za-z]:[\\/]/,'PC absolute path');
      assert.doesNotMatch(value,/\b192\.168\.\d{1,3}\.\d{1,3}\b/,'private network address');
      assert.doesNotMatch(value,/\.local[\\/]|[\\/]Users[\\/]/,'private data path');
    }
  }
  filenames.forEach(name=>inspect(read(name)));
  assert.equal(existsSync(new URL('user-operation-review.json',directory)),false);
});

test('public reference keys are backed by code metadata rather than an installed-phone inventory',optional,()=>{
  const review=read('oneui9-setting-review.json'),code=read('device-code-help.json'),effects=read('oneui9-setting-effects.json');
  const ids=new Set([...Object.keys(code.entries),...Object.keys(code.notes||{}),...Object.keys(effects.entries),...Object.entries(review.entries).filter(([,row])=>row.evidence?.length).map(([id])=>id)]);
  const keys=read('reference-setting-keys.json');assert.ok(keys.length>0);
  for(const row of keys)assert.ok(ids.has(row.namespace+':'+row.key),'unverified private inventory key');
  for(const [id,row]of Object.entries(review.entries))assert.ok(row.evidence?.length||code.entries[id]||code.notes?.[id]||effects.entries[id],'unverified source '+id);
});

test('sanitization preserves policy flags, hashes, source locations and functional explanations',optional,()=>{
  const review=read('oneui9-setting-review.json'),effects=read('oneui9-setting-effects.json'),policy=read('deviceconfig-write-review.json');
  assert.equal(review.profile.fingerprint,effects.profile.fingerprint);assert.equal(review.profile.fingerprint,policy.fingerprint);
  assert.ok(review.profile.model&&review.profile.build&&review.profile.sdk);
  for(const artifact of policy.artifacts){assert.match(artifact.sha256,/^[a-f0-9]{64}$/);assert.match(artifact.path,/^\/(system|apex)\//);}
  assert.equal(policy.keyAllowlisted['privacy/camera_mic_icons_enabled'],false);
  assert.equal(typeof policy.namespaceAllowlisted.privacy,'boolean');
  for(const [id,row]of Object.entries(effects.entries)){
    assert.ok(review.entries[id],'missing reviewed control '+id);assert.equal(typeof row.writeBlocked,'boolean');assert.equal(row.effectTested,false);assert.match(row.reason,/[가-힣]/);
    assert.ok(row.evidence.length);for(const evidence of row.evidence){assert.ok(evidence.file&&evidence.line>0&&evidence.note);}
  }
  assert.ok(effects.officialReferences.some(row=>/^https:\/\//.test(row.url||'')),'official links must not be mistaken for PC paths');
});
