import { ActionError } from './connections.mjs';
import { quote } from './operations-core.mjs';
import { parseProcStat } from './process-operations.mjs';
import { createShizukuTools } from './shizuku-tools.mjs';

const PACKAGE = 'moe.shizuku.privileged.api';
const START_SCRIPT = `/sdcard/Android/data/${PACKAGE}/start.sh`;
export const SHIZUKU_MANAGEMENT_SOURCES = [
  'https://github.com/RikkaApps/Shizuku/blob/master/manager/src/main/jni/starter.cpp',
  'https://github.com/RikkaApps/Shizuku/blob/master/server/src/main/java/rikka/shizuku/server/ShizukuService.java',
  'https://shizuku.rikka.app/guide/setup/',
];
export const SHIZUKU_MANAGEMENT_ACTIONS = [
  { id: 'shizuku-stop', group: 'advanced', title: 'Shizuku 서버 종료', description: 'ADB shell 권한으로 실행 중인 Shizuku 서버 한 개의 PID·UID·이름·시작 시각을 재확인한 뒤 종료합니다. Shizuku에 연결된 앱의 기능도 중단됩니다.', fields: [], write: true, support: '기본 사용자 0 · ADB UID 2000 · 같은 UID의 단일 shizuku_server만 지원' },
  { id: 'shizuku-restart', group: 'advanced', title: 'Shizuku 서버 재시작', description: '검증한 ADB Shizuku 서버를 종료한 뒤 설치된 앱의 공식 시작 스크립트로 다시 시작합니다. 서버가 없으면 시작을 요청합니다. 앱별 허용 목록은 바꾸지 않습니다.', fields: [], write: true, support: '기본 사용자 0 · ADB UID 2000 · 공식 시작 스크립트 읽기 가능' },
];
export function shizukuRecoveryGuide({ installed = null, running = null, uid = null, currentUser = null, error = '' } = {}) {
  const lines = [];
  if (installed === false) lines.push('미설치: 공식 Shizuku 앱을 기본 사용자(0)에 설치하고 앱을 한 번 연 뒤 시작 안내를 확인하세요. 웹은 앱을 자동 설치하지 않습니다.');
  if (running === false) lines.push('서버 미실행: 폰을 재부팅하면 ADB로 시작한 Shizuku는 종료됩니다. ADB 연결을 다시 준비한 뒤 시작 버튼을 사용하세요. 미실행 원인이 재부팅이라고 단정하지는 않습니다.');
  if (uid != null && uid !== '2000') lines.push(`현재 ADB UID ${uid}: 웹의 종료·재시작은 shell UID 2000만 지원합니다. root 서버는 Shizuku 앱에서 관리하세요. 웹이 root 전환하지 않습니다.`);
  if (currentUser != null && currentUser !== '0') lines.push('다른 사용자·업무 프로필: 이 시작/재시작 경로는 기본 사용자 0에서 지원합니다. 프로필별 사용은 Shizuku 앱의 공식 안내를 따르세요.');
  if (/permission|denied|SELinux|권한|거부/i.test(error)) lines.push('권한 실패: USB/무선 디버깅 승인과 Shizuku 앱의 시작 안내를 확인하세요. 제조사 정책·SELinux 제한을 임의로 해제하거나 우회하지 않습니다.');
  if (/script|start\.sh|스크립트|설치/i.test(error)) lines.push('시작 파일 문제: Shizuku 앱을 열어 공식 시작 스크립트 경로를 준비하세요. 앱 업데이트 직후에는 시작 안내를 다시 확인하세요.');
  lines.push('프로세스가 존재해도 Binder 연결·앱별 권한 허용까지 확인한 것은 아닙니다. 연결 상태와 허용 앱은 Shizuku 앱에서 확인하세요.');
  lines.push('공식 안내: https://shizuku.rikka.app/guide/setup/');
  return lines.join('\n');
}

