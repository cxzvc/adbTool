import {storagePaths} from './local-paths.mjs';
import { createWriteStream } from 'node:fs';
import { mkdir, stat, lstat, realpath, rm, readdir, open, readFile, writeFile, rename } from 'node:fs/promises';
import { finished } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { audioEncodingOptions, audioEncodingArgs, validatedAudioFormat, encodedAudioDurationUs } from './mirror-audio-codecs.mjs';

const require = createRequire(import.meta.url);
const SOURCES = new Set(['output','playback','mic','mic-unprocessed','mic-camcorder','mic-voice-recognition','mic-voice-communication','voice-call','voice-call-uplink','voice-call-downlink','voice-performance']);
const AUDIO_FORMATS = new Set(['m4a','flac','opus','wav']);
const FORMATS = new Set(['mkv','mp4','webm',...AUDIO_FORMATS]);
const VIDEO_CODECS=new Set(['h264','h265','av1','vp8','vp9']);
const MAX_PENDING = 8 * 1024 * 1024;
// scrcpy 5 separates session metadata (bit 63), codec config (62), and keyframes (61).
const PTS_MASK = (1n << 61n) - 1n;
const KEY = 1n << 61n, CONFIG = 1n << 62n;
const UUID=/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/;
const RETENTION=24*3600000,FILE_LIMIT=2*1024**3+16*1024**2,MANIFEST_LIMIT=256*1024;
const MIME={mkv:'video/x-matroska',mp4:'video/mp4',webm:'video/webm',m4a:'audio/mp4',flac:'audio/flac',opus:'audio/ogg',wav:'audio/wav'};
const deviceIdValid=value=>typeof value==='string'&&value.length>0&&value.length<=512&&!/[\x00-\x1f\x7f]/.test(value);

export function normalizeAudioOptions(params) {
  const audioOnly = params.get('audioOnly') === '1', audio = params.get('audio') === '1' || audioOnly;
  if (!audio) return {};
  const audioSource = params.get('audioSource') || 'playback';
  if (!SOURCES.has(audioSource)) throw new Error('소리 입력을 목록에서 선택하세요.');
  const audioDup = audioSource === 'playback' && params.get('audioDup') !== '0';
  return { audio:true, channels:true, audioOnly, audioSource, audioDup, ...audioEncodingOptions(params), ...(params.get('audioRequired')==='1'?{requireAudio:true}:{}) };
}

export function audioServerArgs(options, android) {
  if (!options.audio) return ['audio=false'];
  if (!Number.isInteger(android) || android < 11) throw new Error('소리 전달은 Android 11 이상이 필요합니다.');
  const source = options.audioSource || 'playback';
  if (!SOURCES.has(source)) throw new Error('지원하지 않는 소리 입력입니다.');
  if (source === 'playback' && android < 13) throw new Error('앱 재생 소리·폰 스피커 유지는 Android 13 이상입니다. Android 11~12에서는 기기 전체 출력을 선택하세요.');
  return ['audio=true',...audioEncodingArgs(options),`audio_source=${source}`,`audio_dup=${source === 'playback' && options.audioDup !== false}`];
}

function uint(value) {
  let n=BigInt(value); if(n<0n)throw new Error('음수 EBML 값');
  let bytes=1;while(n>=(1n<<BigInt(bytes*8)))bytes++;
  const result=Buffer.alloc(bytes);for(let i=bytes-1;i>=0;i--){result[i]=Number(n&255n);n>>=8n;}return result;
}
function vint(value) {
  const n=BigInt(value);for(let width=1;width<=8;width++)if(n<(1n<<BigInt(width*7))-1n){let x=n|(1n<<BigInt(width*7));const out=Buffer.alloc(width);for(let i=width-1;i>=0;i--){out[i]=Number(x&255n);x>>=8n;}return out;}throw new Error('EBML 크기 초과');
}
function element(id,payload){const body=Buffer.isBuffer(payload)?payload:Buffer.concat(payload);return Buffer.concat([Buffer.from(id,'hex'),vint(body.length),body]);}
const number=(id,value)=>element(id,uint(value)),string=(id,value)=>element(id,Buffer.from(value));
function float(id,value){const data=Buffer.alloc(8);data.writeDoubleBE(value);return element(id,data);}
export function splitAnnexB(buffer){
  const starts=[];for(let i=0;i+2<buffer.length;i++)if(buffer[i]===0&&buffer[i+1]===0&&(buffer[i+2]===1||(buffer[i+2]===0&&buffer[i+3]===1))){const n=buffer[i+2]===1?3:4;starts.push({offset:i,start:i+n});i+=n-1;}
  if(!starts.length)throw new Error('영상 NAL 헤더를 확인하지 못했습니다.');
  return starts.map((item,i)=>buffer.subarray(item.start,i+1<starts.length?starts[i+1].offset:buffer.length)).filter(item=>item.length);
}
function lengthPrefixed(nals){return Buffer.concat(nals.flatMap(nal=>{const size=Buffer.alloc(4);size.writeUInt32BE(nal.length);return[size,nal];}));}
function rbsp(nal){const out=[];for(let i=2;i<nal.length;i++){if(i>=4&&nal[i]===3&&nal[i-1]===0&&nal[i-2]===0)continue;out.push(nal[i]);}return Buffer.from(out);}
class Bits{constructor(data,label='HEVC'){this.data=data;this.at=0;this.label=label;}read(n){if(this.at+n>this.data.length*8)throw new Error(`${this.label} 설정이 잘렸습니다.`);let value=0;for(let i=0;i<n;i++,this.at++)value=value*2+((this.data[this.at>>3]>>(7-(this.at&7)))&1);return value;}skip(n){this.read(n);}ue(){let zeros=0;while(!this.read(1)){if(++zeros>30)throw new Error(`${this.label} 설정이 잘못되었습니다.`);}return 2**zeros-1+this.read(zeros);}}

