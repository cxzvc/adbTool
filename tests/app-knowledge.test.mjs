import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { lookupAppKnowledge } from '../lib/app-knowledge.mjs';

test('knowledge snapshot preserves upstream text, license and pinned source provenance', async () => {
  const reference = JSON.parse(await readFile(new URL('../data/uad-package-reference.json', import.meta.url), 'utf8'));
  const raw = await readFile(new URL('../data/licenses/uad-upstream-source.json', import.meta.url));
  const upstream = JSON.parse(raw);
  assert.equal(createHash('sha256').update(raw).digest('hex'), reference.source.sourceSha256);
  assert.match(reference.source.commit, /^[a-f0-9]{40}$/);
  assert.ok(reference.source.sourceUrl.includes(reference.source.commit));
  assert.match(await readFile(new URL('../data/licenses/UAD-NG-GPL-3.0.txt', import.meta.url), 'utf8'), /GNU GENERAL PUBLIC LICENSE/);
  assert.equal(Object.keys(reference.packages).length, Object.keys(upstream).length);
  for (const [key, entry] of Object.entries(upstream)) {
    const local = reference.packages[key];
    for (const field of ['description', 'list', 'removal', 'dependencies', 'neededBy', 'labels']) assert.deepEqual(local[field], entry[field], `${key}.${field}`);
  }
  assert.equal(Object.values(reference.packages).filter(entry => entry.summaryKo).length, reference.koreanSummaryCount);
  assert.ok(reference.koreanSummaryCount >= 60);
});

test('known app returns real Korean function summary and qualified community classification', async () => {
  const data = await lookupAppKnowledge('com.google.android.webview');
  assert.equal(data.found, true);
  assert.equal(data.translationStatus, 'community-summary');
  assert.match(data.summaryKo, /다른 앱 안에서 웹 페이지/);
  assert.equal(data.removal.communityOnly, true);
  assert.match(data.notes.join(' '), /공식 검증.*아닙니다/);
  assert.match(data.notes.join(' '), /비어 있어도.*없다는 뜻은 아닙니다/);
});

test('source relationships survive without claiming live installed dependency detection', async () => {
  const pay = await lookupAppKnowledge('com.samsung.android.spay');
  assert.ok(pay.dependencies.includes('com.samsung.android.spayfw'));
  const framework = await lookupAppKnowledge('com.samsung.android.spayfw');
  assert.ok(framework.neededBy.includes('com.samsung.android.spay'));
  framework.neededBy.push('test.mutation');
  assert.ok(!(await lookupAppKnowledge('com.samsung.android.spayfw')).neededBy.includes('test.mutation'));
});

test('untranslated references and unknown packages do not invent Korean functionality', async () => {
  const untranslated = await lookupAppKnowledge('org.lineageos.jelly');
  assert.equal(untranslated.found, true);
  assert.equal(untranslated.translationStatus, 'untranslated');
  assert.match(untranslated.summaryKo, /공식\/번역 설명 미확인/);
  assert.match(untranslated.description, /Browser/);
  const absent = await lookupAppKnowledge('app.unknown.not_in_snapshot');
  assert.equal(absent.found, false);
  assert.equal(absent.removal, null);
  assert.match(absent.summaryKo, /목록에 없습니다/);
});

test('package query rejects path, command and markup inputs', async () => {
  for (const value of [undefined, '', '../data', 'com.app;id', 'com.app\n', '<img>', 'x'.repeat(256)]) await assert.rejects(lookupAppKnowledge(value));
});

class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.textContent = ''; }
  set innerHTML(_) { throw Error('Untrusted HTML must not be inserted'); }
  append(...values) { this.children.push(...values); }
  replaceChildren(...values) { this.children = values; this.textContent = ''; }
  setAttribute(name, value) { this.attributes[name] = value; }
  removeAttribute(name) { delete this.attributes[name]; }
  flatten() { return this.textContent + this.children.map(x => typeof x === 'string' ? x : x.flatten()).join('\n'); }
}
async function ui(feedback) {
  const mount = new Element('div'), pending = [];
  const context = vm.createContext({ window: {DeskFeedback:feedback}, document: { getElementById: id => id === 'app-knowledge' ? mount : null, createElement: tag => new Element(tag) }, AbortController, fetch: (url, options) => new Promise(resolve => pending.push({ url, options, resolve })) });
  vm.runInContext(await readFile(new URL('../public/app-knowledge.js', import.meta.url), 'utf8'), context);
  return { mount, pending, api: context.window.AppKnowledge };
}
const response = data => ({ ok: true, json: async () => data });

test('app knowledge UI only fetches local reference API and ignores stale selection', async () => {
  const view = await ui();
  const first = view.api.show('com.android.chrome'), second = view.api.show('com.google.android.webview');
  assert.match(view.pending[0].url, /^\/api\/ops\/app-knowledge\?package=/);
  assert.equal(view.pending[0].options.signal.aborted, true);
  const webview = await lookupAppKnowledge('com.google.android.webview');
  view.pending[1].resolve(response(webview)); await second;
  view.pending[0].resolve(response(await lookupAppKnowledge('com.android.chrome'))); await first;
  assert.match(view.mount.flatten(), /Android System WebView/);
  assert.doesNotMatch(view.mount.flatten(), /Google Chrome/);
  assert.equal(view.mount.attributes['aria-busy'], undefined);
});

test('closing selected app prevents late response from restoring panel and original markup stays text', async () => {
  const view = await ui();
  const showing = view.api.show('test.example');
  const value = { ...(await lookupAppKnowledge('com.google.android.webview')), description: '<img src=x onerror=alert(1)>' };
  view.pending[0].resolve(response(value)); await showing;
  assert.match(view.mount.flatten(), /<img src=x onerror=alert\(1\)>/);
  const late = view.api.show('test.other'); view.api.clear();
  view.pending[1].resolve(response(value)); await late;
  assert.equal(view.mount.hidden, true);
  assert.equal(view.mount.children.length, 0);
});
test('reference invalidation cannot be undone by an older description response repopulating cache',async()=>{const view=await ui(),old=view.api.show('com.test');view.api.invalidateReference();view.pending[1].resolve(response({title:'NEW REFERENCE',summaryKo:'new',found:false}));await new Promise(resolve=>setImmediate(resolve));view.pending[0].resolve(response({title:'OLD REFERENCE',summaryKo:'old',found:false}));await old;await view.api.show('com.test');assert.match(view.mount.flatten(),/NEW REFERENCE/);assert.doesNotMatch(view.mount.flatten(),/OLD REFERENCE/);assert.equal(view.pending.length,2);});

test('description failure exposes a guarded read retry without any device action',async()=>{const cards=[];let starts=0,finished=0;const view=await ui({start:()=>{starts++;return()=>finished++;},state:(host,value)=>cards.push(value)});const first=view.api.show('com.test');assert.equal(starts,1);view.pending[0].resolve({ok:false,json:async()=>({error:'reference unavailable'})});await first;assert.equal(cards[0].type,'error');const again=cards[0].onAction();assert.equal(view.pending.length,2);view.pending[1].resolve(response({title:'Recovered reference',summaryKo:'조회됨',found:false}));await again;assert.match(view.mount.flatten(),/Recovered reference/);assert.equal(finished,2);view.api.clear();const before=view.pending.length;await cards[0].onAction();assert.equal(view.pending.length,before);});
