import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { open, stat, writeFile } from 'node:fs/promises';
import { ActionError } from './connections.mjs';
import { quote } from './operations-core.mjs';

const select = (name, label, options, value) => ({ name, label, type: 'select', options: options.map(([value, label]) => ({ value, label })), value: value ?? options[0][0] });
const number = (name, label, value, min, max) => ({ name, label, type: 'number', value, min, max });
const text = (name, label, value = '', hint = '') => ({ name, label, type: 'text', value, hint });
const display = number('display', '입력 대상 화면 ID', 0, 0, 99999);
const point = (suffix = '') => [number('x' + suffix, (suffix === '2' ? '끝' : '시작') + ' X 좌표', 200, 0, 32767), number('y' + suffix, (suffix === '2' ? '끝' : '시작') + ' Y 좌표', suffix === '2' ? 200 : 600, 0, 32767)];
const physical = text('physicalDisplay', '물리 화면 ID (기본 화면은 비움)', '', '화면·입력 장치 정보의 SurfaceFlinger ID입니다. 입력 대상 화면 ID와 다릅니다.');
const action = (id, title, description, fields = [], write = true, support = 'Android input 명령 지원 기기') => ({ id, group: 'display', title, description, fields, write, support });

export const INPUT_KEY_PRESETS = Object.freeze({
  enter: [66, 'Enter · 입력 확인'], backspace: [67, 'Backspace · 앞 글자 삭제'], delete: [112, 'Delete · 뒤 글자 삭제'], tab: [61, 'Tab · 다음 항목'], escape: [111, 'Esc · 취소'],
  left: [21, '← 왼쪽'], up: [19, '↑ 위'], down: [20, '↓ 아래'], right: [22, '→ 오른쪽'], center: [23, '방향키 가운데 · 선택'],
  home: [3, '홈 화면'], back: [4, '뒤로'], recents: [187, '최근 앱'], menu: [82, '메뉴'], search: [84, '검색'],
  moveHome: [122, '줄 맨 앞'], moveEnd: [123, '줄 맨 끝'], pageUp: [92, '이전 페이지'], pageDown: [93, '다음 페이지'],
  copy: [278, '복사'], cut: [277, '잘라내기'], paste: [279, '폰 클립보드 붙여넣기'],
  volumeUp: [24, '음량 높임'], volumeDown: [25, '음량 낮춤'], mute: [164, '음량 음소거 전환'],
  playPause: [85, '재생·일시 정지'], mediaStop: [86, '미디어 정지'], next: [87, '다음 곡'], previous: [88, '이전 곡'],
  wake: [224, '화면 켜기'], sleep: [223, '화면 끄기'], power: [26, '전원 버튼'],
});
const shortcuts = Object.freeze({
  selectAll: [[113, 29], '전체 선택 · Ctrl+A'], copy: [[113, 31], '복사 · Ctrl+C'], cut: [[113, 52], '잘라내기 · Ctrl+X'], paste: [[113, 50], '붙여넣기 · Ctrl+V'],
  undo: [[113, 54], '실행 취소 · Ctrl+Z'], redo: [[113, 59, 54], '다시 실행 · Ctrl+Shift+Z'], previousField: [[59, 61], '이전 입력란 · Shift+Tab'],
});

