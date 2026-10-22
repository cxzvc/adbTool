// Fixed USB HID report formats and scrcpy 5 UHID framing. The browser never
// supplies descriptors, USB identifiers, device names, or arbitrary device IDs.
const keyboard=Buffer.from([0x05,1,0x09,6,0xa1,1,0x05,7,0x19,0xe0,0x29,0xe7,0x15,0,0x25,1,0x75,1,0x95,8,0x81,2,0x75,8,0x95,1,0x81,1,0x05,8,0x19,1,0x29,5,0x75,1,0x95,5,0x91,2,0x75,3,0x95,1,0x91,1,0x05,7,0x19,0,0x29,0x73,0x15,0,0x25,0x73,0x75,8,0x95,6,0x81,0,0xc0]);
const mouse=Buffer.from([0x05,1,0x09,2,0xa1,1,0x09,1,0xa1,0,0x05,9,0x19,1,0x29,5,0x15,0,0x25,1,0x95,5,0x75,1,0x81,2,0x95,1,0x75,3,0x81,1,0x05,1,0x09,0x30,0x09,0x31,0x09,0x38,0x15,0x81,0x25,0x7f,0x75,8,0x95,3,0x81,6,0x05,0x0c,0x0a,0x38,2,0x95,1,0x81,6,0xc0,0xc0]);
const gamepad=Buffer.from([0x05,1,0x09,5,0xa1,1,0xa1,0,0x09,0x30,0x09,0x31,0x09,0x33,0x09,0x34,0x15,0,0x27,0xff,0xff,0,0,0x75,16,0x95,4,0x81,2,0x09,0x32,0x09,0x35,0x26,0xff,0x7f,0x95,2,0x81,2,0x05,9,0x19,1,0x29,16,0x15,0,0x25,1,0x75,1,0x95,16,0x81,2,0x05,1,0x09,0x39,0x15,1,0x25,8,0x75,4,0x95,1,0x81,0x42,0x75,4,0x95,1,0x81,1,0xc0,0xc0]);
const profiles=Object.freeze({keyboard:{id:0x4401,name:'ADB Desk Keyboard',descriptor:keyboard,length:8},mouse:{id:0x4402,name:'ADB Desk Mouse',descriptor:mouse,length:5},gamepad:{id:0x4403,name:'ADB Desk Gamepad',descriptor:gamepad,length:15}});
const neutralGamepad=Buffer.from([0,128,0,128,0,128,0,128,0,0,0,0,0,0,0]);
export function createHidState(){return {devices:new Map()};}
function profile(kind){if(!Object.hasOwn(profiles,kind))throw new Error('키보드·마우스·게임패드 중 입력 장치를 선택하세요.');return profiles[kind];}
function deviceProfile(message){const spec=profile(message.kind),slot=message.slot??0;if(!Number.isInteger(slot)||slot<0||slot>(message.kind==='gamepad'?3:0))throw new Error('게임패드는 세션마다 0~3 슬롯만 사용할 수 있습니다.');return {...spec,id:spec.id+slot,slot,key:message.kind==='gamepad'?`gamepad:${slot}`:message.kind,name:spec.name+(message.kind==='gamepad'?` ${slot+1}`:'')};}
function session(state){if(!state||!(state.devices instanceof Map))throw new Error('HID 입력 세션이 준비되지 않았습니다.');return state.devices;}
function neutral(kind){return kind==='gamepad'?Buffer.from(neutralGamepad):Buffer.alloc(profile(kind).length);}
function inputPacket(id,report){const packet=Buffer.alloc(5+report.length);packet[0]=13;packet.writeUInt16BE(id,1);packet.writeUInt16BE(report.length,3);report.copy(packet,5);return packet;}
function destroyPacket(id){const packet=Buffer.alloc(3);packet[0]=14;packet.writeUInt16BE(id,1);return packet;}
function reportBytes(message){const spec=profile(message.kind),data=message.report;if(!Array.isArray(data)||data.length!==spec.length||data.some(byte=>!Number.isInteger(byte)||byte<0||byte>255))throw new Error('HID 입력 보고서의 크기·바이트가 잘못되었습니다.');
  if(message.kind==='keyboard'&&(data[1]!==0||data.slice(2).some(key=>key>0x73||key===2||key===3)||(data.slice(2).includes(1)&&!data.slice(2).every(key=>key===1))))throw new Error('허용되지 않은 키보드 보고서입니다.');
  if(message.kind==='mouse'&&(data[0]>31||data.slice(1).includes(128)))throw new Error('허용되지 않은 마우스 보고서입니다.');
  if(message.kind==='gamepad'&&(data[9]>127||data[11]>127||data[14]>8))throw new Error('허용되지 않은 게임패드 보고서입니다.');return Buffer.from(data);
}
export function isHidRelease(message){try{if(message?.type==='hid-destroy'){deviceProfile(message);return true;}if(message?.type!=='hid-input')return false;deviceProfile(message);return reportBytes(message).equals(neutral(message.kind));}catch{return false;}}
export function encodeHidControl(message,state){
  if(!message||!['hid-create','hid-input','hid-destroy'].includes(message.type))return null;
  const spec=deviceProfile(message),devices=session(state);
  if(message.id!==undefined&&message.id!==spec.id)throw new Error('이 세션에 예약된 HID 장치 ID만 사용할 수 있습니다.');
  if(message.descriptor!==undefined||message.reportDescriptor!==undefined||message.vendorId!==undefined||message.productId!==undefined||message.name!==undefined)throw new Error('HID 장치 형식은 서버가 지정합니다.');
  if(message.type==='hid-create'){
    if(devices.has(spec.key))throw new Error('이미 생성 요청한 HID 장치입니다. 중지한 뒤 다시 시작하세요.');
    const name=Buffer.from(spec.name),packet=Buffer.alloc(10+name.length+spec.descriptor.length);packet[0]=12;packet.writeUInt16BE(spec.id,1);packet.writeUInt16BE(0,3);packet.writeUInt16BE(0,5);packet[7]=name.length;name.copy(packet,8);packet.writeUInt16BE(spec.descriptor.length,8+name.length);spec.descriptor.copy(packet,10+name.length);devices.set(spec.key,{id:spec.id,kind:message.kind,slot:spec.slot});return packet;
  }
  if(!devices.has(spec.key))throw new Error('먼저 이 세션에서 HID 장치를 시작하세요.');
  if(message.type==='hid-input')return inputPacket(spec.id,reportBytes(message));
  devices.delete(spec.key);return Buffer.concat([inputPacket(spec.id,neutral(message.kind)),destroyPacket(spec.id)]);
}
export function releaseHidControl(state){const devices=session(state),packets=[];for(const spec of devices.values())packets.push(inputPacket(spec.id,neutral(spec.kind)),destroyPacket(spec.id));devices.clear();return packets;}
