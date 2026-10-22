import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { TextDecoder } from 'node:util';
import { ActionError } from './connections.mjs';
import { quote, remotePath } from './operations-core.mjs';

export const TEXT_LIMIT = 1024 * 1024;
const field = (name, label, extra = {}) => ({ name, label, type: 'text', value: '', required: true, ...extra });
const target = field('path', '선택한 파일·폴더');
export const FILE_EXTRA_ACTIONS = [
  { id: 'file-inspect', group: 'files', title: '파일·폴더 상세 정보', description: '크기·권한·소유자·수정 시각과 연결 경로를 확인합니다.', fields: [target, { name: 'includeUsage', label: '폴더의 실제 디스크 사용량도 계산', type: 'checkbox', value: false }], write: false, support: '읽을 수 있는 경로 · 폴더 합계는 최대 3분 계산' },
  { id: 'file-checksum', group: 'files', title: '파일 체크섬 확인', description: '파일 내용의 SHA-256 또는 MD5 값을 계산하고 기준값과 비교합니다.', fields: [target, { name: 'algorithm', label: '계산 방식', type: 'select', value: 'sha256', options: [{ value: 'sha256', label: 'SHA-256' }, { value: 'md5', label: 'MD5 · 기존 파일 비교용' }] }, field('expectedHash', '비교할 체크섬 (선택)', { required: false })], write: false, support: '일반 파일 최대 2GB · SHA-256/MD5 명령 지원 필요' },
  { id: 'file-text-save', group: 'files', title: '텍스트 편집·저장', description: '1MB 이하 UTF-8 파일을 편집합니다. 읽은 뒤 바뀐 파일은 덮어쓰지 않습니다.', fields: [target, field('originalHash', '처음 읽은 파일의 SHA-256', { type: 'hidden', readOnly: true }), field('text', '파일 내용', { type: 'textarea', required: false })], write: true, support: 'UTF-8 일반 파일 최대 1MB · 폴더 쓰기와 속성 보존 권한 필요' },
];

const regular = kind => /^regular(?: empty)? file$/.test(kind);
const hash = data => createHash('sha256').update(data).digest('hex');
const protectedPath = p => p === '/' || ['/sdcard', '/storage', '/storage/emulated', '/storage/emulated/0', '/data', '/system', '/vendor', '/product'].includes(p) || ['/proc', '/sys', '/dev'].some(root => p === root || p.startsWith(root + '/'));
const kindLabels = { 'regular file': '일반 파일', 'regular empty file': '빈 파일', directory: '폴더', 'symbolic link': '심볼릭 링크', 'character device': '문자 장치', 'block device': '블록 장치', socket: '소켓', 'FIFO (named pipe)': '이름 있는 파이프' };
const iso = seconds => Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : null;

export function parseFileStat(output) {
  const parts = String(output).trim().split('|');
  if (parts.length !== 13 || !parts[0] || !parts.slice(1, 12).every(n => /^-?\d+$/.test(n))) throw new ActionError('파일 상세 정보 응답을 읽지 못했습니다.', 502);
  const [kind, size, mode, uid, gid, inode, links, accessed, modified, changed, blocks, blockSize, context] = parts;
  const numbers = [size, uid, gid, links, accessed, modified, changed, blocks, blockSize].map(Number);
  if (numbers.some(n => !Number.isSafeInteger(n)) || Number(size) < 0 || !/^[0-7]{1,4}$/.test(mode)) throw new ActionError('파일 상세 정보의 숫자 범위를 확인하지 못했습니다.', 502);
  return { kind, size: +size, mode, uid: +uid, gid: +gid, inode, links: +links, accessed: +accessed, modified: +modified, changed: +changed, blocks: +blocks, blockSize: +blockSize, context };
}

