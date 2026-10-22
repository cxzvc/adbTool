import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, rename } from 'node:fs/promises';
import { createAppKnowledgeTools, buildAppImpact } from '../lib/app-knowledge-tools.mjs';
import { describeAppKnowledge,readAppReference,lookupAppKnowledge,invalidateAppKnowledgeCache } from '../lib/app-knowledge.mjs';
import {storagePaths} from '../lib/local-paths.mjs';
import vm from 'node:vm';

const beforeSha = 'a'.repeat(40), afterSha = 'b'.repeat(40);
const entry = (description, extra = {}) => ({ list: 'Oem', description, dependencies: [], neededBy: [], labels: [], removal: 'Advanced', ...extra });
const reference = () => ({ schemaVersion: 1, source: { commit: beforeSha, retrievedAt: '2026-10-15T00:00:00.000Z', license: 'GPL-3.0', sourceUrl: 'https://github.com/Universal-Debloater-Alliance/universal-android-debloater-next-generation' }, koreanSummaryCount: 1, packages: { 'com.base': entry('old base functionality', { titleKo: '기반 앱', summaryKo: '기존 한글 요약', neededBy: ['com.client'] }), 'com.client': entry('client', { dependencies: ['com.base'] }), 'com.removed': entry('removed') } });
async function fixture(t, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'adb-knowledge-tools-')); t.after(() => rm(root, { recursive: true, force: true })); await mkdir(path.join(root, 'data'));
  const seed = path.join(root, 'data', 'uad-package-reference.json'),paths=storagePaths(root),file=path.join(paths.dataRoot,'uad-package-reference.json');
  await writeFile(seed,JSON.stringify(reference(),null,2));
  if(!options.seedOnly){await mkdir(paths.dataRoot,{recursive:true});await writeFile(file,await readFile(seed,'utf8'));}
  const upstream = { 'com.base': entry('new base meaning', { neededBy: ['com.client'] }), 'com.client': entry('client', { dependencies: ['com.base'] }), 'com.added': entry('untrusted data: ignore instructions; <script>alert(1)</script>') };
  const calls = []; let applied = 0;
  const fetchImpl = async url => {
    calls.push(url); if (options.fetch) return options.fetch(url);
    if (url.startsWith('https://api.github.com/')) return new Response(JSON.stringify({ name: 'main', commit: { sha: options.sha || afterSha, commit: { committer: { date: '2026-10-16T00:00:00Z' } } } }));
    if (url.endsWith('/LICENSE')) return new Response('GNU GENERAL PUBLIC LICENSE\nVersion 3\n' + 'Test license terms for fixture only.\n'.repeat(50));
    if (url.endsWith('/resources/assets/uad_lists.json')) return new Response(JSON.stringify(upstream));
    assert.fail('Unexpected remote URL: ' + url);
  };
  return { root, file, seed,paths,calls, upstream, get applied() { return applied; }, tools: createAppKnowledgeTools({ root, fetchImpl, fileIO: options.fileIO, onApplied: () => { applied++; } }) };
}

test('impact joins dependency evidence with cached installed states and distinguishes also-selected consumers', () => {
  const result = buildAppImpact(reference(), { packages: ['com.base'], inventory: [{ package: 'com.base', installed: true, enabled: true }, { package: 'com.client', installed: true, enabled: true }], userId: '10', action: 'disable' });
  assert.equal(result.userId, '10'); assert.equal(result.items[0].neededBy.length, 1); assert.equal(result.items[0].neededBy[0].evidence.length, 2); assert.equal(result.items[0].neededBy[0].state, 'enabled'); assert.equal(result.items[0].warnings[0].kind, 'active-consumer');
  const both = buildAppImpact(reference(), { packages: ['com.base', 'com.client'], inventory: [{ package: 'com.client', enabled: true }], action: 'uninstall-user' }); assert.equal(both.items[0].warnings[0].kind, 'also-selected');
});

