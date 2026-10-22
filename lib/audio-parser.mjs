export class AudioParser {
  constructor(onPacket,onFormat,onFailure){this.buffer=Buffer.alloc(0);this.codec=false;this.disabled=false;this.onPacket=onPacket;this.onFormat=onFormat;this.onFailure=onFailure;}
  push(chunk){
    if(this.disabled)return;this.buffer=Buffer.concat([this.buffer,chunk]);
    if(!this.codec){if(this.buffer.length<4)return;const codec=this.buffer.readUInt32BE();this.buffer=this.buffer.subarray(4);if(codec===0||codec===1){this.disabled=true;this.buffer=Buffer.alloc(0);this.onFailure(codec===0?'기기 또는 앱이 오디오 캡처를 허용하지 않았습니다.':'기기에서 오디오 초기화에 실패했습니다.');return;}if(codec!==0x00726177)throw new Error('지원하지 않는 오디오 코덱입니다.');this.codec=true;this.onFormat({sampleRate:48000,channels:2,format:'s16le'});}
    while(this.buffer.length>=12){const length=this.buffer.readUInt32BE(8);if(length>1024*1024||length%4!==0)throw new Error('잘못된 PCM 오디오 패킷입니다.');if(this.buffer.length<12+length)return;const packet=this.buffer.subarray(0,12+length);this.buffer=this.buffer.subarray(12+length);if(length)this.onPacket(packet);}
  }
}