export function validateText(value) {
  if (typeof value !== 'string' || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new ActionError('바이너리 제어 문자가 없는 UTF-8 텍스트만 저장할 수 있습니다.');
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length > TEXT_LIMIT) throw new ActionError('텍스트 편집은 UTF-8 기준 1MB까지 지원합니다.', 413);
  // Buffer silently substitutes unmatched UTF-16 surrogates. Do not alter user text that way.
  if (bytes.toString('utf8') !== value) throw new ActionError('올바르지 않은 유니코드 문자가 포함되어 있습니다.');
  return bytes;
}

export function buildTextSaveScript(source, temporary, originalHash, nextHash) {
  const failure = message => `printf '%s\\n' ${quote(message)} >&2; exit 1`;
  return [
    'set -e', `p=${quote(source)}`, `tmp=${quote(temporary)}`,
    `[ -f "$p" ] && [ ! -L "$p" ] || { ${failure('일반 파일이 아니거나 연결 경로로 바뀌었습니다.')}; }`,
    `[ "$(stat -c %h "$p")" = 1 ] || { ${failure('여러 경로가 공유하는 하드 링크 파일은 편집할 수 없습니다.')}; }`,
    `before=$(sha256sum "$p"); before=\${before%% *}; [ "$before" = ${quote(originalHash)} ] || { ${failure('읽은 뒤 파일이 변경되었습니다. 다시 읽고 저장하세요.')}; }`,
    `[ ! -e "$tmp" ] && [ ! -L "$tmp" ] || { ${failure('임시 파일 경로가 이미 사용 중입니다. 다시 시도하세요.')}; }`,
    // The sibling directory is reserved atomically, preventing a pre-existing link from being overwritten.
    'mkdir -m 700 "$tmp"', `trap 'rm -rf -- "$tmp"' EXIT`, `trap 'exit 130' HUP INT TERM`,
    'cp --preserve=all -- "$p" "$tmp/content" 2>"$tmp/copy-error"',
    '[ ! -s "$tmp/copy-error" ] || { cat "$tmp/copy-error" >&2; exit 1; }',
    'original_attrs=$(stat -c \'%a|%u|%g|%C\' "$p")',
    '[ "$(stat -c \'%a|%u|%g|%C\' "$tmp/content")" = "$original_attrs" ] || { ' + failure('원래 파일의 접근 권한·소유자·보안 속성을 유지할 수 없습니다.') + '; }',
    'cat > "$tmp/content"',
    `next=$(sha256sum "$tmp/content"); next=\${next%% *}; [ "$next" = ${quote(nextHash)} ] || { ${failure('전송된 내용이 원본과 다릅니다. 기존 파일은 유지됩니다.')}; }`,
    `[ -f "$p" ] && [ ! -L "$p" ] || { ${failure('저장 직전 파일 종류가 바뀌었습니다.')}; }`,
    `before=$(sha256sum "$p"); before=\${before%% *}; [ "$before" = ${quote(originalHash)} ] || { ${failure('저장 직전 파일이 변경되었습니다. 기존 파일은 유지됩니다.')}; }`,
    '[ "$(stat -c \'%a|%u|%g|%C\' "$p")" = "$original_attrs" ] || { ' + failure('저장 직전 파일 접근 속성이 변경되었습니다.') + '; }',
    'mv -T -- "$tmp/content" "$p"',
    `after=$(sha256sum "$p"); after=\${after%% *}; [ "$after" = ${quote(nextHash)} ] || { ${failure('파일을 교체했지만 최종 내용이 다릅니다. 다시 읽어 확인하세요.')}; }`,
    'printf \'%s\\n\' "$after"',
  ].join('\n');
}