export const INPUT_EXTRA_ACTIONS = [
  action('input-key', '미러링 없이 키 입력', '화면 전송을 켜지 않아도 선택한 키를 보냅니다. 메뉴·검색·편집 키의 효과는 현재 앱에 따라 다릅니다.', [select('key', '보낼 키', Object.entries(INPUT_KEY_PRESETS).map(([key, [, label]]) => [key, label])), select('press', '누르는 방식', [['normal', '한 번 누르기'], ['long', '길게 누르기']]), display]),
  action('input-shortcut', '편집 단축키', '전체 선택·실행 취소 같은 키 조합을 보냅니다. 입력란을 먼저 선택해야 하며 앱이 단축키를 지원해야 합니다.', [select('shortcut', '단축키', Object.entries(shortcuts).map(([key, [, label]]) => [key, label])), display], true, 'input keycombination 지원 기기·앱'),
  action('input-tap', '좌표 한 번 누르기', 'Android 화면의 실제 픽셀 좌표를 한 번 누릅니다. 웹에 축소된 화면의 좌표와 다릅니다.', [...point(), display]),
  action('input-longpress', '좌표 길게 누르기', '같은 위치를 지정한 시간 동안 누릅니다. 메뉴 열기·아이콘 선택 등에 사용합니다.', [...point(), number('duration', '누르는 시간(ms)', 800, 500, 10000), display]),
  action('input-swipe', '스와이프·끌어놓기', '두 좌표 사이를 움직입니다. 끌어놓기는 시작 지점을 길게 누른 후 이동합니다.', [select('gesture', '동작', [['swipe', '스와이프'], ['draganddrop', '길게 눌러 끌어놓기']]), ...point(), ...point('2'), number('duration', '이동 시간(ms)', 500, 50, 10000), display]),
  action('input-text', '영문·숫자 직접 입력', '현재 입력란에 영문·숫자·기호를 보냅니다. 한글은 실시간 화면의 텍스트 붙여넣기를 사용하세요.', [text('text', '입력할 내용', '', '최대 1,024자, 줄바꿈과 문자 그대로의 %s는 지원하지 않습니다.'), display]),
  action('input-displays', '화면·입력 장치 정보', '화면 ID·회전·해상도와 입력 장치, 이 기기에서 지원하는 input 문법을 조회합니다.', [], false, 'dumpsys display/input·SurfaceFlinger'),
  action('screen-native-capture', '기기 원본 PNG 캡처', '브라우저 영상 재생 없이 기기 화면을 PNG로 받아 PC에 저장합니다. 캡처가 제한된 화면은 보이지 않을 수 있습니다.', [physical], false, 'screencap 지원 기기'),
  action('screen-native-record', '기기 자체 MP4 녹화', '5~180초 동안 기기에서 녹화한 뒤 PC로 받습니다. 소리는 포함되지 않습니다. 취소하면 임시 녹화를 정리합니다.', [number('seconds', '녹화 시간(초)', 30, 5, 180), select('bitrate', '화질(Mbps)', [['2', '2 Mbps'], ['4', '4 Mbps'], ['8', '8 Mbps'], ['12', '12 Mbps'], ['20', '20 Mbps']], '4'), physical], true, 'screenrecord·H.264 인코더 지원 기기'),
  action('screen-ui-tree', '현재 화면 요소 구조', '앱이 접근성에 공개한 버튼·문구·좌표를 XML로 저장합니다. 숨겨진 요소나 모든 게임 화면까지 읽는 기능은 아닙니다.', [], false, 'uiautomator dump 지원 기기'),
];

function integer(value, min, max, label) {
  if (!['number', 'string'].includes(typeof value) || String(value).trim() === '') throw new ActionError(`${label} 값을 입력하세요.`);
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new ActionError(`${label} 범위는 ${min}~${max}입니다.`);
  return String(n);
}
function physicalId(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{1,20}$/.test(value) || BigInt(value) > 0xffffffffffffffffn) throw new ActionError('물리 화면 ID는 화면 정보에 표시된 64비트 숫자여야 합니다.');
  return value;
}
function checked(result) {
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
  if (/^(?:Error:|Exception\b|Security exception|Permission denied|Unknown command|Unknown option|Invalid arguments|Failed to|ERROR:)/im.test(output)) throw new ActionError(output.slice(-3000), 409);
  return output;
}

export async function validateCaptureFile(file, kind) {
  const info = await stat(file), limit = kind === 'png' ? 64 * 1024 * 1024 : 512 * 1024 * 1024;
  if (info.size < 24 || info.size > limit) throw new ActionError('생성된 화면 파일이 비어 있거나 허용 크기를 초과했습니다.', 409);
  const handle = await open(file, 'r');
  try {
    const header = Buffer.alloc(24); await handle.read(header, 0, 24, 0);
    if (kind === 'png') {
      if (!header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || header.toString('ascii', 12, 16) !== 'IHDR' || !header.readUInt32BE(16) || !header.readUInt32BE(20)) throw new ActionError('PNG 화면을 받지 못했습니다. 기기의 캡처 지원과 화면 보호 정책을 확인하세요.', 409);
      return;
    }
    let offset = 0, boxes = 0, ftyp = false, moov = false, mdat = false;
    while (offset + 8 <= info.size && ++boxes <= 10000) {
      const atom = Buffer.alloc(16), { bytesRead } = await handle.read(atom, 0, 16, offset);
      if (bytesRead < 8) break;
      const tag = atom.toString('ascii', 4, 8); let size = atom.readUInt32BE(0), minimum = 8;
      if (size === 1) { if (bytesRead < 16) break; const large = atom.readBigUInt64BE(8); if (large > BigInt(Number.MAX_SAFE_INTEGER)) break; size = Number(large); minimum = 16; }
      if (size === 0) size = info.size - offset;
      if (size < minimum || size > info.size - offset) break;
      ftyp ||= tag === 'ftyp'; moov ||= tag === 'moov'; mdat ||= tag === 'mdat'; offset += size;
    }
    if (!ftyp || !moov || !mdat || offset !== info.size) throw new ActionError('MP4 녹화가 완전히 마무리되지 않았습니다. 다시 녹화하세요.', 409);
  } finally { await handle.close(); }
}

