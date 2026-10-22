import { ActionError } from './connections.mjs';
import { lstat, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import yazl from 'yazl';

const select = (name, label, options, value) => ({ name, label, type: 'select', options: options.map(([value, label]) => ({ value, label })), value: value ?? options[0][0] });
const text = (name, label, value = '', hint = '') => ({ name, label, type: 'text', value, required: true, hint });
const number = (name, label, value, min, max) => ({ name, label, type: 'number', value, min, max });
const action = (id, title, description, fields = [], write = false, resolve = 'stored', support = '일반 ADB') => ({ id, group: 'connection', title, description, fields, write, resolve, scope: resolve === 'host' ? 'host' : 'device', support });
const direction = select('direction', '연결 방향', [['forward', 'PC → 기기'], ['reverse', '기기 → PC']]);
const socketKinds = [['tcp', 'TCP 포트'], ['localabstract', '앱의 추상 UNIX 소켓'], ['localreserved', '/dev/socket의 시스템 소켓'], ['localfilesystem', '기기의 파일 경로 UNIX 소켓'], ['jdwp', 'JDWP 디버깅 PID · 정방향'], ['vsock', '가상 머신 CID:포트 · 정방향'], ['dev', '/dev 장치 파일 · 정방향'], ['dev-raw', '/dev 장치 파일 원시 모드 · 정방향']];

export const CONNECTION_EXTRA_ACTIONS = [
  action('connection-inspect', '선택 연결 상세 상태', '현재 연결의 상태·일련번호·장치 경로와 지원하는 ADB 기능을 확인합니다. 일부 조회가 실패해도 나머지 결과를 보여 줍니다.'),
  action('connection-host-info', 'PC의 ADB 정보', 'ADB 버전·서버 구성과 지원 기능, 설치된 ADB의 도움말, 원본 연결 목록을 확인합니다.', [select('query', '조회 항목', [['status', '버전·서버 구성·지원 기능'], ['help', '이 PC의 ADB 명령 도움말'], ['devices', 'USB·무선·에뮬레이터 연결 원본 목록']])], false, 'host'),
  action('connection-mdns', '무선 검색 진단', '이 PC의 mDNS 검색 동작과 발견된 무선 디버깅 서비스를 확인합니다.', [], false, 'host'),
  action('connection-reconnect-target', '선택한 연결만 다시 연결', '선택한 연결을 끊고 ADB에 재연결을 요청합니다. 전송·화면 보기는 중단될 수 있습니다.', [select('side', '재연결을 요청할 쪽', [['host', 'PC 쪽 연결'], ['device', '기기 쪽 연결']])], true),
  action('connection-wait', '연결 상태 기다리기', '선택한 연결이 지정한 상태가 되는지 기다립니다. 폰을 재부팅하거나 상태를 바꾸지는 않으며, 제한 시간과 작업 취소를 지원합니다.', [select('state', '기다릴 상태', [['device', 'ADB 사용 가능'], ['disconnect', '연결 해제'], ['recovery', '복구 모드'], ['sideload', 'OTA 전송 모드'], ['rescue', '복구 지원 모드'], ['bootloader', '부트로더']]), select('transport', '연결 방식', [['any', '선택한 연결'], ['usb', 'USB'], ['local', 'TCP/IP 또는 에뮬레이터']]), number('seconds', '최대 대기 시간(초)', 30, 1, 120)], false, 'stored', '대기 중 IP·포트가 바뀌면 새 주소는 다른 연결로 처리됩니다. 부트로더는 ADB를 제공하는 기기만 감지합니다.'),
  action('connection-usb-detach', 'USB를 다른 프로그램에 넘기기', 'ADB가 선택한 USB 기기를 놓아 다른 프로그램에서 쓸 수 있게 합니다. 무선 연결 해제와는 다릅니다.', [], true, 'stored-usb', 'ADB 서버의 libusb 방식에서만 지원합니다. Windows의 일반 USB 방식은 지원하지 않을 수 있습니다.'),
  action('connection-usb-attach', '넘겨둔 USB 다시 가져오기', '이전에 넘겨둔 USB 기기를 ADB가 다시 사용하도록 요청합니다.', [], true, 'stored-usb', 'libusb 방식과 detached 상태의 기존 USB 연결이 필요합니다. USB 드라이버를 설치하거나 바꾸지 않습니다.'),
  action('connection-keygen', '별도 ADB 인증 키 만들기', '새 인증 키 쌍을 ZIP으로 내려받습니다. 현재 PC의 ADB 키를 교체하거나 폰에 등록하지 않습니다. ZIP의 개인 키는 다른 사람에게 공유하지 마세요.', [], true, 'host', '별도 보관·다른 개발 환경용 키입니다. 인증 연결 적용은 자동으로 하지 않습니다.'),
  action('connection-emulator-info', '에뮬레이터 콘솔 조회', '선택한 Android 에뮬레이터의 도움말·실행 상태·스냅샷 목록·포트 연결을 읽습니다.', [select('query', '조회 항목', [['help', '지원 콘솔 명령 설명'], ['status', '가상 기기 실행 상태'], ['name', '가상 기기 이름'], ['snapshots', '저장된 스냅샷 목록'], ['ports', '포트 리디렉션 목록']])], false, 'stored', 'emulator-번호 형태의 Android Emulator 연결만 지원합니다. 폰에는 사용할 수 없습니다.'),
  action('ports-socket-add', '앱·시스템 소켓 터널', 'PC의 TCP 포트를 기기의 포트·앱 소켓·디버깅 대상에 연결합니다. 기존 연결을 덮어쓰지 않습니다.', [direction, number('pcPort', 'PC TCP 포트 · 정방향은 0으로 자동 배정', 0, 0, 65535), select('deviceType', '기기 쪽 종류', socketKinds), text('deviceValue', '기기 쪽 포트·소켓 이름·PID', '8080', '소켓 이름은 그 소켓을 제공하는 앱·시스템 문서에서 확인하세요. VSock은 CID:포트 형식입니다.')], true, 'online', '기기 서비스가 실제로 열려 있고 ADB 접근 권한이 있어야 합니다. 역방향은 TCP와 UNIX 소켓만 지원합니다.'),
  action('ports-socket-remove', '선택 터널 지우기', '현재 선택한 기기에 속한 터널 하나를 제거합니다. 기존 목록에 있는 수신 주소만 선택할 수 있습니다.', [{ name: 'tunnel', label: '제거할 터널', type: 'select', choices: 'tunnels', options: [], required: true }], true, 'online'),
  action('ports-clear-owned', '이 연결의 터널 모두 지우기', '선택한 연결에 속한 터널만 확인하여 하나씩 제거합니다. 화면 보기나 디버깅에 쓰던 터널도 끊깁니다.', [select('direction', '지울 방향', [['both', '양방향'], ['forward', 'PC → 기기'], ['reverse', '기기 → PC']])], true, 'online'),
];

const integer = (value, min, max, label) => {
  if (!/^(?:0|[1-9]\d*)$/.test(String(value))) throw new ActionError(`${label}는 ${min}~${max} 범위의 정수여야 합니다.`);
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < min || result > max) throw new ActionError(`${label}는 ${min}~${max} 범위의 정수여야 합니다.`);
  return String(result);
};
const choice = (value, values, label) => { if (!values.includes(value)) throw new ActionError(`${label}을 선택하세요.`); return value; };
const selectedSerial = value => {
  if (typeof value !== 'string' || !value || value.length > 255 || /[\s\x00-\x1f\x7f]/.test(value) || value.startsWith('-')) throw new ActionError('대상 연결을 목록에서 선택하세요.');
  return value;
};
const checkedText = value => {
  if (typeof value !== 'string' || !value || value.length > 255 || /[\s\x00-\x1f\x7f:]/.test(value)) throw new ActionError('소켓 이름에 공백·제어 문자·콜론은 쓸 수 없습니다.');
  return value;
};