export function createFileExtras(core) {
  async function shell(serial, command, options = {}) {
    const result = await core.run(serial, ['shell', command], options);
    if (result.stderr?.trim()) throw new ActionError(result.stderr.trim().slice(-3000), 409);
    return result.stdout;
  }
  async function describe(serial, target, job) {
    return parseFileStat(await shell(serial, `stat -c ${quote('%F|%s|%a|%u|%g|%i|%h|%X|%Y|%Z|%b|%B|%C')} -- ${quote(target)}`, { job }));
  }
  async function digest(serial, target, algorithm, job) {
    const output = await shell(serial, `${algorithm}sum -- ${quote(target)}`, { job, timeout: 180000, maxBytes: 16384 });
    const value = output.split(/\s+/)[0].toLowerCase();
    if (!(algorithm === 'sha256' ? /^[a-f0-9]{64}$/ : /^[a-f0-9]{32}$/).test(value)) throw new ActionError('체크섬 응답 형식을 확인하지 못했습니다.', 502);
    return value;
  }
  async function saveOutput(job, data, message) {
    const text = JSON.stringify(data, null, 2);
    const directory = job.directory || await core.tempDir(); job.directory = directory;
    job.artifact = path.join(directory, 'file-result.json'); job.downloadName = `${job.kind || 'file'}-result.json`;
    await writeFile(job.artifact, text, 'utf8');
    return { message, output: text };
  }
  async function readText(serial, body, job) {
    const target = remotePath(body.path), info = await describe(serial, target, job);
    if (!regular(info.kind)) throw new ActionError('연결 경로·폴더가 아닌 일반 텍스트 파일을 선택하세요.');
    if (info.size > TEXT_LIMIT) throw new ActionError('텍스트 편집은 1MB 이하 파일만 지원합니다.', 413);
    const before = await digest(serial, target, 'sha256', job);
    const directory = await core.tempDir(), local = path.join(directory, 'text.bin');
    try {
      await core.run(serial, ['exec-out', `cat -- ${quote(target)}`], { job, maxBytes: TEXT_LIMIT, stdoutFile: createWriteStream(local) });
      const bytes = await readFile(local);
      if (bytes.length > TEXT_LIMIT) throw new ActionError('읽는 중 파일 크기가 1MB를 넘었습니다.', 413);
      const actual = hash(bytes), after = await digest(serial, target, 'sha256', job);
      if (before !== actual || actual !== after) throw new ActionError('읽는 중 파일이 변경되었습니다. 다시 읽어 주세요.', 409);
      let text;
      try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { throw new ActionError('UTF-8 텍스트가 아닙니다. 원본 파일을 다운로드해 확인하세요.'); }
      validateText(text);
      return { path: target, text, sha256: actual, bytes: bytes.length };
    } finally { await core.removeOwned(directory); }
  }
  async function run(action, serial, body, job) {
    if (!FILE_EXTRA_ACTIONS.some(a => a.id === action)) throw new ActionError('지원하는 파일 기능을 선택하세요.');
    const target = remotePath(body.path);
    if (action === 'file-inspect') {
      const info = await describe(serial, target, job);
      const result = { 경로: target, 종류: kindLabels[info.kind] || info.kind, '크기 (바이트)': info.size, '할당된 디스크 공간 (바이트)': info.blocks * info.blockSize, '권한 (8진수)': info.mode, '소유 사용자 UID': info.uid, '소유 그룹 GID': info.gid, inode: info.inode, '하드 링크 개수': info.links, '마지막 읽기 시각': iso(info.accessed), '마지막 내용 수정 시각': iso(info.modified), '마지막 파일 속성 변경 시각': iso(info.changed), 'SELinux 보안 문맥': info.context };
      if (info.kind === 'symbolic link') result['연결 대상'] = await shell(serial, `readlink -- ${quote(target)}`, { job });
      if (info.kind === 'directory' && body.includeUsage === true) {
        const output = await shell(serial, `du -skx -- ${quote(target)}`, { job, timeout: 180000 });
        const blocks = /^(\d+)\s/.exec(output)?.[1];
        if (!blocks || !Number.isSafeInteger(Number(blocks) * 1024)) throw new ActionError('폴더 디스크 사용량을 확인하지 못했습니다.');
        result['폴더 합계 디스크 사용량 (바이트)'] = Number(blocks) * 1024;
        result['폴더 합계 범위'] = '같은 파일시스템의 읽을 수 있는 하위 항목. 심볼릭 링크 대상은 따라가지 않음.';
      }
      return saveOutput(job, result, '파일 상세 정보를 읽었습니다. 시각은 UTC 기준입니다.');
    }
    if (action === 'file-checksum') {
      const algorithm = body.algorithm || 'sha256';
      if (!['sha256', 'md5'].includes(algorithm)) throw new ActionError('SHA-256 또는 MD5를 선택하세요.');
      const expected = String(body.expectedHash || '').trim().toLowerCase();
      if (expected && !(algorithm === 'sha256' ? /^[a-f0-9]{64}$/ : /^[a-f0-9]{32}$/).test(expected)) throw new ActionError('비교할 체크섬의 길이와 16진수 형식을 확인하세요.');
      const info = await describe(serial, target, job);
      if (!regular(info.kind) || info.size > 2 * 1024 ** 3) throw new ActionError('체크섬은 2GB 이하 일반 파일만 지원합니다.');
      const value = await digest(serial, target, algorithm, job), after = await describe(serial, target, job);
      if (info.size !== after.size || info.inode !== after.inode || info.modified !== after.modified || info.changed !== after.changed) throw new ActionError('체크섬 계산 중 파일이 변경되었습니다. 다시 계산하세요.', 409);
      return saveOutput(job, { 경로: target, 계산: algorithm === 'sha256' ? 'SHA-256' : 'MD5', 체크섬: value, ...(expected ? { 기준값: expected, 일치: expected === value } : {}) }, expected ? expected === value ? '기준 체크섬과 일치합니다.' : '기준 체크섬과 다릅니다. 파일 내용을 확인하세요.' : '파일 체크섬을 계산했습니다.');
    }
    if (typeof body.deviceId !== 'string' || !body.deviceId || body.confirmDevice !== body.deviceId) throw new ActionError('텍스트를 저장할 기기와 파일을 확인하세요.');
    if (protectedPath(target)) throw new ActionError('이 시스템 경로는 텍스트 편집 대상으로 사용할 수 없습니다.');
    if (!/^[a-f0-9]{64}$/.test(body.originalHash || '')) throw new ActionError('편집할 파일을 먼저 읽어 주세요.');
    const bytes = validateText(body.text), info = await describe(serial, target, job);
    if (!regular(info.kind) || info.size > TEXT_LIMIT || info.links !== 1) throw new ActionError('1MB 이하이며 하드 링크가 없는 일반 파일만 편집할 수 있습니다.');
    const canonical = remotePath(await shell(serial, `readlink -f -- ${quote(target)}`, { job }));
    if (protectedPath(canonical)) throw new ActionError('연결된 실제 대상이 편집할 수 없는 시스템 경로입니다.');
    const current = await digest(serial, target, 'sha256', job);
    if (current !== body.originalHash) throw new ActionError('읽은 뒤 파일이 변경되었습니다. 다시 읽고 편집하세요.', 409);
    const expected = hash(bytes);
    if (expected === current) return { message: '파일 내용이 같아서 저장하지 않았습니다.', output: JSON.stringify({ path: target, sha256: current, bytes: bytes.length }) };
    const directory = job.directory || await core.tempDir(); job.directory = directory;
    const local = path.join(directory, 'edited-text.txt'); await writeFile(local, bytes);
    const temporary = path.posix.join(path.posix.dirname(target), `.adb-desk-edit-${randomUUID()}`);
    const result = await core.run(serial, ['shell', '-T', buildTextSaveScript(target, temporary, current, expected)], { job, timeout: 120000, stdinFile: local, maxBytes: 16384 });
    if (result.stdout.trim() !== expected || result.stderr?.trim()) throw new ActionError((result.stderr || '저장 확인 응답이 다릅니다. 파일을 다시 읽어 확인하세요.').slice(-3000), 409);
    return saveOutput(job, { 경로: target, '저장 전 SHA-256': current, '저장 후 SHA-256': expected, '저장한 바이트': bytes.length }, '파일을 저장하고 SHA-256으로 내용을 확인했습니다.');
  }
  return { run, readText };
}