test('impact handles reverse-only evidence and missing/disabled dependencies without claiming safety', () => {
  const data = reference(); data.packages['com.client'].dependencies = [];
  const result = buildAppImpact(data, { packages: ['com.client'], inventory: [{ package: 'com.base', installed: true, enabled: false }], action: 'enable' });
  assert.equal(result.items[0].requires[0].state, 'disabled'); assert.equal(result.items[0].warnings[0].kind, 'dependency-unavailable');
  const unknown = buildAppImpact(data, { packages: ['com.unknown'], inventory: [], action: 'inspect' }); assert.equal(unknown.items[0].found, false); assert.match(unknown.notice, /빈 관계는 영향 없음의 증거가 아니/);
});

test('impact rejects invalid or contradictory cached inventories', () => {
  for (const body of [{ packages: ['com.x;reboot'], inventory: [] }, { packages: ['com.base'], inventory: [{ package: 'com.client', enabled: 'yes' }] }, { packages: ['com.base'], inventory: [{ package: 'com.client' }, { package: 'com.client' }] }]) assert.throws(() => buildAppImpact(reference(), body));
});

test('unknown activation remains unknown and shared UID relationships come from cached device identity', () => {
  const data = buildAppImpact(reference(), { packages: ['com.base'], inventory: [{ package: 'com.base', enabled: true, uid: 10001 }, { package: 'com.client', enabled: null, uid: 10001 }, { package: 'com.other', enabled: true, uid: 10002 }], action: 'disable' });
  assert.equal(data.items[0].neededBy[0].state, 'enabled-unknown'); assert.equal(data.items[0].neededBy[0].enabled, null); assert.equal(data.items[0].sharedUid.length, 1); assert.equal(data.items[0].sharedUid[0].uid, 10001); assert.equal(data.items[0].sharedUid[0].evidence[0].field, 'observed-shared-uid'); assert.equal(data.items[0].warnings.some(row => row.kind === 'active-consumer'), false); assert.match(data.items[0].warnings.find(row => row.kind === 'shared-uid').message, /모두 비활성화한다는 뜻은 아닙니다/);
});

test('status and cached impact do not perform a remote fetch', async t => {
  const f = await fixture(t); const status = await f.tools.status(); assert.equal(status.source.packageCount, 3);
  const impact = await f.tools.impact({ packages: ['com.base'], inventory: [{ package: 'com.client', enabled: true }] }); assert.equal(impact.items[0].neededBy[0].installed, true); assert.deepEqual(f.calls, []);
});

test('update check prepares review without writing current data and retains original summaries for review', async t => {
  const f = await fixture(t), before = await readFile(f.file, 'utf8'), result = await f.tools.check();
  assert.deepEqual(result.summary, { added: 1, changed: 1, removed: 1, koreanSummariesNeedingReview: 1 }); assert.equal(await readFile(f.file, 'utf8'), before);
  const detail = await f.tools.review({ reviewId: result.reviewId, package: 'com.base' }); assert.equal(detail.after.summaryKo, '기존 한글 요약'); assert.equal(detail.after.koreanReviewRequired, true); assert.equal(detail.after.summarySourceCommit, beforeSha);
  assert.equal(f.calls.length, 3); assert.ok(f.calls[0].endsWith('/branches/main'), 'version check avoids downloading an entire commit patch'); assert.ok(f.calls.every(url => !url.includes('127.0.0.1'))); assert.equal(f.applied, 0);
});

test('same upstream commit returns current status without source downloads', async t => {
  const f = await fixture(t, { sha: beforeSha }), result = await f.tools.check(); assert.equal(result.upToDate, true); assert.equal(f.calls.length, 1);
});

