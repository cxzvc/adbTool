import { ActionError } from './connections.mjs';
import { quote } from './operations-core.mjs';

const PACKAGE = 'moe.shizuku.privileged.api';
const START_SCRIPT = `/sdcard/Android/data/${PACKAGE}/start.sh`;
// Official ADB startup procedure: https://shizuku.rikka.app/guide/setup/#start-shizuku-2
// Process identity: https://github.com/RikkaApps/Shizuku (shizuku_server).
export const SHIZUKU_ACTIONS = [
  { id:'shizuku-status', group:'advanced', title:'Shizuku 설치·실행 상태', description:'설치 버전과 서버 프로세스·실행 권한을 조회합니다. 앱별 사용 허용 상태는 Shizuku 앱에서 확인합니다.', fields:[], write:false, support:'Shizuku 선택 설치 · 프로세스 조회는 Binder 연결 확인과 다름' },
  { id:'shizuku-open', group:'advanced', title:'Shizuku 앱 열기', description:'설치된 Shizuku 앱을 열어 실행 상태와 허용한 앱을 확인합니다.', fields:[], write:true, support:'현재 사용자에게 Shizuku가 설치되어 있어야 함' },
  { id:'shizuku-start', group:'advanced', title:'Shizuku ADB 시작', description:'설치된 Shizuku의 공식 시작 스크립트를 ADB 권한으로 실행합니다. 앱별 권한 허용은 Shizuku에서 직접 선택합니다.', fields:[], write:true, support:'Shizuku v11.2 이상 · 기본 사용자 0 · ADB shell UID 2000 · 재부팅 후 다시 시작 필요' },
];

