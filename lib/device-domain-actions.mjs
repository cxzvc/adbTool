import { createHash } from 'node:crypto';
import { ActionError } from './connections.mjs';
import { quote } from './operations-core.mjs';
import { parseBackground } from './device-domains.mjs';

// Syntax verified against AOSP InputMethodManagerService, NotificationShellCmd and
// cmds/svc/.../PowerCommand.java. No device command is executed by module initialization.
export const DEVICE_DOMAIN_ACTION_SOURCES = [
  'https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/services/core/java/com/android/server/inputmethod/InputMethodManagerService.java',
  'https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/services/core/java/com/android/server/notification/NotificationShellCmd.java',
  'https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/cmds/svc/src/com/android/commands/svc/PowerCommand.java',
  'https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/apex/jobscheduler/service/java/com/android/server/job/JobSchedulerShellCommand.java',
  'https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/apex/jobscheduler/service/java/com/android/server/job/controllers/JobStatus.java',
];
const selection = (name, label, choices, options = []) => ({ name, label, type: 'select', choices, options, ...(name === 'user' ? { value: 'current' } : {}), required: true });
const modes = (name, label, options, value) => ({ name, label, type: 'select', options: options.map(([value, label]) => ({ value, label })), value: value || options[0][0], required: true });
const action = (id, title, description, fields, group = 'users', support = '기기 명령 지원·정책 허용 필요') => ({ id, title, description, fields, group, write: true, support });
export const DEVICE_DOMAIN_ACTIONS = Object.freeze([
  action('device-ime-manage', '입력기 선택·활성 관리', '설치된 입력기를 목록에서 골라 활성화·비활성화하거나 기본 입력기로 선택합니다. 기본 입력기와 마지막 활성 입력기는 끄지 않습니다.', [selection('user', '사용자·프로필', 'users-current', [{ value: 'current', label: '현재 사용자' }]), modes('mode', '할 작업', [['set', '기본 입력기로 선택'], ['enable', '입력기 활성화'], ['disable', '입력기 비활성화']]), selection('imeId', '설치된 입력기', 'device-ime')]),
  action('notification-snooze', '알림 잠시 숨기기', '현재 사용자에게 표시된 알림을 목록에서 선택해 정한 시간 동안 미룹니다. 앱의 알림 권한이나 채널 설정은 바꾸지 않습니다.', [selection('notificationKey', '현재 알림', 'notification-key'), modes('minutes', '숨길 시간', [['5', '5분'], ['15', '15분'], ['30', '30분'], ['60', '1시간'], ['120', '2시간'], ['240', '4시간']], '30')], 'diagnostics'),
  action('notification-unsnooze', '숨긴 알림 다시 표시', '기기가 공개한 현재 사용자의 미뤄진 알림 중 하나를 다시 표시합니다. 이미 앱에서 취소한 알림은 복구되지 않을 수 있습니다.', [selection('notificationKey', '미뤄진 알림', 'notification-key')], 'diagnostics'),
  action('notification-dnd', '방해 금지 모드 변경', '방해 금지를 끄거나 중요한 알림·알람만 허용합니다. 적용 후 실제 모드 값을 다시 확인하며 자동 규칙이나 관리 정책이 변경을 제한할 수 있습니다.', [modes('mode', '허용할 알림·소리', [['off', '방해 금지 끄기'], ['priority', '중요한 알림만 허용'], ['alarms', '알람만 허용'], ['none', '모든 소리 차단']])], 'diagnostics'),
  action('device-shutdown', '기기 정상 종료', 'Android의 정상 종료 절차로 폰 전원을 끕니다. 연결이 끊어지며 다시 켜려면 폰의 전원 버튼을 사용해야 합니다.', [], 'display', 'svc power shutdown 지원·종료 권한 필요'),
  action('device-job-manage', '예약 작업 실행·취소', '사용자별 등록 작업을 목록에서 골라 실행을 요청하거나 등록을 취소합니다. 취소하면 다음 예약 실행도 제거되며 앱이 다시 예약할 수 있습니다. 완료 여부와 실행 요청 수락을 구분합니다.', [selection('user', '사용자·프로필', 'users-current', [{ value: 'current', label: '현재 사용자' }]), selection('jobKey', '등록된 예약 작업', 'device-jobs'), modes('mode', '할 작업', [['run', '실행 요청'], ['cancel', '선택 작업의 예약 취소']]), modes('execution', '실행 요청 방식', [['satisfied', '모든 실행 조건이 충족될 때만'], ['force', '네트워크 등 조건을 무시하고 요청']])], 'diagnostics', 'JobScheduler 명령 지원·정책 허용 필요'),
]);