test('apply requires exact reviewed commit and archives license, unmodified source and previous reference', async t => {
  const f = await fixture(t), before = await readFile(f.file, 'utf8'), checked = await f.tools.check();
  await assert.rejects(f.tools.apply({ reviewId: checked.reviewId, confirmCommit: beforeSha }), /확인/); assert.equal(await readFile(f.file, 'utf8'), before);
  const result = await f.tools.apply({ reviewId: checked.reviewId, confirmCommit: afterSha }); assert.equal(result.applied, true); assert.equal(f.applied, 1);
  const actual = JSON.parse(await readFile(f.file, 'utf8')); assert.equal(actual.source.commit, afterSha); assert.equal(actual.source.license, 'GPL-3.0'); assert.equal(actual.packages['com.base'].summaryKo, '기존 한글 요약');
  const archive = path.join(f.root, result.archive), files = await readdir(archive); for (const name of ['LICENSE.txt', 'NOTICE.txt', 'upstream.json', 'previous-reference.json', 'reference.json']) assert.ok(files.includes(name));
  assert.equal(await readFile(path.join(archive, 'previous-reference.json'), 'utf8'), before); assert.deepEqual(JSON.parse(await readFile(path.join(archive, 'upstream.json'), 'utf8')), f.upstream);
  assert.match(actual.packages['com.added'].description, /<script>/); assert.equal(actual.packages['com.added'].summaryKo, undefined, 'untranslated upstream text never becomes a fabricated Korean summary');
  await assert.rejects(f.tools.apply({ reviewId: checked.reviewId, confirmCommit: afterSha }), /만료/);
});

test('local edits after review prevent update overwrite', async t => {
  const f = await fixture(t), checked = await f.tools.check(), edited = reference(); edited.packages['com.base'].summaryKo = '사용자의 새 요약'; await writeFile(f.file, JSON.stringify(edited));
  await assert.rejects(f.tools.apply({ reviewId: checked.reviewId, confirmCommit: afterSha }), /자료가 바뀌/); assert.equal(JSON.parse(await readFile(f.file, 'utf8')).packages['com.base'].summaryKo, '사용자의 새 요약');
});

test('partial archive writes are cleaned and the same reviewed update can be retried', async t => {
  let fail = true;
  const f = await fixture(t, { fileIO: { writeFile: async (file, ...args) => { await writeFile(file, ...args); if (fail && file.endsWith('LICENSE.txt')) { fail = false; throw new Error('simulated disk error'); } } } });
  const before = await readFile(f.file, 'utf8'), checked = await f.tools.check(); await assert.rejects(f.tools.apply({ reviewId: checked.reviewId, confirmCommit: afterSha }), /simulated/); assert.equal(await readFile(f.file, 'utf8'), before); assert.deepEqual(await readdir(path.join(f.paths.dataRoot, 'uad-reference-versions')), []);
  assert.equal((await f.tools.apply({ reviewId: checked.reviewId, confirmCommit: afterSha })).applied, true);
});

test('failed atomic replacement cleans staging files and retries without stale archive collision', async t => {
  let fail = true;
  const f = await fixture(t, { fileIO: { rename: async (...args) => { if (fail) { fail = false; throw new Error('simulated rename lock'); } return rename(...args); } } });
  const before = await readFile(f.file, 'utf8'), checked = await f.tools.check(); await assert.rejects(f.tools.apply({ reviewId: checked.reviewId, confirmCommit: afterSha }), /rename lock/); assert.equal(await readFile(f.file, 'utf8'), before); assert.ok((await readdir(f.paths.dataRoot)).every(name => !name.endsWith('.reference.tmp'))); assert.deepEqual(await readdir(path.join(f.paths.dataRoot, 'uad-reference-versions')), []);
  assert.equal((await f.tools.apply({ reviewId: checked.reviewId, confirmCommit: afterSha })).applied, true);
});

test('local rollback previews and restores an archived version without network or phone actions', async t => {
  const f = await fixture(t), checked = await f.tools.check(); await f.tools.apply({ reviewId: checked.reviewId, confirmCommit: afterSha }); const requests = f.calls.length;
  const listed = await f.tools.versions(); assert.equal(listed.versions.length, 2); const old = listed.versions.find(row => row.variant === 'before'); assert.equal(old.source.commit, beforeSha);
  const preview = await f.tools.rollbackPreview({ versionId: old.versionId, variant: 'before' }); assert.equal(preview.operation, 'rollback'); assert.equal(preview.after.commit, beforeSha); assert.equal(JSON.parse(await readFile(f.file, 'utf8')).source.commit, afterSha);
  await assert.rejects(f.tools.apply({ reviewId: preview.reviewId, confirmCommit: afterSha }), /확인/);
  const applied = await f.tools.apply({ reviewId: preview.reviewId, confirmCommit: beforeSha }); assert.equal(applied.operation, 'rollback'); const restored = JSON.parse(await readFile(f.file, 'utf8')); assert.equal(restored.source.commit, beforeSha); assert.equal(restored.packages['com.base'].summaryKo, '기존 한글 요약'); assert.equal(restored.packages['com.base'].koreanReviewRequired, undefined); assert.equal(f.calls.length, requests); assert.equal((await f.tools.versions()).versions.length, 4);
  const repeat = await f.tools.rollbackPreview({ versionId: old.versionId, variant: 'before' }); assert.equal(repeat.upToDate, true);
});

