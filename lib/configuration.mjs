import {readFile,writeFile,mkdir,rename,unlink,lstat} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {storagePaths,samePath,assertLocalLocation} from './local-paths.mjs';

export const DEFAULT_CONFIGURATION=Object.freeze({port:4387,extensions:Object.freeze([]),lan:Object.freeze({enabled:false,addresses:Object.freeze([])})});
const allowedExtensions=new Set(['samsung']);
export function validateExtensions(value){
  if(!Array.isArray(value)||value.some(id=>typeof id!=='string'||!allowedExtensions.has(id)))throw new Error('확장은 지원 목록에서 선택해 주세요.');
  return [...new Set(value)];
}
function boolean(value,label){if(value===true||value==='1'||value==='true')return true;if(value===false||value==='0'||value==='false')return false;throw new Error(label+' 값은 true 또는 false여야 합니다.');}
async function readLocal(file){
  try{const info=await lstat(file);if(info.isSymbolicLink())throw new Error('설정 파일 링크 대신 실제 설정 파일 경로를 지정해 주세요.');const value=JSON.parse(await readFile(file,'utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('설정은 JSON 객체여야 합니다.');return value;}catch(error){if(error.code==='ENOENT')return null;throw new Error('로컬 설정 파일을 읽지 못했습니다. JSON 형식과 파일 접근 권한을 확인하세요.',{cause:error});}
}
async function configuredLocal(paths,{explicit=false,creating=false}={}){
  const local=await readLocal(paths.configFile);if(local)return local;
  if(explicit&&!creating)throw new Error('ADB_DESK_CONFIG로 지정한 설정 파일이 없습니다. 경로를 확인해 주세요.');
  const legacy=path.join(paths.root,'config.json');
  if(!samePath(legacy,paths.configFile)){
    try{await lstat(legacy);throw new Error('이전 config.json이 남아 있습니다. 기본값으로 실행하지 않았습니다. 먼저 node tools/migrate-local-data.mjs --apply로 개인 설정과 데이터를 이전해 주세요.');}catch(error){if(error.code!=='ENOENT')throw error;}
  }
  return {};
}
export async function loadConfiguration(root,{env=process.env}={}){
  const paths=storagePaths(root,{env}),local=await configuredLocal(paths,{explicit:Boolean(env.ADB_DESK_CONFIG)});
  const port=Number(env.PORT??local.port??DEFAULT_CONFIGURATION.port);
  if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('PORT는 1024~65535 사이의 정수여야 합니다.');
  const requested=env.ADB_DESK_EXTENSIONS!==undefined?(env.ADB_DESK_EXTENSIONS.trim()===''||env.ADB_DESK_EXTENSIONS==='none'?[]:env.ADB_DESK_EXTENSIONS.split(',').map(x=>x.trim())):local.extensions??[];
  const extensions=validateExtensions(requested);
  const lanEnabled=env.ADB_DESK_LAN!==undefined?boolean(env.ADB_DESK_LAN,'ADB_DESK_LAN'):local.lan?.enabled===undefined?false:boolean(local.lan.enabled,'lan.enabled');
  const addresses=env.ADB_DESK_LAN_ADDRESSES!==undefined?env.ADB_DESK_LAN_ADDRESSES.split(',').map(x=>x.trim()).filter(Boolean):local.lan?.addresses??[];
  if(!Array.isArray(addresses)||addresses.some(value=>typeof value!=='string'||value.length>255||/[\x00-\x20\x7f\/\\?#@]/.test(value)))throw new Error('LAN 접속 주소 목록의 형식을 확인해 주세요.');
  const adbPath=env.ADB_PATH??local.adbPath;
  if(adbPath!==undefined&&(typeof adbPath!=='string'||adbPath.includes('\0')))throw new Error('ADB 경로 형식을 확인해 주세요.');
  const config={...local,port,extensions,lan:{enabled:lanEnabled,addresses:[...new Set(addresses)]}};
  if(adbPath)config.adbPath=adbPath;else delete config.adbPath;
  return {config,paths,overrides:{extensions:env.ADB_DESK_EXTENSIONS!==undefined,lan:env.ADB_DESK_LAN!==undefined,adbPath:env.ADB_PATH!==undefined,port:env.PORT!==undefined}};
}
export async function saveExtensionConfiguration(root,enabled,{env=process.env}={}){
  const extensions=validateExtensions(enabled),paths=storagePaths(root,{env}),local=await configuredLocal(paths,{explicit:Boolean(env.ADB_DESK_CONFIG),creating:true});
  const value={...local,extensions},temporary=paths.configFile+'.'+randomUUID()+'.tmp';
  await mkdir(path.dirname(paths.configFile),{recursive:true});
  assertLocalLocation(paths.root,paths.configFile,{allowLegacyConfig:true});
  try{await writeFile(temporary,JSON.stringify(value,null,2)+'\n',{encoding:'utf8',flag:'wx',mode:0o600});await rename(temporary,paths.configFile);}finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  return {saved:extensions,restartRequired:true,environmentOverride:env.ADB_DESK_EXTENSIONS!==undefined};
}