export function vpFrameInfo(codec,payload){
  if(!Buffer.isBuffer(payload)||payload.length<1||payload.length>8*1024*1024)throw new Error('VP 영상 패킷 크기가 올바르지 않습니다.');
  if(codec==='vp8'){
    if(payload.length<3)throw new Error('VP8 프레임 헤더가 잘렸습니다.');const tag=payload.readUIntLE(0,3),key=!(tag&1),show=!!(tag&16),version=(tag>>1)&7;
    if(version>3)throw new Error('지원하지 않는 VP8 비트스트림 버전입니다.');if(!key)return{key,show};
    if(payload.length<10||!payload.subarray(3,6).equals(Buffer.from([0x9d,1,0x2a])))throw new Error('VP8 키프레임 시작 표시가 올바르지 않습니다.');
    const width=payload.readUInt16LE(6)&0x3fff,height=payload.readUInt16LE(8)&0x3fff;if(!width||!height)throw new Error('VP8 화면 크기가 올바르지 않습니다.');
    return{key,show,width,height,bitDepth:8};
  }
  if(codec!=='vp9')throw new Error('VP8·VP9 프레임만 읽을 수 있습니다.');
  const one=data=>{
    const bits=new Bits(data,'VP9');if(bits.read(2)!==2)throw new Error('VP9 프레임 시작 표시가 올바르지 않습니다.');const profile=bits.read(1)+2*bits.read(1);if(profile===3&&bits.read(1))throw new Error('VP9 예약 비트가 잘못되었습니다.');
    if(bits.read(1)){bits.skip(3);return{key:false,show:true,profile};}
    const key=bits.read(1)===0,show=!!bits.read(1);bits.skip(1);if(!key)return{key,show,profile};
    if(bits.read(24)!==0x498342)throw new Error('VP9 키프레임 동기 코드가 올바르지 않습니다.');const bitDepth=profile>=2?(bits.read(1)?12:10):8,colorSpace=bits.read(3);let fullRange,subX=1,subY=1;
    if(colorSpace!==7){fullRange=!!bits.read(1);if(profile===1||profile===3){subX=bits.read(1);subY=bits.read(1);if(bits.read(1))throw new Error('VP9 색상 예약 비트가 잘못되었습니다.');}}
    else{if(profile!==1&&profile!==3)throw new Error('VP9 RGB 색상과 프로파일이 맞지 않습니다.');fullRange=true;subX=0;subY=0;if(bits.read(1))throw new Error('VP9 RGB 예약 비트가 잘못되었습니다.');}
    return{key,show,profile,bitDepth,colorSpace,fullRange,subX,subY,width:bits.read(16)+1,height:bits.read(16)+1};
  };
  const marker=payload.at(-1);if((marker&0xe0)!==0xc0)return one(payload);
  const count=(marker&7)+1,sizeBytes=((marker>>3)&3)+1,indexSize=2+count*sizeBytes,index=payload.length-indexSize;
  if(index<1||payload[index]!==marker)return one(payload);
  const frames=[];let offset=0;for(let i=0;i<count;i++){const length=payload.readUIntLE(index+1+i*sizeBytes,sizeBytes);if(!length||offset+length>index)throw new Error('VP9 슈퍼프레임 길이가 잘못되었습니다.');frames.push(one(payload.subarray(offset,offset+length)));offset+=length;}if(offset!==index)throw new Error('VP9 슈퍼프레임 인덱스가 일치하지 않습니다.');
  return{...frames[0],show:frames.some(frame=>frame.show)};
}

export function recordingFormatError(codec,container,audioOnly=false){
  if(audioOnly)return'';
  if(container==='webm'&&!['vp8','vp9','av1'].includes(codec))return '원본 WebM은 VP8·VP9·AV1 영상을 지원합니다. 이 영상은 MKV 또는 MP4로 저장하세요.';
  if(container==='mp4'&&codec==='vp8')return 'VP8은 MP4로 원본 저장할 수 없습니다. MKV 또는 WebM을 선택하세요.';
  return'';
}

