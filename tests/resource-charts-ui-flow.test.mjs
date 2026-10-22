import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const overviewSource = await readFile(new URL('../public/resource-overview.js', import.meta.url), 'utf8');
const telemetrySource = await readFile(new URL('../public/telemetry.js', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const start = 1_000_000;
function history(count = 3, range = 'all') {
  const points = Array.from({ length: count }, (_, i) => ({ at: start + i * 5000, session: 'one', event: 'sample', cpu: 10 + i, ram: 100 + i, ramTotal: 1000, storage: 200, storageTotal: 2000, battery: 80, charging: 'charging' }));
  return { count, range, collecting: true, error: '', points, latest: points.at(-1), sessions: [{ id: 'one', start, end: points.at(-1).at, count }], firstAt: start, lastAt: points.at(-1).at, serverTime: points.at(-1).at, intervalMs: 5000, stats: Object.fromEntries(['cpu', 'ram', 'storage', 'battery'].map(key => [key, { count, min: 1, max: 100, average: 20 }])) };
}
function fixture() {
  const nodes = new Map(), requests = [], timers = new Map(), downloads = [], observerCallbacks = [], busy = [], states = new Map();
  let timerId = 0;
  function node(id) {
    if (nodes.has(id)) return nodes.get(id);
    const attributes = new Map(), handlers = new Map();
    const value = { id, hidden: false, disabled: false, value: '', textContent: '', dataset: {}, style: {}, clientWidth: 800, innerHTML: '', offsetWidth: 300, offsetHeight: 300,
      classList: { toggle() {}, add() {}, remove() {} },
      setAttribute(key, value) { attributes.set(key, value); }, getAttribute(key) { return attributes.get(key); },
      addEventListener(type, handler) { handlers.set(type, handler); }, fire(type, event) { return handlers.get(type)?.(event); },
      querySelectorAll() { return []; },
      querySelector(selector) { if (!this.innerHTML.includes('<svg')) return null; return node(id + selector); },
      getBoundingClientRect() { return { left: 0, top: 0, width: 400, height: 242 }; }
    };
    nodes.set(id, value); return value;
  }
  const window = { innerWidth: 1400, innerHeight: 1000 }, context = {
    window, document: { getElementById: node, addEventListener() {}, createElement: () => ({ click() { downloads.push(this.download); } }) },
    ResizeObserver: class { constructor(callback) { observerCallbacks.push(callback); } observe() {} },
    DeskUI: { formatBytes: value => String(value) }, DeskFeedback: { start(label, options) { const entry={label,options,done:false};busy.push(entry);return()=>{entry.done=true;}; }, paint: (_, callback) => callback(), state(host, options) {states.set(host.id, options);host.hidden=!options;host.textContent=options?options.title+' · '+options.message:'';} },
    URLSearchParams, AbortController,
    URL: { createObjectURL: () => 'blob:mock', revokeObjectURL() {} },
    setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id; }, clearTimeout(id) { timers.delete(id); },
    setInterval() {}, requestAnimationFrame: callback => callback(), cancelAnimationFrame() {},
    fetch(url, options) { return new Promise(resolve => requests.push({ url, options, resolve })); }
  };
  vm.runInNewContext(overviewSource, context); vm.runInNewContext(telemetrySource, context);
  const answer = async (request, data, ok = true) => { request.resolve({ ok, json: async () => data, blob: async () => ({ csv: true }) }); await tick(); };
  const runTimer = async () => { const entry = timers.entries().next().value; assert.ok(entry, 'a tooltip timer should be scheduled'); timers.delete(entry[0]); entry[1](); await tick(); };
  const open = async (mode = 'overview') => { window.ResourceCharts.open('phone'); window.ResourceCharts.activate(true, mode); await answer(requests.at(-1), history()); };
  return { node, window, requests, timers, downloads, answer, runTimer, open, observerCallbacks, busy, states };
}

test('overview legend redraw preserves the selected cursor and synchronizes its time slider', async () => {
  const f = fixture(); await f.open();
  f.window.ResourceCharts.inspectIndex(0, null, true);
  const selected = f.node('overview-selected').textContent;
  assert.equal(f.node('overview-scrubber').value, 0);
  const button = { dataset: { overviewSeries: 'cpu' }, setAttribute() {} };
  f.node('overview-legend').onclick({ target: { closest: () => button } });
  assert.equal(f.node('overview-selected').textContent, selected);
  assert.equal(f.node('overview-scrubber').value, 0);
});

test('manual refresh retains a pinned measurement instead of moving its cursor to the latest sample', async () => {
  const f = fixture(); await f.open(); f.window.ResourceCharts.inspectIndex(0, null, true);
  const selected = f.node('overview-selected').textContent;
  f.window.ResourceCharts.refresh(); await f.answer(f.requests.at(-1), history(4));
  assert.equal(f.node('overview-selected').textContent, selected);
  assert.equal(f.node('overview-scrubber').value, 0);
  assert.equal(f.node('resource-scrubber').value, 0);
});

test('the same pinned tooltip measurement can be retried after a failed snapshot request', async () => {
  const f = fixture(); await f.open(); f.window.ResourceCharts.inspectIndex(0, null, true); await f.runTimer();
  await f.answer(f.requests.at(-1), { error: 'temporary failure' }, false);
  assert.match(f.node('resource-inspector-message').textContent, /다시 선택/);
  f.window.ResourceCharts.inspectIndex(0, null, true); await f.runTimer();
  assert.equal(f.requests.filter(request => request.url.includes('telemetry-point?')).length, 2);
  await f.answer(f.requests.at(-1), { ...history().points[0], processes: { cpu: [{name:'test.app',pid:1,user:'user',cpu:1,rss:10}], ram: [] } });
  assert.equal(f.node('resource-inspector-message').hidden, true);
  assert.equal(f.node('resource-inspector-loading').hidden, true);
});

test('old range data cannot open a tooltip while the new range is loading, and late range responses are ignored', async () => {
  const f = fixture(); await f.open();
  f.window.ResourceCharts.setRange('1h'); const older = f.requests.at(-1);
  f.window.ResourceCharts.inspectIndex(0, null, true);
  assert.equal(f.timers.size, 0);
  f.window.ResourceCharts.setRange('6h'); const newer = f.requests.at(-1);
  await f.answer(newer, history(4, '6h')); await f.answer(older, history(2, '1h'));
  assert.match(f.node('resource-count').textContent, /^4회/);
  f.window.ResourceCharts.inspectIndex(0, null, true); assert.equal(f.timers.size, 1);
});

test('a CSV response arriving after a device change cannot download or overwrite the new device state', async () => {
  const f = fixture(); await f.open();
  const pending = f.node('resource-export').onclick(), request = f.requests.at(-1);
  f.window.ResourceCharts.open('other-phone'); await f.answer(request, {}); await pending;
  assert.deepEqual(f.downloads, []);
  assert.equal(f.node('resource-warning').hidden, true);
  assert.equal(f.node('resource-export').disabled, true);
  assert.equal(request.options.signal.aborted, true);
});

test('a late CSV failure after a range change stays silent and cannot re-enable a different active export', async () => {
  const f = fixture(); await f.open();
  const olderExport = f.node('resource-export').onclick(), olderRequest = f.requests.at(-1);
  f.window.ResourceCharts.setRange('1h'); await f.answer(f.requests.at(-1), history(3, '1h'));
  const newerExport = f.node('resource-export').onclick(), newerRequest = f.requests.at(-1);
  await f.answer(olderRequest, {}, false); await olderExport;
  assert.equal(f.states.get('resource-warning').type, 'loading');
  assert.equal(f.node('resource-export').disabled, true);
  await f.answer(newerRequest, {}); await newerExport;
  assert.equal(f.downloads.length, 1);
  assert.equal(f.node('resource-export').disabled, false);
});

test('a late tooltip response from a previous device cannot reopen the inspector', async () => {
  const f = fixture(); await f.open(); f.window.ResourceCharts.inspectIndex(0, null, true); await f.runTimer();
  const request = f.requests.at(-1); f.window.ResourceCharts.open('other-phone');
  await f.answer(request, { ...history().points[0], processes: { cpu: [], ram: [] } });
  assert.equal(f.node('resource-inspector').hidden, true);
  assert.equal(f.node('resource-count').textContent, '측정값 대기');
});

test('changing the device clears the overview charging label, selected time and old connection choices immediately',async()=>{
  const f=fixture();await f.open();f.window.ResourceCharts.inspectIndex(0,null,true);
  assert.equal(f.node('overview-charge-label').textContent,'충전 중');
  assert.match(f.node('overview-session').innerHTML,/value="one"/);
  f.window.ResourceCharts.open('other-phone');
  assert.equal(f.node('overview-charge-label').textContent,'기록 조회 전');
  assert.doesNotMatch(f.node('overview-selected').textContent,/충전 중/);
  assert.doesNotMatch(f.node('overview-session').innerHTML,/value="one"/);
  assert.equal(f.node('overview-session').value,'latest');
  assert.equal(f.node('overview-scrubber').disabled,true);
  assert.equal(Number(f.node('overview-scrubber').max),0);
  assert.doesNotMatch(f.node('resource-session').innerHTML,/value="one"/);
  assert.equal(f.node('resource-session').value,'latest');
  assert.equal(f.node('resource-session').disabled,true);
  assert.equal(f.node('resource-scrubber').disabled,true);
  f.window.ResourceCharts.activate(true,'overview');await f.answer(f.requests.at(-1),history());
  assert.equal(f.node('overview-session').disabled,false);
  assert.equal(f.node('resource-session').disabled,false);
});

test('overview pointer selection accounts for the SVG being displayed at half its coordinate width', async () => {
  const f = fixture(); await f.open();
  // The second sample is 5 seconds into a 60-second axis; SVG 800px is displayed at 400px.
  const clientX = (44 + 5000 / 60000 * (785 - 44)) / 2;
  f.node('overview-plot').fire('pointermove', { clientX, clientY: 50 });
  assert.equal(f.node('overview-scrubber').value, 1);
});

test('detail graph pointer selection uses the displayed SVG scale as well', async () => {
  const f = fixture(); await f.open('resources');
  const plot = f.node('resource-cpu-plot'), clientX = (49 + 5000 / 60000 * (788 - 49)) / 2;
  plot.fire('pointermove', { currentTarget: plot, clientX, clientY: 50 });
  assert.equal(f.node('resource-scrubber').value, 1);
});


function emptyHistory({collecting=true, recorded=false, sessions=true}={}) {
  const data=history();return {...data,count:0,points:[],latest:null,firstAt:null,lastAt:null,collecting,sessions:sessions?[{id:'old',start,end:start+5000,count:recorded?2:0}]:[],stats:Object.fromEntries(Object.keys(data.stats).map(key=>[key,{count:0}]))};
}

test('manual query shows immediate local busy feedback and failed-query retry keeps the current filters', async()=>{
  const f=fixture();await f.open();f.window.ResourceCharts.setRange('1h');await f.answer(f.requests.at(-1),history(3,'1h'));
  f.node('overview-refresh').onclick();
  assert.equal(f.node('overview-plot').getAttribute('aria-busy'),'true');
  assert.equal(f.node('resource-panel-content').getAttribute('aria-busy'),'true');
  assert.equal(f.busy.at(-1).options.button.id,'overview-refresh');
  assert.equal(f.states.get('overview-warning').type,'loading');
  await f.answer(f.requests.at(-1),{error:'query unavailable'},false);
  assert.equal(f.states.get('overview-warning').type,'error');
  assert.equal(f.node('overview-plot').getAttribute('aria-busy'),'false');
  assert.equal(f.node('overview-empty').hidden,true);
  const retry=f.states.get('overview-warning').onAction();
  assert.equal(new URL(f.requests.at(-1).url,'http://mock').searchParams.get('range'),'1h');
  await f.answer(f.requests.at(-1),history(3,'1h'));await retry;
  assert.equal(f.node('overview-warning').hidden,true);
});

test('an empty filter result offers one explicit action that queries all periods and sessions once',async()=>{
  const f=fixture();await f.open();f.window.ResourceCharts.setRange('15m');await f.answer(f.requests.at(-1),emptyHistory({recorded:true}));
  const card=f.states.get('overview-empty');assert.equal(card.type,'empty');assert.match(card.title,/선택한 기간/);assert.match(card.actionLabel,/모든 연결/);
  const before=f.requests.length,pending=card.onAction();
  assert.equal(f.requests.length,before+1);const query=new URL(f.requests.at(-1).url,'http://mock').searchParams;
  assert.equal(query.get('range'),'all');assert.equal(query.get('session'),'all');
  await f.answer(f.requests.at(-1),history());await pending;
});

test('first measurement, no stored history, and disconnected collection have different state guidance',async()=>{
  const f=fixture();await f.open();
  f.window.ResourceCharts.refresh();await f.answer(f.requests.at(-1),emptyHistory());
  assert.match(f.states.get('resource-empty').title,/첫 측정/);
  f.window.ResourceCharts.refresh();await f.answer(f.requests.at(-1),emptyHistory({collecting:false,sessions:false}));
  assert.match(f.states.get('resource-empty').title,/아직 저장된/);
  f.window.ResourceCharts.refresh();await f.answer(f.requests.at(-1),{...history(),collecting:false});
  assert.equal(f.states.get('resource-warning').type,'offline');assert.match(f.states.get('resource-warning').title,/연결이 끊겨/);
  assert.equal(f.node('resource-empty').hidden,true);
});

test('a historical point without app information is distinct from a failed snapshot query and offers a recent saved point',async()=>{
  const f=fixture();await f.open();f.window.ResourceCharts.inspectIndex(0,null,true);await f.runTimer();
  await f.answer(f.requests.at(-1),{...history().points[0],processes:null,message:'This historical sample has no process snapshot.'});
  const card=f.states.get('resource-inspector-message');assert.equal(card.type,'empty');assert.match(card.title,/앱별 기록이 없습니다/);
  card.onAction();await f.runTimer();
  const query=new URL(f.requests.at(-1).url,'http://mock');assert.equal(query.pathname,'/api/ops/telemetry-point');assert.equal(query.searchParams.get('at'),String(history().points.at(-1).at));
});

test('snapshot failure provides an inline retry for that exact saved timestamp',async()=>{
  const f=fixture();await f.open();f.window.ResourceCharts.inspectIndex(1,null,true);await f.runTimer();
  await f.answer(f.requests.at(-1),{error:'snapshot unavailable'},false);
  const card=f.states.get('resource-inspector-message');assert.equal(card.type,'error');assert.match(card.actionLabel,/같은 시점/);
  card.onAction();await f.runTimer();assert.equal(new URL(f.requests.at(-1).url,'http://mock').searchParams.get('at'),String(start+5000));
});

test('CSV export starts button feedback immediately and its inline retry uses the same selected query',async()=>{
  const f=fixture();await f.open();f.window.ResourceCharts.setRange('6h');await f.answer(f.requests.at(-1),history(3,'6h'));
  const pending=f.node('resource-export').onclick();assert.equal(f.busy.at(-1).options.button.id,'resource-export');assert.equal(f.node('resource-export').disabled,true);
  await f.answer(f.requests.at(-1),{},false);await pending;
  const card=f.states.get('resource-warning');assert.equal(card.type,'error');assert.match(card.title,/CSV/);
  const retry=card.onAction();assert.equal(new URL(f.requests.at(-1).url,'http://mock').searchParams.get('range'),'6h');
  await f.answer(f.requests.at(-1),{});await retry;assert.equal(f.downloads.length,1);assert.equal(f.states.get('resource-warning').type,'success');
});
