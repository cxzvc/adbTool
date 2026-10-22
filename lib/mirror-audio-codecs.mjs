const CODECS=new Map([[0x00726177,'raw'],[0x00616163,'aac'],[0x6f707573,'opus'],[0x666c6163,'flac']]);
const RATES=[96000,88200,64000,48000,44100,32000,24000,22050,16000,12000,11025,8000,7350];
export function audioEncodingOptions(params){
  const codec=params.get('audioCodec')||'raw';if(!['raw','aac','opus','flac'].includes(codec))throw new Error('소리 전송 코덱을 선택하세요.');
  const encoder=params.get('audioEncoder')||'',bitrate=Number(params.get('audioBitrate')||128);
  if(encoder&&!/^[A-Za-z0-9_.-]{1,160}$/.test(encoder))throw new Error('소리 인코더를 기기 지원 목록에서 선택하세요.');
  if(!Number.isInteger(bitrate)||bitrate<8||bitrate>1024)throw new Error('소리 비트레이트는 8~1024Kbps입니다.');
  if(codec==='raw'&&encoder)throw new Error('PCM 전송은 기기 인코더를 사용하지 않습니다.');
  return{audioCodec:codec,...(encoder?{audioEncoder:encoder}:{}),...(codec==='aac'||codec==='opus'?{audioBitrate:bitrate}:{})};
}
export function audioEncodingArgs(options){
  const codec=options.audioCodec||'raw',valid=audioEncodingOptions(new URLSearchParams({audioCodec:codec,audioEncoder:options.audioEncoder||'',audioBitrate:String(options.audioBitrate||128)}));
  return[`audio_codec=${codec}`,...(valid.audioEncoder?[`audio_encoder=${valid.audioEncoder}`]:[]),...(valid.audioBitrate?[`audio_bit_rate=${valid.audioBitrate*1000}`]:[])];
}
export function audioCodecFormat(codec,description=Buffer.alloc(0)){
  if(codec==='raw')return{codec,sampleRate:48000,channels:2,bitDepth:16,format:'s16le'};
  if(!Buffer.isBuffer(description)||description.length>65536)throw new Error('소리 코덱 설정 크기가 올바르지 않습니다.');
  let sampleRate,channels,bitDepth=16,codecString=codec,codecDelayNs=0;
  if(codec==='aac'){
    if(description.length<2||description.length>16)throw new Error('AAC 설정을 확인할 수 없습니다.');
    const objectType=description[0]>>3,rateIndex=((description[0]&7)<<1)|(description[1]>>7);channels=(description[1]>>3)&15;sampleRate=RATES[rateIndex];
    if(objectType!==2||!sampleRate||channels!==2)throw new Error('이 AAC 인코더 형식은 지원하지 않습니다. AAC-LC 스테레오 인코더 또는 PCM을 선택하세요.');codecString='mp4a.40.2';
  }else if(codec==='opus'){
    if(description.length!==19||description.subarray(0,8).toString()!=='OpusHead'||description[8]>15||description[9]!==2||description[18]!==0)throw new Error('Opus 스테레오 설정이 올바르지 않습니다.');
    sampleRate=48000;channels=2;codecDelayNs=Math.round(description.readUInt16LE(10)*1e9/48000);
  }else if(codec==='flac'){
    if(description.length===42&&description.subarray(0,4).toString()==='fLaC')description=description.subarray(8);
    if(description.length!==34)throw new Error('FLAC STREAMINFO 설정을 확인할 수 없습니다.');
    sampleRate=(description[10]<<12)|(description[11]<<4)|(description[12]>>4);channels=((description[12]>>1)&7)+1;bitDepth=(((description[12]&1)<<4)|(description[13]>>4))+1;
    if(sampleRate<8000||sampleRate>192000||channels!==2||bitDepth<8||bitDepth>24)throw new Error('지원하지 않는 FLAC 소리 형식입니다.');
    description=Buffer.concat([Buffer.from('fLaC'),Buffer.from([128,0,0,34]),description]);
  }else throw new Error('지원하지 않는 소리 코덱입니다.');
  return{codec,codecString,sampleRate,channels,bitDepth,format:'encoded',description:description.toString('base64'),codecDelayNs};
}
export function validatedAudioFormat(format){
  if(!format||!['raw','aac','opus','flac'].includes(format.codec||'raw'))throw new Error('소리 형식이 올바르지 않습니다.');
  const codec=format.codec||'raw';if(codec==='raw'){if(format.sampleRate!==48000||format.channels!==2||format.format!=='s16le')throw new Error('PCM 형식이 올바르지 않습니다.');return audioCodecFormat('raw');}
  if(typeof format.description!=='string'||format.description.length>90000||!/^[A-Za-z0-9+/]*={0,2}$/.test(format.description))throw new Error('소리 설정 정보가 올바르지 않습니다.');
  return audioCodecFormat(codec,Buffer.from(format.description,'base64'));
}
export function encodedAudioDurationUs(codec,payload,format){
  if(codec==='raw')return payload.length/4/48000*1e6;
  if(codec==='aac')return 1024/format.sampleRate*1e6;
  if(codec==='opus'){
    if(!payload.length)throw new Error('빈 Opus 패킷입니다.');const toc=payload[0],config=toc>>3,code=toc&3;
    const frames=code===0?1:code===3?(payload.length>1?payload[1]&63:0):2;
    const ms=config>=16?2.5*2**(config&3):config>=12?10*2**(config&1):[10,20,40,60][config&3];if(!frames||frames*ms>120)throw new Error('Opus 프레임 길이가 올바르지 않습니다.');return frames*ms*1000;
  }
  if(codec==='flac'){
    if(payload.length<6||payload[0]!==255||(payload[1]&252)!==248)throw new Error('FLAC 프레임 헤더가 올바르지 않습니다.');const code=payload[2]>>4;let samples;
    if(code===1)samples=192;else if(code>=2&&code<=5)samples=576*2**(code-2);else if(code>=8)samples=256*2**(code-8);
    else if(code===6||code===7){let length=1,lead=payload[4];if(lead>=128){length=0;for(let bit=128;lead&bit;bit>>=1)length++;if(length<2||length>7)throw new Error('FLAC 프레임 번호가 올바르지 않습니다.');}const at=4+length;if(at+(code===6?1:2)>=payload.length)throw new Error('FLAC 블록 길이가 잘렸습니다.');samples=code===6?payload[at]+1:payload.readUInt16BE(at)+1;}else throw new Error('FLAC 블록 길이가 올바르지 않습니다.');
    return samples/format.sampleRate*1e6;
  }
  throw new Error('지원하지 않는 소리 코덱입니다.');
}
export class EncodedAudioParser{
  constructor(onPacket,onFormat,onFailure){this.buffer=Buffer.alloc(0);this.codec=null;this.ready=false;this.disabled=false;this.onPacket=onPacket;this.onFormat=onFormat;this.onFailure=onFailure;}
  push(chunk){
    if(this.disabled)return;if(!Buffer.isBuffer(chunk))throw new Error('소리 입력 형식이 올바르지 않습니다.');this.buffer=Buffer.concat([this.buffer,chunk]);
    if(!this.codec){if(this.buffer.length<4)return;const id=this.buffer.readUInt32BE();this.buffer=this.buffer.subarray(4);if(id===0||id===1){this.disabled=true;this.buffer=Buffer.alloc(0);this.onFailure(id===0?'기기 또는 앱이 소리 캡처를 허용하지 않았습니다.':'기기 소리 인코더를 초기화하지 못했습니다. 다른 인코더 또는 PCM을 선택하세요.');return;}this.codec=CODECS.get(id);if(!this.codec)throw new Error('지원하지 않는 소리 전송 코덱입니다.');if(this.codec==='raw'){this.ready=true;this.onFormat(audioCodecFormat('raw'));}}
    while(this.buffer.length>=12){const flags=this.buffer.readBigUInt64BE(),length=this.buffer.readUInt32BE(8),config=!!(flags&(1n<<62n));if(flags&(1n<<63n)||length>1024*1024||(config&&length>65536))throw new Error('소리 패킷의 크기·헤더가 올바르지 않습니다.');if(this.buffer.length<length+12)return;const packet=this.buffer.subarray(0,length+12);this.buffer=this.buffer.subarray(length+12);if(!length)continue;
      if(config){if(this.codec==='raw')throw new Error('PCM 전송에 코덱 설정 패킷이 있습니다.');const format=audioCodecFormat(this.codec,packet.subarray(12));this.ready=true;this.onFormat(format);continue;}
      if(!this.ready)throw new Error('소리 코덱 설정보다 데이터가 먼저 도착했습니다.');if(this.codec==='raw'&&length%4)throw new Error('PCM 샘플 크기가 올바르지 않습니다.');this.onPacket(packet);
    }
  }
}
