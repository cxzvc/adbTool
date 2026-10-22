import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {readdir,lstat,mkdir,realpath,open,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

export const projectRoot=fileURLToPath(new URL('..',import.meta.url));
const key=value=>process.platform==='win32'?path.resolve(value).toLowerCase():path.resolve(value);
const overlaps=(a,b)=>key(a)===key(b)||key(a).startsWith(key(b)+path.sep)||key(b).startsWith(key(a)+path.sep);
const contained=(base,target)=>key(target).startsWith(key(base)+path.sep);
async function projectedPath(target){
  const tail=[];let current=path.resolve(target);
  while(true){try{return path.join(await realpath(current),...tail.reverse());}catch(error){if(error.code!=='ENOENT')throw error;const parent=path.dirname(current);if(parent===current)throw error;tail.push(path.basename(current));current=parent;}}
}
const rootFiles=new Set(['package.json','package-lock.json','server.mjs','config.example.json','.gitignore','.gitattributes','README.md','SUPPORT.md','CONTRIBUTING.md','THIRD-PARTY-FEATURES.md','LICENSE','LICENSE.md','start.ps1','stop.ps1','enable-lan-firewall.ps1','시작.cmd','종료.cmd','외부접속-방화벽허용.cmd']);
const dataFiles=new Set(['app-functional-supplement.json','uad-package-reference.json','tracker-signatures.json']);
const docsFiles=new Set(['3.7-메뉴배치.json','PUBLIC-RELEASE.md']);
const githubCommunityFiles=new Set(['.github/ISSUE_TEMPLATE/bug_report.yml','.github/ISSUE_TEMPLATE/feature_request.yml','.github/ISSUE_TEMPLATE/config.yml','.github/pull_request_template.md']);
const deniedPart=/^(?:\.git|\.local|node_modules|backups|runtime|coverage|dist|migration-backup|__pycache__)$/i;
const sourceExtensions=new Set(['.mjs','.js','.json','.css','.html','.svg','.txt','.md','.java','.dex','.yml','.yaml','.ps1','.cmd']);
const binaryNames=new Set(['scrcpy-server-v5.0.1','trace_processor_shell.exe','trace_processor_shell']);
export function isPublicPath(relative,{includeSamsung=true}={}){
  const clean=relative.replaceAll('\\','/'),parts=clean.split('/');
  if(!clean||parts.some(p=>!p||p==='.'||p==='..'||deniedPart.test(p))||parts.some(p=>/^\.env(?:\.|$)/i.test(p)))return false;
  if(parts.length===1)return rootFiles.has(clean);
  const ext=path.posix.extname(clean).toLowerCase();
  if(parts[0]==='data')return parts[1]==='licenses'||parts.length===2&&dataFiles.has(parts[1]);
  if(parts[0]==='docs')return parts.length===2&&docsFiles.has(parts[1]);
  if(parts[0]==='extensions')return includeSamsung&&parts[1]==='samsung'&&sourceExtensions.has(ext);
  if(parts[0]==='.github')return githubCommunityFiles.has(clean)||parts[1]==='workflows'&&['.yml','.yaml'].includes(ext);
  if(parts[0]==='vendor')return sourceExtensions.has(ext)||binaryNames.has(parts.at(-1))||/LICENSE|NOTICE|THIRD-PARTY/i.test(parts.at(-1));
  if(['lib','public','tests','tools'].includes(parts[0]))return sourceExtensions.has(ext)||/LICENSE|NOTICE/i.test(parts.at(-1));
  return false;
}
export async function publicFiles(root=projectRoot,options={}){
  const result=[];
  async function walk(directory,relative=''){
    for(const entry of await readdir(directory,{withFileTypes:true})){
      const name=relative?relative+'/'+entry.name:entry.name;
      if(entry.isDirectory()){
        if(deniedPart.test(entry.name)||(!relative&&!['lib','public','tests','tools','data','docs','vendor','extensions','.github'].includes(entry.name)))continue;
        await walk(path.join(directory,entry.name),name);
      }else if(isPublicPath(name,options)){
        const info=await lstat(path.join(directory,entry.name));
        if(!info.isFile()||info.isSymbolicLink())throw new Error('공개 파일은 일반 파일이어야 합니다: '+name);
        result.push(name);
      }
    }
  }
  await walk(path.resolve(root));return result.sort();
}
export async function exportPublic({root=projectRoot,destination,includeSamsung=true,check=true}={}){
  if(!destination)throw new Error('--out으로 새 내보내기 폴더를 지정해 주세요.');
  const source=await realpath(path.resolve(root)),target=path.resolve(destination),plannedTarget=await projectedPath(target);
  if(overlaps(source,plannedTarget))throw new Error('내보내기 폴더는 원본 프로젝트 바깥의 새 폴더여야 합니다.');
  try{await lstat(target);throw new Error('기존 폴더를 덮어쓰지 않습니다. 새 경로를 지정해 주세요.');}catch(error){if(error.code!=='ENOENT')throw error;}
  const files=await publicFiles(source,{includeSamsung});
  for(const required of ['package.json','package-lock.json','server.mjs','config.example.json','README.md','.gitignore'])if(!files.includes(required))throw new Error('공개 준비 파일이 없습니다: '+required);
  const checker=check?await import('./check-public.mjs'):null,literals=checker?await checker.privateLiterals(source):[];
  // Fail before creating an export folder when the source already contains
  // private material. A failed check must not leave that material in a copy.
  const before=checker?await checker.checkPublic({root:source,files,privateRoot:source}):null;
  if(before?.violations.length)throw Object.assign(new Error('공개 파일 검사에서 '+before.violations.length+'건을 확인했습니다. 개인 자료를 복사하지 않았습니다.'),{report:before,destination:target});
  await mkdir(path.dirname(target),{recursive:true});await mkdir(target,{mode:0o700});
  const actualTarget=await realpath(target);if(key(actualTarget)!==key(plannedTarget)||overlaps(source,actualTarget))throw new Error('내보내기 대상의 실제 경로가 변경되어 복사를 중단했습니다.');
  const manifest=[],manifestHandle=await open(path.join(actualTarget,'public-export-manifest.json'),'wx',0o600);
  const metadata={schemaVersion:1,generatedAt:new Date().toISOString(),exportStatus:'in-progress',validationPassed:false,samsungIncluded:includeSamsung,licenseDecision:'pending',publicReady:false,files:manifest,validation:null};
  async function saveManifest(){const bytes=Buffer.from(JSON.stringify(metadata,null,2)+'\n');let offset=0;while(offset<bytes.length){const result=await manifestHandle.write(bytes,offset,bytes.length-offset,offset);if(!result.bytesWritten)throw new Error('내보내기 검증 기록을 쓰지 못했습니다.');offset+=result.bytesWritten;}await manifestHandle.truncate(bytes.length);await manifestHandle.sync();}
  try{
  await saveManifest();
  for(const relative of files){
    const input=path.join(source,relative),output=path.join(actualTarget,relative),info=await lstat(input),actualInput=await realpath(input);
    if(!info.isFile()||info.isSymbolicLink()||!contained(source,actualInput))throw new Error('원본 파일 경로가 변경되어 복사를 중단했습니다: '+relative);
    const handle=await open(input,'r');let bytes;
    try{const opened=await handle.stat(),latest=await lstat(input);if(!opened.isFile()||latest.isSymbolicLink()||opened.dev!==latest.dev||opened.ino!==latest.ino||opened.dev!==info.dev||opened.ino!==info.ino)throw new Error('원본 파일이 변경되어 복사를 중단했습니다: '+relative);bytes=await handle.readFile();}finally{await handle.close();}
    const violations=checker?.scanPublicContent(relative,bytes,{literals})||[];
    if(violations.length)throw Object.assign(new Error('복사 직전 공개 파일 검사에서 개인 자료를 발견하여 해당 파일을 복사하지 않았습니다.'),{report:{violations},destination:target});
    await mkdir(path.dirname(output),{recursive:true});
    if(!contained(actualTarget,path.join(await realpath(path.dirname(output)),path.basename(output))))throw new Error('내보내기 하위 경로가 바뀌어 복사를 중단했습니다.');
    await writeFile(output,bytes,{flag:'wx',mode:0o600});manifest.push({path:relative,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
  }
  const report=checker?await checker.checkPublic({root:actualTarget,files,privateRoot:source}):null;
  metadata.validation=report;metadata.validationPassed=!!report&&!report.violations.length;metadata.exportStatus=report?.violations.length?'failed':check?'complete':'unchecked';await saveManifest();
  if(report?.violations.length)throw Object.assign(new Error('공개 파일 검사에서 '+report.violations.length+'건을 확인했습니다. 내보낸 폴더의 manifest를 검토해 주세요.'),{report,destination:target});
  return {destination:target,count:files.length,bytes:manifest.reduce((sum,item)=>sum+item.bytes,0),exportStatus:metadata.exportStatus,validationPassed:metadata.validationPassed,licenseDecision:'pending',publicReady:false,validation:report};
  }catch(error){
    metadata.exportStatus='failed';metadata.validationPassed=false;metadata.validation=error.report||metadata.validation;metadata.failureKo='공개 내보내기를 완료하지 못했습니다. 이 폴더를 배포하지 마세요.';
    try{await saveManifest();}catch{error.manifestWriteFailed=true;}
    throw error;
  }finally{await manifestHandle.close();}
}
function argumentsFor(argv){const args={};for(let i=0;i<argv.length;i++){if(argv[i]==='--out')args.destination=argv[++i];else if(argv[i]==='--root')args.root=argv[++i];else if(argv[i]==='--core-only')args.includeSamsung=false;else throw new Error('지원하지 않는 옵션입니다: '+argv[i]);}return args;}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{console.log(JSON.stringify(await exportPublic(argumentsFor(process.argv.slice(2))),null,2));}
  catch(error){console.error(error.message);if(error.report)console.error(JSON.stringify(error.report,null,2));process.exitCode=1;}
}
