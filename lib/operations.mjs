import {createFeatureSuite} from './feature-suite.mjs';
import { createDeviceDomains } from './device-domains.mjs';
import { createNetworkAdvanced } from './network-advanced.mjs';
import { createNetworkHistory } from './network-history.mjs';
import { createFileMedia } from './file-media.mjs';
import { createBrowserDebug } from './browser-debug.mjs';
import { createResumableUpload } from './resumable-upload.mjs';
import { createAppLabels } from './app-labels.mjs';
import { createAppInsights } from './app-insights.mjs';
import { createAppKnowledgeTools } from './app-knowledge-tools.mjs';
import { createFileLocationTools } from './file-location-tools.mjs';
import { createMultiDeviceApps } from './multi-device-apps.mjs';
import { createMultiDeviceSettings } from './multi-device-settings.mjs';
import { createFileGallery } from './file-gallery.mjs';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createNetworkInfo } from './network-info.mjs';
import { createAppBatch } from './app-batch.mjs';
import { createFileBatch } from './file-batch.mjs';
import { lookupAppKnowledge } from './app-knowledge.mjs';
import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { createOperationsCore } from './operations-core.mjs';
import { createFileOperations } from './file-operations.mjs';
import { createDiagnostics } from './diagnostics.mjs';
import { createPackageOperations } from './package-operations.mjs';
import { ActionError } from './connections.mjs';
import { createProcessOperations } from './process-operations.mjs';
import { createTelemetry } from './telemetry.mjs';
import { createFileTools } from './file-tools.mjs';
import { createLogCapture } from './log-capture.mjs';
import { createWorkbench } from './workbench.mjs';

