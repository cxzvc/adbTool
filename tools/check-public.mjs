import path from 'node:path';
import {readFile,lstat,realpath} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {publicFiles,isPublicPath,projectRoot} from './export-public.mjs';
const execute=promisify(execFile);
const patterns=[
  ['personal-windows-profile',/[A-Za-z]:[\\/]+Users[\\/]+(?!(?:Public|Default|test|example|mock|fixture)(?:[\\/]|\b))[\w.-]+/i],
  ['private-workspace',/[A-Za-z]:[\\/]+(?:git|Documents)[\\/]+(?!(?:test|example|mock|fixture)(?:[\\/]|\b))[^\\/\s"']+/i],
  ['personal-samsung-serial',/\bR[0-9][A-Z0-9]{9,13}\b/],
  ['private-lan-example',/\b192\.168\.0\.\d{1,3}\b/],
  ['personal-attachment',/codex-clipboard-[a-f0-9]{8}-|\.codex[\\/]+attachments[\\/]+[a-f0-9-]{20,}/i],
  ['credential-value',/(?:api[_-]?key|access[_-]?token|password|passwd|secret)\s*[=:]\s*["'](?:sk-|gh[pousr]_|github_pat_)[A-Za-z0-9_-]{12,}/i]
];
const binaryExtensions=new Set(['.exe','.dex','.png','.jpg','.jpeg','.gif','.webp','.woff','.woff2','.zip','.jar']);
const binary=file=>binaryExtensions.has(path.extname(file).toLowerCase())||/scrcpy-server-v[\d.]+$/.test(file);
export async function privateLiterals(root,{env=process.env}={}){
  const values=new Set(),localRoot=path.resolve(root,env.ADB_DESK_HOME||'.local');
  const configured=env.ADB_DESK_CONFIG?path.resolve(root,env.ADB_DESK_CONFIG):path.join(localRoot,'config.json');
  for(const file of new Set([path.join(root,'config.json'),path.join(root,'.local','config.json'),configured]))try{
    const config=JSON.parse(await readFile(file,'utf8'));
    if(typeof config.adbPath==='string'&&config.adbPath.length>8)values.add(config.adbPath);
    for(const address of config.lan?.addresses||[])if(typeof address==='string'&&!['127.0.0.1','localhost','::1'].includes(address))values.add(address);
  }catch(error){if(error.code!=='ENOENT'&&!(error instanceof SyntaxError))throw error;}
  return [...values];
}
function scanJson(value,file,violations,trail=''){
  if(!value||typeof value!=='object')return;
  for(const [key,item]of Object.entries(value)){
    const location=trail?trail+'.'+key:key;
    if(/^(?:excerpt|rawOutput|rawDump|hardwareSerial|serialNumber)$/i.test(key)&&typeof item==='string'&&item.trim())violations.push({file,rule:'raw-device-evidence',field:location});
    if(key==='deviceId'&&typeof item==='string'&&!/^(?:MOCK|TEST|FAKE|fixture|sample|example|PHONE)(?:[-_\w]*)$/i.test(item))violations.push({file,rule:'device-identity',field:location});
    if(item&&typeof item==='object')scanJson(item,file,violations,location);
  }
}
function scanName(file,literals){
  const violations=[];
  for(const [rule,pattern]of patterns)if(pattern.test(file))violations.push({file,rule:'filename-'+rule});
  for(const value of literals)if(file.includes(value)||file.includes(value.replaceAll('\\','/')))violations.push({file,rule:'filename-local-configuration-literal'});
  return violations;
}
export function scanPublicContent(file,bytes,{literals=[]}={}){
  const normalized=file.replaceAll('\\','/'),violations=scanName(normalized,literals);
  if(binary(normalized))return violations;
  const text=Buffer.isBuffer(bytes)?bytes.toString('utf8'):String(bytes);
  for(const [rule,pattern]of patterns){const match=pattern.exec(text);if(match)violations.push({file:normalized,rule,line:text.slice(0,match.index).split('\n').length});}
  for(const literal of literals)if(text.includes(literal)||text.includes(JSON.stringify(literal).slice(1,-1)))violations.push({file:normalized,rule:'local-configuration-literal'});
  if(/^(?:extensions\/[^/]+\/data\/|data\/).+\.json$/.test(normalized))try{scanJson(JSON.parse(text),normalized,violations);}catch(error){if(error instanceof SyntaxError)violations.push({file:normalized,rule:'invalid-json'});else throw error;}
  return violations;
}
async function indexedBlobs(root,hashes){
  if(!hashes.length)return new Map();
  const pending=execute('git',['-C',root,'cat-file','--batch'],{windowsHide:true,encoding:'buffer',maxBuffer:128*1024*1024});pending.child.stdin.end(hashes.join('\n')+'\n');
  const {stdout}=await pending,buffer=Buffer.isBuffer(stdout)?stdout:Buffer.from(stdout),result=new Map();let offset=0;
  for(const expected of hashes){const end=buffer.indexOf(10,offset);if(end<0)throw new Error('Git index blob 응답을 끝까지 읽지 못했습니다.');const header=buffer.subarray(offset,end).toString('ascii'),match=/^([a-f0-9]{40,64}) blob (\d+)$/.exec(header);if(!match||match[1]!==expected)throw new Error('Git index 파일 내용을 확인하지 못했습니다.');const size=Number(match[2]);offset=end+1;if(!Number.isSafeInteger(size)||offset+size>=buffer.length)throw new Error('Git index 파일 길이를 확인하지 못했습니다.');result.set(expected,buffer.subarray(offset,offset+size));offset+=size+1;}
  return result;
}
async function gitInspection(root,literals){
  const {stdout}=await execute('git',['-C',root,'ls-files','--stage','-z'],{windowsHide:true,maxBuffer:16*1024*1024}),violations=[],entries=[];
  for(const row of stdout.split('\0').filter(Boolean)){
    const match=/^(\d+) ([a-f0-9]{40,64}) ([0-3])\t([\s\S]+)$/.exec(row);if(!match)throw new Error('Git index 목록 형식을 확인하지 못했습니다.');const [,mode,hash,stage,file]=match;
    if(!isPublicPath(file)){violations.push({file,rule:'private-or-unreviewed-git-tracked-path',scope:'index'});continue;}
    if(stage!=='0'){violations.push({file,rule:'unmerged-git-index',scope:'index'});continue;}
    if(!['100644','100755'].includes(mode)){violations.push({file,rule:'non-regular-git-index-entry',scope:'index'});continue;}
    if(binary(file)){violations.push(...scanName(file,literals).map(value=>({...value,scope:'index'})));continue;}
    entries.push({file,hash});
  }
  const blobs=await indexedBlobs(root,[...new Set(entries.map(row=>row.hash))]);
  for(const entry of entries)violations.push(...scanPublicContent(entry.file,blobs.get(entry.hash),{literals}).map(value=>({...value,scope:'index'})));
  const candidates=(await execute('git',['-C',root,'ls-files','--others','--exclude-standard','-z'],{windowsHide:true,maxBuffer:16*1024*1024})).stdout.split('\0').filter(Boolean);
  for(const file of candidates){if(!isPublicPath(file))violations.push({file,rule:'private-or-unreviewed-git-candidate',scope:'untracked'});else violations.push(...scanName(file,literals).map(value=>({...value,scope:'untracked'})));}
  return {violations,trackedEntries:stdout.split('\0').filter(Boolean).length,indexFilesChecked:entries.length,untrackedCandidates:candidates.length};
}
export async function checkPublic({root=projectRoot,files,privateRoot=root,tracked=false,env=process.env}={}){
  root=await realpath(path.resolve(root));const selected=files||await publicFiles(root),violations=[],literals=await privateLiterals(privateRoot,{env});
  for(const file of selected){
    if(!isPublicPath(file)){violations.push({file,rule:'non-public-path',scope:'working-tree'});continue;}
    const location=path.resolve(root,file);if(!location.startsWith(root+path.sep)){violations.push({file,rule:'outside-root',scope:'working-tree'});continue;}
    const info=await lstat(location);if(!info.isFile()||info.isSymbolicLink()){violations.push({file,rule:'non-regular-file',scope:'working-tree'});continue;}
    const actual=await realpath(location),rootKey=process.platform==='win32'?root.toLowerCase():root,actualKey=process.platform==='win32'?actual.toLowerCase():actual;
    if(!actualKey.startsWith(rootKey+path.sep)){violations.push({file,rule:'outside-root',scope:'working-tree'});continue;}
    violations.push(...scanPublicContent(file,binary(file)?Buffer.alloc(0):await readFile(location),{literals}).map(value=>({...value,scope:'working-tree'})));
  }
  const git=tracked?await gitInspection(root,literals):null;if(git)violations.push(...git.violations);
  return {filesChecked:selected.length,violations,gitStatus:git?'checked':'not-checked',...(git?{git:{trackedEntries:git.trackedEntries,indexFilesChecked:git.indexFilesChecked,untrackedCandidates:git.untrackedCandidates}}:{}),licenseDecision:'pending',publicReady:false,note:'이 검사는 공개 파일 범위와 알려진 개인 정보 패턴을 확인합니다. 자체 코드 라이선스 확정과 실제 UI 검증을 대신하지 않습니다.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{const args=process.argv.slice(2),rootIndex=args.indexOf('--root'),report=await checkPublic({root:rootIndex>=0?args[rootIndex+1]:projectRoot,tracked:args.includes('--tracked')});console.log(JSON.stringify(report,null,2));if(report.violations.length)process.exitCode=1;}
  catch(error){console.error(error.message);process.exitCode=1;}
}
