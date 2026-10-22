import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { finished } from 'node:stream/promises';
import vm from 'node:vm';
import { createInputExtras, INPUT_EXTRA_ACTIONS, INPUT_KEY_PRESETS, validateCaptureFile } from '../lib/input-extras.mjs';
import { mirrorOptions, encodeControl } from '../lib/mirror.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
function box(type, payload = Buffer.alloc(0)) { const out = Buffer.alloc(8 + payload.length); out.writeUInt32BE(out.length); out.write(type, 4, 'ascii'); payload.copy(out, 8); return out; }
const mp4 = Buffer.concat([box('ftyp', Buffer.from('isom0000')), box('mdat', Buffer.from('data')), box('moov')]);
async function fixture(t, handler) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'adb-desk-input-test-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const calls = [];
  const core = { tempDir: async () => dir, run: async (serial, args, options = {}) => { calls.push({ serial, args, options }); return handler ? handler(serial, args, options) : { stdout: '', stderr: '' }; } };
  return { ...createInputExtras(core), calls, dir };
}
test('all structured screen actions have Korean descriptions and unique IDs', () => {
  assert.equal(INPUT_EXTRA_ACTIONS.length, 10); assert.equal(new Set(INPUT_EXTRA_ACTIONS.map(a => a.id)).size, 10);
  assert.ok(INPUT_EXTRA_ACTIONS.every(a => a.group === 'display' && a.description.length > 20));
  assert.deepEqual(INPUT_KEY_PRESETS.copy, [278, '복사']);
});
test('ADB keys and gestures do not require a mirror session and quote only bounded arguments', async t => {
  const f = await fixture(t); const job = {};
  await f.run('input-key', 'mock', { key: 'delete', press: 'long', display: 2 }, job);
  assert.deepEqual(f.calls[0].args, ['shell', "'input' '-d' '2' 'keyevent' '--longpress' '112'"]);
  await f.run('input-longpress', 'mock', { x: 100, y: 200, duration: 800 }, job);
  assert.equal(f.calls[1].args[1], "'input' '-d' '0' 'swipe' '100' '200' '100' '200' '800'");
  await f.run('input-swipe', 'mock', { x: 100, y: 200, x2: 300, y2: 400, duration: 600, gesture: 'draganddrop' }, job);
  assert.match(f.calls[2].args[1], /'draganddrop' '100' '200' '300' '400' '600'/);
});
test('invalid and cancelled input is rejected before any device call', async t => {
  const f = await fixture(t);
  for (const body of [{ x: -1, y: 0 }, { x: '', y: 0 }, { x: false, y: 0 }, { x: 2.3, y: 0 }, { x: 10, y: '0; reboot' }]) await assert.rejects(f.run('input-tap', 'mock', body, {}));
  await assert.rejects(f.run('input-key', 'mock', { key: '__proto__' }, {}));
  await assert.rejects(f.run('input-key', 'mock', { key: 'enter' }, { cancelled: true }), /취소/);
  assert.equal(f.calls.length, 0);
});
test('text fallback preserves shell boundaries and refuses unsupported Unicode and literal input escapes', async t => {
  const f = await fixture(t);
  await f.run('input-text', 'mock', { text: "a';reboot # b" }, {});
  assert.equal(f.calls[0].args[1], "'input' '-d' '0' 'text' 'a'\\'';reboot%s#%sb'");
  for (const text of ['한글', 'line\nbreak', 'literal%svalue', '', 'a'.repeat(1025)]) await assert.rejects(f.run('input-text', 'mock', { text }, {}));
  assert.equal(f.calls.length, 1);
});
test('key combinations check support first and send simultaneous ordered keys', async t => {
  const f = await fixture(t, async (_, args) => ({ stdout: args[1].includes('--help') ? 'keycombination <key1> <key2>' : '', stderr: '' }));
  await f.run('input-shortcut', 'mock', { shortcut: 'selectAll' }, {});
  assert.equal(f.calls.length, 2); assert.match(f.calls[1].args[1], /'keycombination' '113' '29'/);
  const unsupported = await fixture(t);
  await assert.rejects(unsupported.run('input-shortcut', 'mock', { shortcut: 'copy' }, {}), /지원하지 않습니다/);
  assert.equal(unsupported.calls.length, 1);
});
test('exit-zero command errors are not reported as successful input', async t => {
  const f = await fixture(t, async () => ({ stdout: '', stderr: 'Security exception: denied' }));
  await assert.rejects(f.run('input-key', 'mock', { key: 'enter' }, {}), /Security exception/);
});
test('native PNG capture writes binary output without creating device files', async t => {
  const f = await fixture(t, async (_, args, options) => { options.stdoutFile.end(png); await finished(options.stdoutFile); return { stdout: '', stderr: '' }; });
  const job = {}; await f.run('screen-native-capture', 'mock', { physicalDisplay: '18446744073709551615' }, job);
  assert.deepEqual(f.calls[0].args, ['exec-out', 'screencap', '-p', '-d', '18446744073709551615']);
  assert.deepEqual(await readFile(job.artifact), png); assert.match(job.downloadName, /\.png$/);
  await assert.rejects(f.run('screen-native-capture', 'mock', { physicalDisplay: '18446744073709551616' }, {}), /64비트/);
});
test('capture validation rejects text errors and unfinished MP4 containers', async t => {
  const f = await fixture(t); const file = path.join(f.dir, 'capture');
  await writeFile(file, 'Error: Permission denied. not a real image'); await assert.rejects(validateCaptureFile(file, 'png'), /PNG/);
  await writeFile(file, mp4); await validateCaptureFile(file, 'mp4');
  await writeFile(file, mp4.subarray(0, mp4.length - 8)); await assert.rejects(validateCaptureFile(file, 'mp4'), /마무리/);
  await writeFile(file, Buffer.concat([mp4, Buffer.from('extra')])); await assert.rejects(validateCaptureFile(file, 'mp4'), /마무리/);
});
test('native recording has finite limits, verified MP4 output and owned cleanup', async t => {
  const f = await fixture(t, async (_, args) => { if (args[0] === 'pull') await writeFile(args[2], mp4); return { stdout: '', stderr: '' }; });
  const job = {}; await f.run('screen-native-record', 'mock', { seconds: 5, bitrate: '4' }, job);
  assert.equal(f.calls.length, 3); assert.match(f.calls[0].args[1], /screenrecord/); assert.match(f.calls[0].args[1], /--time-limit/);
  const remote = f.calls[1].args[1]; assert.match(remote, /^\/data\/local\/tmp\/adb-desk-record-[0-9a-f-]+\.mp4$/);
  assert.match(f.calls[2].args[1], /cmdline/); assert.match(f.calls[2].args[1], /kill -INT/); assert.ok(f.calls[2].args[1].includes(remote));
  assert.equal(f.calls[2].options.job, undefined); assert.deepEqual(await readFile(job.artifact), mp4);
});
test('cancelling native recording still performs bounded cleanup for its unique output path', async t => {
  const job = {};
  const f = await fixture(t, async (_, args, options) => { if (options.job) { job.cancelled = true; throw new Error('cancelled'); } return { stdout: '', stderr: '' }; });
  await assert.rejects(f.run('screen-native-record', 'mock', { seconds: 5, bitrate: '2' }, job), /cancelled/);
  assert.equal(f.calls.length, 2); assert.equal(f.calls[1].options.timeout, 12000); assert.equal(f.calls[1].options.job, undefined);
  assert.match(f.calls[1].args[1], /adb-desk-record-/); assert.equal(job.artifact, undefined);
});
test('invalid recording limits do not allocate or send commands', async t => {
  const f = await fixture(t);
  await assert.rejects(f.run('screen-native-record', 'mock', { seconds: 0, bitrate: '4' }, {}));
  await assert.rejects(f.run('screen-native-record', 'mock', { seconds: 181, bitrate: '4' }, {}));
  await assert.rejects(f.run('screen-native-record', 'mock', { seconds: 5, bitrate: '200' }, {}));
  assert.equal(f.calls.length, 0);
});
test('all display queries failing leaves an error report and fails the job', async t => {
  const f = await fixture(t, async () => { throw new Error('offline'); }); const job = {};
  await assert.rejects(f.run('input-displays', 'mock', {}, job), /조회하지 못했습니다/);
  assert.equal(f.calls.length, 4); assert.match(await readFile(job.artifact, 'utf8'), /조회 실패: offline/);
});
test('screen hierarchy failure cleans only its generated temporary XML', async t => {
  const f = await fixture(t, async (_, args, options) => { if (options.job) return { stdout: '', stderr: 'ERROR: could not get idle state.' }; return { stdout: '', stderr: '' }; });
  await assert.rejects(f.run('screen-ui-tree', 'mock', {}, {}), /idle state/);
  assert.equal(f.calls.length, 2); assert.match(f.calls[1].args[1], /^'rm' '-f' '\/data\/local\/tmp\/adb-desk-ui-[0-9a-f-]+\.xml'$/);
  assert.equal(f.calls[1].options.job, undefined);
});
test('audio requests always enable channel framing while legacy video stays compatible', () => {
  assert.deepEqual(mirrorOptions(new URLSearchParams('audio=1')), { size: 1280, fps: 30, bitrate: 4, audio: true, channels: true, audioOnly:false, audioSource:'playback', audioDup:true, audioCodec:'raw' });
  assert.deepEqual(mirrorOptions(new URLSearchParams('audio=0')), { size: 1280, fps: 30, bitrate: 4 });
  const compressed=mirrorOptions(new URLSearchParams('audio=1&audioCodec=opus&audioBitrate=192&audioEncoder=c2.android.opus.encoder'));assert.equal(compressed.channels,true);assert.equal(compressed.audioCodec,'opus');assert.equal(compressed.audioBitrate,192);assert.equal(compressed.audioEncoder,'c2.android.opus.encoder');
  assert.equal(mirrorOptions(new URLSearchParams('audio=1&audioRequired=1')).requireAudio,true);assert.equal(!!mirrorOptions(new URLSearchParams('audio=1')).requireAudio,false);assert.equal(!!mirrorOptions(new URLSearchParams('audio=0&audioRequired=1')).requireAudio,false);
});
test('remote quick editing keys are present and encoded with matching down/up packets', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  for (const keycode of [112, 122, 123, 92, 93, 278, 277, 279]) {
    assert.ok(html.includes(`data-phone-key="${keycode}"`));
    const packet = encodeControl({ type: 'key', keycode }, {}); assert.equal(packet.readUInt32BE(2), keycode); assert.equal(packet.readUInt32BE(16), keycode); assert.equal(packet[15], 1);
  }
  assert.throws(() => encodeControl({ type: 'key', keycode: 9999 }, {}));
});

