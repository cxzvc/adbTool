import net from 'node:net';

// Keep transport selection and service request on the same ADB smart socket.
export async function openAdbService(serial, service, {port=5037, host='127.0.0.1', timeout=15000, connect=net.createConnection, signal}={}) {
  if(typeof serial!=='string'||!serial||serial.length>1024||/[\x00-\x20\x7f]/.test(serial))throw new Error('기기 연결 식별자가 올바르지 않습니다.');
  if(typeof service!=='string'||!service||Buffer.byteLength(service)>65535||service.includes('\0'))throw new Error('ADB 서비스가 올바르지 않습니다.');
  if(signal?.aborted)throw new Error('연결을 취소했습니다.');
  const socket=connect({host,port});let buffer=Buffer.alloc(0),waiting,failed,ended=false;
  const fail=error=>{failed=error;waiting?.();};
  const onData=chunk=>{buffer=Buffer.concat([buffer,chunk]);if(buffer.length>2*1024*1024){fail(new Error('ADB 연결 응답이 너무 큽니다.'));socket.destroy();}waiting?.();};
  const onEnd=()=>{ended=true;waiting?.();};
  socket.on('data',onData);socket.on('error',fail);socket.on('close',onEnd);
  const abort=()=>{fail(new Error('연결을 취소했습니다.'));socket.destroy();};signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>{fail(new Error('ADB 연결 준비 시간이 초과되었습니다.'));socket.destroy();},timeout);timer.unref?.();
  const take=async length=>{if(failed)throw failed;if(signal?.aborted)throw new Error('연결을 취소했습니다.');while(buffer.length<length){if(failed)throw failed;if(ended)throw new Error('ADB가 연결을 닫았습니다.');await new Promise(resolve=>waiting=resolve);waiting=null;}const result=buffer.subarray(0,length);buffer=buffer.subarray(length);return result;};
  const request=async value=>{const body=Buffer.from(value);socket.write(Buffer.concat([Buffer.from(body.length.toString(16).padStart(4,'0')),body]));const status=(await take(4)).toString();if(status==='OKAY')return;if(status!=='FAIL')throw new Error('ADB 응답 형식이 올바르지 않습니다.');const raw=(await take(4)).toString();if(!/^[\da-f]{4}$/i.test(raw))throw new Error('ADB 오류 응답이 올바르지 않습니다.');throw new Error((await take(parseInt(raw,16))).toString().slice(0,2000));};
  try {
    await request('host:transport:'+serial);await request(service);if(failed)throw failed;if(signal?.aborted)throw new Error('연결을 취소했습니다.');
    socket.pause();socket.off('data',onData);socket.off('error',fail);socket.on('error',()=>{});socket.off('close',onEnd);if(buffer.length)socket.unshift(buffer);
    return socket;
  } catch(error){socket.destroy();throw error;}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}

export function shellPacket(id, payload=Buffer.alloc(0)) {const data=Buffer.isBuffer(payload)?payload:Buffer.from(payload);if(data.length>1024*1024)throw new Error('셸 입력이 너무 큽니다.');const head=Buffer.alloc(5);head[0]=id;head.writeUInt32LE(data.length,1);return Buffer.concat([head,data]);}
export function shellWindowSize(cols,rows) {if(!Number.isInteger(cols)||!Number.isInteger(rows)||cols<2||cols>1000||rows<2||rows>500)throw new Error('터미널 크기가 올바르지 않습니다.');return shellPacket(5,`${rows}x${cols},0x0\0`);}
export class ShellPacketReader {
  constructor(onPacket){this.onPacket=onPacket;this.buffer=Buffer.alloc(0);}
  finish(){if(this.buffer.length)throw new Error('기기 셸 응답이 중간에 끊겼습니다.');}
  push(chunk){this.buffer=Buffer.concat([this.buffer,chunk]);while(this.buffer.length>=5){const size=this.buffer.readUInt32LE(1);if(size>1024*1024)throw new Error('기기 셸 응답이 너무 큽니다.');if(this.buffer.length<5+size)return;const id=this.buffer[0],body=this.buffer.subarray(5,5+size);this.buffer=this.buffer.subarray(5+size);if(![1,2,3].includes(id))throw new Error('지원하지 않는 기기 셸 응답입니다.');this.onPacket(id,body);}}
}
