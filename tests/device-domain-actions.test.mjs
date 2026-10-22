import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeviceDomainActions, DEVICE_DOMAIN_ACTIONS, parseNotificationOptions, parseSchedulerJobs } from '../lib/device-domain-actions.mjs';
import { createWorkbenchExtensions, EXTRA_ACTIONS } from '../lib/workbench-extensions.mjs';

function unquoteShell(command) {
  const tokens = []; let token = '', quoted = false;
  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (char === "'") { quoted = !quoted; continue; }
    if (char === '\\' && !quoted) { token += command[++i]; continue; }
    if (/\s/.test(char) && !quoted) { if (token) { tokens.push(token); token = ''; } }
    else token += char;
  }
  if (token) tokens.push(token); return tokens;
}
const A = 'com.example.keyboard/.Ime', B = 'com.second.keyboard/.Ime';
const KEY = "0|com.example.app|12|private 'conversation' tag|10123";
const JOB_DUMP = `Registered 2 jobs:
  JOB #u0a123/7: aabbcc source:com.example.client
    Source: uid=u0a124 user=0 pkg=com.example.client
    JobInfo:
      Service: com.example.owner/.Scheduler
    Required constraints: CONNECTIVITY
    Unsatisfied constraints: CONNECTIVITY
    Ready: false (job=false user=true !pending=true !active=true)
  JOB sync:u10a123/9: aabbcd com.work.app/.Scheduler
    Source: uid=u10a123 user=10 pkg=com.work.app
    JobInfo:
      Service: com.work.app/.Scheduler
    Required constraints: CHARGING
    Unsatisfied constraints: CHARGING
    Ready: false (job=false user=true !pending=true !active=true)
BatteryController:
  history`;
function mock(overrides = {}) {
  const state = { current: '0', methods: [A, B], enabled: [A], selected: A, active: [KEY], snoozed: [], zen: '0', jobsDump: JOB_DUMP, writes: [], calls: [], ...overrides };
  const core = { async run(serial, args, options) {
    const parts = unquoteShell(args[1]); state.calls.push({ serial, parts, options, serialized: args[1] });
    const custom = state.override?.(parts, state); if (custom !== undefined) return typeof custom === 'string' ? { stdout: custom, stderr: '' } : custom;
    let output = '';
    if (parts.join(' ') === 'am get-current-user') output = state.current;
    else if (parts.join(' ') === 'pm list users') output = 'Users:\n  UserInfo{0:Owner:13} running\n  UserInfo{10:Work:30} running';
    else if (parts[0] === 'ime' && parts[1] === 'list') output = state.methods.join('\n');
    else if (parts[0] === 'settings' && parts.at(-1) === 'enabled_input_methods') output = state.enabled.join(':');
    else if (parts[0] === 'settings' && parts.at(-1) === 'default_input_method') output = state.selected || 'null';
    else if (parts[0] === 'ime') {
      state.writes.push(parts); const ime = parts.at(-1);
      if (!state.ignoreWrite) { if (parts[1] === 'enable' && !state.enabled.includes(ime)) state.enabled.push(ime); if (parts[1] === 'disable') state.enabled = state.enabled.filter(value => value !== ime); if (parts[1] === 'set') state.selected = ime; }
      output = 'Input method updated';
    } else if (parts.join(' ') === 'cmd notification help') output = 'Notification manager commands:\n  set_dnd [on|none|priority|alarms|all|off]\n  list\n  snooze --for <msec> <notification-key>\n  unsnooze <notification-key>';
    else if (parts.join(' ') === 'cmd notification list') output = state.active.join('\n');
    else if (parts.join(' ') === 'cmd notification snoozed') output = state.snoozed.map(key => `${key} snoozed, time=123456 context=PRIVATE_CONTEXT`).join('\n');
    else if (parts.slice(0, 3).join(' ') === 'cmd notification snooze') { state.writes.push(parts); const key = parts.at(-1); state.active = state.active.filter(value => value !== key); state.snoozed.push(key); output = `snoozing <${key}> until time: tomorrow`; }
    else if (parts.slice(0, 3).join(' ') === 'cmd notification unsnooze') { state.writes.push(parts); const key = parts.at(-1); state.snoozed = state.snoozed.filter(value => value !== key); state.active.push(key); output = `unsnoozing: ${key}`; }
    else if (parts.slice(0, 3).join(' ') === 'cmd notification set_dnd') { state.writes.push(parts); if (!state.ignoreWrite) state.zen = ({ off: '0', priority: '1', none: '2', alarms: '3' })[parts[3]]; }
    else if (parts.join(' ') === 'settings get global zen_mode') output = state.zen;
    else if (parts.join(' ') === 'svc power') output = 'usage: svc power stayon...\n  svc power shutdown\n  svc power reboot';
    else if (parts.join(' ') === 'svc power shutdown') state.writes.push(parts);
    else if (parts.join(' ') === 'dumpsys -t 8 jobscheduler') output = state.jobsDump;
    else if (parts.join(' ') === 'cmd jobscheduler help') output = 'Job scheduler commands:\n  run [-f | --force] [-s | --satisfied] [-u | --user USER_ID] [-n | --namespace NAMESPACE] PACKAGE JOB_ID\n  cancel [-u | --user USER_ID] [-n | --namespace NAMESPACE] PACKAGE [JOB_ID]';
    else if (parts.slice(0, 3).join(' ') === 'cmd jobscheduler run') { state.writes.push(parts); output = 'Running job' + (parts.includes('--force') ? ' [FORCED]' : ''); }
    else if (parts.slice(0, 3).join(' ') === 'cmd jobscheduler cancel') { state.writes.push(parts); state.jobsDump = 'Registered 0 jobs:\n  None.\nBatteryController:'; output = 'Canceling job'; }
    else throw new Error(`Unexpected mock command: ${parts.join(' ')}`);
    return { stdout: output, stderr: '' };
  } };
  core.resolve = async () => ({ serial: 'mock' });
  return { state, core, service: createDeviceDomainActions(core) };
}
const confirm = { deviceId: 'mock', confirmDevice: 'mock' };

