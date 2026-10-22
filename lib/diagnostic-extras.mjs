import { ActionError } from './connections.mjs';
import { quote } from './operations-core.mjs';
import { parseProcesses } from './diagnostics.mjs';

const select = (name, label, choices) => ({ name, label, type: 'select', options: [], choices, required: true });
const action = (id, title, description, fields = [], group = 'diagnostics') => ({
  id, group, title, description, fields, write: false,
  support: '기기가 제공하는 서비스·ADB 조회 권한 필요. 미지원 항목은 오류 원인을 표시합니다.',
});
const presets = {
  'diagnostic-battery-usage': ['batterystats', ['--charged'], '배터리 소모 내역', '충전 이후 앱 UID별 추정 전력·화면·통신·실행 시간을 읽습니다. 배터리 통계를 초기화하지 않습니다.'],
  'diagnostic-thermal': ['thermalservice', [], '발열·온도·성능 제한', '온도 센서와 발열 단계, 냉각 장치 상태를 읽습니다. 센서 종류와 공개 범위는 기기마다 다릅니다.'],
  'diagnostic-power-detail': ['power', [], '전원·절전·깨움 상태', '화면·절전 상태와 기기를 깨어 있게 하는 WakeLock을 확인합니다. 전원 상태를 바꾸지 않습니다.'],
  'diagnostic-connectivity': ['connectivity', [], '네트워크 연결 진단', '활성 네트워크·링크·라우팅·연결 요청 정보를 확인합니다. 연결을 끊거나 바꾸지 않습니다.'],
  'diagnostic-network-usage': ['netstats', ['detail'], '앱별 통신 사용량', 'Android가 저장한 UID별 송수신 통계를 읽습니다. 실시간 패킷 캡처나 정확한 요금 집계는 아닙니다.'],
  'diagnostic-wifi': ['wifi', [], 'Wi-Fi 연결·이력', '무선 연결 상태와 Wi-Fi 서비스의 진단 이력을 읽습니다. 스캔·접속·비밀번호 변경을 실행하지 않습니다.'],
  'diagnostic-bluetooth': ['bluetooth_manager', [], '블루투스 상태·이력', '블루투스 관리자 상태와 연결 관련 이력을 읽습니다. 페어링이나 전원 상태를 바꾸지 않습니다.'],
  'diagnostic-storage-detail': ['mount', [], '저장장치·볼륨 상세', '내부·외부 저장장치의 볼륨, 마운트와 사용자 잠금 해제 상태를 읽습니다. 쓰기 속도 시험은 하지 않습니다.'],
  'diagnostic-input': ['input', [], '터치·키보드 입력 진단', '입력 장치, 터치 좌표 변환, 입력 대기열과 현재 입력 대상 창을 확인합니다. 입력을 보내지 않습니다.'],
  'diagnostic-window': ['window', [], '화면의 창·포커스', '앱 창의 표시 상태·위치·포커스와 화면 구성을 확인합니다. 창을 열거나 닫지 않습니다.'],
  'diagnostic-display-detail': ['display', [], '디스플레이 상세', '화면 장치·지원 표시 모드·주사율·밝기 관련 상태를 읽습니다. 해상도나 밝기를 바꾸지 않습니다.'],
  'diagnostic-audio': ['audio', [], '소리·오디오 경로', '볼륨 스트림·출력 장치·오디오 포커스 등 소리 관련 상태를 읽습니다. 소리를 재생하지 않습니다.'],
  'diagnostic-sensors': ['sensorservice', [], '센서·사용 앱', '기기가 공개하는 센서 목록과 활성 센서 연결 정보를 확인합니다. 센서 기록을 시작하지 않습니다.'],
};

// Only fixed help invocations are accepted. A selected tool never becomes an arbitrary command.
const tools = {
  am: { label: '앱 실행·프로세스·사용자 (am)', args: ['am', 'help'] },
  pm: { label: '앱 설치·권한·패키지 (pm)', args: ['pm', 'help'] },
  wm: { label: '화면 크기·밀도 (wm)', args: ['wm', 'help'] },
  input: { label: '키·터치 입력 (input)', args: ['input', 'help'] },
  settings: { label: '설정값 조회·수정 (settings)', args: ['settings', 'help'] },
  logcat: { label: '기기 로그 (logcat)', args: ['logcat', '--help'] },
  dumpsys: { label: '시스템 서비스 진단 (dumpsys)', args: ['dumpsys', '--help'] },
  perfetto: { label: '성능 추적 (perfetto)', args: ['perfetto', '--help'] },
  screenrecord: { label: '기기 화면 녹화 (screenrecord)', args: ['screenrecord', '--help'] },
  screencap: { label: '기기 화면 캡처 (screencap)', args: ['screencap', '-h'] },
  getevent: { label: '입력 장치 이벤트 (getevent)', args: ['getevent', '-h'] },
  toybox: { label: '기기 파일·시스템 유틸리티 (toybox)', args: ['toybox', '--help'] },
};

