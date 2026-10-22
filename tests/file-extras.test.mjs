import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { finished } from 'node:stream/promises';
import { createFileExtras, FILE_EXTRA_ACTIONS, parseFileStat, validateText, buildTextSaveScript, TEXT_LIMIT } from '../lib/file-extras.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const statLine = (bytes, extra = {}) => [extra.kind || (bytes.length ? 'regular file' : 'regular empty file'), bytes.length, '644', '2000', '2000', '8711', extra.links || 1, '1720000000', '1720000010', '1720000020', '8', '512', 'u:object_r:shell_data_file:s0'].join('|');
async function fixture(t, bytes = Buffer.from('old\n'), options = {}) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'adb-desk-file-extras-test-'));
  assert.ok(path.dirname(base) === path.resolve(os.tmpdir()));
  t.after(() => rm(base, { recursive: true, force: true }));
  const calls = [], removed = [], created = [];
  let hashReads = 0;
  const core = {
    async tempDir() { const dir = await mkdtemp(path.join(base, 'owned-')); created.push(dir); return dir; },
    async removeOwned(dir) { assert.ok(path.resolve(dir).startsWith(base + path.sep)); removed.push(dir); await rm(dir, { recursive: true, force: true }); },
    async run(serial, args, request = {}) {
      calls.push({ serial, args, request });
      assert.equal(serial, 'mock-device');
      if (request.job?.cancelled) throw new Error('작업을 취소했습니다.');
      if (request.stdoutFile) { request.stdoutFile.end(bytes); await finished(request.stdoutFile); return { stdout: '', stderr: '' }; }
      if (request.stdinFile) { const upload = await readFile(request.stdinFile); return { stdout: options.saveReply || digest(upload), stderr: options.saveError || '' }; }
      const command = args[1];
      if (command.startsWith('stat ')) return { stdout: statLine(bytes, options), stderr: '' };
      if (command.startsWith('sha256sum ')) return { stdout: (options.changeAfterRead && ++hashReads > 1 ? 'b'.repeat(64) : digest(bytes)) + '  /sdcard/file.txt', stderr: '' };
      if (command.startsWith('md5sum ')) return { stdout: createHash('md5').update(bytes).digest('hex') + '  /sdcard/file.txt', stderr: '' };
      if (command.startsWith('du ')) return { stdout: '20\t/sdcard/folder', stderr: '' };
      if (command.startsWith('readlink -f ')) return { stdout: options.canonical || '/storage/emulated/0/file.txt', stderr: '' };
      if (command.startsWith('readlink ')) return { stdout: '/sdcard/real-file', stderr: '' };
      throw new Error('Unexpected mock command: ' + command);
    },
  };
  return { api: createFileExtras(core), calls, removed, created, job: { kind: 'test-file', cancelled: false } };
}

test('file metadata describes ctime as metadata change, and folder disk blocks as bytes', async t => {
  const f = await fixture(t, Buffer.alloc(128), { kind: 'directory' });
  const result = await f.api.run('file-inspect', 'mock-device', { path: '/sdcard/folder', includeUsage: true }, f.job);
  const data = JSON.parse(result.output);
  assert.equal(data['종류'], '폴더'); assert.equal(data['폴더 합계 디스크 사용량 (바이트)'], 20480);
  assert.ok(data['마지막 파일 속성 변경 시각']); assert.equal(data['생성 시각'], undefined);
  assert.equal(data['할당된 디스크 공간 (바이트)'], 4096);
  assert.equal(await readFile(f.job.artifact, 'utf8'), result.output);
});

test('metadata can inspect symbolic links without following them', async t => {
  const f = await fixture(t, Buffer.from('link'), { kind: 'symbolic link' });
  const result = await f.api.run('file-inspect', 'mock-device', { path: '/sdcard/link', includeUsage: true }, f.job);
  assert.equal(JSON.parse(result.output)['연결 대상'], '/sdcard/real-file');
  assert.equal(f.calls.some(c => c.args[1].startsWith('du ')), false);
});

test('text editor preserves BOM, Korean, CRLF and trailing whitespace exactly', async t => {
  const text = '\ufeff  한글\r\n마지막 줄  \r\n\r\n', bytes = Buffer.from(text);
  const f = await fixture(t, bytes), result = await f.api.readText('mock-device', { path: "/sdcard/a' b.txt" });
  assert.deepEqual(result, { path: "/sdcard/a' b.txt", text, sha256: digest(bytes), bytes: bytes.length });
  assert.equal(f.calls.find(c => c.args[0] === 'exec-out').args[1], "cat -- '/sdcard/a'\\'' b.txt'");
  assert.equal(f.created.length, 1); assert.deepEqual(f.removed, f.created);
});

test('empty regular file can be loaded and checksum-compared', async t => {
  const f = await fixture(t, Buffer.alloc(0));
  assert.equal((await f.api.readText('mock-device', { path: '/sdcard/empty' })).text, '');
  const result = await f.api.run('file-checksum', 'mock-device', { path: '/sdcard/empty', algorithm: 'sha256', expectedHash: digest(Buffer.alloc(0)) }, f.job);
  assert.equal(JSON.parse(result.output)['일치'], true);
});

