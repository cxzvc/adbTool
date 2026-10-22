import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,lstat,writeFile,rename,access} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {exportPublic,projectRoot} from './export-public.mjs';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function freePort(){const server=net.createServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
async function run(command,args,{cwd,env,timeout=300000,log}={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='',expired=false;
    child.stdout.on('data',chunk=>{output=(output+chunk).slice(-4*1024*1024);});child.stderr.on('data',chunk=>{output=(output+chunk).slice(-4*1024*1024);});
    const timer=setTimeout(()=>{expired=true;child.kill();},timeout);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('close',async code=>{clearTimeout(timer);try{if(log)await writeFile(log,output);}catch(error){reject(error);return;}if(expired||code!==0)reject(new Error((expired?'시간 제한 초과':'종료 코드 '+code)+': '+path.basename(command)+(log?' · 로그 '+log:'')));else resolve({exitCode:code,log});});
  });
}
async function npmCli(){
  const candidates=[process.env.npm_execpath,path.join(path.dirname(process.execPath),'node_modules','npm','bin','npm-cli.js')].filter(Boolean);
  for(const candidate of candidates)try{await access(candidate);return candidate;}catch{}
  throw new Error('Node.js와 함께 설치된 npm CLI를 찾지 못했습니다. Node.js LTS와 npm을 설치한 뒤 다시 실행해 주세요.');
}
export function isolatedEnvironment(root,inherited=process.env){
  const env={...inherited};
  for(const key of Object.keys(env))if(/^npm_config_/i.test(key)||/^(?:ADB_DESK_(?:HOME|CONFIG|EXTENSIONS|LAN|LAN_ADDRESSES|DISABLE_ADB)|ADB_PATH|ANDROID_HOME|ANDROID_SDK_ROOT|NODE_PATH|NODE_OPTIONS|NPM_TOKEN|NODE_AUTH_TOKEN|PORT)$/i.test(key))delete env[key];
  // Each server/fixture must use its own root's default .local directory.
  // A single forced ADB_DESK_HOME makes independent regression tests share data.
  Object.assign(env,{ADB_DESK_DISABLE_ADB:'1',ADB_PATH:'',ANDROID_HOME:'',ANDROID_SDK_ROOT:'',NODE_PATH:'',NODE_OPTIONS:'',NPM_TOKEN:'',NODE_AUTH_TOKEN:'',npm_config_userconfig:path.join(root,'.local','public.npmrc'),npm_config_globalconfig:path.join(root,'.local','global.npmrc'),npm_config_registry:'https://registry.npmjs.org/'});
  return env;
}
export function entryAssets(html){
  const assets=[...new Set([...html.matchAll(/(?:src|href)="(\/[^"\s]+\.(?:js|css|svg)(?:\?[^"\s]+)?)"/g)].map(match=>match[1]))];
  const paths=new Set(assets.map(url=>url.split('?')[0]));
  if(!/<!doctype html>/i.test(html)||!/<title>ADB Desk\b/i.test(html)||!/<body\b/i.test(html)||!['/app.js','/device.js','/extensions-ui.js','/style.css'].every(file=>paths.has(file)))throw new Error('기본 HTML 또는 필수 화면 파일 연결이 누락되었습니다. HTTP 성공만으로 화면 제공을 통과시키지 않습니다.');
  return assets;
}
async function smokeServer(root,label,outputRoot){
  const port=await freePort(),base='http://127.0.0.1:'+port,env={...isolatedEnvironment(root),PORT:String(port)};
  // Deliberately leave config.json absent: exercise the published defaults.
  await mkdir(path.join(root,'.local'),{recursive:true});
  const child=spawn(process.execPath,[path.join(root,'server.mjs')],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let output='',spawnError;child.stdout.on('data',chunk=>{output=(output+chunk).slice(-1024*1024);});child.stderr.on('data',chunk=>{output=(output+chunk).slice(-1024*1024);});child.once('error',error=>{spawnError=error;});
  let report;
  try{
    let health;const deadline=Date.now()+30000;
    while(Date.now()<deadline){
      if(spawnError)throw spawnError;if(child.exitCode!==null)throw new Error('검증 서버가 시작 중 종료됐습니다.');
      // The child must have bound the port itself before health polling can
      // accept a response from it. Another server on a reused port is not proof.
      if(output.split(/\r?\n/).includes('ADB Desk: '+base))try{const response=await fetch(base+'/api/health',{signal:AbortSignal.timeout(1000)});if(response.ok){const data=await response.json();if(data.app==='adb-desk'&&data.port===port&&child.exitCode===null){health=data;break;}}}catch{}
      await pause(100);
    }
    if(!health)throw new Error('검증 서버의 health 응답을 받지 못했습니다.');
    const response=await fetch(base,{signal:AbortSignal.timeout(10000)}),html=await response.text();if(response.status!==200)throw new Error('기본 화면을 제공하지 못했습니다.');
    const assets=entryAssets(html);
    for(const url of assets){const asset=await fetch(base+url,{method:'HEAD',signal:AbortSignal.timeout(10000)});if(asset.status!==200)throw new Error('정적 파일 제공 실패: '+url);}
    const extensionsResponse=await fetch(base+'/api/extensions',{signal:AbortSignal.timeout(10000)});if(!extensionsResponse.ok)throw new Error('확장 상태 API를 제공하지 못했습니다.');
    const extensions=await extensionsResponse.json();
    if(!Array.isArray(extensions.enabled)||extensions.enabled.length)throw new Error('깨끗한 기본 설정에서 확장이 활성화되어 있습니다.');
    report={label,entryStatus:response.status,assetsChecked:assets.length,extensionsEnabled:extensions.enabled,defaultConfiguration:true,app:health.app,adbConnected:false,uiVisualVerified:false};
  }finally{
    if(child.exitCode===null&&!child.killed)child.kill();
    await Promise.race([new Promise(resolve=>{if(child.exitCode!==null)resolve();else child.once('close',resolve);}),pause(3000)]);
    await writeFile(path.join(outputRoot,label+'-server.log'),output);
  }
  return report;
}
export async function verifyCleanInstall({root=projectRoot,outputRoot,coreTest='tests/public-core.test.mjs',install=true}={}){
  if(outputRoot)try{await lstat(path.resolve(outputRoot));throw new Error('검증 결과 폴더는 새 경로여야 합니다. 기존 폴더를 덮어쓰지 않습니다.');}catch(error){if(error.code!=='ENOENT')throw error;}
  const workspace=outputRoot?path.resolve(outputRoot):await mkdtemp(path.join(os.tmpdir(),'adb-desk-clean-'));
  const project=path.join(workspace,'project');await mkdir(workspace,{recursive:true});
  const report={schemaVersion:1,startedAt:new Date().toISOString(),workspace,sourceOnlyExport:null,npmCi:null,servers:[],coreTests:null,coreRegressionTests:null,freshInstallVerified:false,licenseDecision:'pending',publicReady:false,actualPhoneChanges:false,actualBrowserVerified:false};
  try{
    report.sourceOnlyExport=await exportPublic({root,destination:project});
    await mkdir(path.join(project,'.local'),{recursive:true});
    await writeFile(path.join(project,'.local','public.npmrc'),'registry=https://registry.npmjs.org/\n');await writeFile(path.join(project,'.local','global.npmrc'),'');
    if(install)report.npmCi=await run(process.execPath,[await npmCli(),'ci','--no-audit','--no-fund'],{cwd:project,env:isolatedEnvironment(project),log:path.join(workspace,'npm-ci.log')});
    else report.npmCi={performed:false,note:'테스트용 설치 생략입니다. 새 설치 검증으로 집계하지 않습니다.'};
    report.servers.push(await smokeServer(project,'core-default',workspace));
    const samsung=path.join(project,'extensions','samsung'),disabled=path.join(workspace,'removed-samsung-extension');
    try{await access(samsung);await rename(samsung,disabled);report.samsungPhysicallyRemoved=true;}catch(error){if(error.code!=='ENOENT')throw error;report.samsungPhysicallyRemoved=true;}
    report.servers.push(await smokeServer(project,'without-samsung',workspace));
    const test=path.resolve(project,coreTest);if(!test.startsWith(project+path.sep))throw new Error('공통 기능 테스트는 새 프로젝트 안의 파일이어야 합니다.');await access(test);
    report.coreTests=await run(process.execPath,['--test','--test-reporter=spec',test],{cwd:project,env:isolatedEnvironment(project),timeout:180000,log:path.join(workspace,'core-tests.log')});
    report.coreRegressionTests=await run(process.execPath,[path.join(project,'tools/run-tests.mjs'),'--core-only'],{cwd:project,env:isolatedEnvironment(project),timeout:300000,log:path.join(workspace,'core-regression-tests.log')});
    report.functionalVerificationPassed=true;
    report.freshInstallVerified=install&&report.npmCi.exitCode===0;
  }catch(error){report.functionalVerificationPassed=false;report.error=error.message;throw Object.assign(error,{verification:report});}
  finally{report.finishedAt=new Date().toISOString();await writeFile(path.join(workspace,'verification.json'),JSON.stringify(report,null,2)+'\n');}
  return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const argv=process.argv.slice(2),args={};for(let i=0;i<argv.length;i++){if(argv[i]==='--root')args.root=argv[++i];else if(argv[i]==='--out')args.outputRoot=argv[++i];else if(argv[i]==='--core-test')args.coreTest=argv[++i];else throw new Error('지원하지 않는 옵션입니다: '+argv[i]);}
  try{console.log(JSON.stringify(await verifyCleanInstall(args),null,2));}catch(error){console.error(error.message);if(error.verification)console.error('검증 기록: '+path.join(error.verification.workspace,'verification.json'));process.exitCode=1;}
}
