import test from 'node:test';
import assert from 'node:assert/strict';
import { createShizukuManagement, SHIZUKU_MANAGEMENT_ACTIONS, parseShizukuProcesses, parseShizukuIdentity, shizukuStopGuard, shizukuRecoveryGuide } from '../lib/shizuku-management.mjs';
import { EXTRA_ACTIONS, createWorkbenchExtensions } from '../lib/workbench-extensions.mjs';

const PACKAGE = 'moe.shizuku.privileged.api', SERIAL = 'mock', body = { deviceId: 'mock', confirmDevice: 'mock' };
function stat(pid = 123, start = '123456', status = 'S') { const fields = Array(20).fill('0'); fields[0] = status; fields[19] = start; return `${pid} (shizuku_server) ${fields.join(' ')}`; }
function fixture(overrides = {}) {
  const state = { uid: '2000', user: '0', installed: true, pid: 123, processUid: '2000', start: '123456', cmdline: 'shizuku_server\0', readable: true, calls: [], signals: [], baseCalls: [], ...overrides };
  const core = { async run(serial, args, options) {
    assert.equal(serial, SERIAL); assert.equal(args[0], 'shell'); state.calls.push({ command: args[1], options });
    const custom = state.override?.(args[1], state); if (custom !== undefined) return typeof custom === 'string' ? { stdout: custom, stderr: '' } : custom;
    const cmd = args[1]; let output;
    if (cmd === "'id' '-u'") output = state.uid;
    else if (cmd === "'am' 'get-current-user'") output = state.user;
    else if (cmd.startsWith("'pm' 'list' 'packages'")) output = state.installed ? `package:${PACKAGE}` : '';
    else if (cmd === "'ps' '-A' '-o' 'PID,UID,NAME'") output = 'PID UID NAME\n1 0 init\n100 10123 moe.shizuku.privileged.api\n101 2000 shizuku_server_fake' + (state.pid ? `\n${state.pid} ${state.processUid} shizuku_server` : '') + (state.extraServer ? '\n456 2000 shizuku_server' : '');
    else if (cmd.startsWith("'cat'") && cmd.includes('/status')) output = `Name:\tshizuku_server\nUid:\t${state.processUid}\t${state.processUid}\t${state.processUid}\t${state.processUid}\n`;
    else if (cmd.startsWith("'cat'") && cmd.includes('/stat')) output = stat(state.pid, state.start);
    else if (cmd.startsWith("'cat'") && cmd.includes('/cmdline')) output = state.cmdline;
    else if (cmd.startsWith("'test' '-r'")) { if (!state.readable) throw new Error('Permission denied'); output = ''; }
    else if (cmd.startsWith('set -f;')) { state.signals.push(cmd); if (state.guardError) throw new Error('ADB exit code 76'); const oldPid = state.pid; if (!state.stayRunning) state.pid = null; output = `SHIZUKU_STOP_REQUESTED ${oldPid} ${state.start}`; }
    else throw new Error('Unexpected mock request: ' + cmd);
    return { stdout: output, stderr: '' };
  }, resolve: async () => ({ serial: SERIAL }) };
  const base = { async run(id, serial, request, job) {
    state.baseCalls.push({ id, serial, body: request, job });
    if (state.baseFailure) throw new Error(state.baseFailure);
    if (id === 'shizuku-start') { state.pid = 789; state.start = '789012'; }
    return { message: '모의 Shizuku 응답', output: '설치/프로세스 정보 (Binder 미검증)' };
  } };
  return { state, core, base, api: createShizukuManagement(core, { base }) };
}