export function parseShizukuProcesses(text) {
  if (!/^\s*PID\s+UID\s+NAME\s*$/m.test(String(text))) throw new ActionError('서버 프로세스 목록 형식을 확인하지 못했습니다. 종료하지 않았습니다.', 409);
  return String(text).split(/\r?\n/).flatMap(line => {
    const match = /^\s*(\d+)\s+(\d+)\s+shizuku_server\s*$/.exec(line);
    if (!match || Number(match[1]) <= 1 || Number(match[1]) > 99999999) return [];
    return [{ pid: Number(match[1]), uid: match[2], name: 'shizuku_server' }];
  });
}
export function parseShizukuIdentity(row, statusText, statText, commandLine) {
  const uid = /^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/m.exec(String(statusText));
  const stat = parseProcStat(String(statText));
  const processName = String(commandLine).split('\0')[0];
  if (row.uid !== '2000' || !uid || uid.slice(1).some(value => value !== '2000') || stat.pid !== row.pid || processName !== 'shizuku_server' || stat.state === 'Z') throw new ActionError('Shizuku 서버의 UID·이름·실행 상태를 검증하지 못했습니다. 종료하지 않았습니다.', 409);
  return { ...row, startTime: stat.startTime, state: stat.state };
}
export function shizukuStopGuard(identity) {
  if (!Number.isInteger(identity?.pid) || identity.pid < 2 || identity.pid > 99999999 || identity.uid !== '2000' || identity.name !== 'shizuku_server' || !/^\d{1,24}$/.test(identity.startTime || '')) throw new ActionError('종료 대상의 신원이 올바르지 않습니다.');
  // The official native starter terminates an old shizuku_server with SIGKILL.
  // Restrict this further to a shell-owned exact name and starttime, then repeat every
  // identity check inside the same shell immediately before signalling the numeric PID.
  return [
    'set -f',
    '[ "$(id -u)" = "2000" ] || exit 71',
    '[ "$(am get-current-user)" = "0" ] || exit 78',
    `p=${identity.pid}`,
    'u=$(grep "^Uid:" /proc/$p/status) || exit 72',
    'set -- $u',
    '[ "$2" = 2000 ] && [ "$3" = 2000 ] && [ "$4" = 2000 ] && [ "$5" = 2000 ] || exit 73',
    'n=$(tr "\\000" "\\n" < /proc/$p/cmdline | head -n 1)',
    '[ "$n" = shizuku_server ] || exit 74',
    's=$(cat /proc/$p/stat) || exit 75',
    'r=${s##*) }',
    'set -- $r',
    `[ "\${20}" = ${identity.startTime} ] && [ "$1" != Z ] || exit 76`,
    'kill -9 "$p" || exit 77',
    `printf 'SHIZUKU_STOP_REQUESTED ${identity.pid} ${identity.startTime}\\n'`,
  ].join('; ');
}