test('text load detects concurrent file changes and cleans local temporary file', async t => {
  const f = await fixture(t, Buffer.from('old'), { changeAfterRead: true });
  await assert.rejects(f.api.readText('mock-device', { path: '/sdcard/old.txt' }), /읽는 중 파일이 변경/);
  assert.deepEqual(f.removed, f.created);
});

test('binary, malformed UTF-8 and oversize text are rejected without conversion', async t => {
  for (const bytes of [Buffer.from([0xc3, 0x28]), Buffer.from('hello\0world'), Buffer.alloc(TEXT_LIMIT + 1, 65)]) {
    const f = await fixture(t, bytes);
    await assert.rejects(f.api.readText('mock-device', { path: '/sdcard/blob' }), /UTF-8|바이너리|1MB/);
    assert.deepEqual(f.removed, f.created);
  }
  assert.throws(() => validateText('\ud800'), /유니코드/);
  assert.throws(() => validateText('가'.repeat(TEXT_LIMIT / 2)), /1MB/);
});

test('save rejects stale hash, protected pseudo-files, links and missing confirmation before writing', async t => {
  const f = await fixture(t);
  const body = { deviceId: 'phone', confirmDevice: 'phone', path: '/sdcard/file.txt', text: 'edited', originalHash: 'a'.repeat(64) };
  await assert.rejects(f.api.run('file-text-save', 'mock-device', body, f.job), /읽은 뒤 파일이 변경/);
  await assert.rejects(f.api.run('file-text-save', 'mock-device', { ...body, path: '/proc/sys/kernel/hostname' }, f.job), /시스템 경로/);
  await assert.rejects(f.api.run('file-text-save', 'mock-device', { ...body, confirmDevice: '' }, f.job), /기기와 파일/);
  const link = await fixture(t, Buffer.from('old'), { kind: 'symbolic link' });
  await assert.rejects(link.api.run('file-text-save', 'mock-device', body, link.job), /일반 파일/);
  const ancestorLink = await fixture(t, Buffer.from('old'), { canonical: '/proc/sys/kernel/hostname' });
  await assert.rejects(ancestorLink.api.run('file-text-save', 'mock-device', body, ancestorLink.job), /실제 대상/);
  assert.equal(f.calls.some(c => c.request.stdinFile), false);
  assert.equal(link.calls.some(c => c.request.stdinFile), false);
});

test('unchanged text never starts a remote write', async t => {
  const bytes = Buffer.from('old\n'), f = await fixture(t, bytes);
  const result = await f.api.run('file-text-save', 'mock-device', { path: '/sdcard/file.txt', deviceId: 'phone', confirmDevice: 'phone', originalHash: digest(bytes), text: bytes.toString() }, f.job);
  assert.match(result.message, /저장하지 않았/); assert.equal(f.calls.some(c => c.request.stdinFile), false);
});

test('save stages exact UTF-8 and uses verified sibling replacement, not direct truncation', async t => {
  const bytes = Buffer.from('old\n'), f = await fixture(t, bytes), text = '새 내용\n\n';
  const result = await f.api.run('file-text-save', 'mock-device', { path: '/sdcard/file.txt', deviceId: 'phone', confirmDevice: 'phone', originalHash: digest(bytes), text }, f.job);
  const write = f.calls.find(c => c.request.stdinFile), script = write.args[2];
  assert.deepEqual(write.args.slice(0, 2), ['shell', '-T']);
  assert.equal(await readFile(write.request.stdinFile, 'utf8'), text);
  assert.match(script, /cp --preserve=all/); assert.match(script, /mkdir -m 700/);
  assert.doesNotMatch(script, /cat > "\$p"/);
  assert.ok(script.indexOf('전송된 내용이 원본과 다릅니다') < script.indexOf('mv -T'));
  assert.ok(script.indexOf('저장 직전 파일이 변경되었습니다') < script.indexOf('mv -T'));
  assert.equal(JSON.parse(result.output)['저장 후 SHA-256'], digest(Buffer.from(text)));
});

test('checksum validates algorithm and expected checksum before any device request', async t => {
  const f = await fixture(t);
  await assert.rejects(f.api.run('file-checksum', 'mock-device', { path: '/sdcard/file', algorithm: 'sha256; id' }, f.job), /SHA-256 또는 MD5/);
  await assert.rejects(f.api.run('file-checksum', 'mock-device', { path: '/sdcard/file', expectedHash: '12' }, f.job), /체크섬/);
  assert.equal(f.calls.length, 0);
});

test('file action IDs are unique, malformed stat rejected, and zero permission mode is valid', () => {
  assert.equal(new Set(FILE_EXTRA_ACTIONS.map(a => a.id)).size, FILE_EXTRA_ACTIONS.length);
  assert.throws(() => parseFileStat('regular file|10'), /상세 정보/);
  assert.equal(parseFileStat(statLine(Buffer.alloc(0)).replace('|644|', '|0|')).mode, '0');
  const script = buildTextSaveScript("/sdcard/a'; id; '", '/sdcard/.adb-test', 'a'.repeat(64), 'b'.repeat(64));
  assert.ok(script.startsWith("set -e\np='/sdcard/a'\\''; id; '\\'''"));
});