test('rollback refuses arbitrary paths and rejects stale review after local edits', async t => {
  const f = await fixture(t); await assert.rejects(f.tools.rollbackPreview({ versionId: '../outside', variant: 'before' }), /목록/);
  const checked = await f.tools.check(); await f.tools.apply({ reviewId: checked.reviewId, confirmCommit: afterSha }); const old = (await f.tools.versions()).versions.find(row => row.variant === 'before'), preview = await f.tools.rollbackPreview({ versionId: old.versionId, variant: 'before' });
  const edited = JSON.parse(await readFile(f.file, 'utf8')); edited.packages['com.base'].summaryKo = '새 편집'; await writeFile(f.file, JSON.stringify(edited)); await assert.rejects(f.tools.apply({ reviewId: preview.reviewId, confirmCommit: beforeSha }), /자료가 바뀌/); assert.equal(JSON.parse(await readFile(f.file, 'utf8')).packages['com.base'].summaryKo, '새 편집');
});

test('updater refuses nonofficial redirects and malformed commit identities', async t => {
  const f = await fixture(t, { fetch: async () => new Response('', { status: 302, headers: { location: 'https://evil.example/reference.json' } }) }); await assert.rejects(f.tools.check(), /공식/); assert.equal(f.calls.length, 1);
  const g = await fixture(t, { fetch: async () => new Response(JSON.stringify({ name: 'main', commit: { sha: '../../escape', commit: { committer: { date: '2026-10-16' } } } })) }); await assert.rejects(g.tools.check(), /식별자/); assert.equal(g.calls.length, 1);
});

test('updater rejects invalid source schema or license without touching data', async t => {
  const f = await fixture(t); f.upstream['com.base'].dependencies = ['reboot;']; const before = await readFile(f.file, 'utf8'); await assert.rejects(f.tools.check(), /연결 정보/); assert.equal(await readFile(f.file, 'utf8'), before);
  const g = await fixture(t, { fetch: async url => url.startsWith('https://api.github.com/') ? new Response(JSON.stringify({ name: 'main', commit: { sha: afterSha, commit: { committer: { date: '2026-10-16' } } } })) : url.endsWith('/LICENSE') ? new Response('license missing') : new Response(JSON.stringify({ 'com.one': entry('one') })) }); await assert.rejects(g.tools.check(), /라이선스/);
});

test('enrichment reads the applied local reference and preserves no phone-dependent state', async t => {
  const f = await fixture(t), checked = await f.tools.check(); await f.tools.apply({ reviewId: checked.reviewId, confirmCommit: afterSha }); const fetchCount = f.calls.length;
  const data = await f.tools.enrich({ packages: ['com.base', 'com.added', 'com.removed'] }); assert.equal(data.commit, afterSha); assert.equal(data.entries[0].knowledge.koreanReviewRequired, true); assert.equal(data.entries[2].knowledge.found, false); assert.equal(f.calls.length, fetchCount);
  const description = describeAppKnowledge('com.base', JSON.parse(await readFile(f.file, 'utf8'))); assert.equal(description.koreanReviewRequired, true); assert.equal(description.summarySourceCommit, beforeSha);
});

test('missing local reference reports unavailable without network access', async t => {
  const f = await fixture(t); await rm(f.file);await rm(f.seed);
  await assert.rejects(f.tools.status(), error => error.status === 503 && /자료 파일이 없습니다/.test(error.message)); assert.deepEqual(f.calls, []);
});