export const DIAGNOSTIC_EXTRA_ACTIONS = [
  ...Object.entries(presets).map(([id, [, , title, description]]) => action(id, title, description)),
  action('diagnostic-process-memory', '선택 프로세스 메모리 상세', '실행 중인 프로세스를 골라 Java·Native·그래픽 메모리와 PSS/RSS를 확인합니다.', [select('pid', '실행 중인 프로세스', 'processes')]),
  action('diagnostic-command-services', '기기 명령 서비스 목록', '현재 기기가 제공하는 cmd 서비스 이름을 확인합니다. 목록에 있어도 도움말을 제공하지 않는 서비스가 있습니다.'),
  action('diagnostic-command-help', '기기 서비스의 지원 명령', '목록에서 서비스를 골라 기기 자체 도움말을 읽습니다. 도움말에 표시된 조작 명령을 실행하지 않습니다.', [select('service', '명령 서비스', 'cmd-services')]),
  action('diagnostic-tool-help', 'ADB 기기 도구 도움말', '선택한 도구의 실제 기기 버전이 지원하는 옵션을 읽습니다. 도움말 조회만 수행합니다.', [{ name: 'tool', label: '기기 도구', type: 'select', value: 'am', options: Object.entries(tools).map(([value, item]) => ({ value, label: item.label })) }]),
  action('users-detail', '사용자·프로필 상세 상태', '사용자 유형·프로필 관계·제한과 사용자 서비스의 현재 상태를 읽습니다.', [], 'users'),
  action('user-state', '선택 사용자의 실행 상태', '목록에서 사용자를 골라 시작·잠금 해제·중지 상태를 확인합니다. 사용자를 전환하지 않습니다.', [select('userId', '사용자·프로필', 'users')], 'users'),
];

