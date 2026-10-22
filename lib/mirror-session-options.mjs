import { quote } from './operations-core.mjs';
const TYPES=new Set(['int','long','float','string']);
const RESERVED=new Set(['mime','width','height','color-format','frame-rate','bitrate','crop-left','crop-right','crop-top','crop-bottom','stride','slice-height','rotation-degrees']);
const AUDIO_RESERVED=new Set(['sample-rate','channel-count','channel-mask','pcm-encoding','pcm-big-endian','aac-profile','aac-sbr-mode','profile','bit-depth','bits-per-sample','audio-encoding','channel-layout','is-adts','encoder-delay','encoder-padding','durationUs']);
const decimal=/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
function integer(value,min,max,label){if(!/^\d+$/.test(String(value)))throw new Error(`${label}은 정수로 입력하세요.`);const n=Number(value);if(!Number.isSafeInteger(n)||n<min||n>max)throw new Error(`${label} 범위는 ${min}~${max}입니다.`);return n;}
export function normalizeVideoCodecOptions(rows){
  if(typeof rows==='string'){if(Buffer.byteLength(rows)>4096)throw new Error('영상 코덱 옵션이 너무 큽니다.');try{rows=JSON.parse(rows);}catch{throw new Error('영상 코덱 옵션 목록을 확인하세요.');}}
  if(!Array.isArray(rows)||rows.length>16)throw new Error('영상 코덱 옵션은 최대 16개입니다.');
  const keys=new Set(),result=[];
  for(const row of rows){
    if(!row||typeof row!=='object'||typeof row.key!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(row.key))throw new Error('코덱 옵션 키는 영문·숫자·점·밑줄·하이픈 80자 이내입니다.');
    if(RESERVED.has(row.key))throw new Error(`${row.key}: 화면 좌표·전송 기본값은 위의 크기·FPS·화질 설정에서 지정하세요.`);
    if(keys.has(row.key))throw new Error('같은 코덱 옵션 키를 중복 지정할 수 없습니다.');keys.add(row.key);
    if(!TYPES.has(row.type))throw new Error('코덱 옵션 타입은 int, long, float, string 중 선택하세요.');
    if(typeof row.value!=='string'&&(typeof row.value!=='number'||!Number.isFinite(row.value)))throw new Error('코덱 옵션 값을 입력하세요.');
    let value=String(row.value);
    if(row.type==='string'){if(Buffer.byteLength(value)>512||/[\x00-\x1f\x7f]/.test(value))throw new Error('문자열 옵션은 제어 문자 없는 UTF-8 512바이트 이하입니다.');}
    else if(row.type==='float'){if(!decimal.test(value))throw new Error('float 옵션은 유한한 소수로 입력하세요.');const n=Number(value),f=Math.fround(n);if(!Number.isFinite(n)||!Number.isFinite(f)||(n!==0&&f===0))throw new Error('float32로 표현할 수 없는 값입니다.');value=Object.is(n,-0)?'-0':String(n);}
    else{if(typeof row.value==='number'&&!Number.isSafeInteger(row.value))throw new Error('큰 정수는 정확한 숫자 문자열로 입력하세요.');if(!/^-?(?:0|[1-9]\d*)$/.test(value))throw new Error(`${row.type} 옵션은 정수로 입력하세요.`);const n=BigInt(value),min=row.type==='int'?-2147483648n:-9223372036854775808n,max=row.type==='int'?2147483647n:9223372036854775807n;if(n<min||n>max)throw new Error(`${row.type} 정수 범위를 벗어났습니다.`);value=n.toString();}
    result.push({key:row.key,type:row.type,value});
  }
  const serialized=result.map(row=>`${row.key}:${row.type}=${row.value.replaceAll('\\','\\\\').replaceAll(',','\\,')}`).join(',');
  if(Buffer.byteLength(serialized)>2048)throw new Error('영상 코덱 옵션의 합계는 UTF-8 2KB 이하입니다.');
  return{rows:result,serialized};
}
export function normalizeAudioCodecOptions(rows){const result=normalizeVideoCodecOptions(rows);for(const row of result.rows)if(AUDIO_RESERVED.has(row.key)||/^csd-/i.test(row.key))throw new Error(`${row.key}: 소리 전송의 채널·샘플레이트·기본 형식은 변경할 수 없습니다.`);return result;}
export function normalizeCameraAspectRatio(value){
  if(value==='sensor')return value;
  const parts=String(value).split(':');let ratio;
  if(parts.length===2){const a=integer(parts[0],1,100000,'카메라 비율 분자'),b=integer(parts[1],1,100000,'카메라 비율 분모');ratio=a/b;}
  else if(parts.length===1&&decimal.test(parts[0]))ratio=Number(parts[0]);
  if(!Number.isFinite(ratio)||ratio<.01||ratio>100)throw new Error('카메라 비율은 sensor, 양수:양수 또는 0.01~100 범위의 소수로 지정하세요.');
  return String(value);
}
export function normalizeSessionOptions(params,base={}){
  if(base.observer)return{};
  const result={},controlOnly=params.get('controlOnly')==='1';
  if(controlOnly){if(base.audioOnly||params.get('audioOnly')==='1')throw new Error('소리 전용과 조작 전용을 함께 선택할 수 없습니다.');if(base.newDisplay||base.source==='camera')throw new Error('조작 전용은 기존 기기 화면만 대상으로 합니다.');result.controlOnly=true;result.audio=false;result.audioOnly=false;}
  if(!controlOnly&&!base.audioOnly){
    if(params.get('videoCodecOptions')){const codec=normalizeVideoCodecOptions(params.get('videoCodecOptions'));if(codec.rows.length){result.videoCodecOptions=codec.serialized;result.videoCodecRows=codec.rows;}}
    const angle=params.get('captureAngle');if(angle&&angle!=='0'){if(!decimal.test(angle)||!Number.isFinite(Number(angle))||Number(angle)<-180||Number(angle)>180)throw new Error('전송 영상 각도는 -180~180도입니다.');result.captureAngle=Number(angle);}
    const downsize=params.get('downsize');if(downsize){if(!['on','off'].includes(downsize))throw new Error('자동 해상도 축소 정책을 선택하세요.');result.downsizeOnError=downsize==='on';}
    const alignment=params.get('minSizeAlignment');if(alignment){if(!['1','2','4','8','16'].includes(alignment))throw new Error('최소 크기 정렬은 1·2·4·8·16 중 선택하세요.');result.minSizeAlignment=Number(alignment);}
    if(params.get('ignoreVideoEncoderConstraints')==='1')result.ignoreVideoEncoderConstraints=true;
    const ar=params.get('cameraAr');if(ar){if(base.source!=='camera'||base.cameraSize)throw new Error('카메라 비율은 카메라 소스의 크기 자동 선택에서만 적용합니다.');result.cameraAr=normalizeCameraAspectRatio(ar);}
  }
  if(!controlOnly&&params.get('audioCodecOptions')){if(!base.audio||!['aac','opus','flac'].includes(base.audioCodec))throw new Error('소리 코덱 추가 옵션은 소리 전달을 켜고 압축 코덱을 선택한 뒤 사용하세요.');const codec=normalizeAudioCodecOptions(params.get('audioCodecOptions'));if(codec.rows.length){result.audioCodecOptions=codec.serialized;result.audioCodecRows=codec.rows;}}
  for(const [field,key]of [['showTouches','sessionShowTouches'],['stayAwake','sessionStayAwake'],['powerOn','sessionPowerOn'],['startScreenOff','sessionScreenOff'],['powerOffOnClose','sessionPowerOffOnClose']])if(params.get(key)==='1')result[field]=true;
  const timeout=params.get('sessionScreenTimeout');if(timeout)result.screenOffTimeoutMs=integer(timeout,5,86400,'화면 꺼짐 시간(초)')*1000;
  if(params.get('startForceStop')==='1'){if(!base.startApp)throw new Error('강제 종료 후 시작할 앱을 목록에서 선택하세요.');result.startForceStop=true;}
  if(base.audioOnly&&(result.powerOn||result.startScreenOff))throw new Error('시작 시 화면 전원 조작은 영상 또는 조작 전용 연결에서 사용할 수 있습니다.');
  return result;
}
export function sessionServerArgs(options){
  const args=[];for(const[field,key]of [['videoCodecOptions','video_codec_options'],['audioCodecOptions','audio_codec_options'],['captureAngle','angle'],['minSizeAlignment','min_size_alignment'],['ignoreVideoEncoderConstraints','ignore_video_encoder_constraints'],['cameraAr','camera_ar'],['downsizeOnError','downsize_on_error'],['showTouches','show_touches'],['stayAwake','stay_awake'],['powerOn','power_on'],['screenOffTimeoutMs','screen_off_timeout'],['powerOffOnClose','power_off_on_close']])if(options[field]!==undefined)args.push(`${key}=${options[field]}`);
  return args;
}
export function scrcpyServerCommand(remote,args){if(!/^\/data\/local\/tmp\/adb-desk-[0-9a-f]+\.jar$/.test(remote))throw new Error('허용되지 않은 화면 서버 경로입니다.');return `CLASSPATH=${quote(remote)} ${['app_process','/','com.genymobile.scrcpy.Server','5.0.1',...args].map(value=>quote(String(value))).join(' ')}`;}
export function mirrorChannelPlan(options){if(options.observer)return['video'];if(options.controlOnly)return['control'];if(options.audioOnly)return['audio'];return['video',...(options.audio?['audio']:[]),'control'];}