function leb128(value){const bytes=[];do{const byte=value%128;value=Math.floor(value/128);bytes.push(byte|(value?128:0));}while(value);return Buffer.from(bytes);}
// AV1 low-overhead OBUs, as defined by AOM bitstream syntax 5.3 and ISO binding 2.3.
export function splitAv1Obus(data){
  if(!Buffer.isBuffer(data)||data.length>8*1024*1024)throw new Error('AV1 패킷 크기가 올바르지 않습니다.');
  const result=[];let at=0;
  while(at<data.length){
    const start=at,header=data[at++],type=(header>>3)&15,extended=!!(header&4),sized=!!(header&2);
    if(header&129)throw new Error('AV1 OBU 헤더가 올바르지 않습니다.');
    let extension=0;if(extended){if(at>=data.length)throw new Error('AV1 확장 헤더가 잘렸습니다.');extension=data[at++];if(extension&7)throw new Error('AV1 확장 헤더 예약 비트가 잘못되었습니다.');}
    let size=data.length-at;
    if(sized){size=0;let count=0,multiplier=1,byte;do{if(at>=data.length||count++>=8)throw new Error('AV1 길이 정보가 잘렸거나 너무 큽니다.');byte=data[at++];size+=(byte&127)*multiplier;multiplier*=128;if(!Number.isSafeInteger(size)||size>data.length)throw new Error('AV1 OBU 길이가 패킷을 초과합니다.');}while(byte&128);}
    if(at+size>data.length)throw new Error('AV1 OBU 내용이 잘렸습니다.');const payload=data.subarray(at,at+size);at+=size;
    const bytes=sized?data.subarray(start,at):Buffer.concat([Buffer.from(extended?[header|2,extension]:[header|2]),leb128(size),payload]);
    result.push({type,payload,bytes,temporalId:extension>>5,spatialId:(extension>>3)&3});if(result.length>4096)throw new Error('AV1 OBU 개수가 너무 많습니다.');
  }
  return result;
}
export function av1SequenceInfo(payload){
  const b=new Bits(payload,'AV1'),profile=b.read(3),still=b.read(1),reduced=b.read(1);if(profile>2||reduced&&!still)throw new Error('AV1 프로파일·정지영상 설정이 잘못되었습니다.');
  let level=0,tier=0,decoderModel=false,bufferDelayBits=0;
  if(reduced)level=b.read(5);
  else{
    if(b.read(1)){b.skip(64);if(b.read(1)){let zeros=0;while(zeros<32&&!b.read(1))zeros++;if(zeros<32)b.skip(zeros);}decoderModel=!!b.read(1);if(decoderModel){bufferDelayBits=b.read(5)+1;b.skip(42);}}
    const initialDelay=b.read(1),points=b.read(5)+1;
    for(let i=0;i<points;i++){b.skip(12);const pointLevel=b.read(5),pointTier=pointLevel>7?b.read(1):0;if(decoderModel&&b.read(1))b.skip(bufferDelayBits*2+1);if(initialDelay&&b.read(1))b.skip(4);if(i===0){level=pointLevel;tier=pointTier;}}
  }
  const widthBits=b.read(4)+1,heightBits=b.read(4)+1,width=b.read(widthBits)+1,height=b.read(heightBits)+1;
  if(!reduced&&b.read(1))b.skip(7);b.skip(3);
  if(!reduced){b.skip(4);const orderHint=b.read(1);if(orderHint)b.skip(2);const screenTools=b.read(1)?2:b.read(1);if(screenTools&&!b.read(1))b.skip(1);if(orderHint)b.skip(3);}
  b.skip(3);const highBitdepth=b.read(1),twelveBit=profile===2&&highBitdepth?b.read(1):0,monochrome=profile===1?0:b.read(1);
  let primaries=2,transfer=2,matrix=2;if(b.read(1)){primaries=b.read(8);transfer=b.read(8);matrix=b.read(8);}
  let subX=0,subY=0,chromaPosition=0;
  if(monochrome){b.skip(1);subX=1;subY=1;}
  else{
    if(!(primaries===1&&transfer===13&&matrix===0)){b.skip(1);if(profile===0){subX=1;subY=1;}else if(profile===2){if(twelveBit){subX=b.read(1);subY=subX?b.read(1):0;}else subX=1;}if(subX&&subY)chromaPosition=b.read(2);}
    b.skip(1);
  }
  b.skip(1);if(b.read(1)!==1)throw new Error('AV1 설정 끝 표시가 잘못되었습니다.');while(b.at<payload.length*8)if(b.read(1)!==0)throw new Error('AV1 설정 정렬 비트가 잘못되었습니다.');
  return{profile,level,tier,highBitdepth,twelveBit,monochrome,subX,subY,chromaPosition,width,height,reduced:!!reduced};
}
export function av1Configuration(config){
  if(!Buffer.isBuffer(config)||!config.length||config.length>1024*1024)throw new Error('AV1 설정을 기다리고 있습니다.');
  const isRecord=!!(config[0]&128);if(isRecord&&(config.length<5||config[0]!==129||(config[3]&224)))throw new Error('AV1CodecConfigurationRecord 형식이 잘못되었습니다.');
  const obus=splitAv1Obus(isRecord?config.subarray(4):config),sequence=obus.filter(o=>o.type===1);if(sequence.length!==1)throw new Error('AV1 Sequence Header OBU 하나가 필요합니다.');
  const info=av1SequenceInfo(sequence[0].payload),header=Buffer.from([129,(info.profile<<5)|info.level,(info.tier<<7)|(info.highBitdepth<<6)|(info.twelveBit<<5)|(info.monochrome<<4)|(info.subX<<3)|(info.subY<<2)|info.chromaPosition,0]);
  if(isRecord&&!config.subarray(0,3).equals(header.subarray(0,3)))throw new Error('AV1 설정 레코드와 Sequence Header가 일치하지 않습니다.');
  return{...info,sequence:sequence[0].bytes,private:Buffer.concat([header,sequence[0].bytes,...obus.filter(o=>o.type===5).map(o=>o.bytes)])};
}
export function av1Sample(payload,config,cachedSetup){
  const setup=cachedSetup||av1Configuration(config),obus=splitAv1Obus(payload);if(obus.some(o=>o.type===8))throw new Error('AV1 Tile List 형식은 원본 저장에서 지원하지 않습니다.');
  const present=obus.filter(o=>o.type===1);if(present.some(o=>!o.bytes.equals(setup.sequence)))throw new Error('AV1 시퀀스가 바뀌었습니다. 새 녹화를 시작하세요.');
  const frame=obus.find(o=>o.type===6||o.type===3);let key=false;
  if(frame){if(!frame.payload.length)throw new Error('AV1 프레임 헤더가 비어 있습니다.');if(setup.reduced)key=true;else{const bits=new Bits(frame.payload,'AV1');if(!bits.read(1))key=bits.read(2)===0&&bits.read(1)===1;}}
  // Matroska key SimpleBlocks require a whole Frame OBU and a Sequence Header.
  if(key&&frame.type!==6)throw new Error('기기의 AV1 프레임 구성이 이 녹화 형식과 맞지 않습니다. H.264·H.265로 원본 저장하세요.');
  const data=obus.filter(o=>![2,7,15].includes(o.type)).map(o=>o.bytes);if(key&&!present.length)data.unshift(setup.sequence);
  return{key,payload:Buffer.concat(data),hasFrame:!!frame};
}

export function codecPrivate(codec,config){
  if(codec==='vp8'||codec==='vp9')return null;
  if(codec==='av1')return av1Configuration(config).private;
  const nals=splitAnnexB(config);
  if(codec==='h264'){
    const sps=nals.filter(n=>(n[0]&31)===7),pps=nals.filter(n=>(n[0]&31)===8);
    if(!sps.length||!pps.length||sps[0].length<4||sps.length>31||pps.length>255)throw new Error('H.264 설정 프레임(SPS/PPS)을 기다리고 있습니다.');
    const array=items=>items.flatMap(n=>{if(n.length>65535)throw new Error('영상 설정이 너무 큽니다.');const b=Buffer.alloc(2);b.writeUInt16BE(n.length);return[b,n];});
    return Buffer.concat([Buffer.from([1,sps[0][1],sps[0][2],sps[0][3],255,224|sps.length]),...array(sps),Buffer.from([pps.length]),...array(pps)]);
  }
  if(codec==='h265'){
    const groups=[32,33,34].map(type=>({type,nals:nals.filter(n=>((n[0]>>1)&63)===type)}));
    if(groups.some(g=>!g.nals.length))throw new Error('H.265 설정 프레임(VPS/SPS/PPS)을 기다리고 있습니다.');
    const data=rbsp(groups[1].nals[0]),bits=new Bits(data);bits.skip(4);const layers=bits.read(3),nested=bits.read(1);bits.skip(96);
    const sub=[];for(let i=0;i<layers;i++)sub.push([bits.read(1),bits.read(1)]);if(layers)bits.skip((8-layers)*2);for(const[p,l]of sub){if(p)bits.skip(88);if(l)bits.skip(8);}
    bits.ue();const chroma=bits.ue();if(chroma===3)bits.skip(1);bits.ue();bits.ue();if(bits.read(1))for(let i=0;i<4;i++)bits.ue();const luma=bits.ue(),chromabits=bits.ue();
    if(chroma>3||luma>7||chromabits>7)throw new Error('지원하지 않는 HEVC 색상 형식입니다.');
    const h=Buffer.alloc(23);h[0]=1;data.copy(h,1,1,13);h[13]=240;h[15]=252;h[16]=252|chroma;h[17]=248|luma;h[18]=248|chromabits;h[21]=((layers+1)<<3)|(nested<<2)|3;h[22]=3;
    const arrays=groups.map(g=>{const prefix=Buffer.alloc(3);prefix[0]=128|g.type;prefix.writeUInt16BE(g.nals.length,1);return Buffer.concat([prefix,...g.nals.flatMap(n=>{if(n.length>65535)throw new Error('HEVC 설정이 너무 큽니다.');const size=Buffer.alloc(2);size.writeUInt16BE(n.length);return[size,n];})]);});
    return Buffer.concat([h,...arrays]);
  }
  throw new Error('원본 영상 녹화는 H.264·H.265·AV1을 지원합니다. 영상 형식을 확인하세요.');
}