const servicePattern = /^[A-Za-z0-9_][A-Za-z0-9_.:@/+$-]{0,254}$/;
const commandFailure = /^(?:(?:cmd|dumpsys):\s*)?(?:Error:|Failure\b|Failed\b|Unknown command\b|Unknown option\b|Invalid arguments?\b|Security exception\b|Exception occurred\b|Permission Denial:|Permission denied\b|Can't find service\b|No shell command implementation\b)/i;
const timedOut = /\*\*\*\s*SERVICE\b[^\n]*\bDUMP TIMEOUT\b/i;
function checkedOutput(result, help = false) {
  const stdout = String(result.stdout || '').trim(), stderr = String(result.stderr || '').trim();
  const first = stdout.split(/\r?\n/).find(line => line.trim())?.trim() || '';
  const error = stderr.split(/\r?\n/).find(line => commandFailure.test(line.trim()) || /(?:^|:\s)(?:not found|inaccessible or not found)\s*$/i.test(line));
  if (error || commandFailure.test(first) || timedOut.test(stdout)) throw new ActionError((error || stdout).slice(-3000), 409);
  if (/^Permission Denial:/im.test(stdout) || /^Exception (?:occurred|when calling)/im.test(stdout)) throw new ActionError(stdout.slice(-3000), 409);
  if (help && !stdout && !stderr) throw new ActionError('이 기기 서비스가 도움말을 반환하지 않았습니다. 도움말 미지원 또는 조회 권한 제한일 수 있습니다.', 409);
  return [stdout, stderr && `기기 메시지:\n${stderr}`].filter(Boolean).join('\n\n');
}

export function createDiagnosticExtras(core) {
  async function shell(serial, args, job, { help = false, maxBytes = 8 * 1024 * 1024, timeout = 30000 } = {}) {
    if (job?.cancelled) throw new ActionError('작업을 취소했습니다.', 409);
    let command = args.map(value => quote(String(value))).join(' ');
    // Older Android help handlers may return 255 after printing valid help. Preserve their
    // complete output while still rejecting real failures; never retry a different command.
    if (help) command += '; adb_desk_help_result=$?; printf "\\n__ADB_DESK_HELP_EXIT__=%s\\n" "$adb_desk_help_result"';
    const result = await core.run(serial, ['shell', command], { job, timeout, maxBytes });
    if (job?.cancelled) throw new ActionError('작업을 취소했습니다.', 409);
    let exitCode = 0;
    if (help) {
      const status = /(?:^|\n)__ADB_DESK_HELP_EXIT__=(\d+)\s*$/.exec(result.stdout || '');
      if (status) { exitCode = Number(status[1]); result.stdout = result.stdout.slice(0, status.index).trim(); }
      else throw new ActionError('기기 도움말 명령의 종료 상태를 확인하지 못했습니다.', 409);
    }
    const output = checkedOutput(result, help);
    if (exitCode && !/\b(?:usage|commands?|options?|help text|help message|subcommands?)\b/i.test(output)) throw new ActionError(`기기 도구가 도움말 조회를 지원하지 않습니다. (종료 코드 ${exitCode})\n${output.slice(-2000)}`, 409);
    return output;
  }
  async function options(serial, kind, { job, profileRole } = {}) {
    let rows;
    if (kind === 'services' || kind === 'cmd-services') {
      const output = await shell(serial, kind === 'services' ? ['dumpsys', '-l'] : ['cmd', '-l'], job, { maxBytes: 1024 * 1024, timeout: 15000 });
      rows = output.split(/\r?\n/).map(line => line.trim()).filter(line => servicePattern.test(line)).map(value => ({ value, label: value }));
    } else if (kind === 'users') {
      const output = await shell(serial, ['pm', 'list', 'users'], job, { maxBytes: 1024 * 1024, timeout: 15000 });
      rows = output.split(/\r?\n/).flatMap(line => {
        const item = /UserInfo\{(\d+):(.+):([0-9a-fA-F]+)\}(.*)/.exec(line);
        if (!item) return [];
        const row = { value: item[1], label: `${item[2]} · 사용자 ${item[1]}${/\brunning\b/.test(item[4]) ? ' · 실행 중' : ''}` };
        if ((Number.parseInt(item[3], 16) & (0x1000 | 0x20)) && ['switch', 'parent'].includes(profileRole)) {
          row.disabled = true;
          row.reasonKo = profileRole === 'switch' ? '프로필은 일반 화면 사용자로 전환할 수 없습니다.' : '프로필은 새 관리 프로필의 부모가 될 수 없습니다.';
        }
        return [row];
      });
    } else if (kind === 'processes') {
      const output = await shell(serial, ['ps', '-A', '-o', 'PID,PPID,USER,STAT,RSS,VSZ,NAME'], job, { maxBytes: 2 * 1024 * 1024, timeout: 15000 });
      rows = parseProcesses(output).filter(row => row.pid > 0).map(row => ({ value: String(row.pid), label: `${row.name.slice(0,300)} · PID ${row.pid} · ${row.user}` }));
    } else throw new ActionError('지원하는 대상 목록을 선택하세요.');
    return { options: [...new Map(rows.map(row => [row.value, row])).values()] };
  }
  async function member(serial, kind, value, job) {
    if (typeof value !== 'string' && typeof value !== 'number') throw new ActionError('목록에서 대상을 선택하세요.');
    value = String(value);
    if (kind === 'services' || kind === 'cmd-services') {
      if (!servicePattern.test(value)) throw new ActionError('목록에서 올바른 서비스를 선택하세요.');
    } else if (!/^\d{1,8}$/.test(value)) throw new ActionError('목록에서 올바른 대상을 선택하세요.');
    const found = (await options(serial, kind, { job })).options.find(row => row.value === value);
    if (!found) throw new ActionError('선택한 대상이 현재 기기 목록에 없습니다. 목록을 새로고침한 뒤 다시 선택하세요.', 409);
    return value;
  }
  async function dump(serial, service, args, job) {
    await member(serial, 'services', service, job);
    const output = await shell(serial, ['dumpsys', '-t', '20', service, ...args], job);
    if (!output) throw new ActionError('이 서비스가 진단 내용을 반환하지 않았습니다. 조회 권한 또는 서비스의 진단 지원 여부를 확인하세요.', 409);
    return output;
  }
  async function run(id, serial, body = {}, job) {
    let output;
    if (presets[id]) {
      const [service, args] = presets[id];
      output = await dump(serial, service, args, job);
    } else switch (id) {
      case 'diagnostic-service':
        output = await dump(serial, body.service, [], job); break;
      case 'diagnostic-process-memory': {
        const pid = await member(serial, 'processes', body.pid, job);
        output = await dump(serial, 'meminfo', [pid], job); break;
      }
      case 'diagnostic-command-services':
        output = (await options(serial, 'cmd-services', { job })).options.map(row => row.value).join('\n') || '현재 조회할 수 있는 명령 서비스가 없습니다.'; break;
      case 'diagnostic-command-help': {
        const service = await member(serial, 'cmd-services', body.service, job);
        output = await shell(serial, ['cmd', service, 'help'], job, { help: true, maxBytes: 2 * 1024 * 1024 }); break;
      }
      case 'diagnostic-tool-help': {
        if (!Object.hasOwn(tools, body.tool)) throw new ActionError('목록에서 기기 도구를 선택하세요.');
        output = await shell(serial, tools[body.tool].args, job, { help: true, maxBytes: 2 * 1024 * 1024 }); break;
      }
      case 'users-detail': output = await dump(serial, 'user', [], job); break;
      case 'user-state': {
        const user = await member(serial, 'users', body.userId, job);
        output = await shell(serial, ['am', 'get-started-user-state', user], job, { maxBytes: 1024 * 1024, timeout: 15000 }); break;
      }
      default: throw new ActionError('지원하는 진단 기능을 선택하세요.');
    }
    return { message: '기기의 진단 결과를 읽었습니다. 제조사·Android 버전에 따라 항목과 형식이 다릅니다.', output };
  }
  return { run, options };
}