async function recordingFixture(Recorder) {
  const source = await readFile(new URL('../public/device.js', import.meta.url), 'utf8');
  const elements = new Map(), notices = [], downloads = [], timers = new Map(); let stopped = 0, timer = 0;
  const track = { stop() { stopped++; } }, stream = { getTracks: () => [track], addTrack() {} };
  const $ = id => { if (!elements.has(id)) elements.set(id, { value: '30', textContent: '', disabled: false, classList: { add() {}, remove() {} }, captureStream: () => stream }); return elements.get(id); };
  const s = { recording: null }, context = { s, $, window: { MediaRecorder: Recorder }, MediaRecorder: Recorder, audioDestination: null, notice: (...args) => notices.push(args), download: (...args) => downloads.push(args), Blob,
    setTimeout: fn => { timers.set(++timer, fn); return timer; }, clearTimeout: id => timers.delete(id) };
  vm.runInNewContext(source.slice(source.indexOf('  function stopRecording()'), source.indexOf('  async function loadInfo()')) + '\nthis.toggle = toggleRecording; this.stop = stopRecording;', context);
  return { context, s, $, notices, downloads, timers, get stopped() { return stopped; } };
}
test('MediaRecorder constructor failure closes capture tracks and restores controls', async () => {
  class Recorder { static isTypeSupported() { return true; } constructor() { throw new Error('constructor rejected'); } }
  const f = await recordingFixture(Recorder); f.context.toggle();
  assert.equal(f.stopped, 1); assert.equal(f.s.recording, null); assert.equal(f.$('stream-audio').disabled, false); assert.match(f.notices.at(-1)[0], /constructor rejected/);
});
test('MediaRecorder start failure closes tracks and does not leave a recording timer', async () => {
  class Recorder { static isTypeSupported() { return true; } start() { throw new Error('encoder unavailable'); } }
  const f = await recordingFixture(Recorder); f.context.toggle();
  assert.equal(f.stopped, 1); assert.equal(f.s.recording, null); assert.equal(f.timers.size, 0);
});
test('MediaRecorder runtime failure saves its received chunk once and releases tracks', async () => {
  class Recorder { static isTypeSupported() { return true; } start() { this.state = 'recording'; } stop() { this.state = 'inactive'; this.onstop(); } }
  const f = await recordingFixture(Recorder); f.context.toggle(); const recorder = f.s.recording;
  recorder.ondataavailable({ data: new Blob(['partial']) }); recorder.onerror({ error: new Error('encoder lost') }); recorder.onstop();
  assert.equal(f.stopped, 1); assert.equal(f.s.recording, null); assert.equal(f.downloads.length, 1); assert.match(f.downloads[0][1], /-partial\.webm$/); assert.equal(f.timers.size, 0);
});