const COMPONENT = /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*\/[A-Za-z0-9_.$]+$/;
const FAILED = /(?:^|\n)\s*(?:error\s*:|failure\b|failed\b|exception(?:\s|:)|security(?:exception| exception)\b|permission (?:denied|denial)|unknown (?:command|input method|option)|can't find service|cannot find service|no shell command implementation|java\.[\w.]+Exception\b|\/system\/bin\/sh:)/i;
const NONE = value => value == null || value.trim() === 'null' || value.trim() === '';
const hash = value => createHash('sha256').update(value).digest('hex');
const validateUser = value => value == null || value === '' || value === 'current' ? 'current' : /^\d{1,5}$/.test(String(value)) ? String(Number(value)) : (() => { throw new ActionError('사용자 목록에서 한 명을 선택하세요.'); })();
const throwCancelled = job => { if (job?.cancelled) throw new ActionError('작업을 취소했습니다.', 409); };

export function parseNotificationOptions(text, { snoozed = false, userId = null } = {}) {
  const options = [], invalid = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    let key = line.trim();
    if (snoozed) { const match = /^(.*?)\s+snoozed,\s*time=/.exec(key); if (!match) { invalid.push(line); continue; } key = match[1]; }
    const fields = key.split('|'), user = fields[0], pkg = fields[1], id = fields[2];
    if (key.length > 2048 || /[\x00-\x1f\x7f]/.test(key) || fields.length < 5 || !/^-?\d+$/.test(user) || !/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/.test(pkg || '') || !/^-?\d+$/.test(id || '')) { invalid.push(line); continue; }
    if (userId != null && user !== String(userId) && user !== '-1') continue;
    options.push({ value: hash(key), label: `${pkg} · 알림 ${id} · ${user === '-1' ? '모든 사용자' : '사용자 ' + user}${snoozed ? ' · 미뤄짐' : ''}`, key, user: Number(user), package: pkg, id });
  }
  if (invalid.length) throw new ActionError('기기가 제공한 알림 목록 형식을 확인할 수 없습니다. 변경하지 않았습니다.', 409);
  return [...new Map(options.map(option => [option.value, option])).values()];
}