export function createShizukuManagement(core, { base = createShizukuTools(core) } = {}) {
  const queue = new Map();
  const cancelled = job => { if (job?.cancelled) throw new ActionError('작업을 취소했습니다.', 409); };
  async function command(serial, args, job, timeout = 12000) {
    cancelled(job);
    const result = await core.run(serial, ['shell', args.map(value => quote(String(value))).join(' ')], { job, timeout, maxBytes: 2 * 1024 * 1024 });
    cancelled(job);
    if (/^\s*(?:Error:|Fatal:|Exception\b|SecurityException|Security exception|Permission (?:denied|denial)|Unknown command|Failure\b|Failed\b)/im.test(`${result.stdout}\n${result.stderr}`)) throw new ActionError('기기에서 Shizuku 관리 명령을 지원하지 않거나 거부했습니다.', 409);
    return String(result.stdout || '');
  }
  const processList = async (serial, job) => parseShizukuProcesses(await command(serial, ['ps', '-A', '-o', 'PID,UID,NAME'], job));
  async function identity(serial, row, job) {
    const status = await command(serial, ['cat', `/proc/${row.pid}/status`], job);
    const stat = await command(serial, ['cat', `/proc/${row.pid}/stat`], job);
    const cmdline = await command(serial, ['cat', `/proc/${row.pid}/cmdline`], job);
    return parseShizukuIdentity(row, status, stat, cmdline);
  }
  async function context(serial, job) {
    const uid = (await command(serial, ['id', '-u'], job)).trim();
    const currentUser = (await command(serial, ['am', 'get-current-user'], job)).trim();
    const installed = (await command(serial, ['pm', 'list', 'packages', '--user', '0', PACKAGE], job)).split(/\r?\n/).some(line => line.trim() === `package:${PACKAGE}`);
    const rows = await processList(serial, job);
    return { uid, currentUser, installed, running: rows.length > 0, rows };
  }
  async function stop(serial, before, job) {
    if (!before.rows.length) return { stopped: false, alreadyStopped: true };
    if (before.rows.length !== 1 || before.rows[0].uid !== '2000') throw new ActionError('단일 ADB shell UID 2000 서버가 아닙니다. root·다른 UID·여러 서버는 Shizuku 앱에서 관리하세요.', 409);
    const expected = await identity(serial, before.rows[0], job);
    const rows = await processList(serial, job);
    if (rows.length !== 1 || rows[0].pid !== expected.pid || rows[0].uid !== expected.uid) throw new ActionError('종료 직전에 서버 프로세스가 바뀌었습니다. 상태를 다시 조회하세요.', 409);
    const verified = await identity(serial, rows[0], job);
    if (verified.startTime !== expected.startTime) throw new ActionError('PID가 다른 프로세스로 재사용되어 종료하지 않았습니다. 상태를 다시 조회하세요.', 409);
    cancelled(job);
    let result;
    try { result = await core.run(serial, ['shell', shizukuStopGuard(expected)], { job, timeout: 12000, maxBytes: 4096 }); }
    catch (error) { if (job?.cancelled) throw error; throw new ActionError('서버 신원 재확인 또는 종료 요청이 거부됐습니다. 다른 프로세스에는 종료를 재시도하지 않습니다.', 409); }
    if (String(result.stdout || '').trim() !== `SHIZUKU_STOP_REQUESTED ${expected.pid} ${expected.startTime}` || String(result.stderr || '').trim()) throw new ActionError('Shizuku 서버 종료 요청의 결과를 확인하지 못했습니다.', 409);
    for (let attempt = 0; attempt < 8; attempt++) {
      cancelled(job);
      const remaining = await processList(serial, job);
      if (!remaining.length) return { stopped: true, pid: expected.pid, startTime: expected.startTime, verified: true };
      if (remaining.length !== 1 || remaining[0].pid !== expected.pid || remaining[0].uid !== '2000') throw new ActionError('종료 요청 후 다른 Shizuku 서버가 나타났습니다. 새 프로세스는 종료하지 않았습니다.', 409);
      const now = parseProcStat(await command(serial, ['cat', `/proc/${expected.pid}/stat`], job));
      if (now.startTime !== expected.startTime) throw new ActionError('종료 후 새 서버가 같은 PID를 사용하고 있습니다. 새 서버는 종료하지 않았습니다.', 409);
      if (attempt < 7) await new Promise(resolve => setTimeout(resolve, 150));
    }
    throw new ActionError('종료 요청 후에도 서버 프로세스가 남아 있습니다. Shizuku 앱에서 상태를 확인하세요.', 409);
  }
  async function execute(id, serial, body = {}, job) {
    if (typeof serial !== 'string' || !serial || serial.length > 255 || /[\x00-\x20\x7f]/.test(serial)) throw new ActionError('대상 기기 연결을 확인하세요.');
    if (id === 'shizuku-status') {
      let result;
      try { result = await base.run(id, serial, body, job); }
      catch (error) { if (job?.cancelled) throw error; throw new ActionError(`${error.message}\n\n${shizukuRecoveryGuide({ error: error.message })}`, error.status || 409); }
      let ctx;
      try { ctx = await context(serial, job); }
      catch (error) { if (job?.cancelled) throw error; return { ...result, output: `${result.output}\n\n관리 지원 확인 제한: ${error.message}\n${shizukuRecoveryGuide({ error: error.message })}` }; }
      let details = '종료·재시작 검증 대상: 없음';
      if (ctx.rows.length === 1 && ctx.rows[0].uid === '2000') {
        try { const target = await identity(serial, ctx.rows[0], job); details = `검증한 서버: PID ${target.pid} · UID 2000 · 시작 틱 ${target.startTime}\n이름·UID·시작 시각 검증 완료. Binder 상태 검증은 아닙니다.`; }
        catch (error) { if (job?.cancelled) throw error; details = `종료·재시작 검증 제한: ${error.message}`; }
      } else if (ctx.rows.length) details = '종료·재시작 검증 제한: root·다른 UID 또는 복수 서버는 웹에서 종료하지 않습니다.';
      return { ...result, output: `${result.output}\n\n${details}\n\n${shizukuRecoveryGuide(ctx)}` };
    }
    if (!['shizuku-open', 'shizuku-start', ...SHIZUKU_MANAGEMENT_ACTIONS.map(action => action.id)].includes(id)) throw new ActionError('지원하는 Shizuku 작업을 선택하세요.');
    if (typeof body.deviceId !== 'string' || !body.deviceId || body.confirmDevice !== body.deviceId) throw new ActionError('대상 기기와 Shizuku 작업 내용을 확인하세요.');
    if (id === 'shizuku-open' || id === 'shizuku-start') {
      try { const result = await base.run(id, serial, body, job); return { ...result, output: `${result.output || ''}\n\n${shizukuRecoveryGuide({ running: id === 'shizuku-start' ? true : null })}` }; }
      catch (error) { if (job?.cancelled) throw error; throw new ActionError(`${error.message}\n\n${shizukuRecoveryGuide({ installed: /설치되어 있지/.test(error.message) ? false : null, error: error.message })}`, error.status || 409); }
    }
    let ctx;
    try { ctx = await context(serial, job); }
    catch (error) { if (job?.cancelled) throw error; throw new ActionError(`${error.message}\n\n${shizukuRecoveryGuide({ error: error.message })}`, error.status || 409); }
    try {
      if (ctx.currentUser !== '0' || ctx.uid !== '2000') throw new ActionError('웹의 Shizuku 종료·재시작은 기본 사용자 0 및 ADB shell UID 2000에서만 지원합니다.', 409);
      if (id === 'shizuku-restart') {
        if (!ctx.installed) throw new ActionError('기본 사용자에게 Shizuku가 설치되어 있지 않아 다시 시작할 수 없습니다.', 409);
        // Check the startup prerequisites before stopping a working server.
        try { await command(serial, ['test', '-r', START_SCRIPT], job); }
        catch (error) { if (job?.cancelled) throw error; throw new ActionError('공식 시작 스크립트를 읽을 수 없어 기존 서버를 종료하지 않았습니다.', 409); }
      }
      const stopped = await stop(serial, ctx, job);
      ctx.running = false;
      if (id === 'shizuku-stop') return { message: stopped.stopped ? '검증한 Shizuku 서버의 종료를 확인했습니다.' : '실행 중인 Shizuku 서버가 없어 종료 명령을 보내지 않았습니다.', output: `${JSON.stringify(stopped, null, 2)}\n\n${shizukuRecoveryGuide({ ...ctx, running: false })}` };
      cancelled(job);
      const beforeStart = await processList(serial, job);
      if (beforeStart.length) throw new ActionError('다른 Shizuku 서버가 먼저 시작되어 공식 시작 스크립트를 실행하지 않았습니다.', 409);
      let started;
      try { started = await base.run('shizuku-start', serial, body, job); }
      catch (error) { throw new ActionError(`기존 서버 ${stopped.stopped ? '종료 후' : '미실행 상태에서'} 시작에 실패했습니다.\n${error.message}`, error.status || 409); }
      const afterRows = await processList(serial, job);
      if (afterRows.length !== 1 || afterRows[0].uid !== '2000') throw new ActionError('시작 후 단일 ADB 권한 서버를 확인하지 못했습니다.', 409);
      const after = await identity(serial, afterRows[0], job);
      if (stopped.stopped && after.pid === stopped.pid && after.startTime === stopped.startTime) throw new ActionError('새 서버 프로세스로 바뀌었는지 확인하지 못했습니다.', 409);
      return { message: '새 Shizuku 서버의 이름·UID·시작 시각을 확인했습니다. Binder 연결은 Shizuku 앱에서 확인하세요.', output: `${started.output || ''}\n\n${JSON.stringify({ before: stopped, after: { pid: after.pid, uid: after.uid, startTime: after.startTime }, processVerified: true, binderVerified: false }, null, 2)}\n\n${shizukuRecoveryGuide({ ...ctx, running: true })}` };
    } catch (error) { if (job?.cancelled) throw error; throw new ActionError(`${error.message}\n\n${shizukuRecoveryGuide({ ...ctx, error: error.message })}`, error.status || 409); }
  }
  function run(id, serial, body, job) {
    if (id === 'shizuku-status') return execute(id, serial, body, job);
    const previous = queue.get(serial) || Promise.resolve(), task = previous.then(() => execute(id, serial, body, job));
    const completed = task.then(() => {}, () => {}); queue.set(serial, completed); completed.then(() => { if (queue.get(serial) === completed) queue.delete(serial); }); return task;
  }
  return { run };
}
