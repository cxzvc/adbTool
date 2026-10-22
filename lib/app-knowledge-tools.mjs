import path from 'node:path';
import { readFile, writeFile, mkdir, rename, unlink, readdir, lstat, rmdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { ActionError } from './connections.mjs';
import { invalidateAppKnowledgeCache, describeAppKnowledge,appReferencePaths,readAppReference } from './app-knowledge.mjs';
import {storagePaths} from './local-paths.mjs';

const OWNER = 'Universal-Debloater-Alliance', REPO = 'universal-android-debloater-next-generation';
const REPOSITORY = `https://github.com/${OWNER}/${REPO}`;
const MAX_BYTES = 8 * 1024 * 1024, TTL = 15 * 60 * 1000;
const hash = value => createHash('sha256').update(value).digest('hex');
const pkg = value => typeof value === 'string' && value.length <= 255 && /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/.test(value);
function selected(values, limit = 100) {
  if (!Array.isArray(values) || !values.length || values.length > limit || values.some(value => !pkg(value)) || new Set(values).size !== values.length) throw new ActionError(`패키지 목록은 중복 없이 최대 ${limit}개까지 지정하세요.`);
  return values;
}
const sourceFields = ['list', 'description', 'dependencies', 'neededBy', 'labels', 'removal'];
function normalizeUpstream(value) {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new ActionError('공식 참고 자료의 JSON 형식이 올바르지 않습니다.');
  const entries = Object.entries(value); if (!entries.length || entries.length > 20000) throw new ActionError('공식 참고 자료의 항목 수가 허용 범위를 벗어납니다.');
  const result = Object.create(null);
  for (const [name, item] of entries) {
    if (!pkg(name) || !item || Array.isArray(item) || typeof item !== 'object' || typeof item.description !== 'string' || item.description.length > 64000 || !['Aosp', 'Oem', 'Google', 'Carrier', 'Misc', 'Pending', 'Unlisted'].includes(item.list) || !['Recommended', 'Advanced', 'Expert', 'Unsafe', 'Unlisted'].includes(item.removal)) throw new ActionError(`참고 자료 항목을 확인할 수 없습니다: ${name.slice(0, 100)}`);
    for (const key of ['dependencies', 'neededBy', 'labels']) if (!Array.isArray(item[key]) || item[key].length > 500 || item[key].some(value => typeof value !== 'string' || value.length > 512 || /[\x00-\x1f]/.test(value) || key !== 'labels' && !pkg(value))) throw new ActionError(`참고 자료의 연결 정보 형식이 올바르지 않습니다: ${name}`);
    result[name] = Object.fromEntries(sourceFields.map(key => [key, Array.isArray(item[key]) ? [...new Set(item[key])] : item[key]]));
  }
  return result;
}
function localReference(text) {
  let data; try { data = JSON.parse(text); } catch { throw new ActionError('PC의 앱 참고 자료를 읽을 수 없습니다.'); }
  if (data?.schemaVersion !== 1 || !data.source || !data.packages || Array.isArray(data.packages)) throw new ActionError('PC의 앱 참고 자료 형식이 올바르지 않습니다.');
  return data;
}

export function buildAppImpact(reference, body) {
  const targets = selected(body.packages, 10000), inventory = body.inventory;
  if (!Array.isArray(inventory) || inventory.length > 10000) throw new ActionError('최근 앱 목록을 확인하세요.');
  const installed = new Map();
  for (const item of inventory) {
    if (!item || !pkg(item.package) || installed.has(item.package) || item.installed !== undefined && typeof item.installed !== 'boolean' || item.enabled !== undefined && item.enabled !== null && typeof item.enabled !== 'boolean') throw new ActionError('앱 상태 목록 형식이 올바르지 않습니다.');
    const uid = item.uid == null ? null : Number(item.uid);
    if (uid !== null && (!Number.isSafeInteger(uid) || uid < 0 || uid > 2147483647 || !/^\d+$/.test(String(item.uid)))) throw new ActionError('앱 UID 형식이 올바르지 않습니다.');
    installed.set(item.package, { installed: item.installed !== false, enabled: typeof item.enabled === 'boolean' ? item.enabled : null, uid });
  }
  const edges = new Map();
  const edge = (consumer, dependency, evidence) => {
    if (!pkg(consumer) || !pkg(dependency) || consumer === dependency) return;
    const key = `${consumer}\0${dependency}`; if (!edges.has(key)) edges.set(key, { consumer, dependency, evidence: [] });
    const record = edges.get(key); if (!record.evidence.some(item => item.package === evidence.package && item.field === evidence.field)) record.evidence.push(evidence);
  };
  for (const [name, info] of Object.entries(reference.packages || {})) {
    for (const dependency of info.dependencies || []) edge(name, dependency, { package: name, field: 'dependencies' });
    for (const consumer of info.neededBy || []) edge(consumer, name, { package: name, field: 'neededBy' });
  }
  const outgoing = new Map(), incoming = new Map();
  for (const value of edges.values()) { if (!outgoing.has(value.consumer)) outgoing.set(value.consumer, []); if (!incoming.has(value.dependency)) incoming.set(value.dependency, []); outgoing.get(value.consumer).push(value); incoming.get(value.dependency).push(value); }
  const targetSet = new Set(targets), removing = ['disable', 'uninstall-user'].includes(body.action);
  const uidGroups = new Map(); for (const [name, state] of installed) if (state.installed && state.uid !== null) { if (!uidGroups.has(state.uid)) uidGroups.set(state.uid, []); uidGroups.get(state.uid).push(name); }
  const related = (name, evidence) => {
    const current = installed.get(name), info = Object.hasOwn(reference.packages, name) ? reference.packages[name] : null;
    return { package: name, title: info?.titleKo || name, installed: current?.installed ?? null, enabled: current?.installed ? current.enabled : null, uid: current?.uid ?? null, state: !current ? 'not-listed' : !current.installed ? 'not-installed' : current.enabled === null ? 'enabled-unknown' : current.enabled ? 'enabled' : 'disabled', selected: targetSet.has(name), evidence };
  };
  const items = targets.map(name => {
    const requires = [], neededBy = [];
    for (const value of outgoing.get(name) || []) requires.push(related(value.dependency, value.evidence));
    for (const value of incoming.get(name) || []) neededBy.push(related(value.consumer, value.evidence));
    const uid = installed.get(name)?.uid, sharedUid = uid == null ? [] : (uidGroups.get(uid) || []).filter(other => other !== name).map(other => related(other, [{ package: name, field: 'observed-shared-uid', uid }]));
    const warnings = [];
    if (removing) { for (const item of neededBy) if (item.installed && item.enabled) warnings.push({ package: item.package, kind: item.selected ? 'also-selected' : 'active-consumer', message: item.selected ? '이 앱을 사용하는 활성 앱도 함께 선택되어 있습니다.' : '선택하지 않은 활성 앱이 이 패키지를 사용한다고 기록되어 있습니다. 중지·제거 시 영향 가능성을 확인하세요.' }); }
    else if (['enable', 'restore-system', 'restore-snapshot'].includes(body.action)) { for (const item of requires) if (!item.installed || item.enabled !== true) warnings.push({ package: item.package, kind: 'dependency-unavailable', message: item.state === 'enabled-unknown' ? '사용한다고 기록된 관련 앱의 활성 상태가 미확인입니다.' : '사용한다고 기록된 관련 앱이 활성 목록에 없습니다. 복구 후 기능에 영향을 줄 수 있습니다.' }); }
    if (removing && sharedUid.length) warnings.push({ package: name, kind: 'shared-uid', message: `UID ${uid}를 ${sharedUid.length}개 앱과 공유합니다. 프로세스·권한·데이터 접근을 공유할 수 있으므로 연결된 앱을 함께 확인하세요. 앱 하나의 비활성화가 모두 비활성화한다는 뜻은 아닙니다.` });
    return { package: name, found: Object.hasOwn(reference.packages, name), requires: requires.slice(0, 200), neededBy: neededBy.slice(0, 200), sharedUid: sharedUid.slice(0, 200), warnings: warnings.slice(0, 200), truncated: requires.length > 200 || neededBy.length > 200 || sharedUid.length > 200 };
  });
  return { available: true, userId: String(body.userId ?? 'current'), action: body.action || 'inspect', items, source: { commit: reference.source?.commit, sourceUrl: reference.source?.sourceUrl }, observedAt: new Date().toISOString(), notice: '최근 조회한 선택 사용자 앱 목록과 커뮤니티에 기록된 연결만 비교합니다. 빈 관계는 영향 없음의 증거가 아니며 펌웨어·앱 버전별 실제 동작을 보장하지 않습니다.' };
}

export async function readAppImpact(root, body) {
  const reference = localReference((await readAppReference(root)).text);
  return buildAppImpact(reference, body);
}

export function createAppKnowledgeTools({ root, fetchImpl = globalThis.fetch, onApplied, fileIO = {} } = {}) {
  if (typeof root !== 'string') throw new Error('Application root required');
  const referencePath = appReferencePaths(root).local, versionsRoot = path.join(storagePaths(root).dataRoot,'uad-reference-versions'), reviews = new Map(); let checking = false, applying = false;
  const io = { writeFile, mkdir, rename, unlink, rmdir, ...fileIO };
  const versionPattern = /^[a-f0-9]{40}-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  async function local() { let text; try { text = (await readAppReference(root)).text; } catch (error) { throw new ActionError(error.code === 'ENOENT' ? 'PC 앱 참고 자료 파일이 없습니다. 제공된 자료 파일을 복원한 뒤 다시 확인하세요.' : 'PC 앱 참고 자료를 읽을 수 없습니다. 파일 권한을 확인하세요.', 503); } return { text, data: localReference(text), hash: hash(text) }; }
  function metadata(data) { return { ...data.source, packageCount: Object.keys(data.packages).length, koreanSummaryCount: Object.values(data.packages).filter(item => item.summaryKo).length, summariesNeedingReview: Object.values(data.packages).filter(item => item.koreanReviewRequired).length }; }
  async function status() { return { source: metadata((await local()).data), notice: '조회·업데이트는 PC 참고 자료만 대상으로 합니다. 앱 추천 목록을 자동 선택하거나 폰 상태를 바꾸지 않습니다.' }; }
  function allowed(url) {
    const value = new URL(url); if (value.protocol !== 'https:' || value.port || value.username || value.password) return false;
    const repo = '(?:universal-android-debloater-next-generation|universal-android-debloater)';
    return value.hostname === 'api.github.com' && new RegExp(`^/repos/${OWNER}/${repo}/branches/main$`).test(value.pathname) || value.hostname === 'raw.githubusercontent.com' && new RegExp(`^/${OWNER}/${repo}/[a-f0-9]{40}/(?:resources/assets/uad_lists\\.json|LICENSE)$`).test(value.pathname);
  }
  async function remote(url, limit = MAX_BYTES) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
    try {
      for (let redirect = 0; redirect < 4; redirect++) {
        if (!allowed(url)) throw new ActionError('공식 UAD-NG 자료 주소만 조회할 수 있습니다.');
        const response = await fetchImpl(url, { redirect: 'manual', signal: controller.signal, headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'ADB-Desk-reference-review' } });
        if ([301, 302, 307, 308].includes(response.status)) { const location = response.headers.get('location'); if (!location) throw new ActionError('공식 자료 주소 이동을 확인할 수 없습니다.'); url = new URL(location, url).href; continue; }
        if (!response.ok) throw new ActionError(`공식 자료 조회 실패 (HTTP ${response.status}). GitHub 접근 상태를 확인하세요.`, 502);
        const declared = Number(response.headers.get('content-length')); if (Number.isFinite(declared) && declared > limit) throw new ActionError('공식 자료 응답 크기 한도를 초과했습니다.', 413);
        const chunks = []; let size = 0;
        for await (const chunk of response.body) { size += chunk.length; if (size > limit) { controller.abort(); throw new ActionError('공식 자료 응답 크기 한도를 초과했습니다.', 413); } chunks.push(Buffer.from(chunk)); }
        return Buffer.concat(chunks).toString('utf8');
      }
      throw new ActionError('공식 자료 주소 이동이 너무 많습니다.');
    } catch (error) { if (error.name === 'AbortError') throw new ActionError('공식 자료 조회 시간이 초과되었습니다.', 504); throw error; }
    finally { clearTimeout(timer); }
  }
  function plan(id) { const value = reviews.get(id); if (!value || value.expiresAt < Date.now()) throw new ActionError('자료 변경 검토가 만료되었습니다. 업데이트를 다시 확인하세요.', 409); return value; }
  function keepReview(value) { for (const [key, entry] of reviews) if (entry.expiresAt < Date.now()) reviews.delete(key); while (reviews.size >= 3) reviews.delete(reviews.keys().next().value); reviews.set(value.id, value); }
  function resultReview(value) { return { upToDate: false, operation: value.operation || 'update', reviewId: value.id, expiresAt: new Date(value.expiresAt).toISOString(), before: metadata(value.before), after: metadata(value.candidate), summary: { added: value.changes.filter(item => item.kind === 'added').length, changed: value.changes.filter(item => item.kind === 'changed').length, removed: value.changes.filter(item => item.kind === 'removed').length, koreanSummariesNeedingReview: Object.values(value.candidate.packages).filter(item => item.koreanReviewRequired).length }, changes: value.changes, message: value.operation === 'rollback' ? 'PC에 보관된 자료로 되돌릴 차이를 준비했습니다. 원문·한글 요약 모두 선택한 버전으로 복구되며 폰은 변경하지 않습니다.' : 'UAD 원문과 PC 자료의 차이를 준비했습니다. 항목을 눌러 원문을 확인한 뒤 PC 반영을 선택하세요. 폰은 변경하지 않습니다.' }; }
  function versionPath(id, filename) { if (typeof id !== 'string' || !versionPattern.test(id)) throw new ActionError('보관된 자료 버전을 목록에서 선택하세요.'); const directory = path.resolve(versionsRoot, id), file = path.resolve(directory, filename); if (!directory.startsWith(versionsRoot + path.sep) || !file.startsWith(directory + path.sep)) throw new ActionError('자료 보관 경로가 올바르지 않습니다.'); return file; }
  async function archived(id, variant) {
    if (!['before', 'after'].includes(variant)) throw new ActionError('보관 시점을 선택하세요.');
    const filename = variant === 'before' ? 'previous-reference.json' : 'reference.json', file = versionPath(id, filename);
    const folder = await lstat(path.dirname(file)), info = await lstat(file); if (!folder.isDirectory() || folder.isSymbolicLink() || !info.isFile() || info.isSymbolicLink() || info.size > 24 * 1024 * 1024) throw new ActionError('보관된 자료 파일을 읽을 수 없습니다.');
    const text = await readFile(file, 'utf8'), data = localReference(text); normalizeUpstream(data.packages);
    if (!/^[a-f0-9]{40}$/.test(data.source?.commit || '') || data.source.license !== 'GPL-3.0') throw new ActionError('보관 자료의 출처·라이선스를 확인할 수 없습니다.');
    return { text, data };
  }
  async function versions() {
    let directories; try { directories = await readdir(versionsRoot, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return { versions: [] }; throw error; }
    const rows = [];
    for (const dir of directories.filter(item => item.isDirectory() && versionPattern.test(item.name))) {
      const date = (await lstat(path.join(versionsRoot, dir.name))).mtime.toISOString();
      for (const variant of ['before', 'after']) try { const value = await archived(dir.name, variant); rows.push({ versionId: dir.name, variant, archivedAt: date, source: metadata(value.data), label: variant === 'before' ? '반영 전 자료' : '반영한 자료' }); } catch { /* Invalid or incomplete local archives never become rollback targets. */ }
    }
    return { versions: rows.sort((a, b) => b.archivedAt.localeCompare(a.archivedAt)).slice(0, 200) };
  }
  async function rollbackPreview(body) {
    if (checking || applying) throw new ActionError('자료 확인 또는 반영 작업이 진행 중입니다.', 409); checking = true;
    try {
      const before = await local(), restored = await archived(body.versionId, body.variant), candidate = restored.data;
      if (before.hash === hash(restored.text) || before.data.source.commit === candidate.source.commit && JSON.stringify(before.data.packages) === JSON.stringify(candidate.packages)) return { upToDate: true, source: metadata(before.data), message: '현재 PC 자료와 선택한 보관 자료가 같습니다.' };
      const changes = [], fieldsToCompare = [...sourceFields, 'titleKo', 'summaryKo', 'koreanReviewRequired', 'summarySourceCommit', 'functionKo', 'removalImpactKo', 'alternativeKo', 'functionReview'];
      for (const [name, item] of Object.entries(candidate.packages)) { const previous = Object.hasOwn(before.data.packages, name) ? before.data.packages[name] : null, fields = previous ? fieldsToCompare.filter(key => JSON.stringify(previous[key]) !== JSON.stringify(item[key])) : sourceFields; if (!previous || fields.length) changes.push({ package: name, kind: previous ? 'changed' : 'added', fields, koreanReviewRequired: Boolean(item.koreanReviewRequired) }); }
      for (const name of Object.keys(before.data.packages)) if (!Object.hasOwn(candidate.packages, name)) changes.push({ package: name, kind: 'removed', fields: [], koreanReviewRequired: false });
      const licenseFile = versionPath(body.versionId, 'LICENSE.txt'), licenseInfo = await lstat(licenseFile); if (!licenseInfo.isFile() || licenseInfo.isSymbolicLink() || licenseInfo.size > 128 * 1024) throw new ActionError('보관된 GPL 라이선스를 읽을 수 없습니다.'); const license = await readFile(licenseFile, 'utf8'); if (!/GNU GENERAL PUBLIC LICENSE/.test(license) || !/Version 3/.test(license)) throw new ActionError('보관된 GPL-3.0 라이선스를 확인할 수 없습니다.');
      const value = { id: randomUUID(), operation: 'rollback', rollbackSource: { versionId: body.versionId, variant: body.variant }, expiresAt: Date.now() + TTL, baseHash: before.hash, before: before.data, priorText: before.text, candidate, archivedText: restored.text, raw: null, license, changes }; keepReview(value); return resultReview(value);
    } finally { checking = false; }
  }
  async function check() {
    if (checking || applying) throw new ActionError('자료 확인 또는 반영 작업이 진행 중입니다.', 409); checking = true;
    try {
      const before = await local(); let commit;
      try { const branch = JSON.parse(await remote(`https://api.github.com/repos/${OWNER}/${REPO}/branches/main`, 256 * 1024)); if (branch.name !== 'main' || !branch.commit) throw new ActionError('공식 main 브랜치의 버전을 확인할 수 없습니다.'); commit = branch.commit; } catch (error) { if (error instanceof ActionError) throw error; throw new ActionError('공식 버전 응답이 올바른 JSON이 아닙니다.'); }
      const sha = commit.sha, date = commit.commit?.committer?.date;
      if (typeof sha !== 'string' || !/^[a-f0-9]{40}$/.test(sha) || typeof date !== 'string' || !Number.isFinite(Date.parse(date))) throw new ActionError('공식 버전 식별자를 확인할 수 없습니다.');
      if (sha === before.data.source.commit) return { upToDate: true, source: metadata(before.data), message: 'PC 참고 자료와 공식 저장소의 커밋이 같습니다.' };
      const raw = await remote(`https://raw.githubusercontent.com/${OWNER}/${REPO}/${sha}/resources/assets/uad_lists.json`), license = await remote(`https://raw.githubusercontent.com/${OWNER}/${REPO}/${sha}/LICENSE`, 128 * 1024);
      if (license.length < 1000 || !/GNU GENERAL PUBLIC LICENSE/.test(license) || !/Version 3/.test(license)) throw new ActionError('자료와 함께 보관할 GPL-3.0 라이선스를 확인할 수 없습니다.');
      let upstream; try { upstream = normalizeUpstream(JSON.parse(raw)); } catch (error) { if (error instanceof ActionError) throw error; throw new ActionError('공식 패키지 자료를 JSON으로 읽지 못했습니다.'); }
      const changes = [], converted = Object.create(null); let summaryReviewCount = 0;
      for (const [name, item] of Object.entries(upstream)) {
        const old = Object.hasOwn(before.data.packages, name) ? before.data.packages[name] : null;
        const fields = old ? sourceFields.filter(key => JSON.stringify(old[key]) !== JSON.stringify(item[key])) : [...sourceFields];
        const changedMeaning = old && fields.some(key => ['description', 'list', 'removal', 'dependencies', 'neededBy'].includes(key));
        converted[name] = { ...item };
        if (old?.titleKo) converted[name].titleKo = old.titleKo;
        if (old?.summaryKo) {
          converted[name].summaryKo = old.summaryKo;
          for(const field of ['functionKo','removalImpactKo','alternativeKo','functionReview'])if(old[field]!==undefined)converted[name][field]=structuredClone(old[field]);
          converted[name].summarySourceCommit = old.summarySourceCommit || before.data.source.commit;
          converted[name].koreanReviewRequired = Boolean(old.koreanReviewRequired || changedMeaning);
          if (converted[name].koreanReviewRequired) summaryReviewCount++;
        }
        if (!old || fields.length) changes.push({ package: name, kind: old ? 'changed' : 'added', fields, koreanReviewRequired: Boolean(converted[name].koreanReviewRequired) });
      }
      for (const name of Object.keys(before.data.packages)) if (!Object.hasOwn(upstream, name)) changes.push({ package: name, kind: 'removed', fields: [], koreanReviewRequired: false });
      const source = { name: 'Universal Android Debloater Next Generation', repository: REPOSITORY, retrievedAt: new Date().toISOString(), commit: sha, commitDate: date, datasetPath: 'resources/assets/uad_lists.json', sourceSha256: hash(raw), license: 'GPL-3.0', sourceUrl: `${REPOSITORY}/blob/${sha}/resources/assets/uad_lists.json`, licenseUrl: `${REPOSITORY}/blob/${sha}/LICENSE`, notice: 'UAD-ng community reference. Korean summaries are retained local adaptations; changed upstream meanings are flagged for review. No device safety verification.' };
      const candidate = { schemaVersion: 1, source, koreanSummaryCount: Object.values(converted).filter(item => item.summaryKo).length, packages: converted }, id = randomUUID();
      const value = { id, operation: 'update', expiresAt: Date.now() + TTL, baseHash: before.hash, before: before.data, priorText: before.text, candidate, raw, license, changes }; keepReview(value); return resultReview(value);
    } finally { checking = false; }
  }
  async function review(body) {
    const value = plan(body.reviewId); if (!pkg(body.package) || !value.changes.some(item => item.package === body.package)) throw new ActionError('변경 목록에서 패키지를 선택하세요.');
    return { package: body.package, before: Object.hasOwn(value.before.packages, body.package) ? value.before.packages[body.package] : null, after: Object.hasOwn(value.candidate.packages, body.package) ? value.candidate.packages[body.package] : null, sourceBefore: value.before.source.commit, sourceAfter: value.candidate.source.commit };
  }
  async function apply(body) {
    if (applying || checking) throw new ActionError('자료 확인 또는 반영 작업이 진행 중입니다.', 409);
    const value = plan(body.reviewId); if (body.confirmCommit !== value.candidate.source.commit) throw new ActionError('검토한 자료 버전을 확인한 뒤 PC에 반영하세요.'); applying = true;
    let archive, temporary, committed = false, createdArchive = false; const staged = [];
    try {
      if ((await local()).hash !== value.baseHash) throw new ActionError('검토 이후 PC 자료가 바뀌었습니다. 새 차이를 확인하세요.', 409);
      const archiveName = `${value.candidate.source.commit}-${randomUUID()}`; archive = path.resolve(versionsRoot, archiveName); if (!archive.startsWith(versionsRoot + path.sep)) throw new ActionError('보관 경로 확인에 실패했습니다.'); await io.mkdir(versionsRoot, { recursive: true }); await io.mkdir(archive); createdArchive = true;
      const put = async (filename, text) => { const file = path.resolve(archive, filename); if (!file.startsWith(archive + path.sep)) throw new ActionError('보관 파일 경로가 올바르지 않습니다.'); staged.push(file); await io.writeFile(file, text, { flag: 'wx' }); };
      const notice = `UAD-ng reference ${value.operation || 'update'}\nSource: ${REPOSITORY}\nCommit: ${value.candidate.source.commit}\nCopyright: UAD and UAD-ng contributors.\nLicense: GPL-3.0; full text in LICENSE.txt.\n${value.operation === 'rollback' ? 'Restored local version: rollback-source.json. Original provenance remains in its source metadata.' : 'Unmodified upstream source: upstream.json.'}\nPrevious local reference: previous-reference.json.\nKorean adaptations retained; summaries needing review are explicitly flagged.\nNo automatic device actions.\n`;
      await put(value.operation === 'rollback' ? 'rollback-source.json' : 'upstream.json', value.operation === 'rollback' ? value.archivedText : value.raw); await put('LICENSE.txt', value.license); await put('NOTICE.txt', notice); await put('previous-reference.json', value.priorText);
      const candidate = { ...value.candidate, source: { ...value.candidate.source, localArchive: path.relative(root,archive).split(path.sep).join('/') } };
      const text = JSON.stringify(candidate, null, 2); temporary = path.join(path.dirname(referencePath), `.${randomUUID()}.reference.tmp`);
      await put('reference.json', text); await put('operation.json', JSON.stringify({ operation: value.operation || 'update', at: new Date().toISOString(), commit: candidate.source.commit, rollbackSource: value.rollbackSource || null }, null, 2)); await io.writeFile(temporary, text, { flag: 'wx' });
      if ((await local()).hash !== value.baseHash) throw new ActionError('반영 준비 중 PC 자료가 바뀌었습니다. 새 차이를 확인하세요.', 409); await io.rename(temporary, referencePath); committed = true;
      reviews.clear(); invalidateAppKnowledgeCache(root); let cacheWarning;
      try { await onApplied?.(); } catch (error) { cacheWarning = error.message; }
      return { applied: true, operation: value.operation || 'update', source: metadata(candidate), archive: candidate.source.localArchive, ...(cacheWarning ? { cacheWarning } : {}), message: value.operation === 'rollback' ? '선택한 보관 버전의 원문·한글 요약으로 PC 자료를 되돌렸습니다. 되돌리기 직전 자료도 보존했고 폰 상태는 변경하지 않았습니다.' : '검토한 참고 자료를 PC에 반영했습니다. 한글 요약은 보존하고 원문 변경 항목은 재검토로 표시했습니다. 앱 상태는 변경하지 않았습니다.' };
    } finally {
      if (!committed) { if (temporary) await io.unlink(temporary).catch(() => {}); if (createdArchive && archive.startsWith(versionsRoot + path.sep)) { for (const file of staged) if (file.startsWith(archive + path.sep)) await io.unlink(file).catch(() => {}); await io.rmdir(archive).catch(() => {}); } }
      applying = false;
    }
  }
  async function impact(body) { return buildAppImpact((await local()).data, body); }
  async function enrich(body) {
    const names = selected(body.packages, 10000), data = (await local()).data;
    return { commit: data.source.commit, entries: names.map(name => { const value = describeAppKnowledge(name, data); return { package: name, knowledge: { found: value.found, title: value.title, summary: value.summaryKo, category: value.category?.code || null, categoryLabel: value.category?.label || null, removal: value.removal?.code || null, removalLabel: value.removal?.label || null, translationStatus: value.translationStatus, function:value.functionKo||null,removalImpact:value.removalImpactKo||null,alternative:value.alternativeKo||null,functionalExplanationStatus:value.functionalExplanationStatus||null, labels: value.labels || [], koreanReviewRequired: Boolean(value.koreanReviewRequired) } }; }) };
  }
  return { status, check, review, apply, impact, enrich, versions, rollbackPreview };
}