export function parseSchedulerJobs(text, user) {
  const data = parseBackground(text);
  if (data.registered == null) throw new ActionError('현재 등록 작업 목록 형식을 확인하지 못했습니다. 변경하지 않았습니다.', 409);
  const rows = [];
  for (const item of data.jobs) {
    const identity = /^(?:#|(.+):)(u\d+[asi]\d+|\d+)\/(-?\d+)$/.exec(item.id || '');
    if (!identity || !COMPONENT.test(item.service || '')) continue;
    const jobId = Number(identity[3]), namespace = identity[1] || null, uid = identity[2];
    const userId = uid.startsWith('u') ? Number(/^u(\d+)/.exec(uid)[1]) : Math.floor(Number(uid) / 100000);
    if (!Number.isSafeInteger(userId) || userId < 0 || userId > 99999 || !Number.isInteger(jobId) || jobId < -2147483648 || jobId > 2147483647 || (namespace != null && (namespace.length > 200 || /[\x00-\x1f\x7f]/.test(namespace)))) continue;
    if (user != null && String(userId) !== String(user)) continue;
    // The scheduler command takes the owning service package, not Source.pkg:
    // jobs scheduled on behalf of another app can have a different Source identity.
    const packageName = item.service.split('/')[0], value = hash(JSON.stringify([userId, namespace, packageName, jobId, item.service]));
    rows.push({ value, package: packageName, sourcePackage: item.package, service: item.service, user: userId, namespace, jobId, ready: item.ready, label: `${packageName} · 작업 ${jobId} · 사용자 ${userId}${namespace ? ' · ' + namespace : ''}${item.ready === false ? ' · 대기 조건 있음' : ''}` });
  }
  return { rows: [...new Map(rows.map(row => [row.value, row])).values()], totalRegistered: data.registered };
}

export function createDeviceDomainActions(core) {
  const deviceQueues = new Map();
  async function shell(serial, args, { job, timeout = 12000, allowHelp = false } = {}) {
    throwCancelled(job);
    const result = await core.run(serial, ['shell', args.map(value => quote(String(value))).join(' ')], { timeout, maxBytes: 4 * 1024 * 1024, job });
    const combined = `${result.stdout || ''}\n${result.stderr || ''}`;
    if (FAILED.test(combined) || (!allowHelp && /^\s*(?:usage:|Available commands:|Input method manager commands:|Notification manager commands:)/im.test(combined))) throw new ActionError('기기가 이 명령을 지원하지 않거나 작업을 거부했습니다. 설정을 확인하세요.', 409);
    return result.stdout || (allowHelp ? result.stderr : '') || '';
  }
  async function currentUser(serial, job) {
    const value = (await shell(serial, ['am', 'get-current-user'], { job })).trim();
    if (!/^\d{1,5}$/.test(value)) throw new ActionError('현재 사용자를 확인하지 못했습니다. 변경하지 않았습니다.', 409);
    return String(Number(value));
  }
  async function resolveUser(serial, user, job) {
    const target = validateUser(user), userId = target === 'current' ? await currentUser(serial, job) : target;
    const listing = await shell(serial, ['pm', 'list', 'users'], { job });
    const available = [...listing.matchAll(/UserInfo\{(\d+):/g)].map(match => String(Number(match[1])));
    if (!available.includes(userId)) throw new ActionError('선택한 사용자·프로필이 현재 목록에 없습니다.', 409);
    return userId;
  }
  async function imeState(serial, user, job) {
    const userId = await resolveUser(serial, user, job);
    // Sequential reads keep a single job.child handle valid for cancellation.
    const listing = await shell(serial, ['ime', 'list', '-a', '-s', '--user', userId], { job });
    const methods = listing.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (methods.some(id => !COMPONENT.test(id))) throw new ActionError('설치된 입력기 목록을 정확히 읽지 못했습니다. 변경하지 않았습니다.', 409);
    const enabledText = await shell(serial, ['settings', '--user', userId, 'get', 'secure', 'enabled_input_methods'], { job });
    const defaultText = await shell(serial, ['settings', '--user', userId, 'get', 'secure', 'default_input_method'], { job });
    const enabled = NONE(enabledText) ? [] : enabledText.trim().split(':').map(value => value.split(';')[0]);
    if (enabled.some(id => !COMPONENT.test(id))) throw new ActionError('활성 입력기 목록 형식이 올바르지 않습니다. 변경하지 않았습니다.', 409);
    const selected = NONE(defaultText) ? null : defaultText.trim();
    if (selected != null && !COMPONENT.test(selected)) throw new ActionError('기본 입력기를 확인하지 못했습니다. 변경하지 않았습니다.', 409);
    return { user: userId, methods: [...new Set(methods)], enabled: [...new Set(enabled)], selected };
  }
  async function notificationRows(serial, actionId, job) {
    const user = await currentUser(serial, job), snoozed = actionId === 'notification-unsnooze';
    const text = await shell(serial, ['cmd', 'notification', snoozed ? 'snoozed' : 'list'], { job });
    return { user, rows: parseNotificationOptions(text, { snoozed, userId: user }) };
  }
  async function schedulerRows(serial, user, job) {
    const userId = await resolveUser(serial, user, job);
    const text = await shell(serial, ['dumpsys', '-t', '8', 'jobscheduler'], { job });
    return { ...parseSchedulerJobs(text, userId), user: userId };
  }
  async function support(serial, command, required, job) {
    const help = await shell(serial, command, { job, allowHelp: true });
    if (!required.test(help)) throw new ActionError('이 기기의 명령 도움말에서 해당 기능을 확인하지 못했습니다. 변경하지 않았습니다.', 409);
  }
  async function verify(callback, expected, job) {
    let value;
    for (let attempt = 0; attempt < 4; attempt++) {
      throwCancelled(job); value = await callback(); if (expected(value)) return value;
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 125));
    }
    throw new ActionError('명령은 전달했지만 요청한 상태로 바뀌었는지 확인하지 못했습니다. 현재 상태를 다시 조회하세요.', 409);
  }
  async function options(serial, kind, body = {}) {
    if (kind === 'device-ime') {
      const state = await imeState(serial, body.user || 'current', body.job);
      const mode = body.mode || 'set';
      const usable = state.methods.filter(id => state.enabled.includes(id));
      return { user: state.user, options: state.methods.filter(id => mode === 'set' ? state.enabled.includes(id) : mode === 'disable' ? state.selected != null && state.enabled.includes(id) && id !== state.selected && usable.length > 1 : !state.enabled.includes(id)).map(id => ({ value: id, label: `${id}${id === state.selected ? ' · 기본' : state.enabled.includes(id) ? ' · 활성' : ' · 비활성'}` })) };
    }
    if (kind === 'notification-key') {
      if (!['notification-snooze', 'notification-unsnooze'].includes(body.action)) throw new ActionError('알림 작업을 선택하세요.');
      const data = await notificationRows(serial, body.action, body.job);
      return { user: data.user, options: data.rows.map(({ value, label }) => ({ value, label })) };
    }
    if (kind === 'device-jobs') {
      const data = await schedulerRows(serial, body.user || 'current', body.job);
      return { user: data.user, options: data.rows.map(({ value, label }) => ({ value, label })) };
    }
    throw new ActionError('지원하지 않는 선택 목록입니다.');
  }
  async function execute(id, serial, body, job) {
    const def = DEVICE_DOMAIN_ACTIONS.find(action => action.id === id);
    if (!def) throw new ActionError('지원하는 기기 작업을 선택하세요.');
    if (typeof body.deviceId !== 'string' || !body.deviceId || body.confirmDevice !== body.deviceId) throw new ActionError('대상 기기와 변경 내용을 확인해야 실행할 수 있습니다.');
    throwCancelled(job);
    if (id === 'device-ime-manage') {
      if (!['enable', 'disable', 'set'].includes(body.mode) || typeof body.imeId !== 'string' || !COMPONENT.test(body.imeId)) throw new ActionError('작업과 입력기를 목록에서 선택하세요.');
      const before = await imeState(serial, body.user || 'current', job), imeId = body.imeId;
      if (!before.methods.includes(imeId)) throw new ActionError('선택한 입력기가 이 사용자에게 설치되어 있지 않습니다.', 409);
      if (body.mode === 'disable' && (before.selected == null || before.selected === imeId || (before.enabled.includes(imeId) && before.methods.filter(id => before.enabled.includes(id)).length <= 1))) throw new ActionError('기본 입력기를 확인하지 못했거나 기본·마지막 활성 입력기는 끌 수 없습니다. 다른 입력기를 활성화하고 기본으로 선택하세요.', 409);
      if (body.mode === 'set' && !before.enabled.includes(imeId)) throw new ActionError('기본 입력기로 선택하려면 먼저 이 입력기를 활성화하세요.', 409);
      await shell(serial, ['ime', body.mode, '--user', before.user, imeId], { job });
      const after = await verify(() => imeState(serial, before.user, job), state => body.mode === 'set' ? state.selected === imeId : state.enabled.includes(imeId) === (body.mode === 'enable'), job);
      return { message: `입력기를 ${body.mode === 'enable' ? '활성화' : body.mode === 'disable' ? '비활성화' : '기본으로 선택'}하고 실제 상태를 확인했습니다.`, output: JSON.stringify({ user: after.user, inputMethod: imeId, enabled: after.enabled.includes(imeId), selected: after.selected === imeId, verified: true }, null, 2) };
    }
    if (id === 'notification-snooze' || id === 'notification-unsnooze') {
      if (typeof body.notificationKey !== 'string' || !/^[a-f\d]{64}$/.test(body.notificationKey)) throw new ActionError('알림 목록에서 대상을 선택하세요.');
      if (id === 'notification-snooze' && !['5', '15', '30', '60', '120', '240'].includes(String(body.minutes))) throw new ActionError('지원하는 숨김 시간을 선택하세요.');
      const before = await notificationRows(serial, id, job), selected = before.rows.find(row => row.value === body.notificationKey);
      if (!selected) throw new ActionError('선택한 알림이 현재 목록에 없습니다. 목록을 다시 불러오세요.', 409);
      await support(serial, ['cmd', 'notification', 'help'], id === 'notification-snooze' ? /(?:^|\n)\s*snooze\s+--for\b/ : /(?:^|\n)\s*unsnooze\s+/, job);
      if (id === 'notification-snooze') await notificationRows(serial, 'notification-unsnooze', job);
      if (await currentUser(serial, job) !== before.user) throw new ActionError('현재 사용자가 바뀌었습니다. 알림 목록을 다시 선택하세요.', 409);
      await shell(serial, ['cmd', 'notification', ...(id === 'notification-snooze' ? ['snooze', '--for', String(Number(body.minutes) * 60000)] : ['unsnooze']), selected.key], { job });
      // Snooze/unsnooze dispatch through a Handler. Verify the authoritative snoozed list;
      // disappearance from the active list alone could also mean the app cancelled it.
      await verify(async () => {
        const snoozed = await notificationRows(serial, 'notification-unsnooze', job);
        if (snoozed.user !== before.user) throw new ActionError('현재 사용자가 바뀌어 적용 결과를 확인하지 못했습니다. 같은 사용자에서 알림 상태를 확인하세요.', 409);
        return snoozed.rows.some(row => row.value === selected.value);
      }, present => present === (id === 'notification-snooze'), job);
      return { message: id === 'notification-snooze' ? `${body.minutes}분 동안 알림을 미루고 상태를 확인했습니다.` : '알림 미루기를 해제한 상태를 확인했습니다. 앱이 취소한 알림은 다시 나타나지 않을 수 있습니다.', output: JSON.stringify({ package: selected.package, user: selected.user, notificationId: selected.id, snoozed: id === 'notification-snooze', verified: true }, null, 2) };
    }
    if (id === 'notification-dnd') {
      const modes = { off: '0', priority: '1', none: '2', alarms: '3' };
      const desired = typeof body.mode === 'string' && Object.hasOwn(modes, body.mode) ? modes[body.mode] : null;
      if (desired == null) throw new ActionError('방해 금지 모드를 목록에서 선택하세요.');
      await support(serial, ['cmd', 'notification', 'help'], /(?:^|\n)\s*set_dnd\s+/, job);
      const user = await currentUser(serial, job);
      const before = (await shell(serial, ['settings', 'get', 'global', 'zen_mode'], { job })).trim();
      if (!/^[0-3]$/.test(before)) throw new ActionError('방해 금지의 현재 상태를 확인할 수 없어 변경하지 않았습니다.', 409);
      if (await currentUser(serial, job) !== user) throw new ActionError('확인 중 현재 사용자가 바뀌어 방해 금지 모드를 변경하지 않았습니다.', 409);
      await shell(serial, ['cmd', 'notification', 'set_dnd', body.mode], { job });
      const after = await verify(async () => {
        if (await currentUser(serial, job) !== user) throw new ActionError('사용자가 바뀌어 방해 금지 적용 결과를 확인하지 못했습니다. 같은 사용자에서 상태를 확인하세요.', 409);
        const value = await shell(serial, ['settings', 'get', 'global', 'zen_mode'], { job });
        if (await currentUser(serial, job) !== user) throw new ActionError('결과를 읽는 중 사용자가 바뀌어 방해 금지 적용 확인을 중단했습니다.', 409);
        return value;
      }, value => value.trim() === desired, job);
      return { message: '방해 금지 모드를 변경하고 실제 값을 확인했습니다.', output: JSON.stringify({ user, mode: body.mode, zenMode: after.trim(), verified: true }, null, 2) };
    }
    if (id === 'device-shutdown') {
      await support(serial, ['svc', 'power'], /\bsvc power shutdown\b/, job);
      try { await shell(serial, ['svc', 'power', 'shutdown'], { job, timeout: 30000 }); }
      catch (error) {
        if (/device.*(?:offline|not found)|closed|disconnected|연결.*끊|제한 시간/i.test(error.message)) throw new ActionError('종료 요청 중 ADB 연결이 끊어졌거나 응답이 끝나지 않았습니다. 실제 종료됐을 수 있으므로 폰 상태를 먼저 확인하세요.', 409);
        throw error;
      }
      return { message: 'Android 정상 종료 요청을 전달했습니다. 연결이 끊어지며 실제 전원 종료 여부는 여기서 확인할 수 없습니다.', output: JSON.stringify({ requested: true, verifiedPoweredOff: false }, null, 2) };
    }
    if (id === 'device-job-manage') {
      if (!['run', 'cancel'].includes(body.mode) || typeof body.jobKey !== 'string' || !/^[a-f\d]{64}$/.test(body.jobKey)) throw new ActionError('작업과 등록 대상을 목록에서 선택하세요.');
      if (body.mode === 'run' && !['satisfied', 'force'].includes(body.execution)) throw new ActionError('실행 조건 방식을 선택하세요.');
      const before = await schedulerRows(serial, body.user || 'current', job), selected = before.rows.find(row => row.value === body.jobKey);
      if (!selected) throw new ActionError('선택한 예약 작업이 현재 사용자 목록에 없거나 변경되었습니다. 목록을 다시 읽으세요.', 409);
      const help = await shell(serial, ['cmd', 'jobscheduler', 'help'], { job, allowHelp: true });
      const commandLine = help.split(/\r?\n/).find(line => new RegExp(`^\\s*${body.mode}\\s+`).test(line));
      if (!commandLine || !/--user\b/.test(commandLine) || (selected.namespace != null && !/--namespace\b/.test(commandLine)) || (body.mode === 'run' && !commandLine.includes(body.execution === 'force' ? '--force' : '--satisfied'))) throw new ActionError('이 기기의 도움말에서 선택한 예약 작업 명령 옵션을 확인하지 못했습니다. 실행하지 않았습니다.', 409);
      const args = ['cmd', 'jobscheduler', body.mode, '--user', String(selected.user), ...(selected.namespace == null ? [] : ['--namespace', selected.namespace]), ...(body.mode === 'run' ? [body.execution === 'force' ? '--force' : '--satisfied'] : []), selected.package, String(selected.jobId)];
      const response = await shell(serial, args, { job });
      if (body.mode === 'cancel') {
        await verify(async () => !(await schedulerRows(serial, selected.user, job)).rows.some(row => row.value === selected.value), removed => removed, job);
        return { message: '선택한 예약 작업이 목록에서 제거된 것을 확인했습니다. 앱이 나중에 다시 예약할 수 있습니다.', output: JSON.stringify({ user: selected.user, package: selected.package, namespace: selected.namespace, jobId: selected.jobId, cancelled: true, verified: true }, null, 2) };
      }
      if (!/^\s*Running job(?:\s+\[FORCED\])?\s*$/im.test(response)) throw new ActionError('실행 요청의 수락 응답을 확인하지 못했습니다. 작업 상태를 다시 조회하세요.', 409);
      const after = (await schedulerRows(serial, selected.user, job)).rows.find(row => row.value === selected.value);
      return { message: '예약 작업 실행 요청을 시스템이 수락했습니다. 앱 내부 작업의 성공·완료 여부는 로그에서 확인하세요.', output: JSON.stringify({ user: selected.user, package: selected.package, namespace: selected.namespace, jobId: selected.jobId, execution: body.execution, accepted: true, stillRegistered: Boolean(after), completed: null }, null, 2) };
    }
  }
  function run(id, serial, body, job) {
    // Keep fresh membership -> mutation -> verification atomic relative to this module's
    // other requests, so simultaneous set/disable actions cannot invalidate one another.
    const previous = deviceQueues.get(serial) || Promise.resolve();
    const task = previous.then(() => execute(id, serial, body, job));
    const completed = task.then(() => {}, () => {}); deviceQueues.set(serial, completed);
    completed.then(() => { if (deviceQueues.get(serial) === completed) deviceQueues.delete(serial); });
    return task;
  }
  return { options, run };
}