/** Only a device-side endpoint is accepted here; host endpoints are always local TCP. */
export function deviceSocket(type, value, direction = 'forward') {
  choice(direction, ['forward', 'reverse'], '연결 방향');
  choice(type, socketKinds.map(([kind]) => kind), '기기 소켓 종류');
  if (direction === 'reverse' && !['tcp', 'localabstract', 'localreserved', 'localfilesystem'].includes(type)) throw new ActionError('역방향 수신 주소는 TCP 또는 UNIX 소켓만 지원합니다.');
  if (type === 'tcp') return `tcp:${integer(value, direction === 'reverse' ? 0 : 1, 65535, '기기 TCP 포트')}`;
  if (type === 'jdwp') return `jdwp:${integer(value, 1, 2147483647, '디버깅 PID')}`;
  if (type === 'vsock') {
    const match = /^(\d+):(\d+)$/.exec(String(value));
    if (!match) throw new ActionError('가상 머신 소켓은 CID:포트 형식으로 입력하세요.');
    return `vsock:${integer(match[1], 0, 4294967294, 'CID')}:${integer(match[2], 1, 4294967294, '가상 머신 포트')}`;
  }
  const name = checkedText(value);
  if (['localabstract', 'localreserved'].includes(type)) {
    if (!/^[A-Za-z0-9_@.+-][A-Za-z0-9_@.+/-]*$/.test(name) || name.split('/').some(part => part === '..' || part === '.')) throw new ActionError('소켓 이름 형식을 확인하세요.');
    if (type === 'localreserved' && name.includes('/')) throw new ActionError('/dev/socket 아래의 소켓 이름만 입력하세요.');
    if (Buffer.byteLength(name) > 100) throw new ActionError('소켓 이름은 100바이트 이하여야 합니다.');
  } else {
    if (!name.startsWith('/') || name === '/' || name.split('/').some(part => part === '..' || part === '.') || /[\\]/.test(name)) throw new ActionError('기기 안의 올바른 절대 소켓 경로를 지정하세요.');
    if (type === 'localfilesystem' && Buffer.byteLength(name) > 107) throw new ActionError('UNIX 소켓 경로는 107바이트 이하여야 합니다.');
    if (['dev', 'dev-raw'].includes(type) && !name.startsWith('/dev/')) throw new ActionError('장치 파일은 기기의 /dev/ 아래에서 지정해야 합니다.');
  }
  return `${type}:${name}`;
}

