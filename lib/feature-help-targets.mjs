import { packageName, remotePath, quote } from './operations-core.mjs';
import { parseAppDetails } from './app-extras.mjs';
import { parsePackageInventoryDump } from './app-inventory-data.mjs';
import { isSensitiveHistoryKey } from './activity-history.mjs';
import { firmwareSettingReview, settingWriteRestriction,settingWriteNeedsReview } from './firmware-setting-review.mjs';
import {compatibility} from './compatibility.mjs';

const empty = () => ({ facts: [], warnings: [], errors: [] });
const status = (state, labelKo, reasonKo) => ({ state, labelKo, reasonKo });
const fact = (result, label, value) => result.facts.push({ label, value: String(value) });
const sensitiveKey = key => isSensitiveHistoryKey(key) || /passcode|bluetooth_address|wifi.*ssid|account|auth_|(?:^|[_.])pin(?:$|_code$)|_pin$/i.test(key);
const excerpt = value => String(value || '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').slice(0, 500);
const kindKo = { 'regular file': '일반 파일', 'regular empty file': '빈 파일', directory: '폴더', 'symbolic link': '심볼릭 링크', 'character device': '문자 장치', 'block device': '블록 장치', socket: '소켓', 'FIFO (named pipe)': '이름 있는 파이프' };
const enabledKo = { 0: '앱 기본값', 1: '사용', 2: '중지', 3: '사용자가 중지', 4: '처음 사용할 때까지 중지' };
const bucketKo = { 5: '제외 대상', 10: '활성', 20: '자주 사용', 30: '주기적 사용', 40: '드물게 사용', 45: '사용 제한', 50: '사용 기록 없음' };
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// This contextual inspection has a deliberately small read-only command surface.
// It does not execute an action, probe run-as, extract APKs or create a phone file.
export function createFeatureHelpTargets({ command }) {
  if (typeof command !== 'function') throw new TypeError('읽기 명령 실행기가 필요합니다.');
  async function readCommand(serial, args, options = {}) {
    const text = String(await command(serial, ['shell', args.map(quote).join(' ')], { timeout: 15000, maxBuffer: 4 * 1024 * 1024, preserveWhitespace: true, ...options }));
    if (/^(?:\s*)(?:Error(?: type \d+)?:|Failure\b|Failed\b|Exception\b|Security exception|Permission (?:denied|Denial)|Unknown (?:command|package)|Can't find service|java\.[\w.]+Exception)/im.test(text)) throw new Error(text);
    return text;
  }
  function errorState(result, error, area, hidden = false) {
    const raw = String(error?.message || error || '');
    const restricted = /permission|denied|not permitted|securityexception|selinux|권한|접근.*제한/i.test(raw);
    const missing = /no such file|not found|does not exist|찾지 못|설치된 앱이 아닙니다/i.test(raw);
    result.status = restricted
      ? status('restricted', '조회 권한 제한', area === 'file' ? '현재 ADB shell이 이 경로의 메타데이터를 읽지 못합니다. 공유 저장소를 선택하거나, 앱 전용 경로는 디버깅 가능한 앱의 run-as 또는 이미 허용된 root 접근이 필요할 수 있습니다. 권한을 자동 변경하지 않습니다.' : '현재 ADB 조회 권한 또는 사용자·프로필 정책으로 값을 읽지 못했습니다. 앱의 권한·관리자 정책과 잠금 상태를 확인하세요. 조회 실패를 미지원으로 단정하지 않습니다.')
      : missing ? status('unverified', '선택 대상 확인 필요', '대상이 삭제·이동되었거나 선택한 사용자에 설치되지 않았을 수 있습니다. 원래 목록을 새로 읽고 다시 선택하세요.')
        : status('unverified', '현재 상태 미확인', '기기 응답을 해석하지 못했거나 조회가 완료되지 않았습니다. 다시 조회하세요. 기능을 실행하거나 설정을 변경하지 않았습니다.');
    result.errors.push({ messageKo: result.status.reasonKo, ...(hidden ? {} : { rawError: excerpt(raw) }) });
  }
  function missingTarget(label) {
    const result = empty(); fact(result, label, '대상 미선택');
    result.status = status('unverified', '대상 선택 필요', '목록에서 작업할 대상을 선택하면 현재 상태를 조회합니다.');
    return result;
  }
  async function files(serial, action, values) {
    if (!values.path) return missingTarget('선택한 파일·폴더');
    const result = empty(); let target;
    try { target = remotePath(values.path); } catch (error) { errorState(result, error, 'file'); return result; }
    fact(result, '선택한 경로', target);
    try {
      const raw = (await readCommand(serial, ['stat', '-c', '%F|%s|%u|%g|%a', '--', target])).trim();
      const fields = raw.split('|');
      if (fields.length !== 5 || !fields[0] || !fields.slice(1).every(v => /^\d+$/.test(v)) || !/^[0-7]{1,4}$/.test(fields[4]) || !Number.isSafeInteger(Number(fields[1]))) throw new Error('파일 메타데이터 응답을 읽지 못했습니다.');
      const [kind, bytes, uid, gid, mode] = fields;
      fact(result, '종류', kindKo[kind] || '기타 파일 형식');
      fact(result, kind === 'directory' ? '폴더 항목 자체의 크기' : '파일 크기', Number(bytes).toLocaleString('ko-KR') + ' 바이트');
      fact(result, '소유자 / 그룹 ID', uid + ' / ' + gid);
      fact(result, '접근 모드', mode + ' (8진수)');
      // test inspects permissions only; neither a write-test file nor a directory walk is made.
      const script = `if test -r ${quote(target)}; then printf 'read=yes\\n'; else printf 'read=no\\n'; fi; if test -w ${quote(target)}; then printf 'write=yes\\n'; else printf 'write=no\\n'; fi`;
      let readable = null;
      try {
        const access = String(await command(serial, ['shell', script], { timeout: 10000, maxBuffer: 4096, preserveWhitespace: true }));
        readable = /^read=(yes|no)$/m.exec(access)?.[1] ?? null;
        const writable = /^write=(yes|no)$/m.exec(access)?.[1] ?? null;
        fact(result, '현재 ADB 읽기 검사', readable === 'yes' ? '읽기 가능으로 응답' : readable === 'no' ? '읽기 불가로 응답' : '미확인');
        fact(result, '쓰기 모드 검사', writable === 'yes' ? '가능으로 응답 · 실제 쓰기 미시험' : writable === 'no' ? '불가로 응답' : '미확인');
      } catch (error) { result.warnings.push('읽기·쓰기 모드 검사를 완료하지 못했습니다. 파일 생성·수정은 하지 않았습니다.'); }
      if (kind === 'directory') result.warnings.push('표시된 크기는 폴더 항목 자체의 크기입니다. 하위 파일의 합계를 계산하거나 내용을 재귀 탐색하지 않았습니다.');
      if (kind === 'symbolic link') result.warnings.push('연결 파일입니다. 연결 대상과 작업별 링크 처리 방식은 실행 전 상세 조회에서 확인하세요.');
      if (['file-text', 'file-text-save'].includes(action.id) && !/^regular(?: empty)? file$/.test(kind)) result.status = status('unsupported', '일반 파일 필요', '텍스트 조회·편집은 폴더·링크·특수 장치가 아닌 일반 파일에만 지원됩니다.');
      else if (['file-text', 'file-text-save'].includes(action.id) && Number(bytes) > 1024 * 1024) result.status = status('unsupported', '텍스트 용량 한도 초과', '텍스트 조회·편집은 UTF-8 기준 1MB 이하만 지원됩니다. 다운로드로 확인하세요.');
      else if (readable === 'no' && !action.write) result.status = status('restricted', '내용 읽기 제한', '메타데이터는 읽었지만 현재 ADB shell의 내용 읽기는 허용되지 않습니다. 공유 저장소나 접근 가능한 다른 경로를 선택하세요.');
      else result.status = status(action.write || kind === 'directory' || readable !== 'yes' ? 'unverified' : 'available', action.write ? '대상 조회 완료 · 변경 미시험' : '대상 조회 완료', action.write ? '현재 메타데이터만 읽었습니다. 쓰기 모드 검사만으로 SELinux·대상 폴더·소유권·속성 보존 권한까지 보장하지 않습니다.' : kind === 'directory' ? '현재 폴더 자체의 메타데이터를 확인했습니다. 하위 파일 전체에 대한 접근 여부는 별도입니다.' : '현재 파일의 메타데이터와 읽기 검사를 확인했습니다. 내용 형식·작업별 지원은 별도입니다.');
    } catch (error) { errorState(result, error, 'file'); }
    return result;
  }
  async function apps(serial, action, values, userId) {
    if (!values.package) return missingTarget('선택한 앱');
    const result = empty(); let pkg;
    try { pkg = packageName(values.package); } catch (error) { errorState(result, error, 'app'); return result; }
    fact(result, '선택한 앱', pkg); fact(result, '사용자·프로필', userId);
    try {
      const dump = await readCommand(serial, ['dumpsys', 'package', pkg]);
      const details = parseAppDetails(dump, pkg, userId), metadata = parsePackageInventoryDump(dump, userId).get(pkg);
      const header = new RegExp('^\\s*Package \\[' + escapeRegex(pkg) + '\\][^\\r\\n]*$', 'm').exec(dump);
      const tail = dump.slice(header.index), next = /\n\s*Package \[/.exec(tail.slice(1)), block = next ? tail.slice(0, next.index + 1) : tail;
      const selectedLine = new RegExp('^\\s*User ' + userId + ':([^\\r\\n]*)', 'm').exec(block)?.[1] || '';
      const appFlags = /^\s*(?:flags|pkgFlags)=\[([^\]]*)\]/m.exec(block)?.[1];
      const debuggable = appFlags == null ? null : /\bDEBUGGABLE\b/.test(appFlags);
      const enabled = /\benabled=(\d+)\b/.exec(selectedLine)?.[1];
      fact(result, '설치 상태', '선택한 사용자에 설치됨');
      fact(result, '앱 버전', [metadata?.versionName, metadata?.versionCode && '코드 ' + metadata.versionCode].filter(Boolean).join(' / ') || '응답에 없음');
      fact(result, '사용 상태', enabled == null ? '응답에 없음 · 미확인' : enabledKo[enabled] || '알 수 없는 상태 (' + enabled + ')');
      fact(result, '강제 종료 분류', metadata?.stopped === true ? '중지 상태 · 실행 중 프로세스와 별개' : metadata?.stopped === false ? '중지 아님 · 실행 중이라는 뜻은 아님' : '미확인');
      fact(result, '일시중지', details.suspended ? '일시중지됨' : '일시중지 아님');
      fact(result, '디버깅 선언', debuggable === true ? 'debuggable 선언 있음 · 실제 run-as 접근 미시험' : debuggable === false ? 'debuggable 선언 없음' : '응답에 없어 미확인');
      result.status = status(action.write ? 'unverified' : 'available', action.write ? '앱 상태 조회 완료 · 변경 미시험' : '앱 상태 조회 완료', '선택한 사용자에 설치된 앱의 패키지 정보만 읽었습니다. 목록 조회 성공이 모든 관리 작업의 허용을 뜻하지는 않습니다.');
      if (values.permission) {
        if (!/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/.test(values.permission) || values.permission.length > 255) throw new Error('목록에서 올바른 권한을 선택하세요.');
        const selected = details.permissions.find(item => item.name === values.permission);
        fact(result, '선택한 권한', values.permission);
        fact(result, '권한 상태', selected ? selected.status + ' · ' + selected.kind : '선택한 앱의 권한 목록에 없음');
        if (selected) { fact(result, '권한 설명', selected.description); fact(result, '권한 플래그', selected.flags.length ? selected.flags.join(' | ') : '표시된 플래그 없음'); }
        if (['permission-grant', 'permission-revoke'].includes(action.id)) {
          if (!selected?.requested) result.status = status('unsupported', '앱 요청 권한 아님', '선택한 앱의 manifest 요청 권한 목록에서 확인되지 않아 개별 허용·회수 대상으로 확정할 수 없습니다.');
          else if (selected.kind !== '런타임 권한') result.status = status('unsupported', '런타임 권한 확인 필요', '일반 설치·서명 권한은 이 기능의 개별 허용·회수 대상이 아닙니다. 런타임 권한으로 확인된 항목을 선택하세요.');
          else if (selected.flags.some(flag => /^(?:POLICY_FIXED|SYSTEM_FIXED)$/.test(flag))) result.status = status('restricted', '정책에 고정된 권한', '시스템 또는 관리자가 고정한 권한입니다. 일반 ADB 런타임 권한 변경은 거부될 수 있으며 정책을 자동 해제하지 않습니다.');
        }
      }
      if (values.component) {
        const component = String(values.component), normalized = component.startsWith(pkg + '/.') ? pkg + '/' + pkg + component.slice(pkg.length + 1) : component;
        const selected = details.components.find(item => item.name === normalized);
        fact(result, '선택한 구성요소', selected ? selected.name : '현재 조회 범위에서 찾지 못함');
        if (selected) fact(result, '구성요소 사용 상태', ({ enabled: '사용', disabled: '중지', default: '앱 기본값' })[selected.state] || '미확인');
        else result.warnings.push('구성요소 목록을 다시 읽고 선택하세요. 패키지 진단에 나타나지 않는 내부 구성요소 전체까지 없다는 뜻은 아닙니다.');
      }
      if (action.id.startsWith('appdata-')) {
        fact(result, '데이터 범위', '선택한 사용자의 CE 앱 데이터 · APK·Keystore·외부 저장소·DE 데이터 제외');
        if ((values.method || 'run-as') === 'run-as' && debuggable === false) result.status = status('unsupported', '일반 앱의 내부 데이터 접근 제한', '이 앱은 debuggable로 선언되지 않아 run-as를 이용한 내부 데이터 백업·복원을 지원하지 않습니다. APK 백업은 별개이며, 내부 데이터에는 이미 허용된 root 환경 등이 필요합니다.');
        else {
          result.status = status('unverified', '패키지 정보 조회 완료 · 데이터 접근 미시험', '패키지의 디버깅 선언만으로 앱 내부 데이터 접근 지원을 보장하지 않습니다. 실제 접근·백업·복원은 실행하지 않았습니다.');
          result.warnings.push('디버깅 선언만 확인했습니다. run-as 명령 실행·앱 데이터 접근·파일 전송은 하지 않았습니다. 현재 방식의 실제 접근은 지원 확인을 명시적으로 실행할 때 검사합니다.');
        }
      }
      if (action.id === 'package-certificates') {
        result.status = status('unverified', '패키지 정보 조회 완료 · 서명 검사 미실행', '설치 APK 추출과 PC Android SDK 도구 검사는 이 상태 조회에서 실행하지 않았으므로 인증서 조회 지원은 아직 확인하지 않았습니다.');
        result.warnings.push('이 상태 조회에서는 APK를 추출하지 않습니다. 인증서 조회를 실행하면 설치 APK를 PC로 읽어 Android SDK 도구로 서명을 검사합니다.');
      }
      if (['app-standby-read', 'app-standby-set'].includes(action.id)) {
        const raw = (await readCommand(serial, ['am', 'get-standby-bucket', '--user', userId, pkg])).trim();
        fact(result, '현재 앱 대기 등급', /^\d+$/.test(raw) ? (bucketKo[raw] || '기기 정의 등급') + ' (' + raw + ')' : '응답 형식 미확인');
      }
      if (['app-inactive-read', 'app-inactive-set'].includes(action.id)) {
        const raw = await readCommand(serial, ['am', 'get-inactive', '--user', userId, pkg]), state = /\bIdle=(true|false)\b/i.exec(raw)?.[1]?.toLowerCase();
        fact(result, '현재 앱 유휴 상태', state === 'true' ? '유휴로 분류됨' : state === 'false' ? '유휴 아님 · 실행 중이라는 뜻은 아님' : '응답 형식 미확인');
      }
    } catch (error) { errorState(result, error, 'app'); }
    return result;
  }
  async function settings(serial, action, values, userId, device) {
    if (!values.namespace || !values.key) return missingTarget('선택한 설정 키');
    const result = empty(), ns = values.namespace, key = values.key, hidden = sensitiveKey(key);
    if (!['system', 'secure', 'global'].includes(ns) || typeof key !== 'string' || !/^[A-Za-z0-9_.:-]{1,512}$/.test(key)) { errorState(result, new Error('설정 영역과 키를 목록에서 선택하세요.'), 'setting', hidden); return result; }
    fact(result, '설정 대상', ns + ' / ' + key); fact(result, '사용자·프로필', ns === 'global' ? '기기 공통 · 요청 사용자 ' + userId : userId);
    try {
      let value = (await readCommand(serial, ['settings', '--user', userId, 'get', ns, key])).replace(/\r?\n$/, ''), exists = true;
      if (value === 'null') {
        const lines = await readCommand(serial, ['settings', '--user', userId, 'list', ns]);
        const exact = lines.split(/\r?\n/).find(line => line.startsWith(key + '='));
        exists = exact != null; value = exists ? exact.slice(key.length + 1) : '';
      }
      fact(result, '저장 상태', exists ? '값이 저장되어 있음' : '키 미저장 · 기본 동작과 별개');
      fact(result, '현재 저장값', exists ? hidden ? '민감값 숨김' : excerpt(value) || '(빈 문자열)' : '미지정');
      result.status = status(action.write ? 'unverified' : 'available', action.write ? '저장값 조회 완료 · 쓰기·효과 미시험' : '저장값 조회 완료', '키가 있거나 값이 읽힌다는 이유만으로 실제 기능의 지원·쓰기 권한·효과를 보장하지 않습니다.');
      let fingerprint;
      try { fingerprint = (await readCommand(serial, ['getprop', 'ro.build.fingerprint'])).trim(); } catch { result.warnings.push('현재 빌드를 확인하지 못해 펌웨어별 의미·효과 판정을 생략했습니다.'); }
      const review = firmwareSettingReview(ns, key, fingerprint), restriction = settingWriteRestriction(ns, key, fingerprint,device);
      result.compatibility=compatibility({support:action.write?review?.unsupported?'unsupported':'unknown':'supported',access:action.write?'unknown':'allowed',evidence:review?.currentBuild===false?'previous':review?.revalidated?'current':'unverified',reasonKo:restriction?.reason||review?.reason||'현재 저장값만 조회했습니다. 변경 권한·실제 효과는 미시험입니다.',alternative:restriction?.alternative||null,readable:true,writeAllowed:action.write===true&&!restriction&&(!settingWriteNeedsReview(ns,key,device)||!!fingerprint),source:review?{build:review.build,fingerprint:review.fingerprint,method:review.method}:null});
      if (review) { fact(result, '현재 빌드 대조', review.label); if (review.application?.reason || review.reason) result.warnings.push(review.application?.reason || review.reason); }
      else if (fingerprint) result.warnings.push('현재 펌웨어와 일치하는 코드 대조 결과가 없어 실제 기능·효과는 미검증입니다.');
      if(action.write===true&&settingWriteNeedsReview(ns,key,device)&&!fingerprint){
        result.executionBlocked=true;
        result.status=status('unverified','현재 빌드 확인 필요 · 조회 전용','현재 펌웨어 식별값을 확인하지 못해 이전 제한과 현재 지원 조건을 대조할 수 없습니다. 저장값 조회만 제공하며, 현재 상태를 다시 조회한 뒤 변경 여부를 판단합니다.');
        result.compatibility={...result.compatibility,reasonKo:result.status.reasonKo};
      }
      if (restriction) {
        if(action.write===true)result.executionBlocked=true;
        const reason = restriction.reason + (restriction.alternative ? ' 대안: ' + restriction.alternative : '');
        if (action.write === true) result.status = status(restriction.verificationRequired||review?.currentBuild===false||review?.inheritedRestriction?'unverified':'unsupported', restriction.label, reason);
        else result.warnings.push('쓰기·실제 효과 제한: ' + reason + ' 현재 저장값 조회는 완료했습니다.');
      }
    } catch (error) { errorState(result, error, 'setting', hidden); }
    return result;
  }
  return { async read({ serial, action, values = {}, userId,device }) {
    const family = action?.group;
    if (family !== 'files' && family !== 'apps' && family !== 'settings' && !action?.id?.startsWith('appdata-')) return empty();
    if (family === 'files') return files(serial, action, values);
    if (family === 'settings' && (!values.namespace || !values.key)) return missingTarget('선택한 설정 키');
    if (family !== 'settings' && !values.package) return missingTarget('선택한 앱');
    const selectedUser = values.user && values.user !== 'current' ? String(values.user) : String(userId ?? '');
    if (!/^(?:0|[1-9]\d{0,4})$/.test(selectedUser)) {
      const result = empty(); fact(result, '사용자·프로필', '미확인'); result.status = status('unverified', '사용자 확인 필요', '현재 사용자 또는 선택한 사용자 번호를 확인하지 못해 다른 사용자로 대체 조회하지 않았습니다. 목록을 다시 조회하세요.'); return result;
    }
    if (family === 'settings') return settings(serial, action, values, selectedUser,device);
    return apps(serial, action, values, selectedUser);
  } };
}