test('fresh installations read the public seed without creating or changing local data',async t=>{
  const f=await fixture(t,{seedOnly:true}),seed=await readFile(f.seed,'utf8');
  assert.equal((await f.tools.status()).source.commit,beforeSha);
  const read=await readAppReference(f.root);assert.equal(read.localOverride,false);assert.equal(read.path,f.seed);assert.equal(read.text,seed);
  assert.equal((await lookupAppKnowledge('com.base',{root:f.root})).summaryKo,'기존 한글 요약');
  await assert.rejects(readFile(f.file),{code:'ENOENT'});assert.equal(await readFile(f.seed,'utf8'),seed);assert.equal(f.calls.length,0);
});

test('first update creates a local override and rollback never modifies the public seed',async t=>{
  const f=await fixture(t,{seedOnly:true}),seed=await readFile(f.seed,'utf8');
  await lookupAppKnowledge('com.base',{root:f.root});
  const checked=await f.tools.check();await f.tools.apply({reviewId:checked.reviewId,confirmCommit:afterSha});
  assert.equal(await readFile(f.seed,'utf8'),seed);assert.equal((await readAppReference(f.root)).localOverride,true);
  assert.equal((await lookupAppKnowledge('com.base',{root:f.root})).source.commit,afterSha);
  const old=(await f.tools.versions()).versions.find(row=>row.variant==='before'),rollback=await f.tools.rollbackPreview({versionId:old.versionId,variant:'before'});
  await f.tools.apply({reviewId:rollback.reviewId,confirmCommit:beforeSha});assert.equal(await readFile(f.seed,'utf8'),seed);assert.equal((await lookupAppKnowledge('com.base',{root:f.root})).source.commit,beforeSha);
});

test('failed first update preserves seed and does not leave an incomplete override',async t=>{
  const f=await fixture(t,{seedOnly:true,fileIO:{rename:async()=>{throw new Error('atomic rename failed');}}}),seed=await readFile(f.seed,'utf8');
  const checked=await f.tools.check();await assert.rejects(f.tools.apply({reviewId:checked.reviewId,confirmCommit:afterSha}),/atomic rename/);
  assert.equal(await readFile(f.seed,'utf8'),seed);await assert.rejects(readFile(f.file),{code:'ENOENT'});assert.equal((await f.tools.status()).source.commit,beforeSha);
  assert.deepEqual(await readdir(path.join(f.paths.dataRoot,'uad-reference-versions')),[]);assert.ok((await readdir(f.paths.dataRoot)).every(name=>!name.endsWith('.reference.tmp')));
});

test('lookup cache is isolated by project local store and malformed override is not silently replaced by seed',async t=>{
  const a=await fixture(t),b=await fixture(t),edited=reference();edited.packages['com.base'].summaryKo='다른 사용자 요약';await writeFile(b.file,JSON.stringify(edited));
  assert.equal((await lookupAppKnowledge('com.base',{root:a.root})).summaryKo,'기존 한글 요약');assert.equal((await lookupAppKnowledge('com.base',{root:b.root})).summaryKo,'다른 사용자 요약');
  await writeFile(a.file,'broken JSON');invalidateAppKnowledgeCache(a.root);await assert.rejects(lookupAppKnowledge('com.base',{root:a.root}));
  await assert.rejects(a.tools.status(),/형식|읽을 수/);assert.equal((await lookupAppKnowledge('com.base',{root:b.root})).summaryKo,'다른 사용자 요약');
});

