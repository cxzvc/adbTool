import { randomUUID } from 'node:crypto';
import { ActionError } from './connections.mjs';
import { SETTINGS, CATEGORIES, validateSetting } from './device-control.mjs';
import {CORE_SETTINGS,settingsForDevice} from './settings-catalog.mjs';
import { quote } from './operations-core.mjs';
import { settingWriteNeedsReview, settingWriteRestriction } from './firmware-setting-review.mjs';

const MAX_DEVICES = 4, TTL = 5 * 60 * 1000;
const fail = (message, status = 409) => { throw new ActionError(message, status); };
const name = device => [device.model || device.name || 'Android 기기', device.id].filter(Boolean).join(' · ');
const online = device => Array.isArray(device.transports) && device.transports.some(transport => transport.state === 'device');
const sameIds = (a, b) => a.length === b.length && [...a].sort().every((value, index) => value === [...b].sort()[index]);
function ids(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_DEVICES || value.some(id => typeof id !== 'string' || !id || id.length > 255 || /[\x00-\x1f\x7f]/.test(id)) || new Set(value).size !== value.length) fail('목록에서 서로 다른 기기를 1~4대 선택하세요.', 400);
  return [...value];
}
const safeError = error => String(error?.message || '작업을 처리하지 못했습니다.').slice(0, 1200);
export function createMultiDeviceSettings(core, { readDevices, deviceControl }) {
  if (!deviceControl?.mutate || typeof readDevices !== 'function') throw new Error('DeviceControl and readDevices are required');
  const previews = new Map(), runs = new Map();
  function prune() {
    const now = Date.now();
    for (const [id, preview] of previews) if (preview.expiresAt < now || preview.consumed) previews.delete(id);
    while (previews.size > 32) previews.delete(previews.keys().next().value);
    for (const [id, run] of runs) if (now - run.createdAt > 24 * 60 * 60 * 1000 && core.jobs.get(id)?.state !== 'running') runs.delete(id);
    while (runs.size > 100) { const key = [...runs.keys()].find(id => core.jobs.get(id)?.state !== 'running'); if (!key) break; runs.delete(key); }
  }
  async function catalog() {
    const snapshot = await readDevices();
    const visible=[...new Map([...CORE_SETTINGS,...snapshot.devices.flatMap(device=>settingsForDevice(device))].map(setting=>[setting.namespace+':'+setting.key,setting])).values()];
    return { maxDevices: MAX_DEVICES, previewExpiresSeconds: TTL / 1000, devices: snapshot.devices.map(device => ({ id: device.id, name: name(device), model: device.model || null, manufacturer: device.manufacturer || null, online: online(device), connection: (device.transports || []).map(transport => `${transport.type || 'ADB'} · ${transport.state}`).join(', ') })), settings: visible.map(setting => ({ ...setting, options: setting.options?.map(option => ({ ...option })) })), categories: CATEGORIES };
  }
  async function shell(serial, args) {
    const result = await core.run(serial, ['shell', args.map(value => quote(String(value))).join(' ')], { timeout: 12000, maxBytes: 65536 });
    if (/^\s*(?:Error:|Exception|Security exception|Permission (?:denied|denial)|Unknown command|Failure)/im.test(`${result.stdout}\n${result.stderr}`)) fail('기기가 설정 조회를 허용하지 않거나 명령을 지원하지 않습니다.');
    return String(result.stdout || '').trim();
  }
  async function readTarget(deviceId, setting, deviceHint) {
    const { serial, device: resolvedDevice } = await core.resolve(deviceId), device = resolvedDevice || deviceHint;
    if (!device) fail('연결 기기 정보를 확인할 수 없습니다.');
    if(!setting||!settingsForDevice(device).some(row=>row.key===setting.key&&row.namespace===setting.namespace))fail('현재 기기에 해당 설정을 제공하는 활성 확장이 없습니다.');
    const currentUser = await shell(serial, ['am', 'get-current-user']);
    if (!/^(?:0|[1-9]\d{0,4})$/.test(currentUser)) fail('현재 사용자 번호를 확인할 수 없습니다.');
    if(settingWriteNeedsReview(setting.namespace,setting.key,device)){
      const fingerprint=(await shell(serial,['getprop','ro.build.fingerprint'])).trim();
      if(!fingerprint)fail('현재 펌웨어를 확인하지 못해 적용 대상에서 제외했습니다.');
      const restriction=settingWriteRestriction(setting.namespace,setting.key,fingerprint,device);
      if(restriction)fail(`${restriction.label}: ${restriction.reason}`);
    }
    const raw = await shell(serial, ['settings', '--user', currentUser, 'get', setting.namespace, setting.key]);
    const afterUser = await shell(serial, ['am', 'get-current-user']);
    if (afterUser !== currentUser) fail('값을 읽는 동안 사용자가 바뀌었습니다. 미리보기를 다시 실행하세요.');
    const value = raw === 'null' ? null : raw;
    const numeric = value === null || /^-?\d+(?:\.\d+)?$/.test(value) && value.length <= 64;
    const manufacturerMatch = !setting.manufacturer || String(device.manufacturer || '').toLowerCase().includes(setting.manufacturer);
    const available = numeric && manufacturerMatch && (!setting.requiresExisting || value !== null);
    return { deviceId, name: name(device), manufacturer: device.manufacturer || null, userId: currentUser, value, available, support: !numeric ? '설정 값 형식 확인 필요' : !manufacturerMatch ? '다른 제조사 전용 설정' : setting.requiresExisting && value === null ? '이 기기에 키가 없음' : value === null ? '현재 미지정 · 값 생성 시도 가능' : '현재 값 조회됨' };
  }
  async function preview(body) {
    prune(); const deviceIds = ids(body?.deviceIds), setting = SETTINGS.find(setting => setting.key === body?.key);
    if (!setting) fail('제공된 ADB 설정 목록에서 한 항목을 선택하세요.', 400);
    const value = validateSetting(setting, body.value);
    const snapshot = await readDevices(), rows = [], byId = new Map(snapshot.devices.map(device => [device.id, device]));
    if (deviceIds.some(id => !byId.has(id))) fail('선택한 기기가 현재 목록에 없습니다. 목록을 다시 읽으세요.');
    for (const deviceId of deviceIds) {
      const device = byId.get(deviceId);
      try {
        if (!online(device)) fail('연결되지 않은 기기입니다.');
        const target = await readTarget(deviceId, setting, device);
        rows.push({ ...target, targetValue: value, changed: target.value !== value, error: null });
      } catch (error) { rows.push({ deviceId, name: name(device), manufacturer: device.manufacturer || null, userId: null, value: null, targetValue: value, changed: null, available: false, support: '조회 불가 · 적용 제외', error: safeError(error) }); }
    }
    const plan = { previewId: randomUUID(), deviceIds, key: setting.key, namespace: setting.namespace, title: setting.title, description: setting.description, effectNote: setting.effectNote || null, value, rows, createdAt: Date.now(), expiresAt: Date.now() + TTL, consumed: false };
    previews.set(plan.previewId, plan); prune();
    return { ...plan, expiresAt: new Date(plan.expiresAt).toISOString(), notice: '기기별 값을 순서대로 적용합니다. 일부 실패 시 앞서 적용한 기기를 자동으로 되돌리지 않습니다. 지원 판정은 키·값·제조사 조건이며 실제 기능 효과까지 보장하지 않습니다.' };
  }
  function getRun(jobId) {
    if (typeof jobId !== 'string' || !runs.has(jobId)) fail('다기기 설정 작업 기록을 찾지 못했습니다.', 404);
    return runs.get(jobId);
  }
  function result(jobId) {
    prune(); const run = getRun(jobId), job = core.jobs.get(jobId);
    return { job: job ? core.publicJob(job) : { id: jobId, state: 'unknown' }, previewId: run.previewId, title: run.title, key: run.key, namespace: run.namespace, value: run.value, rows: run.rows.map(row => ({ ...row })), summary: { applied: run.rows.filter(row => row.state === 'applied' || row.state === 'undone').length, failed: run.rows.filter(row => row.state === 'failed').length, unchanged: run.rows.filter(row => row.state === 'unchanged').length, skipped: run.rows.filter(row => row.state === 'unsupported' || row.state === 'cancelled').length } };
  }
  function apply(body) {
    prune(); const plan = previews.get(body?.previewId);
    if (!plan || plan.consumed || plan.expiresAt < Date.now()) fail('미리보기가 만료되었거나 이미 실행했습니다. 다시 미리보기를 실행하세요.');
    const confirmed = ids(body.confirmDeviceIds);
    if (!sameIds(confirmed, plan.deviceIds)) fail('미리보기에 표시된 대상 기기를 모두 확인해야 합니다.', 400);
    if (!plan.rows.some(row => row.available)) fail('적용 가능한 대상이 없습니다. 기기와 설정을 다시 선택하세요.');
    const setting = SETTINGS.find(setting => setting.key === plan.key);
    const run = { previewId: plan.previewId, title: plan.title, key: plan.key, namespace: plan.namespace, value: plan.value, createdAt: Date.now(), rows: plan.rows.map(row => ({ ...row, state: row.available ? 'pending' : 'unsupported', message: row.available ? '적용 대기' : row.error || row.support, historyId: null, undoAvailable: false, undoing: false })) };
    plan.consumed = true;
    let job;
    try {
      job = core.startJob(plan.deviceIds[0], 'multi-device-settings', `${plan.deviceIds.length}대 설정 · ${plan.title}`, async job => {
        for (let index = 0; index < run.rows.length; index++) {
          const row = run.rows[index];
          if (job.cancelled) { for (const pending of run.rows.slice(index)) if (pending.state === 'pending') { pending.state = 'cancelled'; pending.message = '실행 전 중단 · 이미 적용한 다른 기기는 유지'; } break; }
          if (!row.available) { job.progress = Math.round((index + 1) / run.rows.length * 100); continue; }
          row.state = 'running'; row.message = '사용자·값 재확인 중';
          try {
            const current = await readTarget(row.deviceId, setting, row);
            if (job.cancelled) { row.state = 'cancelled'; row.message = '변경 전 중단'; continue; }
            if (!current.available) fail(current.support);
            if (current.userId !== row.userId || current.value !== row.value) fail('미리보기 이후 사용자 또는 설정값이 바뀌어 이 기기에는 적용하지 않았습니다.');
            if (current.value === plan.value) { row.state = 'unchanged'; row.message = '이미 같은 값 · 변경 없음'; }
            else {
              // DeviceControl checks the fixed user and expected value under its per-device
              // lock, and rechecks immediately before writing with a numeric --user.
              const changed = await deviceControl.mutate({ deviceId: row.deviceId, action: 'set', key: plan.key, value: plan.value, expected: row.value, expectedUserId: row.userId });
              if (!changed.ok || changed.setting?.value !== plan.value) fail('기기의 적용 결과를 확인하지 못했습니다. 현재 값을 다시 조회하세요.');
              const history = changed.history?.find(entry => entry.key === plan.key && entry.namespace === plan.namespace && entry.before === row.value && entry.after === plan.value && String(entry.userId) === row.userId && !entry.undone);
              row.state = 'applied'; row.message = changed.message || '저장·값 재조회 완료'; row.after = changed.setting.value;
              row.historyId = history?.id || null; row.undoAvailable = Boolean(history?.id && history.undoEligible !== false);
              if (!row.undoAvailable) row.message += ' · 복원 기록을 확인하지 못했습니다.';
            }
          } catch (error) { row.state = 'failed'; row.message = safeError(error); }
          job.progress = Math.round((index + 1) / run.rows.length * 100);
        }
        const applied = run.rows.filter(row => row.state === 'applied').length, failed = run.rows.filter(row => row.state === 'failed').length;
        job.output = JSON.stringify({ key: plan.key, namespace: plan.namespace, target: plan.value, rows: run.rows }, null, 2);
        return { message: `기기별 처리 완료 · 적용 ${applied}대 · 실패 ${failed}대. 자동 일괄 원복은 하지 않습니다.`, output: job.output };
      });
    } catch (error) { plan.consumed = false; throw error; }
    runs.set(job.id, run); return { job, previewId: plan.previewId };
  }
  async function undo(body) {
    const run = getRun(body?.jobId), job = core.jobs.get(body.jobId);
    if (job?.state === 'running') fail('묶음 적용이 끝난 뒤 기기별로 복원하세요.');
    if (typeof body.deviceId !== 'string' || body.confirmDeviceId !== body.deviceId) fail('복원할 기기를 확인하세요.', 400);
    const row = run.rows.find(row => row.deviceId === body.deviceId);
    if (!row || row.state !== 'applied' || !row.undoAvailable || !row.historyId || row.undoing) fail('개별 복원 가능한 기록이 아닙니다.');
    row.undoing = true;
    delete row.undoError;
    try {
      const restored = await deviceControl.mutate({ deviceId: row.deviceId, action: 'undo', historyId: row.historyId, expectedUserId: row.userId });
      if (restored?.ok !== true) fail('변경 전 값으로 복원했는지 확인하지 못했습니다. 현재 상태를 다시 조회하세요.');
      row.state = 'undone'; row.undoAvailable = false; row.message = restored.message || '변경 전 값으로 복원했습니다.';
      row.undoing = false;
      return { ok: true, message: row.message, result: result(body.jobId) };
    } catch (error) { row.undoError = safeError(error); throw error; }
    finally { row.undoing = false; }
  }
  return { catalog, preview, apply, result, undo };
}