test('all six actions explicitly require a confirmation and device mutation flag', () => {
  assert.equal(DEVICE_DOMAIN_ACTIONS.length, 6); assert.ok(DEVICE_DOMAIN_ACTIONS.every(action => action.write));
  assert.equal(DEVICE_DOMAIN_ACTIONS.find(action => action.id === 'device-ime-manage').fields.find(field => field.name === 'imeId').choices, 'device-ime');
});
test('initialization and rejected confirmation never run a device request', async () => {
  const { service, state } = mock(); assert.equal(state.calls.length, 0);
  await assert.rejects(service.run('device-shutdown', 'mock', { deviceId: 'mock' }, {}), /확인/); assert.equal(state.calls.length, 0);
});
test('IME selection is populated from the selected user and filtered to valid action targets', async () => {
  const { service, state } = mock();
  const enabled = await service.options('mock', 'device-ime', { user: '10', mode: 'enable' });
  assert.deepEqual(enabled.options.map(row => row.value), [B]); assert.equal(enabled.user, '10'); assert.equal(state.writes.length, 0);
  assert.ok(state.calls.filter(call => call.parts[0] === 'ime').every(call => call.parts.includes('10')));
  const defaults = await service.options('mock', 'device-ime', { mode: 'set' }); assert.deepEqual(defaults.options.map(row => row.value), [A]);
  const disabling = await service.options('mock', 'device-ime', { mode: 'disable' }); assert.equal(disabling.options.length, 0);
});
test('IME enable, select, and disable use fresh membership and verify settings after each change', async () => {
  const { service, state } = mock();
  await service.run('device-ime-manage', 'mock', { ...confirm, user: '10', mode: 'enable', imeId: B }, {}); assert.ok(state.enabled.includes(B));
  await service.run('device-ime-manage', 'mock', { ...confirm, user: '10', mode: 'set', imeId: B }, {}); assert.equal(state.selected, B);
  const result = await service.run('device-ime-manage', 'mock', { ...confirm, user: '10', mode: 'disable', imeId: A }, {});
  assert.deepEqual(state.enabled, [B]); assert.equal(JSON.parse(result.output).verified, true);
  assert.ok(state.writes.every(parts => parts[2] === '--user' && parts[3] === '10'));
});
test('IME default, last usable input method, absent method and unknown user are protected without writes', async () => {
  for (const { body, overrides } of [
    { body: { mode: 'disable', imeId: A }, overrides: {} },
    { body: { mode: 'disable', imeId: A }, overrides: { selected: B, enabled: [A, 'com.removed.keyboard/.IME'] } },
    { body: { mode: 'disable', imeId: B }, overrides: { selected: null, enabled: [A, B] } },
    { body: { mode: 'set', imeId: B }, overrides: {} },
    { body: { mode: 'enable', imeId: 'com.missing.keyboard/.Ime' }, overrides: {} },
    { body: { mode: 'enable', imeId: B, user: '99' }, overrides: {} },
    { body: { mode: 'enable', imeId: B, user: 'all' }, overrides: {} },
  ]) {
    const { service, state } = mock(overrides); await assert.rejects(service.run('device-ime-manage', 'mock', { ...confirm, ...body }, {})); assert.equal(state.writes.length, 0);
  }
});
test('IME command success without actual settings change is reported as unverified failure', async () => {
  const { service } = mock({ ignoreWrite: true });
  await assert.rejects(service.run('device-ime-manage', 'mock', { ...confirm, mode: 'enable', imeId: B }, {}), /확인하지 못했습니다/);
});
test('notification choices expose opaque values and metadata labels without private tags or contexts', async () => {
  const { service, state } = mock({ active: [KEY, '10|com.work.app|99|private-work|1010123'] });
  const result = await service.options('mock', 'notification-key', { action: 'notification-snooze' });
  assert.equal(result.options.length, 1); assert.match(result.options[0].value, /^[a-f\d]{64}$/); assert.match(result.options[0].label, /com.example.app/);
  assert.doesNotMatch(JSON.stringify(result), /private|conversation|10123/); assert.equal(state.writes.length, 0);
});
test('notification snooze and unsnooze verify authoritative snoozed membership and safely quote the exact key', async () => {
  const { service, state } = mock(); const token = (await service.options('mock', 'notification-key', { action: 'notification-snooze' })).options[0].value;
  const hidden = await service.run('notification-snooze', 'mock', { ...confirm, notificationKey: token, minutes: '15' }, {});
  assert.equal(state.writes[0].at(-1), KEY); assert.equal(state.writes[0][4], '900000'); assert.equal(JSON.parse(hidden.output).snoozed, true);
  const list = await service.options('mock', 'notification-key', { action: 'notification-unsnooze' }); assert.equal(list.options[0].value, token);
  const restored = await service.run('notification-unsnooze', 'mock', { ...confirm, notificationKey: token }, {});
  assert.equal(JSON.parse(restored.output).snoozed, false); assert.deepEqual(state.snoozed, []);
  assert.doesNotMatch(hidden.output + restored.output, /private|conversation|PRIVATE_CONTEXT/);
  assert.ok(state.calls.some(call => call.serialized.includes("'\\''")));
});
test('notification targets must still exist and duration must be one of the bounded options', async () => {
  const { service, state } = mock(); const token = (await service.options('mock', 'notification-key', { action: 'notification-snooze' })).options[0].value;
  await assert.rejects(service.run('notification-snooze', 'mock', { ...confirm, notificationKey: token, minutes: 99999 }, {}));
  state.active = []; await assert.rejects(service.run('notification-snooze', 'mock', { ...confirm, notificationKey: token, minutes: '5' }, {}), /목록에 없습니다/);
  assert.equal(state.writes.length, 0);
});
test('snooze verification command must be supported before any notification is changed', async () => {
  const { service, state } = mock({ override: parts => parts.join(' ') === 'cmd notification snoozed' ? 'Unknown command: snoozed' : undefined });
  const token = (await service.options('mock', 'notification-key', { action: 'notification-snooze' })).options[0].value;
  await assert.rejects(service.run('notification-snooze', 'mock', { ...confirm, notificationKey: token, minutes: '5' }, {}));
  assert.equal(state.writes.length, 0);
});
test('malformed notification lists and unknown command responses cannot be treated as successful empty lists', async () => {
  assert.throws(() => parseNotificationOptions('Unknown command: list'));
  assert.throws(() => parseNotificationOptions('0|com.example.app|1|tag', {}));
  const { service } = mock({ override: parts => parts.join(' ') === 'cmd notification list' ? { stdout: 'Unknown command: list', stderr: '' } : undefined });
  await assert.rejects(service.options('mock', 'notification-key', { action: 'notification-snooze' }), /지원하지 않거나/);
});
test('changing user during notification verification is not mistaken for a successful unsnooze', async () => {
  const { service, state } = mock({ snoozed: [KEY], active: [] }); const token = (await service.options('mock', 'notification-key', { action: 'notification-unsnooze' })).options[0].value;
  state.override = parts => { if (parts.slice(0, 3).join(' ') === 'cmd notification unsnooze') { state.current = '10'; state.writes.push(parts); return 'unsnoozing'; } };
  await assert.rejects(service.run('notification-unsnooze', 'mock', { ...confirm, notificationKey: token }, {}), /사용자가 바뀌어/);
});
test('DND maps the shell filters to Android zen modes and verifies the applied value', async () => {
  for (const [mode, expected] of [['off', '0'], ['priority', '1'], ['none', '2'], ['alarms', '3']]) {
    const { service, state } = mock(); const result = await service.run('notification-dnd', 'mock', { ...confirm, mode }, {});
    assert.equal(state.zen, expected); assert.equal(JSON.parse(result.output).verified, true);
  }
});
test('unsupported DND help and exit-zero failure output prevent false success', async () => {
  const { service, state } = mock({ override: parts => parts.join(' ') === 'cmd notification help' ? 'Available commands: list' : undefined });
  await assert.rejects(service.run('notification-dnd', 'mock', { ...confirm, mode: 'none' }, {}), /도움말/); assert.equal(state.writes.length, 0);
  const unsupported = mock({ override: parts => parts.slice(0, 3).join(' ') === 'cmd notification set_dnd' ? { stdout: '', stderr: 'SecurityException: Permission denied' } : undefined });
  await assert.rejects(unsupported.service.run('notification-dnd', 'mock', { ...confirm, mode: 'none' }, {}), /지원하지 않거나/);
});
test('normal shutdown performs only the fixed supported command and never claims powered-off verification', async () => {
  const { service, state } = mock(); const result = await service.run('device-shutdown', 'mock', confirm, {});
  assert.deepEqual(state.writes, [['svc', 'power', 'shutdown']]); assert.equal(JSON.parse(result.output).verifiedPoweredOff, false);
  assert.equal(state.calls.at(-1).options.timeout, 30000);
  const unsupported = mock({ override: parts => parts.join(' ') === 'svc power shutdown' ? 'Unknown command: shutdown' : undefined });
  await assert.rejects(unsupported.service.run('device-shutdown', 'mock', confirm, {}), /지원하지 않거나/);
});
test('cancelled jobs never execute a mutation', async () => {
  const { service, state } = mock(); await assert.rejects(service.run('device-shutdown', 'mock', confirm, { cancelled: true }), /취소/); assert.equal(state.calls.length, 0);
});
test('concurrent default-selection and disable actions serialize and recheck the new default', async () => {
  const { service, state } = mock({ enabled: [A, B] });
  const result = await Promise.allSettled([
    service.run('device-ime-manage', 'mock', { ...confirm, mode: 'set', imeId: B }, {}),
    service.run('device-ime-manage', 'mock', { ...confirm, mode: 'disable', imeId: B }, {}),
  ]);
  assert.equal(result[0].status, 'fulfilled'); assert.equal(result[1].status, 'rejected'); assert.equal(state.selected, B); assert.deepEqual(state.enabled, [A, B]);
  assert.equal(state.writes.length, 1);
});