export function createShizukuTools(core) {
  async function shell(serial, args, job, timeout = 20000) {
    if (job?.cancelled) throw new ActionError('작업을 취소했습니다.', 409);
    const result = await core.run(serial, ['shell', args.map(quote).join(' ')], { job, timeout, maxBytes:2*1024*1024 });
    if (job?.cancelled) throw new ActionError('작업을 취소했습니다.', 409);
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
    if (/^(?:Error:|Exception\b|Security exception|Permission denied|Unknown command|Failure\b|Fatal:)/im.test(output)) throw new ActionError(output.trim().slice(-2000), 409);
    return String(result.stdout || '').trim();
  }
  async function installed(serial, job) {
    const output = await shell(serial, ['pm','list','packages','--user','current',PACKAGE], job);
    return output.split(/\r?\n/).some(line => line.trim() === `package:${PACKAGE}`);
  }
  async function processes(serial, job) {
    const output = await shell(serial, ['ps','-A','-o','PID,UID,NAME'], job);
    if (!/^\s*PID\s+UID\s+NAME\s*$/m.test(output)) throw new ActionError('Shizuku 서버 프로세스 목록 형식을 확인하지 못했습니다.', 409);
    return output.split(/\r?\n/).map(line => /^\s*(\d+)\s+(\d+)\s+shizuku_server\s*$/.exec(line)).filter(Boolean).map(match => ({pid:match[1],uid:match[2]}));
  }
  const describe = rows => rows.length ? rows.map(row => `PID ${row.pid} · UID ${row.uid} (${row.uid==='2000'?'ADB shell':row.uid==='0'?'root':'다른 사용자'})`).join('\n') : '서버 프로세스가 보이지 않습니다.';
  async function run(action, serial, body = {}, job) {
    if (!SHIZUKU_ACTIONS.some(item => item.id === action)) throw new ActionError('지원하는 Shizuku 기능을 선택하세요.');
    if (typeof serial !== 'string' || !serial || serial.length > 255 || /[\x00-\x20\x7f]/.test(serial)) throw new ActionError('대상 기기 연결을 확인하세요.');
    if (job?.cancelled) throw new ActionError('작업을 취소했습니다.', 409);
    const hasApp = await installed(serial, job);
    if (action === 'shizuku-status') {
      const dump = hasApp ? await shell(serial, ['dumpsys','package',PACKAGE], job) : '';
      const rows = await processes(serial, job);
      const version = /^\s*versionName=(.*)$/m.exec(dump)?.[1]?.trim() || '확인되지 않음';
      const code = /^\s*versionCode=(\d+)/m.exec(dump)?.[1] || '확인되지 않음';
      return { message:hasApp?'Shizuku 설치·프로세스 상태를 조회했습니다.':'현재 사용자에게 Shizuku가 설치되어 있지 않습니다.', output:[`패키지: ${PACKAGE}`,`현재 사용자 설치: ${hasApp?'있음':'없음'}`,...(hasApp?[`앱 버전: ${version} (코드 ${code})`]:[]),`서버 프로세스: ${describe(rows)}`,'프로세스 조회만으로 Binder 연결이나 개별 앱의 사용 권한을 보장하지 않습니다. 정확한 동작 상태는 Shizuku 앱에서 확인하세요.'].join('\n') };
    }
    if (!hasApp) throw new ActionError('현재 사용자에게 Shizuku가 설치되어 있지 않습니다. 공식 Shizuku 앱을 직접 설치한 뒤 사용하세요.', 409);
    if (action === 'shizuku-open') {
      const resolved = await shell(serial, ['cmd','package','resolve-activity','--brief','--user','current','-a','android.intent.action.MAIN','-c','android.intent.category.LAUNCHER','-p',PACKAGE], job);
      const component = resolved.split(/\r?\n/).map(line=>line.trim()).find(line=>line.startsWith(PACKAGE+'/') && /^[A-Za-z0-9_.$]+\/[A-Za-z0-9_.$]+$/.test(line));
      if (!component) throw new ActionError('Shizuku 시작 화면을 찾지 못했습니다. 앱 사용 중지 여부를 확인하세요.', 409);
      const output = await shell(serial, ['am','start','-W','--user','current','-n',component], job, 30000);
      if (/^\s*Status:\s*(?!ok\b)\S+/im.test(output)) throw new ActionError('Shizuku 앱 열기가 완료되지 않았습니다.\n'+output, 409);
      return { message:'Shizuku 앱 열기를 요청했습니다. 앱 사용 허용은 Shizuku 화면에서 선택하세요.', output };
    }
    const currentUser = await shell(serial, ['am','get-current-user'], job);
    if (currentUser !== '0') throw new ActionError('이 시작 버튼은 기본 사용자 0에서만 지원합니다. 다른 사용자·업무 프로필에서는 Shizuku 앱의 안내를 따르세요.', 409);
    const uid = await shell(serial, ['id','-u'], job);
    if (uid !== '2000') throw new ActionError(`현재 ADB UID가 ${uid || '확인되지 않음'}입니다. 이 버튼은 ADB shell UID 2000에서만 실행합니다. root 전환은 하지 않습니다.`, 409);
    const before = await processes(serial, job);
    if (before.length) return { message:'Shizuku 서버 프로세스가 이미 있어 다시 시작하지 않았습니다. Shizuku 앱에서 상태를 확인하세요.', output:describe(before) };
    try { await shell(serial, ['test','-r',START_SCRIPT], job); }
    catch (error) { if (job?.cancelled) throw error; throw new ActionError('Shizuku 공식 시작 스크립트를 읽을 수 없습니다. Shizuku 앱을 한 번 열어 시작 안내를 확인하세요.\n'+error.message, 409); }
    const output = await shell(serial, ['sh',START_SCRIPT], job, 60000);
    const after = await processes(serial, job);
    if (!after.some(row=>row.uid==='2000')) throw new ActionError('시작 명령은 종료됐지만 ADB 권한의 Shizuku 서버 프로세스를 확인하지 못했습니다. Shizuku 앱에서 오류를 확인하세요.\n'+output.slice(-2000), 409);
    return { message:'ADB 권한의 Shizuku 서버 프로세스를 확인했습니다. 개별 앱 사용 권한은 Shizuku 앱에서 직접 허용하세요.', output:output+'\n\n'+describe(after)+'\n프로세스 확인 결과이며 Binder 연결 성공을 보장하지 않습니다. 재부팅 후 다시 시작해야 합니다.' };
  }
  return { run };
}
