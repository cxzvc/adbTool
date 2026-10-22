import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiagnosticExtras, DIAGNOSTIC_EXTRA_ACTIONS } from '../lib/diagnostic-extras.mjs';

const serviceList = 'Currently running services:\n batterystats\n thermalservice\n power\n connectivity\n netstats\n wifi\n bluetooth_manager\n mount\n input\n window\n display\n audio\n sensorservice\n meminfo\n user\n android.hardware.example.IExample/default\n';
function harness(responder) {
  const calls = [];
  const core = { run: async (serial, args, options) => {
    calls.push({ serial, args, options });
    assert.equal(serial, 'mock-device');
    assert.equal(args[0], 'shell');
    assert.ok(options.timeout >= 1000 && options.timeout <= 30000);
    assert.ok(options.maxBytes > 0 && options.maxBytes <= 8 * 1024 * 1024);
    const result = await responder(args[1], options, calls);
    return typeof result === 'string' ? { stdout: result, stderr: '' } : result;
  } };
  return { calls, api: createDiagnosticExtras(core) };
}

test('diagnostic action metadata is unique, Korean, and has bounded selection sources', () => {
  assert.equal(DIAGNOSTIC_EXTRA_ACTIONS.length, 19);
  assert.equal(new Set(DIAGNOSTIC_EXTRA_ACTIONS.map(item => item.id)).size, 19);
  for (const item of DIAGNOSTIC_EXTRA_ACTIONS) {
    assert.equal(item.write, false);
    assert.match(item.title, /[가-힣]/);
    assert.ok(item.description && item.support);
    for (const field of item.fields) assert.equal(field.type, 'select');
  }
});

test('all diagnostic presets check available services and issue only fixed dump arguments', async () => {
  const { api, calls } = harness(command => command === "'dumpsys' '-l'" ? serviceList : 'diagnostic output');
  const job = { cancelled: false };
  for (const item of DIAGNOSTIC_EXTRA_ACTIONS.slice(0, 13)) {
    const result = await api.run(item.id, 'mock-device', { extra: 'reset; reboot', service: 'diskstats' }, job);
    assert.equal(result.output, 'diagnostic output');
    assert.equal(calls.at(-2).args[1], "'dumpsys' '-l'");
    assert.match(calls.at(-1).args[1], /^'dumpsys' '-t' '20' '[\w]+'/);
    assert.equal(calls.at(-1).options.job, job);
  }
  assert.equal(calls.some(call => /diskstats|reset|reboot|unplug|enable|disable/.test(call.args[1])), false);
  assert.ok(calls.some(call => call.args[1] === "'dumpsys' '-t' '20' 'batterystats' '--charged'"));
  assert.ok(calls.some(call => call.args[1] === "'dumpsys' '-t' '20' 'mount'"));
});

test('unsupported or malicious service selections never execute a selected command', async () => {
  const { api, calls } = harness(() => serviceList);
  await assert.rejects(() => api.run('diagnostic-command-help', 'mock-device', { service: 'missing' }, {}), /현재 기기 목록/);
  assert.equal(calls.length, 1);
  for (const service of ['wifi;reboot', '-w', 'wifi\nreboot', 'a b', "wifi'", null]) {
    await assert.rejects(() => api.run('diagnostic-command-help', 'mock-device', { service }, {}));
  }
  assert.equal(calls.length, 1);
  await assert.rejects(() => api.run('diagnostic-tool-help', 'mock-device', { tool: 'reboot' }, {}));
  assert.equal(calls.length, 1);
});

test('dynamic service, user, and process options preserve identities and readable labels', async () => {
  const { api } = harness(command => {
    if (command === "'cmd' '-l'" || command === "'dumpsys' '-l'") return serviceList + ' wifi\n';
    if (command === "'pm' 'list' 'users'") return 'Users:\n UserInfo{0:기본 사용자:13} running\n UserInfo{10:회사: 업무:30}\n';
    if (command.startsWith("'ps' ")) return ' PID PPID USER STAT RSS VSZ NAME\n 42 1 u0_a12 S 1024 5120 com.example.app\n 99 1 root S 16 64 daemon\n';
    assert.fail(command);
  });
  const services = await api.options('mock-device', 'services');
  assert.equal(services.options.filter(item => item.value === 'wifi').length, 1);
  assert.ok(services.options.some(item => item.value === 'android.hardware.example.IExample/default'));
  const users = await api.options('mock-device', 'users');
  assert.deepEqual(users.options, [{ value: '0', label: '기본 사용자 · 사용자 0 · 실행 중' }, { value: '10', label: '회사: 업무 · 사용자 10' }]);
  const processes = await api.options('mock-device', 'processes');
  assert.deepEqual(processes.options.map(item => item.value), ['42', '99']);
  assert.match(processes.options[0].label, /com\.example\.app · PID 42 · u0_a12/);
  await assert.rejects(() => api.options('mock-device', 'arbitrary'), /지원하는/);
});