test('scheduler membership uses the owning service package and calling user, not a delegated Source.pkg', () => {
  const result = parseSchedulerJobs(JOB_DUMP, '0'); assert.equal(result.rows.length, 1); assert.equal(result.rows[0].package, 'com.example.owner'); assert.equal(result.rows[0].sourcePackage, 'com.example.client');
  const work = parseSchedulerJobs(JOB_DUMP, '10'); assert.equal(work.rows[0].user, 10); assert.equal(work.rows[0].namespace, 'sync'); assert.equal(work.rows[0].jobId, 9);
  assert.throws(() => parseSchedulerJobs('Unknown command', '0'));
});
test('scheduler run passes a selected numeric user, exact owner package and ID; request accepted is not completed', async () => {
  const { service, state } = mock(); const option = (await service.options('mock', 'device-jobs', { user: 'current' })).options[0];
  const result = await service.run('device-job-manage', 'mock', { ...confirm, user: 'current', jobKey: option.value, mode: 'run', execution: 'satisfied' }, {});
  assert.deepEqual(state.writes[0], ['cmd', 'jobscheduler', 'run', '--user', '0', '--satisfied', 'com.example.owner', '7']);
  const output = JSON.parse(result.output); assert.equal(output.accepted, true); assert.equal(output.completed, null);
});
test('scheduler namespace cancel always includes an exact job ID and verifies removal', async () => {
  const { service, state } = mock(); const option = (await service.options('mock', 'device-jobs', { user: '10' })).options[0];
  const result = await service.run('device-job-manage', 'mock', { ...confirm, user: '10', jobKey: option.value, mode: 'cancel' }, {});
  assert.deepEqual(state.writes[0], ['cmd', 'jobscheduler', 'cancel', '--user', '10', '--namespace', 'sync', 'com.work.app', '9']);
  assert.equal(JSON.parse(result.output).verified, true);
});
test('scheduler stale selection, unsupported options, and missing acceptance never become success', async () => {
  const { service, state } = mock(); const option = (await service.options('mock', 'device-jobs', { user: '0' })).options[0];
  state.jobsDump = 'Registered 0 jobs:\n None.';
  await assert.rejects(service.run('device-job-manage', 'mock', { ...confirm, jobKey: option.value, mode: 'run', execution: 'force' }, {}), /목록에 없거나/); assert.equal(state.writes.length, 0);
  state.jobsDump = JOB_DUMP; state.override = parts => parts.join(' ') === 'cmd jobscheduler help' ? 'run PACKAGE JOB_ID\ncancel PACKAGE JOB_ID' : undefined;
  await assert.rejects(service.run('device-job-manage', 'mock', { ...confirm, jobKey: option.value, mode: 'run', execution: 'satisfied' }, {}), /도움말/); assert.equal(state.writes.length, 0);
  state.override = parts => parts.slice(0, 3).join(' ') === 'cmd jobscheduler run' ? 'Command ignored' : undefined;
  await assert.rejects(service.run('device-job-manage', 'mock', { ...confirm, jobKey: option.value, mode: 'run', execution: 'force' }, {}), /수락 응답/);
});
test('workbench catalog, handlers and dynamic choice routes expose all six actions', async () => {
  const { core, state } = mock(), extension = createWorkbenchExtensions(core, { readDevices: async () => ({ devices: [] }), history: new Map() });
  for (const action of DEVICE_DOMAIN_ACTIONS) { assert.equal(extension.has(action.id), true); assert.equal(EXTRA_ACTIONS.filter(row => row.id === action.id).length, 1); }
  const choices = await extension.options({ deviceId: 'mock', kind: 'device-ime', mode: 'enable', user: 'current' }); assert.deepEqual(choices.options.map(row => row.value), [B]);
  assert.equal((await extension.options({ deviceId: 'mock', kind: 'device-jobs', user: '10' })).options.length, 1);
  const notifications = await extension.options({ deviceId: 'mock', kind: 'notification-key', action: 'notification-snooze' }); assert.equal(notifications.options.length, 1);
  assert.equal(state.writes.length, 0);
});