function parseRows(output, direction, serial) {
  return String(output || '').split(/\r?\n/).map(line => line.trim().split(/\s+/)).filter(parts => parts.length === 3 && (direction === 'reverse' || parts[0] === serial)).map(parts => ({ direction, serial, listener: parts[1], target: parts[2] }));
}
function resultText(result) {
  const resultString = [result?.stdout, result?.stderr].filter(Boolean).join('\n').trim();
  if (/^(?:adb:\s*(?:error|failed)|error:|failed\b|failure\b|KO:|unknown command|no such device|no devices|device .*not found|more than one)/im.test(resultString)) throw new ActionError(resultString.slice(-3000), 409);
  return resultString;
}

export function createConnectionExtras(core) {
  const execute = async (serial, args, job, options = {}) => {
    if (job?.cancelled) throw new ActionError('작업을 취소했습니다.', 409);
    return resultText(await core.run(serial, args, { timeout: 20000, maxBytes: 2 * 1024 * 1024, ...options, job }));
  };
  async function list(serial, direction, job) {
    selectedSerial(serial);
    const output = await execute(direction === 'forward' ? null : serial, [direction, '--list'], job);
    return parseRows(output, direction, serial);
  }
  async function remove(serial, row, job) {
    const current = await list(serial, row.direction, job);
    if (!current.some(item => item.listener === row.listener && item.target === row.target)) throw new ActionError('터널 목록이 바뀌었습니다. 목록을 새로 불러온 뒤 다시 선택하세요.', 409);
    await execute(serial, [row.direction, '--remove', row.listener], job);
  }
  async function report(serial, commands, job) {
    const rows = []; let successes = 0;
    for (const [title, args] of commands) {
      if (job?.cancelled) throw new ActionError('작업을 취소했습니다.', 409);
      try { rows.push(`${title}\n${await execute(serial, args, job) || '(응답 없음)'}`); successes++; }
      catch (error) { if (job?.cancelled) throw error; rows.push(`${title}\n조회 불가: ${error.message}`); }
    }
    if (!successes) throw new ActionError(rows.join('\n\n'), 409);
    return { message: '진단 결과를 확인하세요. 조회하지 못한 항목에는 원인을 표시했습니다.', output: rows.join('\n\n') };
  }
  async function run(actionId, serial, body = {}, job) {
    const definition = CONNECTION_EXTRA_ACTIONS.find(entry => entry.id === actionId);
    if (!definition) throw new ActionError('지원하는 연결 기능을 선택하세요.');
    if (definition.resolve !== 'host') selectedSerial(serial);
    switch (actionId) {
      case 'connection-host-info': {
        const query = choice(body.query ?? 'status', ['status', 'help', 'devices'], 'ADB 조회 항목');
        return report(null, query === 'help' ? [['설치된 ADB 명령 도움말', ['help']]] : query === 'devices' ? [['ADB의 원본 연결 목록', ['devices', '-l']]] : [['ADB 버전', ['version']], ['서버 구성', ['server-status']], ['서버 지원 기능', ['host-features']]], job);
      }
      case 'connection-mdns': return report(null, [['mDNS 동작', ['mdns', 'check']], ['발견한 무선 서비스', ['mdns', 'services']]], job);
      case 'connection-inspect': return report(serial, [['연결 상태', ['get-state']], ['연결 일련번호', ['get-serialno']], ['장치 경로', ['get-devpath']], ['이 연결의 지원 기능', ['features']]], job);
      case 'connection-keygen': {
        const directory = await core.tempDir(); job.directory = directory;
        try {
          const privateKey = path.join(directory, 'adbkey'), publicKey = `${privateKey}.pub`;
          await execute(null, ['keygen', privateKey], job);
          for (const file of [privateKey, publicKey]) {
            const info = await lstat(file);
            if (!info.isFile() || info.size < 20 || info.size > 65536) throw new ActionError('생성된 인증 키 파일을 확인하지 못했습니다.', 409);
          }
          if (job.cancelled) throw new ActionError('작업을 취소했습니다.', 409);
          const note = 'adbkey는 개인 키, adbkey.pub는 공개 키입니다.\n개인 키를 공유하면 이 키를 승인한 기기에 다른 사람이 연결할 수 있습니다.\n현재 PC의 인증 키 교체, ADB 서버 재시작, 폰의 인증 승인은 수행하지 않았습니다.\n';
          await writeFile(path.join(directory, '안내.txt'), note, 'utf8');
          const archive = path.join(directory, 'adb-auth-keys.zip'), zip = new yazl.ZipFile();
          zip.addFile(privateKey, 'adbkey', { mode: 0o100600 }); zip.addFile(publicKey, 'adbkey.pub'); zip.addBuffer(Buffer.from(note), '안내.txt');
          const writing = pipeline(zip.outputStream, createWriteStream(archive, { mode: 0o600, flags: 'wx' })); zip.end(); await writing;
          if (job.cancelled) throw new ActionError('작업을 취소했습니다.', 409);
          job.artifact = archive; job.downloadName = `adb-auth-keys-${Date.now()}.zip`;
          return { message: '별도 인증 키 ZIP을 만들었습니다. 개인 키가 들어 있으므로 안전한 곳에 보관하세요. 현재 ADB 연결에는 적용하지 않았습니다.' };
        } catch (error) { await core.removeOwned(directory).catch(() => {}); job.directory = null; throw error; }
      }
      case 'connection-emulator-info': {
        if (!/^emulator-\d{1,5}$/.test(serial)) throw new ActionError('Android 에뮬레이터 연결을 선택하세요. 실제 폰에는 이 조회를 실행하지 않습니다.');
        const commands = { help: ['help-verbose'], status: ['avd', 'status'], name: ['avd', 'name'], snapshots: ['avd', 'snapshot', 'list'], ports: ['redir', 'list'] };
        const query = choice(body.query, Object.keys(commands), '에뮬레이터 조회 항목');
        return { message: '에뮬레이터 조회 결과입니다.', output: await execute(serial, ['emu', ...commands[query]], job) };
      }
      case 'connection-reconnect-target': {
        const side = choice(body.side, ['host', 'device'], '재연결 위치');
        if (side === 'device') await execute(serial, ['get-state'], job);
        const output = await execute(serial, ['reconnect', ...(side === 'device' ? ['device'] : [])], job);
        return { message: '선택한 연결의 재연결을 요청했습니다. 기기 목록에서 실제 연결 상태를 확인하세요.', output };
      }
      case 'connection-wait': {
        const state = choice(body.state, ['device', 'disconnect', 'recovery', 'sideload', 'rescue', 'bootloader'], '대기 상태');
        const transport = choice(body.transport ?? 'any', ['any', 'usb', 'local'], '연결 방식');
        const timeout = Number(integer(body.seconds ?? 30, 1, 120, '대기 시간')) * 1000;
        try { await execute(serial, [`wait-for-${transport}-${state}`], job, { timeout }); }
        catch (error) { if (error.status === 504 || /제한 시간/.test(error.message)) throw new ActionError(`${timeout / 1000}초 안에 ${state} 상태가 감지되지 않았습니다. 주소·포트가 바뀌었으면 새 연결을 선택하세요.`, 504); throw error; }
        return { message: `${state} 상태를 감지했습니다.`, output: `대상 연결: ${serial}\n조건: ${transport} / ${state}` };
      }
      case 'connection-usb-attach': case 'connection-usb-detach': {
        if (!/^[A-Za-z0-9_.-]+$/.test(serial) || /^emulator-\d+$/.test(serial)) throw new ActionError('USB 연결을 선택하세요. 무선 주소와 에뮬레이터에는 사용할 수 없습니다.');
        const features = (await execute(null, ['host-features'], job)).split(/[\s,]+/);
        if (!features.includes('libusb')) throw new ActionError('이 ADB 서버는 libusb 방식이 아니어서 USB 가져오기·넘기기를 지원하지 않습니다. Windows USB 드라이버나 ADB 서버 설정은 자동으로 바꾸지 않습니다.', 409);
        const mode = actionId.endsWith('attach') ? 'attach' : 'detach';
        const output = await execute(serial, [mode], job);
        return { message: mode === 'attach' ? 'USB 다시 가져오기를 요청했습니다. 기기 목록에서 연결을 확인하세요.' : 'ADB의 USB 연결을 넘겼습니다. 다시 쓰려면 USB 다시 가져오기를 실행하세요.', output };
      }
      case 'ports-socket-add': {
        const direction = choice(body.direction, ['forward', 'reverse'], '연결 방향');
        const pc = `tcp:${integer(body.pcPort, direction === 'forward' ? 0 : 1, 65535, 'PC TCP 포트')}`;
        const remote = deviceSocket(body.deviceType, body.deviceValue, direction);
        if (body.deviceType === 'jdwp') {
          const pids = (await execute(serial, ['jdwp'], job)).split(/\s+/);
          if (!pids.includes(String(body.deviceValue))) throw new ActionError('현재 JDWP 목록에 없는 PID입니다. 디버깅 대상을 다시 선택하세요.', 409);
        }
        const output = await execute(serial, [direction, '--no-rebind', ...(direction === 'forward' ? [pc, remote] : [remote, pc])], job);
        const listener = direction === 'forward' ? pc : remote;
        const assignedPort = output.split(/\r?\n/).find(line => /^\d+$/.test(line));
        const assigned = listener === 'tcp:0' ? assignedPort ? `tcp:${assignedPort}` : '자동 배정 (터널 목록에서 확인)' : listener;
        return { message: `터널을 추가했습니다. 수신 주소: ${assigned}`, output: `${direction === 'forward' ? 'PC → 기기' : '기기 → PC'}\n${assigned} → ${direction === 'forward' ? remote : pc}${output ? `\nADB 응답: ${output}` : ''}` };
      }
      case 'ports-socket-remove': {
        let selected;
        try { if (typeof body.tunnel !== 'string' || body.tunnel.length > 2048) throw new Error(); selected = JSON.parse(body.tunnel); } catch { throw new ActionError('터널 목록에서 제거할 항목을 선택하세요.'); }
        if (!Array.isArray(selected) || selected.length !== 3 || selected.some(item => typeof item !== 'string')) throw new ActionError('터널 목록에서 제거할 항목을 선택하세요.');
        const direction = choice(selected[0], ['forward', 'reverse'], '연결 방향');
        const rows = await list(serial, direction, job), row = rows.find(item => item.listener === selected[1] && item.target === selected[2]);
        if (!row) throw new ActionError('이 연결의 터널 목록에 있는 수신 주소를 선택하세요.', 409);
        await remove(serial, row, job);
        return { message: `${row.listener} 터널을 제거했습니다.` };
      }
      case 'ports-clear-owned': {
        const direction = choice(body.direction, ['both', 'forward', 'reverse'], '제거 방향');
        const rows = [];
        for (const item of direction === 'both' ? ['forward', 'reverse'] : [direction]) rows.push(...await list(serial, item, job));
        const removed = [];
        try {
          for (const row of rows) {
            await remove(serial, row, job); removed.push(`${row.direction} ${row.listener} → ${row.target}`);
            if (job) { job.progress = Math.round(removed.length / rows.length * 100); job.output = removed.join('\n'); }
          }
        } catch (error) { throw new ActionError(`${removed.length}개 터널 제거 후 중단했습니다. ${error.message}`, error.status || 409); }
        return { message: rows.length ? `선택한 연결의 터널 ${removed.length}개를 제거했습니다.` : '이 연결에 제거할 터널이 없습니다.', output: removed.join('\n') };
      }
    }
  }
  async function options(serial, kind, { job } = {}) {
    if (kind !== 'tunnels') throw new ActionError('지원하는 연결 목록을 선택하세요.');
    const rows = [...await list(serial, 'forward', job), ...await list(serial, 'reverse', job)];
    return rows.map(row => ({ value: JSON.stringify([row.direction, row.listener, row.target]), label: `${row.direction === 'forward' ? 'PC → 기기' : '기기 → PC'} · ${row.listener} → ${row.target}` }));
  }
  return { run, list, options };
}