test('process memory and user state revalidate the current selection before querying', async () => {
  const { api, calls } = harness(command => {
    if (command.startsWith("'ps' ")) return '42 1 u0_a12 S 1024 5120 com.example.app';
    if (command === "'dumpsys' '-l'") return serviceList;
    if (command === "'pm' 'list' 'users'") return 'Users:\n UserInfo{10:업무:30} running';
    return 'state output';
  });
  await api.run('diagnostic-process-memory', 'mock-device', { pid: '42' }, {});
  assert.equal(calls.at(-1).args[1], "'dumpsys' '-t' '20' 'meminfo' '42'");
  await api.run('user-state', 'mock-device', { userId: '10' }, {});
  assert.equal(calls.at(-1).args[1], "'am' 'get-started-user-state' '10'");
  const count = calls.length;
  await assert.rejects(() => api.run('diagnostic-process-memory', 'mock-device', { pid: '500' }, {}), /현재 기기 목록/);
  assert.equal(calls.length, count + 1);
  await assert.rejects(() => api.run('user-state', 'mock-device', { userId: '10;stop' }, {}));
  assert.equal(calls.length, count + 1);
});

test('help accepts legacy nonzero usage results but rejects code-zero service failures', async () => {
  let response = 'Activity manager commands:\n help\n__ADB_DESK_HELP_EXIT__=255';
  const { api, calls } = harness(command => command === "'cmd' '-l'" ? serviceList : response);
  const result = await api.run('diagnostic-command-help', 'mock-device', { service: 'wifi' }, {});
  assert.match(result.output, /^Activity manager commands:/);
  assert.doesNotMatch(result.output, /HELP_EXIT/);
  assert.match(calls.at(-1).args[1], /^'cmd' 'wifi' 'help';/);
  for (const value of [
    "cmd: Can't find service: wifi\n__ADB_DESK_HELP_EXIT__=0",
    'Unknown command: help\n__ADB_DESK_HELP_EXIT__=0',
    'Permission Denial: denied\n__ADB_DESK_HELP_EXIT__=0',
    'Unsupported operation\n__ADB_DESK_HELP_EXIT__=1',
    '__ADB_DESK_HELP_EXIT__=0',
    'Commands:\n help',
  ]) {
    response = value;
    await assert.rejects(() => api.run('diagnostic-command-help', 'mock-device', { service: 'wifi' }, {}));
  }
  response = { stdout: '__ADB_DESK_HELP_EXIT__=0', stderr: 'cmd: Failure calling service wifi: Failed transaction' };
  await assert.rejects(() => api.run('diagnostic-command-help', 'mock-device', { service: 'wifi' }, {}), /Failure calling/);
});

test('service dump timeouts and permission errors are failures, historical error text is retained', async () => {
  let response = "state data\n*** SERVICE 'power' DUMP TIMEOUT (20000ms) EXPIRED ***";
  const { api } = harness(command => command === "'dumpsys' '-l'" ? serviceList : response);
  await assert.rejects(() => api.run('diagnostic-power-detail', 'mock-device', {}, {}), /TIMEOUT/);
  response = { stdout: '', stderr: 'Permission denied' };
  await assert.rejects(() => api.run('diagnostic-power-detail', 'mock-device', {}, {}), /Permission denied/);
  response = '';
  await assert.rejects(() => api.run('diagnostic-power-detail', 'mock-device', {}, {}), /진단 내용을 반환하지/);
  response = 'State:\n historical records:\n Error: old network connection failed';
  assert.equal((await api.run('diagnostic-power-detail', 'mock-device', {}, {})).output, response);
});

test('cancellation stops between service listing and dump and carries job to every request', async () => {
  const job = { cancelled: false };
  const { api, calls } = harness(() => { job.cancelled = true; return serviceList; });
  await assert.rejects(() => api.run('diagnostic-input', 'mock-device', {}, job), /취소/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.job, job);
  await assert.rejects(() => api.options('mock-device', 'services', { job }), /취소/);
  assert.equal(calls.length, 1);
});