export function createOperations(options) {
  const core=options.core||createOperationsCore(options), files=createFileOperations(core), diagnostics=createDiagnostics(core), packages=createPackageOperations(core);
  const features=createFeatureSuite(core);
  const networkInfo=createNetworkInfo(core),appBatch=createAppBatch(core),fileBatch=createFileBatch(core);
  const deviceDomains=createDeviceDomains(core),networkAdvanced=createNetworkAdvanced(core),networkHistory=createNetworkHistory(core),fileMedia=createFileMedia(core),browserDebug=createBrowserDebug(core);
  const resumable=createResumableUpload(core),appLabels=createAppLabels(core);
  const appInsights=createAppInsights(core),appReference=createAppKnowledgeTools({root:core.root});
  const fileLocations=createFileLocationTools(core);
  const multiApps=createMultiDeviceApps(core,{readDevices:options.readDevices});
  const multiSettings=options.deviceControl?.mutate&&options.readDevices?createMultiDeviceSettings(core,{readDevices:options.readDevices,deviceControl:options.deviceControl}):null;
  const gallery=createFileGallery(core,{files});
  const processes=createProcessOperations(core,diagnostics.invalidate);
  const telemetry=createTelemetry({core,readDevices:options.readDevices});
  const fileTools=createFileTools(core),captures=createLogCapture(core),workbench=createWorkbench(core,{readDevices:options.readDevices,fileTools,captures,processes,externalExecute:{'browser-url-open':browserDebug.execute}});
  async function jsonBody(req) {let bytes=0;const chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>3*1024*1024)throw new ActionError('요청이 너무 큽니다.',413);chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString());}catch{throw new ActionError('요청 내용을 확인하세요.');}}
  async function handle(req,res,url,csrfToken) {
    const json=(status,data)=>{if(!res.destroyed&&!res.headersSent){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));}};
    try{
      const route=url.pathname.slice('/api/ops/'.length),deviceId=url.searchParams.get('deviceId');
      if(req.method==='POST'){
        if(req.headers.origin!==`http://${req.headers.host}`||req.headers['x-adb-desk-token']!==csrfToken)throw Object.assign(new ActionError('페이지를 새로고침한 뒤 다시 시도하세요.',403),{mayHaveChanged:false});
        if(route==='upload'){return json(200,await files.upload(req,url));}
        if(route==='resumable-chunk')return json(200,await resumable.chunk(req,url));
        if(route==='folder-upload')return json(200,await fileTools.upload(req,url));
        if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))throw new ActionError('JSON 요청이 필요합니다.',415);
        const body=await jsonBody(req);
        if(Object.hasOwn(features.post,route))return json(200,await features.post[route](body));
        if(route.startsWith('multi-settings-')){
          if(!multiSettings)throw new ActionError('여러 기기 설정 기능을 사용할 수 없습니다.',503);
          const method=({'multi-settings-preview':'preview','multi-settings-apply':'apply','multi-settings-undo':'undo'})[route];
          if(!method)throw new ActionError('지원하지 않는 여러 기기 작업입니다.',404);
          return json(200,await multiSettings[method](body));
        }
        if(route==='file-gallery')return json(200,await gallery.start(body));
        const multiAppActions={'multi-app-targets':multiApps.targets,'multi-app-preview':multiApps.preview,'multi-app-execute':multiApps.execute,'multi-app-discard':multiApps.discard};
        if(Object.hasOwn(multiAppActions,route))return json(200,await multiAppActions[route](body));
        const locationActions={'file-mkdir-preview':fileLocations.mkdirPreview,'file-mkdir':fileLocations.mkdir,'file-duplicates':fileLocations.duplicates};
        if(Object.hasOwn(locationActions,route))return json(200,await locationActions[route](body));
        const localActions={'resumable-begin':resumable.begin,'resumable-finalize':resumable.finalize,'resumable-discard':resumable.discard,'app-labels':appLabels.start,'app-usage':appInsights.usage,'app-storage':appInsights.storage,'apk-compare':appInsights.compareStart,'app-reference-check':appReference.check,'app-reference-review':appReference.review,'app-reference-apply':appReference.apply,'app-reference-enrich':appReference.enrich,'app-knowledge-impact':appReference.impact,'app-reference-rollback-preview':appReference.rollbackPreview};
        if(Object.hasOwn(localActions,route))return json(200,await localActions[route](body));
        const additions={'app-batch-list':appBatch.list,'app-batch-snapshot':appBatch.snapshot,'app-batch-preview':appBatch.preview,'app-batch-execute':appBatch.execute,'app-batch-export':appBatch.exportSnapshot,'app-batch-import':appBatch.importSnapshot,'app-batch-rename':appBatch.renameSnapshot,'app-batch-delete':appBatch.deleteSnapshot,'file-batch':fileBatch.execute,'file-media':fileMedia.run,'apk-preview':packages.preview,'browser-debug-list':browserDebug.list,'browser-debug-close':browserDebug.closeDevice,'browser-url-open':browserDebug.execute,'network-history-control':networkHistory.control};
        if(Object.hasOwn(additions,route))return json(200,await additions[route](body));
        if(route==='workbench-options')return json(200,await workbench.options(body));
        if(route==='file-text-read')return json(200,await workbench.readText(body));
        const actions={transfer:files.transfer,pull:files.prepareDownload,mkdir:files.makeDirectory,'package-action':packages.action,install:packages.install,'backup-apk':packages.backup,'restore-apk':packages.restore,'process-stop':processes.stop,'folder-begin':fileTools.begin,'folder-push':fileTools.push,'folder-download':fileTools.download,'file-action':fileTools.action,workbench:workbench.execute};
        if(Object.hasOwn(actions,route))return json(200,await actions[route](body));
        if(route==='cancel')return json(200,core.cancel(body.id));
        if(route==='bugreport'){
          const {serial}=await core.resolve(body.deviceId);
          return json(200,core.startJob(body.deviceId,'bugreport','기기 버그 리포트 생성',async job=>{
            const directory=await core.tempDir();job.directory=directory;await core.run(serial,['bugreport',directory],{job,timeout:15*60*1000,maxBytes:2*1024*1024});
            const name=(await readdir(directory)).find(name=>name.endsWith('.zip'));if(!name)throw new Error('생성된 버그 리포트 ZIP을 찾지 못했습니다.');job.artifact=path.join(directory,name);job.downloadName=name;return{message:'버그 리포트를 생성했습니다. 다운로드할 수 있습니다.'};
          }));
        }
        throw new ActionError('지원하지 않는 작업입니다.',404);
      }
      if(req.method!=='GET')throw new ActionError('지원하지 않는 요청입니다.',405);
      if(route==='sync-file')return await features.content(req,res,url);
      if(Object.hasOwn(features.get,route))return json(200,await features.get[route](url.searchParams));
      if(route==='multi-settings-catalog'||route==='multi-settings-result'){
        if(!multiSettings)throw new ActionError('여러 기기 설정 기능을 사용할 수 없습니다.',503);
        return json(200,route==='multi-settings-catalog'?await multiSettings.catalog():multiSettings.result(url.searchParams.get('jobId')));
      }
      if(route==='file-gallery-result')return json(200,await gallery.result(deviceId,url.searchParams.get('id')));
      if(route==='file-gallery-content')return await gallery.content(req,res,url);
      if(route==='multi-app-result')return json(200,multiApps.result(deviceId,url.searchParams.get('id')));
      if(route==='file-volumes')return json(200,await fileLocations.volumes(deviceId));
      if(route==='file-location-result')return json(200,fileLocations.result(deviceId,url.searchParams.get('id')));
      if(route==='resumable-status')return json(200,await resumable.status(url.searchParams.get('id')));
      if(route==='app-labels-result')return json(200,appLabels.result(deviceId,url.searchParams.get('id')));
      if(route==='apk-compare-result')return json(200,appInsights.compareResult(deviceId,url.searchParams.get('id')));
      if(route==='app-reference-status')return json(200,await appReference.status());
      if(route==='app-reference-versions')return json(200,await appReference.versions());
      if(route==='device-domains')return json(200,await deviceDomains.read(deviceId,{domain:url.searchParams.get('domain'),alternative:url.searchParams.get('alternative')||undefined}));
      if(route==='network-advanced')return json(200,await networkAdvanced.read(deviceId,{section:url.searchParams.get('section'),package:url.searchParams.get('package'),user:url.searchParams.get('user')||'current',range:url.searchParams.get('range')||'7d'}));
      if(route==='network-history')return json(200,await networkHistory.read(deviceId,url.searchParams));
      if(route==='file-media-result')return json(200,fileMedia.result(deviceId,url.searchParams.get('id')));
      if(route==='file-media-content')return await fileMedia.serve(req,res,url);
      if(route==='activity-history')return json(200,await core.activity.list(url.searchParams));
      if(route==='activity-history-export'){const data=await core.activity.export(url.searchParams);res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Content-Disposition':'attachment; filename="adb-activity-history.json"'});res.end(JSON.stringify(data,null,2));return;}
      if(route==='activity-history-download'){
        if(!deviceId)throw new ActionError('대상 기기를 선택하세요.');
        const file=await core.activity.resolveArtifact(url.searchParams.get('id'),deviceId);
        res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':file.size,'Content-Disposition':`attachment; filename="result"; filename*=UTF-8''${encodeURIComponent(file.name)}`});await pipeline(createReadStream(file.path),res).catch(()=>{});return;
      }
      if(route==='network-info')return json(200,await networkInfo.read(deviceId,{readMode:url.searchParams.get('readMode')||'full'}));
      if(route==='app-knowledge')return json(200,await lookupAppKnowledge(url.searchParams.get('package'),{root:core.root}));
      if(route==='telemetry')return json(200,await telemetry.history(deviceId,url.searchParams));
      if(route==='workbench-catalog')return json(200,workbench.catalog());
      if(route==='managed-profile-setup')return json(200,await workbench.managedProfileSetup.read(deviceId,{parent:url.searchParams.get('parent')||'0',managerId:url.searchParams.get('managerId')||undefined,sessionId:url.searchParams.get('sessionId')||undefined,requestId:url.searchParams.get('requestId')||undefined}));
      if(route==='telemetry-point')return json(200,await telemetry.point(deviceId,url.searchParams));
      if(route==='telemetry-export'){
        const body=await telemetry.csv(deviceId,url.searchParams);
        res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="adb-resource-history.csv"'});res.end(body);return;
      }
      if(route==='files')return json(200,await files.list(deviceId,url.searchParams.get('path')));
      if(route==='status')return json(200,await diagnostics.status(deviceId));
      if(route==='logs')return json(200,await diagnostics.logs(deviceId,url.searchParams));
      if(route==='process-info')return json(200,await processes.describe(deviceId,url.searchParams.get('pid')));
      if(route==='capabilities')return json(200,await packages.capabilities());
      if(route==='jobs')return json(200,{jobs:[...core.jobs.values()].filter(job=>!deviceId||job.deviceId===deviceId).slice(-100).reverse().map(core.publicJob)});
      if(route==='job'){const job=core.jobs.get(url.searchParams.get('id'));if(!job||job.deviceId!==deviceId)throw new ActionError('작업을 찾지 못했습니다.',404);return json(200,{...core.publicJob(job),output:job.output||''});}
      if(route==='download-job')return await files.downloadJob(res,url.searchParams.get('id'));
      if(route==='backups')return json(200,await packages.backupList());
      if(route==='download-backup')return await packages.backupDownload(res,url.searchParams.get('name'));
      throw new ActionError('페이지를 찾을 수 없습니다.',404);
    }catch(error){if(res.headersSent)res.destroy();else json(error.status||500,{error:error.message,...(typeof error.mayHaveChanged==='boolean'?{mayHaveChanged:error.mayHaveChanged}:{}),...(error.reasonKo?{reasonKo:error.reasonKo}:{}),...(error.requiredAccessKo?{requiredAccessKo:error.requiredAccessKo}:{}),...(error.rawError?{rawError:error.rawError}:{}),...(error.sessionId?{sessionId:error.sessionId}:{}),...(error.compatibility?{compatibility:error.compatibility}:{})});}
  }
  const cleanup=setInterval(async()=>{
    await core.pruneHistory().catch(()=>{});
    for(const [id,upload]of core.uploads)if(Date.now()-upload.at>3600000){core.uploads.delete(id);await core.removeOwned(upload.directory).catch(()=>{});}
    for(const [id,job]of core.jobs)if(job.state!=='running'&&Date.now()-Date.parse(job.finishedAt)>12*3600000){core.jobs.delete(id);if(job.directory)await core.removeOwned(job.directory).catch(()=>{});}
  },60000);cleanup.unref();
  return {handle,activity:core.activity,start(){telemetry.start();},async close(){clearInterval(cleanup);for(const job of core.jobs.values())if(job.state==='running'){job.cancelled=true;job.child?.kill();}await Promise.allSettled([()=>features.close(),()=>telemetry.close(),()=>networkHistory.close(),()=>fileMedia.close(),()=>files.close(),()=>browserDebug.close(),()=>resumable.close(),()=>multiApps.close(),()=>gallery.close(),()=>fileLocations.close(),()=>fileTools.close(),()=>captures.close(),()=>core.flushHistory()].map(fn=>Promise.resolve().then(fn)));}};
}
