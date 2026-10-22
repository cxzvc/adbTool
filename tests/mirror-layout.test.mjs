import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../public/mirror-layout.js', import.meta.url), 'utf8');

function fixture() {
  const events = [], externalCalls = [];
  const controls = new Map(['ms-control-only', 'media-audio-only', 'stream-audio', 'mirror-connection-mode-note'].map(id => [id, {
    checked: false, textContent: '',
    dispatchEvent(event) { events.push({ id, type: event.type }); this.onchange?.(); }
  }]));
  const control = controls.get('ms-control-only'), audio = controls.get('media-audio-only'), stream = controls.get('stream-audio');
  // Existing option handlers only change the local checkbox state.
  control.onchange = () => { if (control.checked) { audio.checked = false; stream.checked = false; } };
  audio.onchange = () => { if (audio.checked) stream.checked = true; };
  const window = {}, panel = { dataset: {} }, field = { value: '' };
  const body = source.replace('window.MirrorLayout = {', 'window.setLayoutFixture = (p, m) => { panel = p; modeField = m; }; window.MirrorLayout = {');
  assert.notEqual(body, source, 'fixture must attach inside the module scope');
  vm.runInNewContext(body, {
    window,
    document: { getElementById: id => controls.get(id) },
    Event: class Event { constructor(type) { this.type = type; } },
    fetch(...args) { externalCalls.push(['fetch', ...args]); throw new Error('Phone APIs must not be called'); },
    WebSocket: class WebSocket { constructor(...args) { externalCalls.push(['WebSocket', ...args]); throw new Error('Connections must remain explicit'); } }
  });
  window.setLayoutFixture(panel, field);
  return { api: window.MirrorLayout, controls, control, audio, stream, panel, field, events, externalCalls };
}

test('audio-only mode selects audio without the control-only mode', () => {
  const { api, control, audio, stream, panel, field } = fixture();
  assert.equal(api.setMode('audio'), true);
  assert.equal(audio.checked, true);
  assert.equal(control.checked, false);
  assert.equal(stream.checked, true);
  assert.equal(field.value, 'audio');
  assert.equal(panel.dataset.connectionMode, 'audio');
});

test('control-only mode clears audio-only and audio transmission together', () => {
  const { api, control, audio, stream, field } = fixture();
  api.setMode('audio');
  assert.equal(api.setMode('control'), true);
  assert.equal(control.checked, true);
  assert.equal(audio.checked, false);
  assert.equal(stream.checked, false);
  assert.equal(field.value, 'control');
});

test('video mode releases both exclusive-only choices', () => {
  const { api, control, audio, field } = fixture();
  api.setMode('control');
  assert.equal(api.setMode('video'), true);
  assert.equal(control.checked, false);
  assert.equal(audio.checked, false);
  assert.equal(field.value, 'video');
});

test('an unknown connection mode leaves the current selection untouched', () => {
  const { api, audio, control, field, events } = fixture();
  api.setMode('audio');
  const eventCount = events.length;
  assert.equal(api.setMode('invalid'), false);
  assert.equal(audio.checked, true);
  assert.equal(control.checked, false);
  assert.equal(field.value, 'audio');
  assert.equal(events.length, eventCount);
});

test('refresh reflects external preference resets without applying the connection', () => {
  const { api, control, audio, field, panel, events } = fixture();
  api.setMode('control');
  control.checked = false;
  audio.checked = false;
  const eventCount = events.length;
  assert.equal(api.refreshMode(), 'video');
  assert.equal(field.value, 'video');
  assert.equal(panel.dataset.connectionMode, 'video');
  assert.equal(events.length, eventCount, 'refresh must not dispatch apply or option changes');
  control.checked = true;
  audio.checked = true;
  assert.equal(api.refreshMode(), 'control', 'control-only takes precedence if older input state conflicts');
});

test('changing modes only dispatches local option events and never opens a connection', () => {
  const { api, events, externalCalls } = fixture();
  for (const mode of ['audio', 'control', 'video']) api.setMode(mode);
  assert.deepEqual(events.map(event => `${event.id}:${event.type}`), [
    'ms-control-only:change', 'media-audio-only:change',
    'ms-control-only:change', 'media-audio-only:change',
    'ms-control-only:change', 'media-audio-only:change'
  ]);
  assert.deepEqual(externalCalls, []);
  assert.doesNotMatch(source, /fetch\s*\(|new\s+WebSocket|\.click\s*\(/);
});