export function matroskaHeader({video,audio}){
  const tracks=[];
  if(video){const av1=video.codec==='av1'?av1Configuration(video.config):null,vp9=video.codec==='vp9'?video.vpInfo:null,extra=av1?av1.private:vp9?Buffer.from([1,1,vp9.profile,3,1,vp9.bitDepth]):codecPrivate(video.codec,video.config),id=({h264:'V_MPEG4/ISO/AVC',h265:'V_MPEGH/ISO/HEVC',av1:'V_AV1',vp8:'V_VP8',vp9:'V_VP9'})[video.codec];if(!id)throw new Error('지원하지 않는 영상 코덱입니다.');tracks.push(element('ae',[number('d7',1),number('73c5',1),number('83',1),number('9c',0),string('86',id),...(extra?[element('63a2',extra)]:[]),element('e0',[number('b0',av1?.width||video.width),number('ba',av1?.height||video.height),...(vp9?[element('55b0',[number('55b2',vp9.bitDepth),number('55b3',vp9.subX),number('55b4',vp9.subY),number('55b9',vp9.fullRange?2:1)])]:[])])]));}
  if(audio){const a=audio===true?{codec:'raw',sampleRate:48000,channels:2,bitDepth:16}:audio;tracks.push(element('ae',[number('d7',2),number('73c5',2),number('83',2),number('9c',0),string('86',({raw:'A_PCM/INT/LIT',aac:'A_AAC',opus:'A_OPUS',flac:'A_FLAC'})[a.codec]),...(a.description?[element('63a2',Buffer.from(a.description,'base64'))]:[]),...(a.codec==='opus'?[number('56aa',a.codecDelayNs),number('56bb',80000000)]:[]),element('e1',[float('b5',a.sampleRate),number('9f',a.channels),number('6264',a.bitDepth||16)])]));}
  if(!tracks.length)throw new Error('녹화할 영상 또는 소리가 없습니다.');
  return Buffer.concat([element('1a45dfa3',[number('4286',1),number('42f7',1),number('42f2',4),number('42f3',8),string('4282','matroska'),number('4287',4),number('4285',2)]),Buffer.from('1853806701ffffffffffffff','hex'),element('1549a966',[number('2ad7b1',1000),float('4489',0),string('4d80','ADB Desk'),string('5741','ADB Desk scrcpy PTS')]),element('1654ae6b',tracks)]);
}
export function matroskaFrame(track,ptsUs,key,payload,{invisible=false}={}){
  const block=Buffer.alloc(4);block[0]=128|track;block[3]=(key?128:0)|(invisible?8:0);
  return element('1f43b675',[number('e7',ptsUs),element('a3',Buffer.concat([block,payload]))]);
}
export function readMediaPacket(packet){
  if(!Buffer.isBuffer(packet)||packet.length<12||packet.readUInt32BE(8)!==packet.length-12)throw new Error('잘못된 녹화 패킷입니다.');
  const meta=packet.readBigUInt64BE();if(meta&(1n<<63n))throw new Error('세션 메타데이터는 영상 설정으로 전달해야 합니다.');return{pts:meta&PTS_MASK,key:!!(meta&KEY),config:!!(meta&CONFIG),payload:packet.subarray(12)};
}

export function recordingConversionArgs(input,output,format){
  const base=['-hide_banner','-loglevel','error','-nostdin','-y','-i',input];
  const audioClock=['-af','aresample=async=1:first_pts=0'];
  if(format==='webm')return[...base,'-map','0:v:0?','-map','0:a:0?','-c:v','copy','-c:a','libopus','-b:a','128k',...audioClock,'-fps_mode','passthrough','-avoid_negative_ts','disabled','-cues_to_front','1',output];
  if(format==='mp4')return[...base,'-map','0:v:0?','-map','0:a:0?','-c:v','copy','-c:a','aac','-b:a','192k',...audioClock,'-fps_mode','passthrough','-movflags','+faststart',output];
  if(format==='m4a')return[...base,'-vn','-c:a','aac','-b:a','192k',...audioClock,'-movflags','+faststart',output];
  if(format==='flac')return[...base,'-vn','-c:a','flac',...audioClock,output];
  if(format==='opus')return[...base,'-vn','-c:a','libopus','-b:a','128k',...audioClock,output];
  if(format==='wav')return[...base,'-vn','-c:a','pcm_s16le',...audioClock,output];
  throw new Error('지원하지 않는 저장 형식입니다.');
}

