import {storagePaths} from './local-paths.mjs';
import path from 'node:path';
import { mkdir, readdir, readFile, stat, writeFile, rename, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { ActionError } from './connections.mjs';
import { packageName } from './operations-core.mjs';
import { readAppImpact } from './app-knowledge-tools.mjs';

const MAX_PACKAGES = 100, MAX_INVENTORY = 10000, PREVIEW_TTL = 10 * 60 * 1000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const LABELS = { enable: '활성화', disable: '비활성화', 'uninstall-user': '선택 사용자에서 제거', 'restore-system': '기본 앱 복원', 'restore-snapshot': '저장한 설치·활성 상태로 복구' };
const stateKey = state => `${state?.installed ? 1 : 0}:${state?.enabled ? 1 : 0}:${state?.kind || 'unknown'}:${state?.uid ?? ''}`;
const emptyState = () => ({ installed: false, enabled: false, kind: 'unknown' });

function device(value) {
  if (typeof value !== 'string' || !value || value.length > 512 || /[\x00-\x1f]/.test(value)) throw new ActionError('기기를 선택하세요.');
  return value;
}
function userScope(value = 'current') {
  if (value === 'current') return value;
  if (typeof value === 'number' && Number.isInteger(value)) value = String(value);
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,4})$/.test(value)) throw new ActionError('사용자·프로필을 목록에서 선택하세요.');
  return value;
}
function snapshotLabel(value, fallback = '직접 저장한 앱 상태') {
  if (value === undefined || value === '') return fallback;
  if (typeof value !== 'string' || !value.trim() || value.length > 100 || /[\x00-\x1f]/.test(value)) throw new ActionError('상태 이름은 100자 이내로 입력하세요.');
  return value.trim();
}
function strictKeys(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new ActionError(`${label} 파일 형식이 올바르지 않습니다.`);
}
function validateSnapshot(value) {
  strictKeys(value, ['format', 'id', 'deviceId', 'userId', 'createdAt', 'label', 'includesAppData', 'packages', 'origin'], '앱 상태');
  if (value.format !== 'adb-desk-app-state-v1' || typeof value.id !== 'string' || !UUID.test(value.id) || value.includesAppData !== false || typeof value.createdAt !== 'string' || value.createdAt.length > 40 || !Number.isFinite(Date.parse(value.createdAt)) || typeof value.label !== 'string' || !value.label.trim() || !Array.isArray(value.packages) || !value.packages.length || value.packages.length > MAX_INVENTORY) throw new ActionError('앱 상태 파일 형식이 올바르지 않습니다.');
  device(value.deviceId); if (userScope(value.userId) === 'current') throw new ActionError('저장된 사용자 번호가 올바르지 않습니다.'); snapshotLabel(value.label);
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > 2 * 1024 * 1024) throw new ActionError('앱 상태 파일은 2MB 이하만 가져올 수 있습니다.', 413);
  const seen = new Set();
  const packages = value.packages.map(item => {
    strictKeys(item, ['package', 'installed', 'enabled', 'kind'], '앱 상태 항목'); packageName(item.package);
    if (seen.has(item.package) || typeof item.installed !== 'boolean' || typeof item.enabled !== 'boolean' || !['system', 'user'].includes(item.kind) || !item.installed && item.enabled) throw new ActionError('앱 상태 파일 항목이 올바르지 않습니다.');
    seen.add(item.package); return { package: item.package, installed: item.installed, enabled: item.enabled, kind: item.kind };
  });
  let origin;
  if (value.origin !== undefined) {
    strictKeys(value.origin, ['deviceId', 'userId', 'snapshotId', 'createdAt', 'label'], '원본 정보');
    const item = value.origin; device(item.deviceId); if (userScope(item.userId) === 'current' || typeof item.snapshotId !== 'string' || !UUID.test(item.snapshotId) || typeof item.createdAt !== 'string' || item.createdAt.length > 40 || !Number.isFinite(Date.parse(item.createdAt)) || typeof item.label !== 'string' || !item.label.trim()) throw new ActionError('앱 상태 원본 정보가 올바르지 않습니다.');
    origin = { deviceId: item.deviceId, userId: String(item.userId), snapshotId: item.snapshotId, createdAt: item.createdAt, label: snapshotLabel(item.label) };
  }
  return { format: value.format, id: value.id, deviceId: value.deviceId, userId: String(value.userId), createdAt: value.createdAt, label: snapshotLabel(value.label), includesAppData: false, packages, ...(origin ? { origin } : {}) };
}
function names(value, { optional = false } = {}) {
  if (optional && value === undefined) return null;
  if (!Array.isArray(value) || !value.length || value.length > MAX_PACKAGES || new Set(value).size !== value.length) throw new ActionError(`목록에서 앱 1~${MAX_PACKAGES}개를 선택하세요.`);
  return value.map(packageName);
}
function parsePackages(output) {
  const result = new Set();
  for (const line of String(output).split(/\r?\n/).map(line => line.trim()).filter(Boolean)) {
    const match = /^package:([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)$/.exec(line);
    if (!match) throw new ActionError('앱 목록 응답을 확인할 수 없어 작업을 중단했습니다.', 502);
    result.add(packageName(match[1]));
  }
  if (result.size > MAX_INVENTORY) throw new ActionError('앱 목록 크기 한도를 초과했습니다.', 413);
  return result;
}
function parseUidPackages(output) {
  const result = new Map();
  for (const line of String(output).split(/\r?\n/).map(value => value.trim()).filter(Boolean)) {
    const match = /^package:([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)\s+uid:(\d+)$/.exec(line);
    if (!match || !Number.isSafeInteger(Number(match[2])) || Number(match[2]) > 2147483647 || result.has(match[1])) throw new ActionError('앱 UID를 확인할 수 없어 변경을 중단했습니다. 목록을 다시 조회하세요.', 409);
    result.set(match[1], Number(match[2]));
  }
  if (result.size > MAX_INVENTORY) throw new ActionError('앱 목록 크기 한도를 초과했습니다.', 413);
  return result;
}

export function createAppBatch(core) {
  const plans = new Map(), busy = new Set();
  const directory = id => path.join(storagePaths(core.root).dataRoot, 'app-state-snapshots', createHash('sha256').update(device(id)).digest('hex'));
  const checkCancelled = job => { if (job?.cancelled) throw new ActionError('앱 작업을 중지했습니다. 이미 적용한 결과는 자동으로 되돌리지 않습니다.', 409); };
  async function run(serial, args, job) {
    checkCancelled(job);
    const result = await core.run(serial, ['shell', ...args], { job, timeout: 30000, maxBytes: 4 * 1024 * 1024 });
    if (result.stderr || /\b(?:error:|exception|failure\s*\[|permission denied|permission denial|unknown command|not allowed)/i.test(result.stdout)) throw new ActionError((result.stderr || result.stdout).slice(0, 1500), 502);
    return result.stdout;
  }
  async function currentUser(serial, job) {
    const value = (await run(serial, ['am', 'get-current-user'], job)).trim();
    if (!/^\d{1,5}$/.test(value)) throw new ActionError('현재 사용자 번호를 확인할 수 없습니다.', 502);
    return value;
  }
  async function selectedUser(serial, requested, job) {
    const scope = userScope(requested);
    if (scope === 'current') return currentUser(serial, job);
    const output = await run(serial, ['pm', 'list', 'users'], job);
    const users = [...output.matchAll(/UserInfo\{(\d+):/g)].map(match => match[1]);
    if (!users.includes(scope)) throw new ActionError('선택한 사용자·프로필을 기기에서 확인할 수 없습니다.', 409);
    return scope;
  }
  async function readState(serial, requested = 'current', job) {
    const scope = userScope(requested), userId = await selectedUser(serial, scope, job);
    const installed = parseUidPackages(await run(serial, ['pm', 'list', 'packages', '--user', userId, '-U'], job));
    if (!installed.size) throw new ActionError('설치된 앱 목록이 비어 있어 상태 변경을 중단했습니다.', 502);
    const disabled = parsePackages(await run(serial, ['pm', 'list', 'packages', '--user', userId, '-d'], job));
    const system = parsePackages(await run(serial, ['pm', 'list', 'packages', '--user', userId, '-s', '-u'], job));
    if ([...disabled].some(pkg => !installed.has(pkg))) throw new ActionError('앱 목록이 조회 중 변경되었습니다. 다시 미리보기를 실행하세요.', 409);
    if (await selectedUser(serial, scope, job) !== userId) throw new ActionError('조회 중 사용자가 전환되었습니다. 다시 미리보기를 실행하세요.', 409);
    const packages = [...new Set([...installed.keys(), ...system])].sort().map(pkg => ({ package: pkg, installed: installed.has(pkg), enabled: installed.has(pkg) && !disabled.has(pkg), kind: system.has(pkg) ? 'system' : 'user', uid: installed.get(pkg) ?? null }));
    if (packages.length > MAX_INVENTORY) throw new ActionError('앱 목록 크기 한도를 초과했습니다.', 413);
    return { userId, packages };
  }
  async function readOne(serial, userId, pkg, job, requested = 'current') {
    if (await selectedUser(serial, requested, job) !== userId) throw new ActionError('대상 사용자가 바뀌어 남은 작업을 중단했습니다.', 409);
    const installed = parseUidPackages(await run(serial, ['pm', 'list', 'packages', '--user', userId, '-U', pkg], job));
    const disabled = parsePackages(await run(serial, ['pm', 'list', 'packages', '--user', userId, '-d', pkg], job));
    const system = parsePackages(await run(serial, ['pm', 'list', 'packages', '--user', userId, '-s', '-u', pkg], job));
    return { installed: installed.has(pkg), enabled: installed.has(pkg) && !disabled.has(pkg), kind: system.has(pkg) ? 'system' : installed.has(pkg) ? 'user' : 'unknown', uid: installed.get(pkg) ?? null };
  }
  async function saveSnapshot(deviceId, state, label, origin) {
    const value = { format: 'adb-desk-app-state-v1', id: randomUUID(), deviceId, userId: state.userId, createdAt: new Date().toISOString(), label, includesAppData: false, packages: state.packages.map(({ package: name, installed, enabled, kind }) => ({ package: name, installed, enabled, kind })), ...(origin ? { origin } : {}) };
    const dir = directory(deviceId); await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${value.id}.json`), JSON.stringify(value, null, 2), { flag: 'wx' });
    return value;
  }
  const metadata = value => ({ id: value.id, deviceId: value.deviceId, userId: value.userId, createdAt: value.createdAt, label: value.label, packageCount: value.packages.length, installedCount: value.packages.filter(item => item.installed).length, includesAppData: false, ...(value.origin ? { origin: value.origin } : {}) });
  const snapshotFile = (deviceId, id) => { if (typeof id !== 'string' || !UUID.test(id)) throw new ActionError('저장한 앱 상태를 목록에서 선택하세요.'); const dir = path.resolve(directory(deviceId)), file = path.resolve(dir, `${id}.json`); if (!file.startsWith(dir + path.sep)) throw new ActionError('잘못된 앱 상태 파일입니다.'); return file; };
  async function loadSnapshot(deviceId, id) {
    if (typeof id !== 'string' || !UUID.test(id)) throw new ActionError('저장한 앱 상태를 목록에서 선택하세요.');
    const file = snapshotFile(deviceId, id);
    let value;
    try { if ((await stat(file)).size > 5 * 1024 * 1024) throw new Error(); value = JSON.parse(await readFile(file, 'utf8')); }
    catch { throw new ActionError('저장한 앱 상태를 읽을 수 없습니다.', 404); }
    value = validateSnapshot(value);
    if (value.id !== id || value.deviceId !== deviceId) throw new ActionError('앱 상태 파일의 대상 기기가 다릅니다.');
    return value;
  }
  async function localUser(body) {
    if (body.userId === undefined) return null;
    const scope = userScope(body.userId); if (scope !== 'current') return scope;
    const { serial } = await core.resolve(device(body.deviceId)); return currentUser(serial);
  }
  async function scopedSnapshot(body) {
    const value = await loadSnapshot(device(body.deviceId), body.snapshotId), selected = await localUser(body);
    if (selected !== null && value.userId !== selected) throw new ActionError('선택한 사용자·프로필의 앱 상태를 선택하세요.', 409);
    return value;
  }
  async function list(body) {
    const id = device(body.deviceId), selected = await localUser(body); let files;
    try { files = await readdir(directory(id)); } catch (error) { if (error.code === 'ENOENT') return { snapshots: [] }; throw error; }
    const snapshots = [];
    for (const filename of files.filter(file => UUID.test(file.replace(/\.json$/, '')) && file.endsWith('.json'))) {
      try { const value = await loadSnapshot(id, filename.slice(0, -5)); if (selected === null || value.userId === selected) snapshots.push(metadata(value)); } catch { /* Ignore incomplete or invalid files in the listing. */ }
    }
    return { snapshots: snapshots.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 500) };
  }
  async function snapshot(body) {
    const deviceId = device(body.deviceId), label = snapshotLabel(body.label), scope = userScope(body.userId);
    const { serial } = await core.resolve(deviceId), value = await saveSnapshot(deviceId, await readState(serial, scope), label);
    return { snapshot: metadata(value), message: '설치·활성 상태를 PC에 저장했습니다. 앱 데이터·권한·구성요소 상태는 포함하지 않습니다.' };
  }
  async function exportSnapshot(body) { const value = await scopedSnapshot(body); return { snapshot: value, filename: `adb-app-state-user-${value.userId}-${value.createdAt.slice(0, 10)}.json` }; }
  async function importSnapshot(body) {
    const deviceId = device(body.deviceId), source = validateSnapshot(body.snapshot), scope = userScope(body.userId);
    const targetUserId = scope === 'current' ? await localUser({ deviceId, userId: scope }) : scope;
    const different = source.deviceId !== deviceId || source.userId !== targetUserId;
    const expected = { sourceDeviceId: source.deviceId, sourceUserId: source.userId, targetDeviceId: deviceId, targetUserId, acknowledged: true };
    if (different && (!body.mapping || Object.entries(expected).some(([key, value]) => body.mapping[key] !== value))) return { mappingRequired: true, source: metadata(source), target: { deviceId, userId: targetUserId }, message: '원본 기기·사용자가 다릅니다. 가져올 대상 연결을 확인하세요. 가져오기는 PC에 상태 기록만 저장합니다.' };
    const origin = source.origin || { deviceId: source.deviceId, userId: source.userId, snapshotId: source.id, createdAt: source.createdAt, label: source.label };
    const value = await saveSnapshot(deviceId, { userId: targetUserId, packages: source.packages }, snapshotLabel(body.label, source.label), origin);
    return { snapshot: metadata(value), mappingRequired: false, message: '앱 상태를 PC에 가져왔습니다. 폰에는 적용하지 않았습니다. 상태 비교에서 차이를 확인하세요.' };
  }
  async function renameSnapshot(body) {
    const value = await scopedSnapshot(body); value.label = snapshotLabel(body.label);
    const file = snapshotFile(value.deviceId, value.id), temporary = path.join(path.dirname(file), `.${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(value, null, 2), { flag: 'wx' });
    try { await rename(temporary, file); } catch (error) { await unlink(temporary).catch(() => {}); throw error; }
    return { snapshot: metadata(value), message: 'PC에 저장한 상태 이름을 바꿨습니다.' };
  }
  async function deleteSnapshot(body) {
    const value = await scopedSnapshot(body);
    if (body.confirmSnapshotId !== value.id) throw new ActionError('삭제할 PC 상태 기록을 확인하세요.');
    await unlink(snapshotFile(value.deviceId, value.id));
    for (const [id, plan] of plans) if (plan.deviceId === value.deviceId && plan.snapshotId === value.id) plans.delete(id);
    return { ok: true, message: 'PC의 앱 상태 기록을 삭제했습니다. 폰의 앱은 변경하지 않았습니다.' };
  }
  async function preview(body) {
    const deviceId = device(body.deviceId), action = body.action, scope = userScope(body.userId);
    if (!Object.hasOwn(LABELS, action)) throw new ActionError('지원하는 묶음 작업을 선택하세요.');
    const requested = names(body.packages, { optional: action === 'restore-snapshot' });
    const saved = action === 'restore-snapshot' ? await loadSnapshot(deviceId, body.snapshotId) : null;
    const { serial } = await core.resolve(deviceId), state = await readState(serial, scope);
    if (saved && saved.userId !== state.userId) throw new ActionError('저장 당시 사용자와 현재 사용자가 다릅니다. 같은 사용자에서 비교하세요.', 409);
    const current = new Map(state.packages.map(item => [item.package, item])), old = new Map((saved?.packages || []).map(item => [item.package, item]));
    const candidates = requested || [...new Set([...old.keys(), ...current.keys()])].sort();
    const items = candidates.map(pkg => {
      const from = current.get(pkg) || { package: pkg, ...emptyState() }, previous = old.get(pkg), to = { ...from };
      let reason = '', allowed = true;
      if (saved) {
        if (!previous) reason = '저장 이후 추가된 앱은 자동으로 제거하지 않습니다.';
        else if (!previous.installed) reason = '저장 당시 미설치 상태로 맞추기 위한 자동 삭제는 하지 않습니다.';
        else if (!from.installed && from.kind !== 'system') reason = '설치 파일이 남아 있는 기본 앱만 설치 상태를 복구할 수 있습니다. APK는 따로 복원하세요.';
        else { to.installed = true; to.enabled = previous.enabled; }
      } else if (action === 'restore-system') {
        if (from.kind !== 'system') reason = '기기에 설치 파일이 남아 있는 기본 앱만 복원할 수 있습니다.';
        else if (from.installed) reason = '이미 설치되어 있습니다.';
        else { to.installed = true; to.enabled = true; }
      } else if (!from.installed) reason = '선택 사용자에 설치된 앱만 선택할 수 있습니다.';
      else if (action === 'uninstall-user') { to.installed = false; to.enabled = false; }
      else to.enabled = action === 'enable';
      if (reason) allowed = false;
      else if (from.installed === to.installed && from.enabled === to.enabled) { allowed = false; reason = '이미 요청한 상태입니다.'; }
      return { package: pkg, from, to, action, allowed, reason };
    }).filter(item => !saved || item.allowed || item.from.installed !== (old.get(item.package)?.installed || false) || item.from.enabled !== (old.get(item.package)?.enabled || false));
    for (const [id, plan] of plans) if (plan.expiresAt < Date.now()) plans.delete(id);
    if (plans.size >= 100) plans.delete(plans.keys().next().value);
    const plan = { previewId: randomUUID(), deviceId, userId: state.userId, userScope: scope, action, items, expiresAt: Date.now() + PREVIEW_TTL, snapshotId: saved?.id || null, ...(saved?.origin ? { sourceOrigin: saved.origin } : {}) };
    let impact = null;
    if (items.length) try { impact = await readAppImpact(core.root, { packages: items.map(item => item.package), inventory: state.packages, userId: state.userId, action }); } catch { impact = { available: false, notice: '참고 자료의 연결 정보를 읽지 못했습니다. 미리보기는 앱 설치·활성 상태만 비교합니다.' }; }
    plans.set(plan.previewId, plan);
    return { ...plan, impact, expiresAt: new Date(plan.expiresAt).toISOString(), maximumSelection: MAX_PACKAGES, message: saved ? '차이만 표시합니다. 복구할 앱을 최대 100개 선택하세요. 앱 개인 데이터·권한·구성요소 설정은 복구하지 않습니다.' : '미리보기만 완료했습니다. 적용할 대상을 확인한 뒤 실행하세요.' };
  }
  async function execute(body) {
    const deviceId = device(body.deviceId), selected = names(body.packages), plan = plans.get(body.previewId);
    if (body.confirmDevice !== deviceId) throw new ActionError('대상 기기와 앱 목록을 확인한 뒤 실행하세요.');
    if (!plan || plan.deviceId !== deviceId || plan.expiresAt < Date.now()) throw new ActionError('미리보기가 만료되었습니다. 다시 비교하세요.', 409);
    if (userScope(body.userId) !== plan.userScope) throw new ActionError('선택 사용자가 바뀌었습니다. 다시 미리보기를 확인하세요.', 409);
    const rows = selected.map(pkg => plan.items.find(item => item.package === pkg && item.allowed));
    if (rows.some(row => !row)) throw new ActionError('미리보기에서 적용 가능한 앱만 선택하세요.');
    if (busy.has(deviceId)) throw new ActionError('이 기기의 다른 묶음 작업이 진행 중입니다.', 409);
    const { serial } = await core.resolve(deviceId);
    if (plans.get(body.previewId) !== plan || busy.has(deviceId)) throw new ActionError('이미 실행한 미리보기이거나 다른 묶음 작업이 진행 중입니다.', 409);
    busy.add(deviceId);
    try {
      const result = core.startJob(deviceId, 'app-batch', `${LABELS[plan.action]} · ${rows.length}개`, async job => {
        const results = []; let before;
        const publish = () => { job.output = [`작업: ${LABELS[plan.action]}`, `사용자: ${plan.userId}`, before ? `작업 전 상태: ${before.label} (${before.id})` : '', ...results.map(item => `${item.package} | ${item.status} | ${item.message}`)].filter(Boolean).join('\n'); };
        try {
          const fresh = await readState(serial, plan.userScope, job), byName = new Map(fresh.packages.map(item => [item.package, item]));
          if (fresh.userId !== plan.userId || rows.some(row => stateKey(byName.get(row.package) || emptyState()) !== stateKey(row.from))) throw new ActionError('미리보기 이후 앱 상태나 사용자가 바뀌었습니다. 적용하지 않았습니다. 다시 비교하세요.', 409);
          before = await saveSnapshot(deviceId, fresh, `묶음 작업 전 · ${LABELS[plan.action]}`); publish();
          for (const row of rows) {
            checkCancelled(job);
            let changed = false;
            try {
              if (stateKey(await readOne(serial, plan.userId, row.package, job, plan.userScope)) !== stateKey(row.from)) throw new ActionError('앱 상태가 바뀌었습니다. 남은 작업을 중단합니다.', 409);
              const commands = [];
              if (!row.to.installed) commands.push(['pm', 'uninstall', '--user', plan.userId, row.package]);
              else {
                if (!row.from.installed) commands.push(['cmd', 'package', 'install-existing', '--user', plan.userId, row.package]);
                if (!row.from.installed || row.from.enabled !== row.to.enabled) commands.push(['pm', row.to.enabled ? 'enable' : 'disable-user', '--user', plan.userId, row.package]);
              }
              for (const args of commands) { checkCancelled(job); changed = true; const output = await run(serial, args, job); if (/\b(?:failure|failed|not installed|unknown package|error)\b/i.test(output)) throw new ActionError(output.slice(0, 1500), 502); }
              const after = await readOne(serial, plan.userId, row.package, job, plan.userScope);
              if (after.installed !== row.to.installed || after.enabled !== row.to.enabled) throw new ActionError('실제 상태가 요청 결과와 다릅니다.', 502);
              results.push({ package: row.package, status: '완료', message: LABELS[plan.action], from: row.from, to: after });
            } catch (error) {
              results.push({ package: row.package, status: job.cancelled ? '중지' : '실패', message: `${error.message}${changed ? ' · 일부 명령은 적용됐을 수 있습니다.' : ''}`, from: row.from }); publish(); throw error;
            }
            job.progress = Math.round(results.length / rows.length * 100); publish();
          }
          return { message: `앱 ${rows.length}개를 처리했습니다. 작업 전 상태를 PC에 저장했습니다. 개인 데이터 삭제는 상태 복구로 되돌릴 수 없습니다.`, output: job.output };
        } finally {
          for (const row of rows) if (!results.some(item => item.package === row.package)) results.push({ package: row.package, status: '실행 안 함', message: '앞선 오류 또는 중지로 실행하지 않았습니다.' });
          publish(); busy.delete(deviceId);
          const dir = await core.tempDir(); job.directory = dir; job.artifact = path.join(dir, 'app-batch-result.json'); job.downloadName = 'app-batch-result.json';
          await writeFile(job.artifact, JSON.stringify({ deviceId, userId: plan.userId, action: plan.action, beforeSnapshot: before ? metadata(before) : null, results }, null, 2));
        }
      });
      plans.delete(body.previewId);
      return result;
    } catch (error) { busy.delete(deviceId); throw error; }
  }
  return { list, snapshot, preview, execute, exportSnapshot, importSnapshot, renameSnapshot, deleteSnapshot };
}
