import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir,readdir,lstat,rename,access,unlink} from 'node:fs/promises';
import {storagePaths,insidePath,samePath,physicalPath,assertLocalLocation} from '../lib/local-paths.mjs';

const mutableNames=['activity-history','app-labels','app-state-snapshots','firmware-snapshots','managed-profile-setups','network-history','telemetry','uad-reference-versions'];
const digest=buffer=>createHash('sha256').update(buffer).digest('hex');
async function exists(file){try{await access(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
async function manifest(directory){
  const result=[];
  async function walk(current){for(const item of await readdir(current,{withFileTypes:true})){
    const file=path.join(current,item.name),info=await lstat(file);
    if(info.isSymbolicLink())throw new Error('링크가 포함된 로컬 자료는 자동 이전하지 않습니다. 원본을 보존했습니다.');
    if(info.isDirectory())await walk(file);
    else if(info.isFile())result.push({file:path.relative(directory,file),bytes:info.size,sha256:digest(await readFile(file))});
    else throw new Error('일반 파일이 아닌 자료가 있어 자동 이전하지 않았습니다.');
  }}
  const rootInfo=await lstat(directory);if(rootInfo.isSymbolicLink()||!rootInfo.isDirectory())throw new Error('이전 원본은 일반 디렉터리여야 합니다.');
  await walk(directory);return result.sort((a,b)=>a.file.localeCompare(b.file));
}

async function directoryAncestors(location){
  let current=path.resolve(location);
  while(true){
    try{const info=await lstat(current);if(!info.isDirectory()&&!info.isSymbolicLink())throw new Error('이전 대상의 상위 경로가 폴더가 아닙니다. 원본을 이동하지 않았습니다.');const actual=physicalPath(current);if(!(await lstat(actual)).isDirectory())throw new Error('이전 대상의 실제 상위 경로가 폴더가 아닙니다.');return;}
    catch(error){if(error.code!=='ENOENT')throw error;const parent=path.dirname(current);if(parent===current)throw error;current=parent;}
  }
}
export async function migrateLocalData(root,{apply=false,env=process.env,fileIO={}}={}){
  const project=path.resolve(root),paths=storagePaths(project,{env});
  const io={writeFile,mkdir,rename,unlink,...fileIO};
  if(samePath(paths.localRoot,project))throw new Error('로컬 데이터 위치가 프로젝트 루트와 같아 이전하지 않았습니다.');
  const candidates=[...mutableNames.map(name=>({source:path.join(project,'data',name),target:path.join(paths.dataRoot,name)})),{source:path.join(project,'data','runtime'),target:paths.runtime},{source:path.join(project,'backups'),target:paths.backupRoot}];
  const moves=[];
  for(const candidate of candidates){
    const source=path.resolve(candidate.source),target=path.resolve(candidate.target);
    if(!insidePath(project,source)||!insidePath(paths.localRoot,target)||samePath(source,target)||insidePath(source,target))throw new Error('이전 경로 검증에 실패했습니다.');
    if(!await exists(source))continue;
    if(!samePath(physicalPath(source),path.join(physicalPath(project),path.relative(project,source))))throw new Error('이전 원본의 상위 경로가 링크로 다른 위치를 가리킵니다. 원본을 이동하지 않았습니다.');
    if(await exists(target))throw new Error('원본과 새 저장 위치가 모두 존재합니다. 덮어쓰거나 삭제하지 않았습니다: '+path.basename(source));
    assertLocalLocation(project,target);await directoryAncestors(path.dirname(target));
    moves.push({...candidate,files:await manifest(source)});
  }
  const legacyConfig=path.join(project,'config.json');let config=null;
  if(await exists(legacyConfig)){
    if(await exists(paths.configFile))throw new Error('기존 설정과 새 로컬 설정이 모두 있어 자동 덮어쓰기를 중단했습니다.');
    const info=await lstat(legacyConfig);if(!info.isFile()||info.isSymbolicLink())throw new Error('기존 설정 파일의 링크 또는 파일 형식을 확인해 주세요.');
    assertLocalLocation(project,paths.configFile,{allowLegacyConfig:true});await directoryAncestors(path.dirname(paths.configFile));
    const raw=await readFile(legacyConfig),parsed=JSON.parse(raw.toString('utf8'));
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('기존 설정 파일의 형식을 확인해 주세요.');
    config={raw,sha256:digest(raw),value:{...parsed,extensions:parsed.extensions??['samsung']}};
  }
  const summary={applied:apply,directories:moves.length,files:moves.reduce((sum,row)=>sum+row.files.length,0),bytes:moves.reduce((sum,row)=>sum+row.files.reduce((n,file)=>n+file.bytes,0),0),configMigrated:Boolean(config)};
  if(!apply)return summary;
  if(!moves.length&&!config)return {...summary,verified:true};
  const records=path.join(paths.localRoot,'migrations'),recordFile=path.join(records,'local-data-'+randomUUID()+'.json');
  const backup=config?path.join(paths.localRoot,'migration-backup','config.original-'+randomUUID()+'.json'):null;
  assertLocalLocation(project,records);await directoryAncestors(records);
  if(backup){assertLocalLocation(project,backup);await directoryAncestors(path.dirname(backup));}
  const record={version:2,at:new Date().toISOString(),state:'prepared',moves:moves.map(move=>({source:path.relative(project,move.source),target:path.relative(paths.localRoot,move.target),state:'pending',files:move.files})),config:config?{state:'pending',original:path.relative(paths.localRoot,backup),originalSha256:config.sha256,source:'config.json',target:path.relative(paths.localRoot,paths.configFile)}:null};
  async function persist(){
    assertLocalLocation(project,recordFile);await io.mkdir(records,{recursive:true});
    const temporary=recordFile+'.'+randomUUID()+'.tmp';
    try{await io.writeFile(temporary,JSON.stringify(record,null,2),{flag:'wx',mode:0o600});await io.rename(temporary,recordFile);}finally{await io.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  }
  // Commit the complete source/target/hash plan before any original is moved.
  await persist();
  try{
    record.state='running';await persist();
    for(const [index,move] of moves.entries()){
      const step=record.moves[index];step.state='moving';await persist();
      assertLocalLocation(project,move.target);
      if(await exists(move.target))throw new Error('이전 중 대상이 생성되어 덮어쓰지 않았습니다.');
      await io.mkdir(path.dirname(move.target),{recursive:true});assertLocalLocation(project,move.target);
      await io.rename(move.source,move.target);step.state='moved';await persist();
      const after=await manifest(move.target);
      if(JSON.stringify(after)!==JSON.stringify(move.files)){step.observedFiles=after;throw new Error('이전 후 파일 내용이 일치하지 않습니다. 이동된 자료를 보존했습니다.');}
      step.state='verified';await persist();
    }
    if(config){
      record.config.state='writing-local';await persist();
      await io.mkdir(path.dirname(backup),{recursive:true});await io.mkdir(path.dirname(paths.configFile),{recursive:true});
      assertLocalLocation(project,paths.configFile,{allowLegacyConfig:true});assertLocalLocation(project,backup);
      const text=JSON.stringify(config.value,null,2)+'\n';await io.writeFile(paths.configFile,text,{flag:'wx',mode:0o600});
      if(digest(await readFile(paths.configFile))!==digest(Buffer.from(text)))throw new Error('새 로컬 설정 파일의 내용을 확인하지 못했습니다.');
      record.config.state='local-written';await persist();
      await io.rename(legacyConfig,backup);record.config.state='original-preserved';await persist();
      if(digest(await readFile(backup))!==config.sha256)throw new Error('설정 원본 보존을 검증하지 못했습니다.');
      record.config.state='verified';await persist();
    }
    record.state='complete';record.finishedAt=new Date().toISOString();await persist();
    return {...summary,verified:true};
  }catch(error){
    record.state='failed';record.failureCode=error.code||'MIGRATION_FAILED';record.finishedAt=new Date().toISOString();
    try{await persist();}catch{/* The last committed step still identifies both paths and the original hashes. */}
    throw Object.assign(new Error('로컬 자료 이전을 완료하지 못했습니다. 원본 또는 이동된 자료는 삭제하지 않았습니다. 로컬 데이터 폴더의 migrations 기록을 확인해 주세요.',{cause:error}),{code:error.code,migrationRecord:recordFile});
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const root=fileURLToPath(new URL('../',import.meta.url));
  try{console.log(JSON.stringify(await migrateLocalData(root,{apply:process.argv.includes('--apply')})));}catch(error){console.error(error.message);process.exitCode=1;}
}