export function createMirrorMedia({root,ffmpegPath,spawnProcess=spawn,storagePath,removeFinalizedInput=rm}={}){
  if(!root&&!storagePath)throw new Error('미디어 저장 위치가 필요합니다.');
  const directory=path.resolve(storagePath||path.join(storagePaths(root).runtime,'mirror-recordings'));
  let binary=ffmpegPath;if(binary===undefined){try{binary=require('ffmpeg-static');}catch{binary=null;}}
  const manifest=path.join(directory,'recordings.json'),artifacts=new Map(),records=new Map(),sessions=new Set(),pending=new Map();let initialize,actualRoot,activity=null,persistQueue=Promise.resolve();
  async function verifiedFile(id,extension){
    if(!UUID.test(id)||!FORMATS.has(extension))throw new Error('녹화 파일 형식이 올바르지 않습니다.');
    const location=path.join(directory,`media-${id}.${extension}`),[info,actual]=await Promise.all([lstat(location),realpath(location)]);
    if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||path.dirname(actual)!==actualRoot||info.size<12||info.size>FILE_LIMIT)throw new Error('녹화 파일 경로·크기·형식을 확인할 수 없습니다.');
    const handle=await open(location,'r');let head;try{head=Buffer.alloc(Math.min(512,info.size));await handle.read(head,0,head.length,0);}finally{await handle.close();}
    const ebml=head.subarray(0,4).equals(Buffer.from('1a45dfa3','hex'));const magic=extension==='mkv'?ebml:extension==='webm'?ebml&&head.includes(Buffer.from('4282847765626d','hex')):extension==='flac'?head.subarray(0,4).toString()==='fLaC':extension==='opus'?head.subarray(0,4).toString()==='OggS'&&head.includes(Buffer.from('OpusHead')):extension==='wav'?head.subarray(0,4).toString()==='RIFF'&&head.subarray(8,12).toString()==='WAVE':head.subarray(4,8).toString()==='ftyp';
    if(!magic)throw new Error('녹화 파일의 미디어 헤더가 손상되었습니다.');return{path:location,size:info.size,mime:MIME[extension]};
  }
  async function writeManifest(){
    const now=Date.now(),rows=[...records.values()].filter(r=>r.expiresAt>now).sort((a,b)=>b.created-a.created).slice(0,64),kept=new Set(rows.map(r=>r.id)),data=JSON.stringify({version:1,records:rows});
    for(const[id]of records)if(!kept.has(id)&&!pending.has(id))records.delete(id);
    if(Buffer.byteLength(data)>MANIFEST_LIMIT)throw new Error('녹화 목록의 크기 한도를 초과했습니다.');
    const temporary=path.join(directory,`recordings-${randomUUID()}.tmp`);try{await writeFile(temporary,data,{flag:'wx',encoding:'utf8'});await rename(temporary,manifest);}finally{await rm(temporary,{force:true}).catch(()=>{});}
  }
  function persist(){const task=persistQueue.then(writeManifest);persistQueue=task.catch(()=>{});return task;}
  function safeSource(source={}){if(!source||typeof source!=='object')return{};const out={};if(typeof source.sessionId==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(source.sessionId))out.sessionId=source.sessionId;if(typeof source.newDisplay==='string'&&/^\d{3,4}x\d{3,4}\/\d{2,4}$/.test(source.newDisplay))out.newDisplay=source.newDisplay;if(SOURCES.has(source.audioSource))out.audioSource=source.audioSource;if(['raw','aac','opus','flac'].includes(source.audioCodec))out.audioCodec=source.audioCodec;if(Number.isInteger(source.audioBitrate)&&source.audioBitrate>=8&&source.audioBitrate<=1024)out.audioBitrate=source.audioBitrate;if(typeof source.audioEncoder==='string'&&/^[A-Za-z0-9_.-]{1,160}$/.test(source.audioEncoder))out.audioEncoder=source.audioEncoder;const video=source.source||source.videoSource,codec=source.codec||source.videoCodec;if(['display','camera'].includes(video))out.videoSource=video;if(VIDEO_CODECS.has(codec))out.videoCodec=codec;out.audioOnly=source.audioOnly===true;return out;}
  async function history(row,state,summary){
    if(!activity)return;
    try{await activity.record({id:row.id,deviceId:row.deviceId,kind:'mirror-native-recording',title:'원본 영상·소리 녹화',state,createdAt:row.created,finishedAt:state==='running'?null:Date.now(),summary,history:{source:row.source||{},format:row.format,requestedFormat:row.requestedFormat,bytes:row.bytes||0,expiresAt:new Date(row.expiresAt).toISOString(),downloadId:row.filename?row.id:null}});}catch{/* Recording must remain downloadable if the separate activity journal is unavailable. */}
  }
  const ready=()=>initialize||=(async()=>{
    await mkdir(directory,{recursive:true});const rootInfo=await lstat(directory);if(rootInfo.isSymbolicLink())throw new Error('녹화 저장 폴더가 다른 위치를 가리킵니다.');actualRoot=await realpath(directory);
    let stored=[];try{const info=await lstat(manifest);if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>MANIFEST_LIMIT||path.dirname(await realpath(manifest))!==actualRoot)throw new Error('녹화 목록 파일을 확인할 수 없습니다.');const parsed=JSON.parse(await readFile(manifest,'utf8'));if(parsed.version!==1||!Array.isArray(parsed.records)||parsed.records.length>64)throw new Error('녹화 목록 형식이 올바르지 않습니다.');stored=parsed.records;}catch(error){if(error.code!=='ENOENT')throw error;}
    for(const input of stored){
      const now=Date.now();if(!input||!UUID.test(input.id)||!deviceIdValid(input.deviceId)||!Number.isFinite(input.created)||input.created>now+60000||!Number.isFinite(input.expiresAt)||input.expiresAt<=now||input.expiresAt>now+RETENTION+60000||input.expiresAt>input.created+RETENTION+2*3600000+60000||!FORMATS.has(input.format)||!['complete','error','cancelled','interrupted','preparing','waiting','recording','saving','running'].includes(input.state))continue;
      const interrupted=['preparing','waiting','recording','saving','running'].includes(input.state),extension=interrupted?'mkv':input.format;
      const row={id:input.id,deviceId:input.deviceId,created:input.created,expiresAt:input.expiresAt,state:interrupted?'interrupted':input.state,format:FORMATS.has(extension)?extension:'mkv',requestedFormat:FORMATS.has(input.requestedFormat)?input.requestedFormat:'mkv',bytes:0,filename:null,source:safeSource(input.source),message:interrupted?'서버 종료로 중단됐습니다. 자동으로 다시 실행하지 않습니다.':''};
      if(input.filename!==null&&input.filename!==undefined&&input.filename!==`media-${row.id}.${input.format}`)continue;
      try{if(input.filename||interrupted){const file=await verifiedFile(row.id,row.format);if(!interrupted&&row.state==='complete'&&input.bytes!==file.size)throw new Error('보관 파일의 크기가 변경되었습니다.');row.filename=`media-${row.id}.${row.format}`;row.bytes=file.size;artifacts.set(row.id,{...file,...(row.format==='webm'&&row.source.audioOnly?{mime:'audio/webm'}:{}),id:row.id,name:`ADB-Desk-${row.created}.${row.format}`,deviceId:row.deviceId,created:row.created,expiresAt:row.expiresAt});if(row.state==='complete'&&row.requestedFormat!==row.format)row.message='변환에 실패해 원본 MKV를 보존했습니다.';}else if(row.state==='complete')row.state='error';}catch{row.message='녹화 파일이 없거나 손상되어 다운로드할 수 없습니다.';if(row.state==='complete')row.state='error';}
      records.set(row.id,row);
    }
    await prune();
    const files=await readdir(directory,{withFileTypes:true});for(const file of files){if(!file.isFile()||!/^media-[\da-f-]{36}\.(?:mkv|mp4|webm|m4a|flac|opus|wav)$/.test(file.name))continue;const location=path.join(directory,file.name),info=await lstat(location);if(info.nlink===1&&Date.now()-info.mtimeMs>RETENTION&&![...artifacts.values()].some(a=>a.path===location))await rm(location,{force:true});}
    await writeManifest();
  })();
  async function prune(){const done=[...artifacts.values()].sort((a,b)=>a.created-b.created);let total=done.reduce((s,a)=>s+a.size,0);for(const item of done){if(item.expiresAt>Date.now()&&artifacts.size<=12&&total<=4*1024**3)continue;try{await rm(item.path,{force:true});artifacts.delete(item.id);records.delete(item.id);total-=item.size;}catch{/* An active Windows download may temporarily hold a completed file. */}}for(const[id,row]of records)if(row.expiresAt<=Date.now())records.delete(id);}
  function createSession({deviceId,send=()=>{},source={}}={}){
    let sourceInfo=safeSource(source);
    let format={codec:'h264',width:0,height:0},config=null,cachedAv1=null,audioReady=false,audioFormat=null,recording=null,closed=false;
    const emit=data=>{try{send({type:'media-recording',...data});}catch{}};
    const progress=r=>emit({state:r.state,id:r.id,format:r.format,bytes:r.bytes,seconds:Math.round((Date.now()-r.created)/1000),message:r.message||''});
    async function discard(r){pending.delete(r.id);artifacts.delete(r.id);r.child?.kill();r.stream?.destroy();try{await r.completion;}catch{}await Promise.all([r.input,r.output].filter(Boolean).map(p=>rm(p,{force:true}).catch(()=>{})));}
    async function terminal(r,state,summary){const row={...(records.get(r.id)||{}),id:r.id,deviceId,created:r.created,expiresAt:Date.now()+RETENTION,state,format:r.format,requestedFormat:r.format,bytes:r.bytes,filename:null,source:sourceInfo,message:summary};records.set(r.id,row);try{await ready();await persist();}catch{}await history(row,state,summary);}
    async function cancel(){const r=recording;if(!r)return;recording=null;r.cancelled=true;clearTimeout(r.timer);clearInterval(r.progress);r.child?.kill();r.stream?.destroy();try{await r.finishing;}catch{}await discard(r);await terminal(r,'cancelled','원본 녹화를 취소하고 임시 파일을 삭제했습니다.');emit({state:'cancelled',id:r.id,message:'원본 녹화를 취소하고 임시 파일을 삭제했습니다.'});}
    function append(r,data){if(recording!==r||r.state!=='recording')return false;if(r.bytes+data.length>r.maxBytes){void stop('선택한 용량 한도에서 녹화를 마쳤습니다.');return false;}if(r.stream.writableLength>MAX_PENDING){void stop('PC 저장 속도가 느려 기록을 마쳤습니다. 이후 프레임은 포함되지 않습니다.');return false;}r.bytes+=data.length;r.stream.write(data);return true;}
    function begin(r,pts,vpInfo){
      if(recording!==r||r.origin!==null)return;
      try{const video=r.video?{...format,config,...(vpInfo?{vpInfo,width:vpInfo.width,height:vpInfo.height}:{})}:null;const mismatch=video?recordingFormatError(video.codec,r.format):'';if(mismatch)throw new Error(mismatch);if(video&&(!Number.isInteger(video.width)||video.width<1||video.width>8192||!Number.isInteger(video.height)||video.height<1||video.height>8192))throw new Error('녹화 화면 크기가 올바르지 않습니다.');r.videoFormat=video;const header=matroskaHeader({video,audio:r.audio?r.audioFormat:null});r.durationOffset=header.indexOf(Buffer.from('448988','hex'))+3;r.origin=pts;r.state='recording';append(r,header);progress(r);}catch(error){void fail(r,error);}
    }
    async function fail(r,error){if(recording!==r)return;recording=null;r.cancelled=true;clearTimeout(r.timer);clearInterval(r.progress);await discard(r);await terminal(r,'error','원본 녹화를 완료하지 못했습니다.');emit({state:'error',id:r.id,message:error.message});}
    async function start(options={}){
      if(!deviceIdValid(deviceId))throw new Error('녹화 대상 기기를 확인하세요.');if(closed)throw new Error('화면 연결이 끝났습니다.');if(recording)throw new Error('이미 원본 녹화 또는 저장 작업이 진행 중입니다.');
      const output=options.format||'mkv',minutes=Number(options.maxMinutes??30),mb=Number(options.maxMB??512);
      if(!FORMATS.has(output)||!Number.isInteger(minutes)||minutes<1||minutes>120||!Number.isInteger(mb)||mb<16||mb>2048)throw new Error('녹화 형식·시간(1~120분)·용량(16~2048MB)을 확인하세요.');
      if(output!=='mkv'&&!binary)throw new Error('이 PC에 미디어 변환 도구가 없습니다. MKV 형식으로 저장하세요.');
      const audioOnly=AUDIO_FORMATS.has(output)||options.audioOnly===true;
      if(audioOnly&&!audioReady)throw new Error('소리 전달을 켜고 소리가 연결된 뒤 시작하세요.');
      if(!audioOnly&&(!format.width||!format.height))throw new Error('영상이 연결된 뒤 녹화를 시작하세요.');
      if(!audioOnly&&!VIDEO_CODECS.has(format.codec))throw new Error('원본 영상 녹화는 H.264·H.265·AV1·VP8·VP9를 지원합니다.');
      const mismatch=recordingFormatError(format.codec,output,audioOnly);if(mismatch)throw new Error(mismatch);
      const id=randomUUID(),r={id,format:output,created:Date.now(),state:'preparing',bytes:0,frames:0,audioFrames:0,origin:null,lastPts:0n,durationUs:0,video:!audioOnly,audio:audioReady,audioFormat:audioFormat?{...audioFormat}:null,maxBytes:mb*1024*1024,input:path.join(directory,`media-${id}.mkv`),output:output==='mkv'?null:path.join(directory,`media-${id}.${output}`)};
      recording=r;pending.set(id,{record:r,deviceId});progress(r);
      try{await ready();await prune();if(recording!==r)return;r.stream=createWriteStream(r.input,{flags:'wx',highWaterMark:256*1024});r.completion=finished(r.stream);r.completion.catch(error=>{if(recording===r&&!r.finishing)void fail(r,error);});await new Promise((resolve,reject)=>{r.stream.once('open',resolve);r.stream.once('error',reject);});if(recording!==r){await discard(r);return;}r.state=r.video?'waiting':'recording';records.set(id,{id,deviceId,created:r.created,expiresAt:r.created+RETENTION,state:r.state,format:'mkv',requestedFormat:output,bytes:0,filename:`media-${id}.mkv`,source:{...sourceInfo,audioOnly,videoCodec:format.codec}});await persist();await history(records.get(id),'running','원본 영상·소리 녹화를 시작했습니다.');if(recording!==r)return;r.message=r.video?'다음 키프레임부터 저장합니다. 화면이 정지돼 있으면 잠시 기다리세요.':'소리를 기다리고 있습니다.';r.timer=setTimeout(()=>void stop('선택한 시간 한도에서 녹화를 마쳤습니다.'),minutes*60000);r.timer.unref();r.progress=setInterval(()=>progress(r),1000);r.progress.unref();progress(r);return{id,state:r.state};}catch(error){await fail(r,error);throw error;}
    }
    async function convert(r){return new Promise((resolve,reject)=>{let error='';const child=spawnProcess(binary,recordingConversionArgs(r.input,r.output,r.format),{windowsHide:true,stdio:['ignore','ignore','pipe']});r.child=child;const timeout=setTimeout(()=>{child.kill();reject(new Error('저장 형식 변환 시간이 초과되었습니다. 원본 MKV를 받으세요.'));},300000);timeout.unref();child.stderr?.on('data',chunk=>{error=(error+chunk.toString()).slice(-2000);});child.once('error',e=>{clearTimeout(timeout);reject(e);});child.once('close',code=>{clearTimeout(timeout);r.child=null;code===0?resolve():reject(new Error('형식 변환 실패: '+error.slice(-500)));});});}
    async function register(r,location,extension,message){const info=await verifiedFile(r.id,extension),expiresAt=Date.now()+RETENTION;const artifact={...info,...(extension==='webm'&&!r.video?{mime:'audio/webm'}:{}),id:r.id,name:`ADB-Desk-${r.created}.${extension}`,deviceId,created:r.created,expiresAt};artifacts.set(r.id,artifact);pending.delete(r.id);const row={id:r.id,deviceId,created:r.created,expiresAt,state:'complete',format:extension,requestedFormat:r.format,bytes:info.size,filename:path.basename(location),source:{...sourceInfo,audioOnly:!r.video,videoCodec:r.videoFormat?.codec||format.codec},message:r.conversionFailed?'변환에 실패해 원본 MKV를 보존했습니다.':''};records.set(r.id,row);await prune();await persist();await history(row,r.conversionFailed?'error':'success',r.conversionFailed?'저장 형식 변환에 실패해 원본 MKV를 보존했습니다.':'원본 영상·소리 파일을 저장했습니다.');return{state:'complete',id:r.id,format:extension,name:artifact.name,bytes:info.size,expiresAt,url:`/api/mirror-recordings/${r.id}?deviceId=${encodeURIComponent(deviceId)}`,message};}
    async function stop(message=''){
      const r=recording;if(!r)return;if(r.finishing)return r.finishing;
      r.finishing=(async()=>{
        clearTimeout(r.timer);clearInterval(r.progress);r.state='saving';r.message=message||'PC에서 파일을 마무리하고 있습니다.';progress(r);
        try{
          if(!r.stream)throw new Error('녹화가 아직 준비 중입니다.');const row=records.get(r.id);if(row){row.state='saving';row.bytes=r.bytes;await persist();}r.stream.end();await r.completion;if(recording!==r||r.cancelled)return;
          if(!r.frames&&!r.audioFrames)throw new Error('저장된 프레임이 없습니다. 영상 키프레임 또는 소리를 받은 뒤 다시 시도하세요.');
          const duration=Buffer.alloc(8);duration.writeDoubleBE(r.durationUs);const file=await open(r.input,'r+');try{await file.write(duration,0,8,r.durationOffset);}finally{await file.close();}
          let result;
          if(r.output){try{await convert(r);if(recording!==r||r.cancelled)return;const info=await stat(r.output);if(!info.size)throw new Error('변환 결과가 비어 있습니다.');result=await register(r,r.output,r.format,message);await removeFinalizedInput(r.input,{force:true}).catch(()=>{});}catch(error){if(recording!==r||r.cancelled)return;await rm(r.output,{force:true}).catch(()=>{});r.conversionFailed=true;result=await register(r,r.input,'mkv',`${error.message} 원본 MKV는 보존했습니다.`);}}
          else result=await register(r,r.input,'mkv',message);
          if(recording!==r||r.cancelled)return;recording=null;emit(result);return result;
        }catch(error){await fail(r,error);}
      })();return r.finishing;
    }
    function onVideo(packet){
      let parsed;try{parsed=readMediaPacket(packet);}catch(error){if(recording){if(recording.frames||recording.audioFrames)void stop('영상 패킷을 읽지 못해 정상 수신 구간을 저장했습니다.');else void fail(recording,error);}return;}
      if(parsed.config){if(recording?.origin!==null&&recording?.video&&config&&!config.equals(parsed.payload))void stop('영상 설정이 변경되어 이전 구간을 저장했습니다. 새 녹화를 시작하세요.');config=Buffer.from(parsed.payload);cachedAv1=null;return;}
      const r=recording;if(!r?.video||!['waiting','recording'].includes(r.state))return;
      try{
        if(format.codec==='av1'){
          const sequence=splitAv1Obus(parsed.payload).filter(o=>o.type===1);if(sequence.length>1)throw new Error('AV1 패킷에 서로 다른 시퀀스가 여러 개 있습니다.');
          if(sequence.length===1){
            if(!config)config=sequence[0].bytes;
            else{let previous;try{previous=cachedAv1||av1Configuration(config);}catch(error){if(r.origin!==null)throw error;config=sequence[0].bytes;cachedAv1=null;}
              if(previous&&!previous.sequence.equals(sequence[0].bytes)){if(r.origin!==null)void stop('AV1 영상 구성이 변경되어 이전 구간을 저장했습니다. 새 녹화를 시작하세요.');config=sequence[0].bytes;cachedAv1=null;if(r.state==='saving')return;}}
          }
        }
        const vp=['vp8','vp9'].includes(format.codec)?vpFrameInfo(format.codec,parsed.payload):null;
        if(!config&&!vp)return;if(format.codec==='av1'&&!cachedAv1)cachedAv1=av1Configuration(config);const av1=format.codec==='av1'?av1Sample(parsed.payload,config,cachedAv1):null;if(av1&&!av1.hasFrame)return;const key=vp?vp.key:av1?av1.key:parsed.key;
        if(r.origin!==null&&vp?.key&&(vp.width!==r.videoFormat.width||vp.height!==r.videoFormat.height||['profile','bitDepth','subX','subY'].some(key=>vp[key]!==r.videoFormat.vpInfo?.[key]))){void stop('VP 영상 크기·프로파일이 변경되어 이전 구간을 저장했습니다.');return;}
        if(r.origin===null){if(!key)return;begin(r,parsed.pts,vp);}if(recording!==r||r.state!=='recording'||parsed.pts<r.origin)return;
        const data=vp?parsed.payload:av1?av1.payload:lengthPrefixed(splitAnnexB(parsed.payload));if(append(r,matroskaFrame(1,parsed.pts-r.origin,key,data,{invisible:vp?.show===false}))){const duration=vp?.show===false?0:r.frames?Math.max(1,Number(parsed.pts-r.lastPts)):33333;r.durationUs=Math.max(r.durationUs,Number(parsed.pts-r.origin)+duration);r.frames++;r.lastPts=parsed.pts;}
      }catch(error){if(r.frames||r.audioFrames)void stop('영상 패킷을 읽지 못해 정상 수신 구간을 저장했습니다. '+error.message);else void fail(r,error);}
    }
    function onAudio(packet){const r=recording;if(!r?.audio||r.state!=='recording')return;try{const p=readMediaPacket(packet);if(p.config||!p.payload.length)return;if(r.audioFormat.codec==='raw'&&p.payload.length%4)throw new Error('소리 샘플 크기가 올바르지 않습니다.');const duration=encodedAudioDurationUs(r.audioFormat.codec,p.payload,r.audioFormat);if(r.origin===null)begin(r,p.pts);if(p.pts<r.origin)return;const delay=BigInt(Math.round((r.audioFormat.codecDelayNs||0)/1000));if(append(r,matroskaFrame(2,p.pts-r.origin+delay,true,p.payload))){r.audioFrames++;r.durationUs=Math.max(r.durationUs,Number(p.pts-r.origin)+duration);}}catch(error){if(r.frames||r.audioFrames)void stop('소리 패킷을 읽지 못해 정상 수신 구간을 저장했습니다. '+error.message);else void fail(r,error);}}
    const api={start,stop,cancel,onVideo,onAudio,setSource(next){sourceInfo=safeSource(next);},setVideoFormat(next){if(next.codec&&!VIDEO_CODECS.has(next.codec))throw new Error('지원하지 않는 영상 코덱입니다.');if(recording?.video&&recording.origin!==null&&((next.width&&next.width!==format.width)||(next.height&&next.height!==format.height)||(next.codec&&next.codec!==format.codec)))void stop('화면 크기·형식이 변경되어 이전 구간을 저장했습니다.');if(next.codec&&next.codec!==format.codec){config=null;cachedAv1=null;}format={...format,...next};},setAudioFormat(next){const valid=next?validatedAudioFormat(next):null;if(recording?.audio&&audioFormat&&JSON.stringify(valid)!==JSON.stringify(audioFormat))void stop('소리 형식이 바뀌어 이전 구간을 저장했습니다.');audioFormat=valid;audioReady=!!valid;},async close(){closed=true;sessions.delete(api);return stop('연결이 종료되어 받은 구간을 저장했습니다.');}};
    sessions.add(api);return api;
  }
  return{
    createSession,
    setActivity(value){activity=value;return ready().then(async()=>{for(const row of records.values())if(row.state==='interrupted')await history(row,'interrupted','서버 종료로 원본 녹화가 중단되었습니다. 자동 재실행하지 않습니다.');}).catch(()=>{});},
    async list(deviceId){
      if(!deviceIdValid(deviceId))throw new Error('녹화 대상 기기를 확인하세요.');await ready();await persistQueue;const count=records.size;await prune();if(records.size!==count)await persist();
      const completed=[...records.values()].filter(r=>r.deviceId===deviceId&&!pending.has(r.id)).map(row=>{const artifact=artifacts.get(row.id);return{id:row.id,deviceId:row.deviceId,state:row.state,format:row.format,created:row.created,bytes:artifact?.size||row.bytes,expiresAt:row.expiresAt,message:row.message||'',...(artifact?{name:artifact.name,url:`/api/mirror-recordings/${row.id}?deviceId=${encodeURIComponent(row.deviceId)}`}:{})};});
      return{formats:binary?[...FORMATS]:['mkv'],retentionHours:24,items:[...[...pending.values()].filter(p=>p.deviceId===deviceId).map(({record:r})=>({id:r.id,deviceId,state:r.state,format:r.format,created:r.created,bytes:r.bytes,expiresAt:r.created+RETENTION})),...completed].sort((a,b)=>b.created-a.created)};
    },
    async download(id,deviceId){
      await ready();await persistQueue;const artifact=artifacts.get(id);
      if(typeof id!=='string'||!UUID.test(id)||!artifact||artifact.expiresAt<=Date.now()||(deviceId!==undefined&&deviceId!==artifact.deviceId))throw new Error('녹화 파일이 없거나 보관 기간·대상 기기를 확인할 수 없습니다.');
      const extension=records.get(id)?.format;const checked=await verifiedFile(id,extension);if(checked.size!==artifact.size)throw new Error('보관된 녹화 파일이 변경되었습니다.');return{...artifact,...checked,mime:artifact.mime};
    },
    async close(){await Promise.all([...sessions].map(s=>s.close()));await Promise.all([...pending.values()].map(p=>p.record.finishing).filter(Boolean));await persistQueue;},
    formats:binary?[...FORMATS]:['mkv']
  };
}