test('DND current-user change during preview is rejected before the mode mutation', async () => {
  let currentReads = 0;
  const { service, state } = mock({ override: parts => parts.join(' ') === 'am get-current-user' ? (++currentReads === 1 ? '0' : '10') : undefined });
  await assert.rejects(service.run('notification-dnd', 'mock', { ...confirm, mode: 'none' }, {}), /현재 사용자가 바뀌어/); assert.equal(state.writes.length, 0);
});

test('DND inherited object keys are not accepted as modes and cause no reads or writes', async () => {
  for (const mode of ['constructor', '__proto__', 'toString', 'unexpected']) {
    const { service, state } = mock(); await assert.rejects(service.run('notification-dnd', 'mock', { ...confirm, mode }, {}), /목록에서/); assert.equal(state.calls.length, 0);
  }
});

test('DND user switch during readback is not reported as verified for the original user', async () => {
  const { service, state } = mock({ override: (parts, state) => { if (parts.join(' ') === 'settings get global zen_mode' && state.writes.length) { state.current = '10'; return '2'; } } });
  await assert.rejects(service.run('notification-dnd', 'mock', { ...confirm, mode: 'none' }, {}), /읽는 중 사용자가 바뀌어/); assert.equal(state.writes.length, 1);
});

test('scheduler namespaces containing spaces are preserved from the official dump and safely passed as one selected argument', async () => {
  const { service, state } = mock({ jobsDump: JOB_DUMP.replace('#u0a123/7', 'work sync:u0a123/7') });
  const selected = (await service.options('mock', 'device-jobs', { user: '0' })).options[0];
  await service.run('device-job-manage', 'mock', { ...confirm, user: '0', mode: 'run', execution: 'satisfied', jobKey: selected.value }, {});
  assert.equal(state.writes[0][state.writes[0].indexOf('--namespace') + 1], 'work sync'); assert.equal(state.writes[0].at(-2), 'com.example.owner');
});