test('reference UI initializes without requests and refreshes only cached row knowledge', async () => {
  const elements = new Map(), calls = []; let count = 0;
  function element(id) { if (!elements.has(id)) elements.set(id, { id, textContent: '', innerHTML: '', children: [], classList: { add() {}, toggle() {} }, setAttribute() {}, addEventListener() {}, querySelectorAll: () => [], append(...values) { this.children.push(...values); }, replaceChildren(...values) { this.children = values; } }); return elements.get(id); }
  const window = {}, document = { getElementById: element, createElement: tag => ({ ...element('created-' + count++), tag }), dispatchEvent() {} };
  const context = { window, document, CustomEvent: class {}, fetch: async (url, options) => { calls.push({ url, body: options?.body ? JSON.parse(options.body) : null }); return { ok: true, json: async () => url === '/api/session' ? { csrfToken: 'test' } : { commit: afterSha, entries: [{ package: 'com.base', knowledge: { title: '새 참고 이름', found: true } }] } }; } };
  vm.runInNewContext(await readFile(new URL('../public/app-reference-tools.js', import.meta.url), 'utf8'), context);
  assert.equal(calls.length, 0);
  const rows = await window.AppReference.refreshInventory([{ package: 'com.base', label: '폰 실제 이름', enabled: false, versionCode: 10 }]); assert.equal(rows[0].label, '폰 실제 이름'); assert.equal(rows[0].enabled, false); assert.equal(rows[0].knowledge.title, '새 참고 이름'); assert.deepEqual(calls.map(item => item.url), ['/api/session', '/api/ops/app-reference-enrich']);
  const target = element('impact'); window.AppReference.renderImpact(target, { available: true, userId: '10', notice: '참고 자료', items: [{ package: 'com.base', requires: [{ package: 'com.client', title: '<img src=x onerror=alert(1)>', installed: true, state: 'enabled', selected: false }], neededBy: [], warnings: [] }] });
  const all = []; const visit = item => { all.push(item); for (const child of item.children || []) visit(child); }; visit(target);
  assert.ok(all.some(item => item.textContent.includes('<img'))); assert.ok(all.every(item => !item.innerHTML.includes('<img')));
});

test('rollback UI only applies an explicitly confirmed reviewed version and invalidates changed selection', async () => {
  const elements = new Map(), calls = [], events = []; let invalidated = 0;
  function element(id) { if (!elements.has(id)) elements.set(id, { id, value: '', checked: false, hidden: false, textContent: '', innerHTML: '', classList: { add() {}, toggle() {} }, setAttribute() {}, addEventListener() {}, querySelectorAll: () => [] }); return elements.get(id); }
  const review = { operation: 'rollback', reviewId: 'review', before: { commit: afterSha }, after: { commit: beforeSha }, summary: { added: 0, changed: 1, removed: 0, koreanSummariesNeedingReview: 0 }, changes: [{ package: 'com.base', kind: 'changed' }], message: '되돌리기 검토' };
  const context = { window: { AppKnowledge: { invalidateReference() { invalidated++; } } }, document: { getElementById: element, dispatchEvent: event => events.push(event) }, CustomEvent: class { constructor(type, detail) { this.type = type; this.detail = detail; } }, fetch: async (url, options) => { calls.push({ url, body: options?.body ? JSON.parse(options.body) : null }); let data; if (url === '/api/session') data = { csrfToken: 'test' }; else if (url.endsWith('app-reference-versions')) data = { versions: [{ versionId: 'archive', variant: 'before', label: '반영 전', source: { commit: beforeSha, koreanSummaryCount: 1 }, archivedAt: '2026-10-16T00:00:00Z' }] }; else if (url.endsWith('app-reference-rollback-preview')) data = review; else if (url.endsWith('app-reference-apply')) data = { applied: true, source: { commit: beforeSha }, message: '되돌리기 완료' }; else assert.fail(url); return { ok: true, json: async () => data }; } };
  vm.runInNewContext(await readFile(new URL('../public/app-reference-tools.js', import.meta.url), 'utf8'), context); assert.equal(calls.length, 0);
  await element('app-reference-versions').onclick(); element('app-reference-version').value = '0'; await element('app-reference-rollback-preview').onclick();
  assert.match(element('app-reference-apply').textContent, /되돌리기/); await element('app-reference-apply').onclick(); assert.equal(calls.filter(row => row.url.endsWith('app-reference-apply')).length, 0);
  element('app-reference-confirm').checked = true; element('app-reference-version').onchange(); await element('app-reference-apply').onclick(); assert.equal(calls.filter(row => row.url.endsWith('app-reference-apply')).length, 0);
  await element('app-reference-rollback-preview').onclick(); element('app-reference-confirm').checked = true; await element('app-reference-apply').onclick(); assert.equal(calls.filter(row => row.url.endsWith('app-reference-apply')).length, 1); assert.equal(calls.find(row => row.url.endsWith('app-reference-apply')).body.confirmCommit, beforeSha); assert.equal(invalidated, 1); assert.equal(events[0].type, 'adb-reference-updated');
});
