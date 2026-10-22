const integer = (value, min, max, label) => { const number = Number(value); if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${label}: ${min}~${max} 범위를 확인하세요.`); return number; };
const token = (value, label) => { if (!/^[A-Za-z0-9_.-]{1,160}$/.test(value)) throw new Error(`${label} 형식이 올바르지 않습니다.`); return value; };
export function normalizeMirrorOptions(params) {
  if(params.get('observer')==='1')return{size:720,fps:15,bitrate:2,channels:true,observer:true};
  const size = integer(params.get('size') || 1280, 0, 8192, '영상 최대 변'), fps = integer(params.get('fps') || 30, 0, 240, 'FPS'), bitrate = integer(params.get('bitrate') || 4, 1, 100, '비트레이트');
  if (size && size < 200) throw new Error('영상 최대 변은 200 이상 또는 원본(0)이어야 합니다.');
  const audio = params.get('audio') === '1', result = { size, fps, bitrate, ...(audio ? { audio: true } : {}), ...(audio || params.get('channels') === '1' ? { channels: true } : {}) };
  const codec = params.get('codec') || 'h264'; if (!['h264', 'h265', 'av1', 'vp8', 'vp9'].includes(codec)) throw new Error('지원하는 영상 코덱을 선택하세요.'); if (codec !== 'h264') result.codec = codec;
  const encoder = params.get('encoder'); if (encoder) result.encoder = token(encoder, '인코더');
  const crop = params.get('crop'); if (crop) { const values = crop.split(':'); if (values.length !== 4) throw new Error('자르기는 너비:높이:X:Y 형식입니다.'); const nums = values.map((v, i) => integer(v, i < 2 ? 1 : 0, 32767, '자르기')); if (nums[0] + nums[2] > 32767 || nums[1] + nums[3] > 32767) throw new Error('자르기 범위가 너무 큽니다.'); result.crop = nums.join(':'); }
  const orientation = params.get('orientation'); if (orientation && orientation !== '0') { if (!/^@?(?:0|90|180|270|flip0|flip90|flip180|flip270)?$/.test(orientation)) throw new Error('영상 방향을 목록에서 선택하세요.'); result.orientation = orientation; }
  if (params.has('display') && params.get('display') !== '0') result.display = integer(params.get('display'), 0, 99999, '화면 ID');
  if (params.get('newDisplay') === '1') {
    if (result.display) throw new Error('가상 화면과 기존 화면을 함께 선택할 수 없습니다.');
    const width = integer(params.get('vdWidth') || 1280, 200, 8192, '가상 화면 너비'), height = integer(params.get('vdHeight') || 960, 200, 8192, '가상 화면 높이'), dpi = integer(params.get('vdDpi') || 240, 72, 1600, '가상 화면 DPI');
    result.newDisplay = `${width}x${height}/${dpi}`; result.flex = params.get('flex') === '1'; result.decorations = params.get('decorations') !== '0'; result.destroyContent = params.get('destroyContent') !== '0';
  }
  const ime = params.get('ime'); if (ime) { if (!['local', 'fallback', 'hide'].includes(ime)) throw new Error('키보드 표시 위치를 선택하세요.'); result.ime = ime; }
  const startApp = params.get('startApp'); if (startApp) { if (!/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/.test(startApp) || startApp.length > 255) throw new Error('앱 목록에서 시작할 앱을 선택하세요.');if(!/^\d{1,5}$/.test(params.get('startAppUser')||''))throw new Error('현재 사용자 앱을 목록에서 다시 선택하세요.');result.startApp = startApp;result.startAppUser=Number(params.get('startAppUser')); }
  if (params.get('source') === 'camera') {
    if (result.newDisplay || result.display) throw new Error('카메라와 화면 대상을 함께 선택할 수 없습니다.'); result.source = 'camera';
    // Legacy requests may contain both; an explicit ID remains authoritative.
    // The web UI sends one target selector, and normalized server arguments never send both.
    const id = params.get('cameraId'), facing = params.get('cameraFacing'); if (id) result.cameraId = token(id, '카메라 ID');
    else if (facing) { if (!['front', 'back', 'external'].includes(facing)) throw new Error('카메라 방향을 선택하세요.'); result.cameraFacing = facing; }
    const resolution = params.get('cameraSize'); if (resolution) { const parts = resolution.split('x'); if (parts.length !== 2) throw new Error('카메라 크기를 목록에서 선택하세요.'); result.cameraSize = parts.map(v => integer(v, 1, 8192, '웹 전송 카메라 크기')).join('x'); }
    if (params.get('cameraFps')) result.cameraFps = integer(params.get('cameraFps'), 1, 960, '카메라 FPS');
    const zoom = Number(params.get('cameraZoom') || 1); if (!Number.isFinite(zoom) || zoom < .1 || zoom > 100) throw new Error('카메라 확대 비율을 확인하세요.'); result.cameraZoom = zoom;
    result.cameraTorch = params.get('cameraTorch') === '1'; result.cameraHighSpeed = params.get('cameraHighSpeed') === '1';
  } else if (params.get('source') && params.get('source') !== 'display') throw new Error('영상 소스를 선택하세요.');
  if (params.get('keepActive') === '1') result.keepActive = true;
  if (params.get('preview') === '0') result.preview = false;
  if(params.get('limit')){const limit=integer(params.get('limit'),0,86400,'연결 시간');if(limit&&limit<30)throw new Error('연결 시간은 30초 이상 또는 제한 없음(0)으로 설정하세요.');if(limit)result.limitSeconds=limit;}
  if(params.get('verbosity')){if(!['error','warn','info','debug'].includes(params.get('verbosity')))throw new Error('세션 로그 수준을 선택하세요.');result.verbosity=params.get('verbosity');}
  if(params.get('decoder')){if(!['no-preference','prefer-hardware','prefer-software'].includes(params.get('decoder')))throw new Error('PC 디코더 선호를 선택하세요.');result.decoder=params.get('decoder');}
  return result;
}
export function videoServerArgs(options) {
  const args = [`max_size=${options.source === 'camera' && options.cameraSize ? 0 : options.size}`, `max_fps=${options.source === 'camera' ? 0 : options.fps}`, `video_bit_rate=${options.bitrate * 1000000}`, `video_codec=${options.codec || 'h264'}`];
  for (const [field, server] of [['encoder','video_encoder'],['crop','crop'],['orientation','capture_orientation'],['display','display_id'],['newDisplay','new_display'],['ime','display_ime_policy'],['source','video_source'],['cameraId','camera_id'],['cameraFacing','camera_facing'],['cameraSize','camera_size'],['cameraFps','camera_fps'],['cameraZoom','camera_zoom']]) {
    if(field.startsWith('camera')&&(options.source!=='camera'||field==='cameraFacing'&&options.cameraId))continue;
    if (options[field] !== undefined) args.push(`${server}=${options[field]}`);
  }
  for (const [field, server] of [['flex','flex_display'],['decorations','vd_system_decorations'],['destroyContent','vd_destroy_content'],['cameraTorch','camera_torch'],['cameraHighSpeed','camera_high_speed'],['keepActive','keep_active']]) if (options[field] !== undefined&&(!field.startsWith('camera')||options.source==='camera')) args.push(`${server}=${!!options[field]}`);
  return args;
}