export function createInputExtras(core) {
  const shell = async (serial, args, job, options = {}) => checked(await core.run(serial, ['shell', args.map(v => quote(String(v))).join(' ')], { job, ...options }));
  async function saved(job, filename, output) {
    job.directory ||= await core.tempDir(); job.artifact = path.join(job.directory, filename); job.downloadName = filename;
    await writeFile(job.artifact, output, 'utf8'); job.output = output.slice(0, 131072);
    return { message: '결과를 조회했습니다. 전체 파일을 다운로드할 수 있습니다.', output: job.output };
  }
  async function run(id, serial, body, job) {
    if (!INPUT_EXTRA_ACTIONS.some(action => action.id === id)) throw new ActionError('지원하지 않는 화면·입력 기능입니다.');
    if (job?.cancelled) throw new ActionError('작업을 취소했습니다.', 409);
    if (id === 'input-displays') {
      const sections = []; let succeeded = 0;
      for (const [title, args] of [['화면 목록·회전·해상도', ['dumpsys', 'display']], ['물리 화면 ID (캡처·녹화용)', ['dumpsys', 'SurfaceFlinger', '--display-id']], ['입력 장치', ['dumpsys', 'input']], ['지원 입력 명령', ['input', '--help']]]) {
        try { sections.push(`${title}\n${await shell(serial, args, job, { maxBytes: 4 * 1024 * 1024 })}`); succeeded++; }
        catch (error) { if (job?.cancelled) throw error; sections.push(`${title}\n조회 실패: ${error.message}`); }
      }
      const result = await saved(job, 'display-input-info.txt', sections.join('\n\n'));
      if (!succeeded) throw new ActionError('화면·입력 정보를 조회하지 못했습니다. 결과 파일에서 각 오류를 확인하세요.', 409);
      return result;
    }
    if (id === 'screen-native-capture') {
      const selected = physicalId(body.physicalDisplay); job.directory = await core.tempDir(); const file = path.join(job.directory, 'screen.png');
      const stream = createWriteStream(file);
      try { await core.run(serial, ['exec-out', 'screencap', '-p', ...(selected ? ['-d', selected] : [])], { job, timeout: 30000, maxBytes: 64 * 1024 * 1024, stdoutFile: stream }); }
      catch (error) { stream.destroy(); throw error; }
      await validateCaptureFile(file, 'png'); job.artifact = file; job.downloadName = `screen-${Date.now()}.png`;
      return { message: '기기 원본 PNG를 받았습니다. 다운로드할 수 있습니다.' };
    }
    if (id === 'screen-ui-tree') {
      const remote = `/data/local/tmp/adb-desk-ui-${randomUUID()}.xml`; job.directory = await core.tempDir(); const file = path.join(job.directory, 'screen-elements.xml');
      try {
        await shell(serial, ['uiautomator', 'dump', '--compressed', remote], job, { timeout: 45000 });
        await core.run(serial, ['pull', remote, file], { job, timeout: 30000 });
        const info = await stat(file); if (!info.size || info.size > 16 * 1024 * 1024) throw new ActionError('화면 요소 파일이 비어 있거나 너무 큽니다.');
        job.artifact = file; job.downloadName = 'screen-elements.xml'; return { message: '현재 화면이 공개한 요소·좌표를 XML로 저장했습니다.' };
      } finally { await shell(serial, ['rm', '-f', remote], undefined).catch(() => {}); }
    }
    if (id === 'screen-native-record') {
      const seconds = integer(body.seconds, 5, 180, '녹화 시간'), bitrate = String(body.bitrate), selected = physicalId(body.physicalDisplay);
      if (!['2', '4', '8', '12', '20'].includes(bitrate)) throw new ActionError('지원하는 녹화 화질을 선택하세요.');
      if (selected) { const help = await shell(serial, ['screenrecord', '--help'], job); if (!help.includes('--display-id')) throw new ActionError('이 기기의 screenrecord는 화면 ID 선택을 지원하지 않습니다. 기본 화면으로 녹화하세요.'); }
      const unique = randomUUID(), remote = `/data/local/tmp/adb-desk-record-${unique}.mp4`, pidfile = `/data/local/tmp/adb-desk-record-${unique}.pid`;
      job.directory = await core.tempDir(); const file = path.join(job.directory, 'screen.mp4');
      const args = ['screenrecord', '--time-limit', seconds, '--bit-rate', String(Number(bitrate) * 1000000), ...(selected ? ['--display-id', selected] : []), remote];
      const script = `umask 077; printf '%s\\n' "$$" > ${quote(pidfile)} || exit 1; exec ${args.map(quote).join(' ')}`;
      const started = Date.now(), progress = setInterval(() => { job.progress = Math.min(85, Math.round((Date.now() - started) / (Number(seconds) * 1000) * 85)); }, 500); progress.unref();
      try {
        await shell(serial, ['sh', '-c', script], job, { timeout: (Number(seconds) + 30) * 1000 }); clearInterval(progress); job.progress = 90;
        await core.run(serial, ['pull', remote, file], { job, timeout: 10 * 60 * 1000 });
        await validateCaptureFile(file, 'mp4'); job.artifact = file; job.downloadName = `screen-${Date.now()}.mp4`;
        return { message: `${seconds}초 MP4 녹화를 받았습니다. 기기 자체 녹화에는 소리가 포함되지 않습니다.` };
      } finally {
        clearInterval(progress);
        // The unique output path verifies ownership before signalling a PID that may have been reused.
        const cleanup = `p=$(cat ${quote(pidfile)} 2>/dev/null); case "$p" in ''|*[!0-9]*) p='' ;; esac; if [ -n "$p" ] && [ -r "/proc/$p/cmdline" ]; then c=$(tr '\\000' ' ' < "/proc/$p/cmdline"); case "$c" in screenrecord\\ *${quote(remote)}*) kill -INT "$p" 2>/dev/null; n=0; while [ -r "/proc/$p/cmdline" ] && [ "$n" -lt 5 ]; do sleep 1; n=$((n+1)); done ;; esac; fi; rm -f ${quote(remote)} ${quote(pidfile)}`;
        await shell(serial, ['sh', '-c', cleanup], undefined, { timeout: 12000 }).catch(() => {});
      }
    }
    const displayId = integer(body.display ?? 0, 0, 99999, '화면 ID'), input = ['input', '-d', displayId]; let args;
    if (id === 'input-key') {
      if (!Object.hasOwn(INPUT_KEY_PRESETS, body.key)) throw new ActionError('보낼 키를 목록에서 선택하세요.');
      if (!['normal', 'long'].includes(body.press ?? 'normal')) throw new ActionError('키를 누르는 방식을 선택하세요.');
      args = [...input, 'keyevent', ...(body.press === 'long' ? ['--longpress'] : []), String(INPUT_KEY_PRESETS[body.key][0])];
    } else if (id === 'input-shortcut') {
      if (!Object.hasOwn(shortcuts, body.shortcut)) throw new ActionError('단축키를 목록에서 선택하세요.');
      const help = await shell(serial, ['input', '--help'], job); if (!help.includes('keycombination')) throw new ActionError('이 기기의 input 명령은 키 조합을 지원하지 않습니다. 복사·붙여넣기는 단일 키 입력도 확인하세요.');
      args = [...input, 'keycombination', ...shortcuts[body.shortcut][0].map(String)];
    } else if (id === 'input-text') {
      if (typeof body.text !== 'string' || !body.text || body.text.length > 1024 || /[^\x20-\x7e]/.test(body.text) || body.text.includes('%s')) throw new ActionError('1~1,024자의 영문·숫자·기호를 입력하세요. 한글·줄바꿈·문자 그대로의 %s는 실시간 화면의 붙여넣기를 사용하세요.');
      args = [...input, 'text', body.text.replaceAll(' ', '%s')];
    } else {
      const x = integer(body.x, 0, 32767, 'X 좌표'), y = integer(body.y, 0, 32767, 'Y 좌표');
      if (id === 'input-tap') args = [...input, 'tap', x, y];
      else if (id === 'input-longpress') args = [...input, 'swipe', x, y, x, y, integer(body.duration, 500, 10000, '누르는 시간')];
      else if (id === 'input-swipe') {
        if (!['swipe', 'draganddrop'].includes(body.gesture)) throw new ActionError('이동 동작을 목록에서 선택하세요.');
        args = [...input, body.gesture, x, y, integer(body.x2, 0, 32767, '끝 X 좌표'), integer(body.y2, 0, 32767, '끝 Y 좌표'), integer(body.duration, 50, 10000, '이동 시간')];
      } else throw new ActionError('지원하지 않는 입력 동작입니다.');
    }
    await shell(serial, args, job, { timeout: 20000 });
    return { message: '입력 요청을 전달했습니다. 실제 동작은 현재 화면·앱의 입력 처리 방식에 따라 다릅니다.' };
  }
  return { run };
}
