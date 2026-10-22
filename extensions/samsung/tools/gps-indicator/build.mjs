import path from 'node:path';
import os from 'node:os';
import {access,mkdtemp,mkdir,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

// PC build only. This script never locates or invokes adb.
const execute=promisify(execFile),directory=path.dirname(fileURLToPath(import.meta.url));
async function existing(candidates){for(const file of candidates.filter(Boolean))try{await access(file);return file;}catch{}return null;}
const suffix=process.platform==='win32'?'.exe':'';
const jdk=process.env.GPS_HELPER_JAVA_HOME||process.env.JAVA_HOME||'';
const javac=await existing([path.join(jdk,'bin','javac'+suffix)]),java=await existing([path.join(jdk,'bin','java'+suffix)]);
let d8=process.env.GPS_HELPER_D8_JAR;
if(!d8){for(const sdk of [process.env.ANDROID_HOME,process.env.ANDROID_SDK_ROOT,process.env.LOCALAPPDATA&&path.join(process.env.LOCALAPPDATA,'Android','Sdk')].filter(Boolean)){
  let versions=[];try{versions=(await readdir(path.join(sdk,'build-tools'))).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}));}catch{}
  d8=await existing(versions.map(version=>path.join(sdk,'build-tools',version,'lib','d8.jar')));if(d8)break;
}}
if(!javac||!java||!d8)throw new Error('PC JDK와 Android D8이 필요합니다. GPS_HELPER_JAVA_HOME 및 GPS_HELPER_D8_JAR를 지정하세요. 폰에는 접근하지 않았습니다.');
const temporary=await mkdtemp(path.join(os.tmpdir(),'adb-desk-gps-build-'));
try{
  const classes=path.join(temporary,'classes'),dex=path.join(temporary,'dex');await mkdir(classes);await mkdir(dex);
  await execute(javac,['--release','8','-encoding','UTF-8','-d',classes,path.join(directory,'GpsIndicator.java')],{windowsHide:true,timeout:60000});
  const compiled=(await readdir(path.join(classes,'com','adbdesk','gps'))).filter(name=>name.endsWith('.class')).map(name=>path.join(classes,'com','adbdesk','gps',name));
  await execute(java,['-cp',d8,'com.android.tools.r8.D8','--min-api','26','--output',dex,...compiled],{windowsHide:true,timeout:60000});
  const bytes=await readFile(path.join(dex,'classes.dex'));
  if(bytes.length<112||bytes.length>128*1024||!/^dex\n0\d\d\0$/.test(bytes.subarray(0,8).toString('latin1')))throw new Error('DEX 출력 검증 실패');
  await writeFile(path.join(directory,'gps-indicator.dex'),bytes);
  console.log(JSON.stringify({file:path.join(directory,'gps-indicator.dex'),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),phoneAccessed:false}));
}finally{await rm(temporary,{recursive:true,force:true});}