test('management adds only explicit stop/restart, with no manager Binder or grant API', () => {
  assert.deepEqual(SHIZUKU_MANAGEMENT_ACTIONS.map(item => [item.id, item.write]), [['shizuku-stop', true], ['shizuku-restart', true]]);
  for (const action of SHIZUKU_MANAGEMENT_ACTIONS) assert.equal(EXTRA_ACTIONS.filter(row => row.id === action.id).length, 1);
  const { core } = fixture(), extensions = createWorkbenchExtensions(core, { readDevices: async () => ({ devices: [] }), history: new Map() });
  assert.equal(extensions.has('shizuku-stop'), true); assert.equal(extensions.has('shizuku-restart'), true);
});
test('only exact Shizuku process name qualifies and every UID field and PID must match', () => {
  const rows = parseShizukuProcesses('PID UID NAME\n123 2000 shizuku_server\n124 2000 shizuku_server_fake\n125 10123 moe.shizuku.privileged.api'); assert.equal(rows.length, 1);
  const good = parseShizukuIdentity(rows[0], 'Uid:\t2000 2000 2000 2000\n', stat(), 'shizuku_server\0'); assert.equal(good.startTime, '123456');
  for (const [status, proc, cmd] of [['Uid: 2000 0 2000 2000', stat(), 'shizuku_server'], ['Uid: 2000 2000 2000 2000', stat(124), 'shizuku_server'], ['Uid: 2000 2000 2000 2000', stat(), 'moe.shizuku.privileged.api'], ['Uid: 2000 2000 2000 2000', stat(123, '123456', 'Z'), 'shizuku_server']]) assert.throws(() => parseShizukuIdentity(rows[0], status, proc, cmd));
});
test('stop guard repeats numeric PID, all UID values, command name and start-time checks before SIGKILL', () => {
  const guard = shizukuStopGuard({ pid: 123, uid: '2000', name: 'shizuku_server', startTime: '123456' });
  assert.match(guard, /\[ "\$\{20\}" = 123456 \]/); assert.match(guard, /kill -9 "\$p"/); assert.match(guard, /Uid:/); assert.match(guard, /shizuku_server/);
  assert.ok(guard.indexOf('kill -9') > guard.indexOf('${20}')); assert.doesNotMatch(guard, /force-stop|pkill|killall/);
  assert.match(guard, /\[ "\$\(am get-current-user\)" = "0" \]/); assert.ok(guard.indexOf('am get-current-user') < guard.indexOf('kill -9'));
  for (const value of ['1', '123; reboot', 1, -1]) assert.throws(() => shizukuStopGuard({ pid: value, uid: '2000', name: 'shizuku_server', startTime: '123456' }));
});
test('confirmation is required before reads or writes, and cancelled jobs make no request', async () => {
  const f = fixture();
  await assert.rejects(f.api.run('shizuku-stop', SERIAL, { deviceId: 'mock' }), /확인/);
  await assert.rejects(f.api.run('shizuku-restart', SERIAL, body, { cancelled: true }), /취소/); assert.equal(f.state.calls.length, 0);
});
test('stop signals the verified server and confirms disappearance without stopping the manager app', async () => {
  const f = fixture(), result = await f.api.run('shizuku-stop', SERIAL, body, {});
  assert.equal(f.state.signals.length, 1); assert.equal(f.state.pid, null); assert.match(result.message, /종료를 확인/);
  assert.ok(f.state.calls.filter(call => call.command.includes('/stat')).length >= 4);
  assert.ok(f.state.calls.every(call => !/force-stop|killall|pkill|appops|grant/.test(call.command)));
});
test('no running server is an explicit no-op rather than a kill', async () => {
  const f = fixture({ pid: null }), result = await f.api.run('shizuku-stop', SERIAL, body, {});
  assert.equal(f.state.signals.length, 0); assert.match(result.message, /종료 명령을 보내지/); assert.match(result.output, /재부팅/);
});
test('root, other UID, non-owner user, multiple servers, and mismatched cmdline cannot be stopped', async () => {
  for (const overrides of [{ uid: '0' }, { processUid: '0' }, { processUid: '10123' }, { user: '10' }, { extraServer: true }, { cmdline: 'arbitrary_process\0' }]) {
    const f = fixture(overrides); await assert.rejects(f.api.run('shizuku-stop', SERIAL, body, {})); assert.equal(f.state.signals.length, 0);
  }
});
test('PID reuse or failed in-shell identity guard never triggers a second kill or start', async () => {
  let reads = 0; const f = fixture({ override: cmd => cmd === "'cat' '/proc/123/stat'" ? stat(123, ++reads === 1 ? '123456' : '999999') : undefined });
  await assert.rejects(f.api.run('shizuku-restart', SERIAL, body, {}), /PID가 다른/); assert.equal(f.state.signals.length, 0); assert.equal(f.state.baseCalls.length, 0);
  const guard = fixture({ guardError: true }); await assert.rejects(guard.api.run('shizuku-restart', SERIAL, body, {}), /재확인 또는 종료 요청/); assert.equal(guard.state.signals.length, 1); assert.equal(guard.state.baseCalls.length, 0);
});
test('restart checks installed manager and readable official script before stopping an existing server', async () => {
  for (const overrides of [{ installed: false }, { readable: false }]) {
    const f = fixture(overrides); await assert.rejects(f.api.run('shizuku-restart', SERIAL, body, {}), /설치|스크립트/); assert.equal(f.state.signals.length, 0); assert.equal(f.state.pid, 123);
  }
});
test('restart stops the verified old instance, invokes official start, and verifies a new identity', async () => {
  const f = fixture(), result = await f.api.run('shizuku-restart', SERIAL, body, {});
  assert.equal(f.state.signals.length, 1); assert.equal(f.state.baseCalls.length, 1); assert.equal(f.state.baseCalls[0].id, 'shizuku-start'); assert.equal(f.state.pid, 789);
  assert.match(result.output, /"pid": 789/); assert.match(result.output, /"binderVerified": false/); assert.match(result.message, /새 Shizuku 서버/);
});
test('restart when stopped can start, and failure after stop clearly says recovery requires starting again', async () => {
  const empty = fixture({ pid: null }); await empty.api.run('shizuku-restart', SERIAL, body, {}); assert.equal(empty.state.signals.length, 0); assert.equal(empty.state.baseCalls[0].id, 'shizuku-start');
  const failed = fixture({ baseFailure: 'Permission denied' }); await assert.rejects(failed.api.run('shizuku-restart', SERIAL, body, {}), /기존 서버 종료 후[\s\S]*서버 미실행/); assert.equal(failed.state.pid, null); assert.equal(failed.state.signals.length, 1);
});
test('status supplies validated process details and recovery advice without any mutation', async () => {
  const f = fixture(), result = await f.api.run('shizuku-status', SERIAL, {}, {});
  assert.match(result.output, /검증한 서버: PID 123/); assert.match(result.output, /시작 틱 123456/); assert.match(result.output, /Binder 상태 검증은 아닙니다/); assert.equal(f.state.signals.length, 0);
  const missing = fixture({ installed: false, pid: null }); const absent = await missing.api.run('shizuku-status', SERIAL, {}, {}); assert.match(absent.output, /미설치/); assert.match(absent.output, /재부팅.*종료/);
});
test('recovery instructions distinguish missing app, reboot, privileges and script problems without changing policy', () => {
  const guide = shizukuRecoveryGuide({ installed: false, running: false, uid: '0', currentUser: '10', error: 'start.sh Permission denied SELinux' });
  for (const word of ['미설치', '재부팅', 'UID 0', '업무 프로필', '권한 실패', '시작 파일', 'Binder']) assert.ok(guide.includes(word));
  assert.match(guide, /원인이 재부팅이라고 단정하지는/); assert.match(guide, /제한을 임의로 해제하거나 우회하지/);
});
test('an unexpected replacement server is never killed as a retry', async () => {
  const f = fixture({ override: (cmd, state) => cmd === "'ps' '-A' '-o' 'PID,UID,NAME'" && state.signals.length ? 'PID UID NAME\n789 2000 shizuku_server' : undefined });
  await assert.rejects(f.api.run('shizuku-restart', SERIAL, body, {}), /다른 Shizuku 서버/); assert.equal(f.state.signals.length, 1); assert.equal(f.state.baseCalls.length, 0);
});
test('a surviving server is not a successful stop and does not trigger repeated signals', async () => {
  const f = fixture({ stayRunning: true }); await assert.rejects(f.api.run('shizuku-stop', SERIAL, body, {}), /남아 있습니다/); assert.equal(f.state.signals.length, 1);
});
test('exit-zero permission errors and unreadable process formats include recovery guidance without mutation', async () => {
  const denied = fixture({ override: cmd => cmd === "'id' '-u'" ? { stdout: '', stderr: 'Permission denied' } : undefined });
  await assert.rejects(denied.api.run('shizuku-stop', SERIAL, body, {}), /권한 실패/); assert.equal(denied.state.signals.length, 0);
  const format = fixture({ override: cmd => cmd === "'ps' '-A' '-o' 'PID,UID,NAME'" ? 'USER PID NAME\nshell 123 shizuku_server' : undefined });
  await assert.rejects(format.api.run('shizuku-stop', SERIAL, body, {}), /목록 형식/); assert.equal(format.state.signals.length, 0);
});
