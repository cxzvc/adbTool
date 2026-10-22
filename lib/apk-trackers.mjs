import path from 'node:path';
import { readFile,stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import yauzl from 'yauzl';
import { ActionError } from './connections.mjs';
import { packageName,remotePath } from './operations-core.mjs';
import { uploaded,userContext,shellArgs,createResultStore } from './feature-common.mjs';
const definitions=JSON.parse(readFileSync(new URL('../data/tracker-signatures.json',import.meta.url),'utf8'));
const MAX=256*1024*1024;
// DEX 041 uses physical-file offsets and may contain several logical headers.
// https://source.android.com/docs/core/runtime/dex-format#container-format
export function dexClassNames(bytes){
  const names=new Set();let header=0,logicalCount=0,container=false;
  do{if(++logicalCount>128||header+112>bytes.length||!/^dex\n0(?:35|37|38|39|40|41)\0$/.test(bytes.toString('latin1',header,header+8)))throw new ActionError('표준 DEX 형식을 확인하지 못했습니다. CompactDEX·암호화 코드는 별도 분석이 필요합니다.');
    const version=bytes.toString('ascii',header+4,header+7),v41=version==='041',size=bytes.readUInt32LE(header+32),headerSize=v41?120:112;
    if(header&&(!container||!v41)||header+headerSize>bytes.length||size<headerSize||header+size>bytes.length||bytes.readUInt32LE(header+36)!==headerSize||bytes.readUInt32LE(header+40)!==0x12345678)throw new ActionError('DEX 헤더·논리 파일 범위가 잘못되었습니다.');
    if(v41&&(bytes.readUInt32LE(header+112)!==bytes.length||bytes.readUInt32LE(header+116)!==header))throw new ActionError('DEX 컨테이너 크기·헤더 위치가 다릅니다.');container=v41;
    const limit=v41?bytes.length:size,count=bytes.readUInt32LE(header+56),offset=bytes.readUInt32LE(header+60),types=bytes.readUInt32LE(header+64),typeOffset=bytes.readUInt32LE(header+68),classes=bytes.readUInt32LE(header+96),classOffset=bytes.readUInt32LE(header+100),minimum=header+headerSize;
    const table=(off,n,unit)=>!n?off===0||off>=minimum&&off<=limit:off>=minimum&&off+n*unit<=limit;
    if(count>1000000||classes>300000||types>1000000||!table(offset,count,4)||!table(typeOffset,types,4)||!table(classOffset,classes,32))throw new ActionError('DEX 표 범위·개수 한도를 초과했습니다.');
    for(let i=0;i<classes;i++){const type=bytes.readUInt32LE(classOffset+i*32);if(type>=types)throw new ActionError('DEX 클래스 인덱스가 잘못되었습니다.');const index=bytes.readUInt32LE(typeOffset+type*4);if(index>=count)throw new ActionError('DEX 문자열 인덱스가 잘못되었습니다.');let start=bytes.readUInt32LE(offset+index*4),lengthEnded=false;if(start<minimum||start>=limit)throw new ActionError('DEX 문자열 위치가 잘못되었습니다.');
      for(let n=0;n<5&&start<limit;n++){if((bytes[start++]&128)===0){lengthEnded=true;break;}}if(!lengthEnded||start>=limit)throw new ActionError('DEX 문자열 길이가 잘못되었습니다.');let end=start;while(end<limit&&end-start<=4096&&bytes[end])end++;if(end>=limit||end-start>4096)throw new ActionError('DEX 클래스 이름이 너무 깁니다.');const name=bytes.toString('utf8',start,end);if(/^L[^;\0\r\n]+;$/.test(name))names.add(name.slice(1,-1).replaceAll('/','.'));if(names.size>500000)throw new ActionError('APK 클래스 총 개수 한도를 초과했습니다.');
    }header+=size;
  }while(container&&header<bytes.length);return[...names];
}
export function matchTrackers(classes,defs=definitions.entries){
  const matches=new Map();for(const item of defs){const signature=item.signature;if(typeof signature!=='string'||!signature||signature.length>512)continue;
    const found=classes.filter(name=>signature.startsWith('.')?name.includes(signature):name.startsWith(signature));
    if(found.length){const prior=matches.get(item.name)||{name:item.name,classes:new Set(),signatures:[]};for(const name of found)prior.classes.add(name);prior.signatures.push(signature);matches.set(item.name,prior);}
  }return[...matches.values()].map(m=>({name:m.name,classCount:m.classes.size,examples:[...m.classes].slice(0,8),signatures:m.signatures})).sort((a,b)=>b.classCount-a.classCount||a.name.localeCompare(b.name));
}
export async function analyzeApkClasses(file,{definitions:defs=definitions}={}){
  if((await stat(file)).size>MAX)throw new ActionError('APK는 파일당 256MB 이하만 분석합니다.');
  const classes=new Set(),nativeLibraries=new Set(),warnings=[];let dexCount=0,total=0,entries=0;
  await new Promise((resolve,reject)=>yauzl.open(file,{lazyEntries:true,validateEntrySizes:true,strictFileNames:true},(error,zip)=>{
    if(error)return reject(new ActionError('APK ZIP 구조를 읽지 못했습니다.'));let settled=false;const finish=e=>{if(settled)return;settled=true;zip.close();e?reject(e):resolve();};zip.on('error',finish);zip.on('end',()=>finish());
    zip.on('entry',entry=>{if(++entries>100000)return finish(new ActionError('APK 항목 수 한도 초과입니다.'));if(/^lib\/[^/]+\/[^/]+\.so$/.test(entry.fileName))nativeLibraries.add(entry.fileName);
      if(!/^classes(?:[2-9]|[1-9]\d+)?\.dex$/.test(entry.fileName)){zip.readEntry();return;}
      if(entry.generalPurposeBitFlag&1||entry.uncompressedSize>MAX||total+entry.uncompressedSize>512*1024*1024)return finish(new ActionError('암호화 DEX 또는 분석 크기 한도를 초과했습니다.'));
      total+=entry.uncompressedSize;zip.openReadStream(entry,async(e,stream)=>{if(e)return finish(e);try{const chunks=[];let size=0;for await(const chunk of stream){size+=chunk.length;if(size>entry.uncompressedSize||size>MAX)throw new ActionError('DEX 압축 해제 크기 한도 초과입니다.');chunks.push(chunk);}for(const name of dexClassNames(Buffer.concat(chunks)))classes.add(name);dexCount++;zip.readEntry();}catch(e){finish(e);}});
    });zip.readEntry();
  }));
  if(!dexCount)warnings.push('표준 DEX 클래스가 없습니다. 네이티브 코드만 있거나 암호화·동적 로딩을 사용하는 APK는 탐지 범위가 제한됩니다.');
  const data=await readFile(file);return{sha256:createHash('sha256').update(data).digest('hex'),bytes:data.length,dexCount,classCount:classes.size,matches:matchTrackers([...classes],defs.entries),nativeLibraries:[...nativeLibraries].sort(),warnings,definitionCount:defs.entries.length,source:defs.source,definitionDate:defs.retrievedAt,notes:['APK에 정의된 DEX 클래스의 서명 일치 결과입니다. 문자열·권한 이름만 보고 트래커로 판정하지 않습니다.','SDK 포함은 실제 실행·전송·개인정보 유출의 증거가 아닙니다. 난독화·네이티브·다운로드 코드로 인해 누락될 수 있습니다.']};
}
export function createApkTrackers(core){
  const results=createResultStore(core,'apk-trackers');
  function start(body){return core.startJob(body.deviceId||'pc','apk-trackers','앱 트래커·라이브러리 정적 분석',async job=>{
    const files=[];let directory;
    if(body.uploadId){const source=await uploaded(core,body.uploadId,{max:MAX,extensions:['.apk']});files.push({file:source.localPath,name:source.name});}
    else{
      const pkg=packageName(body.package),{serial}=await core.resolve(body.deviceId),user=await userContext(core,serial,body.user,job);directory=await core.tempDir();job.directory=directory;
      const versionBefore=await shellArgs(core,serial,['pm','list','packages','--user',user,'--show-versioncode',pkg],job);const listed=await shellArgs(core,serial,['pm','list','packages','--user',user,pkg],job);if(!listed.split(/\r?\n/).includes('package:'+pkg))throw new ActionError('선택한 사용자에서 설치된 앱을 다시 선택하세요.');
      const paths=(await shellArgs(core,serial,['pm','path','--user',user,pkg],job)).split(/\r?\n/).filter(l=>l.startsWith('package:')).map(l=>remotePath(l.slice(8)));if(!paths.length||paths.length>64)throw new ActionError('앱의 APK 목록을 확인하지 못했습니다.');let total=0;
      for(const[p,remote]of paths.entries()){if(job.cancelled)throw new Error('분석을 중지했습니다.');const size=Number((await shellArgs(core,serial,['stat','-c','%s',remote],job)).trim());if(!Number.isSafeInteger(size)||size<=0||size>MAX||total+size>1024**3)throw new ActionError('앱 코드 크기 한도(각 256MB·합계 1GB)를 초과했습니다.');total+=size;const file=path.join(directory,p+'.apk');await core.run(serial,['pull',remote,file],{job,timeout:180000});if((await stat(file)).size!==size)throw new ActionError('분석 중 APK가 변경되었습니다. 다시 조회하세요.');files.push({file,name:path.posix.basename(remote)});job.progress=Math.round((p+1)/paths.length*35);}
      const recheck=(await shellArgs(core,serial,['pm','path','--user',user,pkg],job)).split(/\r?\n/).filter(l=>l.startsWith('package:')).map(l=>l.slice(8));if(JSON.stringify(recheck)!==JSON.stringify(paths)||versionBefore!==await shellArgs(core,serial,['pm','list','packages','--user',user,'--show-versioncode',pkg],job))throw new ActionError('앱 업데이트로 APK 경로가 바뀌어 분석을 중단했습니다.');
    }
    const reports=[];for(const[itemIndex,item]of files.entries()){if(job.cancelled)throw new Error('분석을 중지했습니다.');reports.push({name:item.name,...await analyzeApkClasses(item.file)});job.progress=35+Math.round((itemIndex+1)/files.length*60);}
    const merged=new Map();for(const report of reports)for(const match of report.matches){const p=merged.get(match.name)||{name:match.name,classCount:0,files:[],examples:[],signatures:[]};p.classCount+=match.classCount;p.files.push(report.name);p.examples.push(...match.examples.slice(0,Math.max(0,8-p.examples.length)));p.signatures=[...new Set([...p.signatures,...match.signatures])];merged.set(match.name,p);}
    const result={package:body.package||null,reports,matches:[...merged.values()].sort((a,b)=>b.classCount-a.classCount),source:definitions.source,definitionCount:definitions.entries.length,notes:reports[0]?.notes||[]};results.set(job.id,result);return{message:`SDK 서명 ${result.matches.length}개 일치 · APK ${reports.length}개 분석. 앱 실행이나 권한 변경은 하지 않았습니다.`};
  });}
  return{start,result:results.get,definitions(){return{count:definitions.entries.length,source:definitions.source,license:definitions.license,retrievedAt:definitions.retrievedAt};}};
}
