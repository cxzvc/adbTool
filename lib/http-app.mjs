import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { ActionError } from './connections.mjs';
import { attachMirroring } from './mirror.mjs';
import { createAccess } from './access.mjs';
import { createOperations } from './operations.mjs';
import { helpReference } from './help-reference.mjs';
import { attachShell } from './shell-session.mjs';
import { attachLiveLogs } from './live-logs.mjs';
import { createMirrorCapabilities } from './mirror-capabilities.mjs';
import {userOperationReview} from './user-operation-review.mjs';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import {describeExtensions,listAvailableExtensions,enabledExtensionIds,resolveExtensionAsset} from './extensions.mjs';
import {loadConfiguration,saveExtensionConfiguration} from './configuration.mjs';

const assets = new Map([
  ['/extensions-ui.js',['extensions-ui.js','text/javascript; charset=utf-8']],
  ['/extensions-ui.css',['extensions-ui.css','text/css; charset=utf-8']],
  ['/user-profile-help.js',['user-profile-help.js','text/javascript; charset=utf-8']],
  ['/user-profile-help.css',['user-profile-help.css','text/css; charset=utf-8']],
  ['/appearance.js',['appearance.js','text/javascript; charset=utf-8']],
  ['/appearance.css',['appearance.css','text/css; charset=utf-8']],
  ['/mirror-diagnostics.js',['mirror-diagnostics.js','text/javascript; charset=utf-8']],
  ['/mirror-drop.js',['mirror-drop.js','text/javascript; charset=utf-8']],
  ['/experience-additions.css',['experience-additions.css','text/css; charset=utf-8']],
  ['/managed-profile-setup.js',['managed-profile-setup.js','text/javascript; charset=utf-8']],
  ['/managed-profile-setup.css',['managed-profile-setup.css','text/css; charset=utf-8']],
  ['/feature-help.js',['feature-help.js','text/javascript; charset=utf-8']],
  ['/feature-help.css',['feature-help.css','text/css; charset=utf-8']],
  ['/compatibility-ui.js',['compatibility-ui.js','text/javascript; charset=utf-8']],
  ['/compatibility.css',['compatibility.css','text/css; charset=utf-8']],
  ['/popup-help.js',['popup-help.js','text/javascript; charset=utf-8']],
  ['/popup-help.css',['popup-help.css','text/css; charset=utf-8']],
  ['/feature-sync-local.js', ['feature-sync-local.js', 'text/javascript; charset=utf-8']],
  ['/feature-hash.js', ['feature-hash.js', 'text/javascript; charset=utf-8']],
  ['/feature-desk.js', ['feature-desk.js', 'text/javascript; charset=utf-8']],
  ['/virtual-workspace.js', ['virtual-workspace.js', 'text/javascript; charset=utf-8']],
  ['/feature-desk.css', ['feature-desk.css', 'text/css; charset=utf-8']],

  ['/error-help.js', ['error-help.js', 'text/javascript; charset=utf-8']],
  ['/mirror-layout.js', ['mirror-layout.js', 'text/javascript; charset=utf-8']],
  ['/mirror-layout.css', ['mirror-layout.css', 'text/css; charset=utf-8']],
  ['/mirror-presets.js', ['mirror-presets.js', 'text/javascript; charset=utf-8']],
  ['/mirror-presets.css', ['mirror-presets.css', 'text/css; charset=utf-8']],
  ['/monitor-layout.js', ['monitor-layout.js', 'text/javascript; charset=utf-8']],
  ['/workbench-access.js', ['workbench-access.js', 'text/javascript; charset=utf-8']],
  ['/workbench-access.css', ['workbench-access.css', 'text/css; charset=utf-8']],
  ['/monitor-layout.css', ['monitor-layout.css', 'text/css; charset=utf-8']],

  ['/mirror-session-options.js', ['mirror-session-options.js', 'text/javascript; charset=utf-8']],
  ['/mirror-session-options.css', ['mirror-session-options.css', 'text/css; charset=utf-8']],
  ['/multi-device-settings.js', ['multi-device-settings.js', 'text/javascript; charset=utf-8']],
  ['/multi-device-settings.css', ['multi-device-settings.css', 'text/css; charset=utf-8']],
  ['/file-gallery.js', ['file-gallery.js', 'text/javascript; charset=utf-8']],
  ['/file-gallery.css', ['file-gallery.css', 'text/css; charset=utf-8']],

  ['/mirror-input-map.js', ['mirror-input-map.js', 'text/javascript; charset=utf-8']],
  ['/mirror-input-map.css', ['mirror-input-map.css', 'text/css; charset=utf-8']],
  ['/mirror-playback-clock.js', ['mirror-playback-clock.js', 'text/javascript; charset=utf-8']],
  ['/multi-device-apps.js', ['multi-device-apps.js', 'text/javascript; charset=utf-8']],
  ['/multi-device-apps.css', ['multi-device-apps.css', 'text/css; charset=utf-8']],

  ['/mirror-audio-decoder.js', ['mirror-audio-decoder.js', 'text/javascript; charset=utf-8']],
  ['/file-location-tools.js', ['file-location-tools.js', 'text/javascript; charset=utf-8']],
  ['/file-location-tools.css', ['file-location-tools.css', 'text/css; charset=utf-8']],
  ['/mirror-compare.js', ['mirror-compare.js', 'text/javascript; charset=utf-8']],
  ['/mirror-compare.css', ['mirror-compare.css', 'text/css; charset=utf-8']],

  ['/overview-tools.js', ['overview-tools.js', 'text/javascript; charset=utf-8']],
  ['/overview-tools.css', ['overview-tools.css', 'text/css; charset=utf-8']],
  ['/app-reference-tools.js', ['app-reference-tools.js', 'text/javascript; charset=utf-8']],
  ['/app-reference-tools.css', ['app-reference-tools.css', 'text/css; charset=utf-8']],
  ['/mirror-view.js', ['mirror-view.js', 'text/javascript; charset=utf-8']],
  ['/mirror-view.css', ['mirror-view.css', 'text/css; charset=utf-8']],

  ['/vendor/xterm.js', ['vendor/xterm.js', 'text/javascript; charset=utf-8']],
  ['/vendor/xterm-addon-fit.js', ['vendor/xterm-addon-fit.js', 'text/javascript; charset=utf-8']],
  ['/terminal-ui.js', ['terminal-ui.js', 'text/javascript; charset=utf-8']],
  ['/browser-debug-ui.js', ['browser-debug-ui.js', 'text/javascript; charset=utf-8']],
  ['/live-logs.js', ['live-logs.js', 'text/javascript; charset=utf-8']],
  ['/device-domains.js', ['device-domains.js', 'text/javascript; charset=utf-8']],
  ['/activity-history.js', ['activity-history.js', 'text/javascript; charset=utf-8']],
  ['/app-inventory.js', ['app-inventory.js', 'text/javascript; charset=utf-8']],
  ['/network-advanced.js', ['network-advanced.js', 'text/javascript; charset=utf-8']],
  ['/file-media.js', ['file-media.js', 'text/javascript; charset=utf-8']],
  ['/resumable-upload.js', ['resumable-upload.js', 'text/javascript; charset=utf-8']],
  ['/mirror-keyboard.js', ['mirror-keyboard.js', 'text/javascript; charset=utf-8']],
  ['/mirror-video.js', ['mirror-video.js', 'text/javascript; charset=utf-8']],
  ['/mirror-options-ui.js', ['mirror-options-ui.js', 'text/javascript; charset=utf-8']],
  ['/mirror-media-ui.js', ['mirror-media-ui.js', 'text/javascript; charset=utf-8']],
  ['/mirror-hid.js', ['mirror-hid.js', 'text/javascript; charset=utf-8']],
  ['/device-preferences.js', ['device-preferences.js', 'text/javascript; charset=utf-8']],
  ['/vendor/xterm.css', ['vendor/xterm.css', 'text/css; charset=utf-8']],
  ['/terminal-ui.css', ['terminal-ui.css', 'text/css; charset=utf-8']],
  ['/live-logs.css', ['live-logs.css', 'text/css; charset=utf-8']],
  ['/device-domains.css', ['device-domains.css', 'text/css; charset=utf-8']],
  ['/activity-history.css', ['activity-history.css', 'text/css; charset=utf-8']],
  ['/app-inventory.css', ['app-inventory.css', 'text/css; charset=utf-8']],
  ['/network-advanced.css', ['network-advanced.css', 'text/css; charset=utf-8']],
  ['/file-media.css', ['file-media.css', 'text/css; charset=utf-8']],
  ['/install-ui.css', ['install-ui.css', 'text/css; charset=utf-8']],
  ['/mirror-media-ui.css', ['mirror-media-ui.css', 'text/css; charset=utf-8']],
  ['/mirror-hid.css', ['mirror-hid.css', 'text/css; charset=utf-8']],
  ['/device-preferences.css', ['device-preferences.css', 'text/css; charset=utf-8']],

  ['/desk-ui.css', ['desk-ui.css', 'text/css; charset=utf-8']],
  ['/list-layout.css', ['list-layout.css', 'text/css; charset=utf-8']],
  ['/network-info.js', ['network-info.js', 'text/javascript; charset=utf-8']],
  ['/network-info.css', ['network-info.css', 'text/css; charset=utf-8']],
  ['/app-batch.js', ['app-batch.js', 'text/javascript; charset=utf-8']],
  ['/app-batch.css', ['app-batch.css', 'text/css; charset=utf-8']],
  ['/file-batch.js', ['file-batch.js', 'text/javascript; charset=utf-8']],
  ['/file-batch.css', ['file-batch.css', 'text/css; charset=utf-8']],
  ['/app-knowledge.js', ['app-knowledge.js', 'text/javascript; charset=utf-8']],
  ['/app-knowledge.css', ['app-knowledge.css', 'text/css; charset=utf-8']],
  ['/mirror-tools.js', ['mirror-tools.js', 'text/javascript; charset=utf-8']],
  ['/mirror-tools.css', ['mirror-tools.css', 'text/css; charset=utf-8']],

  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
  ['/device.js', ['device.js', 'text/javascript; charset=utf-8']],
  ['/firmware-review-ui.js', ['firmware-review-ui.js', 'text/javascript; charset=utf-8']],
  ['/device.css', ['device.css', 'text/css; charset=utf-8']],
  ['/theme.css', ['theme.css', 'text/css; charset=utf-8']],
  ['/operations.js', ['operations.js', 'text/javascript; charset=utf-8']],
  ['/operations.css', ['operations.css', 'text/css; charset=utf-8']],
  ['/ui-utils.js', ['ui-utils.js', 'text/javascript; charset=utf-8']],
  ['/ui-feedback.js', ['ui-feedback.js', 'text/javascript; charset=utf-8']],
  ['/audit.css', ['audit.css', 'text/css; charset=utf-8']],
  ['/telemetry.js', ['telemetry.js', 'text/javascript; charset=utf-8']],
  ['/telemetry.css', ['telemetry.css', 'text/css; charset=utf-8']],
  ['/resource-overview.js', ['resource-overview.js', 'text/javascript; charset=utf-8']],
  ['/workbench.js', ['workbench.js', 'text/javascript; charset=utf-8']],
  ['/workbench-fields.js', ['workbench-fields.js', 'text/javascript; charset=utf-8']],
  ['/install-ui.js', ['install-ui.js', 'text/javascript; charset=utf-8']],
  ['/install.css', ['install.css', 'text/css; charset=utf-8']],
  ['/target-ui.js', ['target-ui.js', 'text/javascript; charset=utf-8']],
  ['/workbench.css', ['workbench.css', 'text/css; charset=utf-8']],
  ['/jmuxer.min.js', ['jmuxer.min.js', 'text/javascript; charset=utf-8']],
]);

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0, chunks = [], rejected = false;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 4096) { rejected = true; chunks = []; reject(new ActionError('요청이 너무 큽니다.', 413)); }
      if (!rejected) chunks.push(chunk);
    });
    req.on('end', () => {
      if (rejected) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new ActionError('JSON 요청을 확인해 주세요.')); }
    });
    req.on('error', () => reject(new ActionError('요청을 읽을 수 없습니다.')));
    req.on('aborted', () => reject(new ActionError('요청이 중단되었습니다.')));
  });
}

export function createAppServer({ root, readDevices, act, adbError = '', deviceControl, adbPath, lan = {}, version = 'unknown', operationsFactory = createOperations }) {
  const access = createAccess(lan);
  const csrfToken = randomBytes(32).toString('hex');
  function extensionStatus(configured, environmentOverride = false) {
    const enabled=enabledExtensionIds(),known=listAvailableExtensions();
    return {available:known.filter(item=>item.installed),enabled,configured,
      restartRequired:JSON.stringify([...enabled].sort())!==JSON.stringify([...configured].sort()),
      environmentOverride,unavailable:known.filter(item=>item.reasonKo)};
  }
  const operations = deviceControl && adbPath ? operationsFactory({ adbPath, resolve: deviceControl.resolve, root, readDevices, deviceControl }) : null;
  const mirrorCapabilities=deviceControl&&adbPath?createMirrorCapabilities({adbPath,root,resolve:deviceControl.resolve}):null;
  let mirrors=null,mirrorReady=Promise.resolve();
  deviceControl?.setActivity?.(operations?.activity);
  const server = http.createServer(async (req, res) => {
    const styleNonce=randomBytes(18).toString('base64');
    const port = server.address().port;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self' 'nonce-${styleNonce}'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' ${access.allowedHosts(port).map(host => `ws://${host}`).join(' ')}; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`);
    function json(status, data) { if (!res.destroyed) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); } }
    if (!access.allowedHosts(port).includes(req.headers.host)) return json(403, { error: '허용된 서버 주소로 접속해 주세요.' });
    let route;
    try { route = new URL(req.url, `http://127.0.0.1:${port}`).pathname; } catch { return json(400, { error: '잘못된 요청입니다.' }); }
    // The static entry page contains no device data and must open from external links.
    // Device reads, session tokens, and all actions still require a local origin.
    const entryPage = route === '/' && ['GET', 'HEAD'].includes(req.method);
    if (!entryPage && req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return json(403, { error: '외부 사이트에서는 접근할 수 없습니다.' });
    if (!entryPage && req.headers['sec-fetch-site'] === 'cross-site') return json(403, { error: '외부 사이트에서는 접근할 수 없습니다.' });
    if(route==='/api/extensions'){
      if(req.method==='GET'||req.method==='HEAD'){
        try{const {config,overrides}=await loadConfiguration(root);return json(200,extensionStatus(config.extensions,overrides.extensions));}catch(error){return json(503,{error:error.message});}
      }
      if(req.method!=='POST'){res.setHeader('Allow','GET, HEAD, POST');return json(405,{error:'지원하지 않는 요청입니다.'});}
      if(req.headers.origin!==`http://${req.headers.host}`||req.headers['x-adb-desk-token']!==csrfToken)return json(403,{error:'페이지를 새로고침한 뒤 다시 시도해 주세요.'});
      if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return json(415,{error:'JSON 요청만 지원합니다.'});
      try{
        if((await loadConfiguration(root)).overrides.extensions)throw new ActionError('확장 목록이 ADB_DESK_EXTENSIONS 환경변수로 지정되어 있습니다. 환경변수를 변경한 뒤 웹 서버를 다시 시작하세요.',409);
        const body=await readJson(req),installed=new Set(listAvailableExtensions().filter(item=>item.installed).map(item=>item.id));
        if(!Array.isArray(body?.enabled)||body.enabled.some(id=>!installed.has(id)))throw new ActionError('설치된 확장 목록에서 선택해 주세요.',400);
        const saved=await saveExtensionConfiguration(root,body.enabled),status=extensionStatus(saved.saved,saved.environmentOverride);
        return json(200,{ok:true,...saved,...status,message:status.restartRequired?'PC의 확장 설정을 저장했습니다. 웹 서버를 다시 시작하면 적용됩니다.':'PC의 확장 설정을 저장했습니다. 현재 실행 상태와 같습니다.'});
      }catch(error){return json(error.status||400,{error:error.message});}
    }
    if(route==='/api/device/features'){
      if(!['GET','HEAD'].includes(req.method)){res.setHeader('Allow','GET, HEAD');return json(405,{error:'조회 요청만 지원합니다.'});}
      const id=new URL(req.url,`http://${req.headers.host}`).searchParams.get('id');if(!id)return json(400,{error:'기기를 선택해 주세요.'});
      try{const device=readDevices?(await readDevices()).devices?.find(item=>item.id===id):(await deviceControl?.resolve?.(id))?.device;if(!device)return json(404,{error:'현재 목록에서 기기를 찾지 못했습니다. 연결 상태를 다시 조회해 주세요.'});return json(200,{deviceId:id,...describeExtensions(device)});}catch(error){return json(error.status||503,{error:'기기 확장 조건을 읽지 못했습니다. 연결 상태를 확인한 뒤 다시 조회해 주세요.'});}
    }
    if (route.startsWith('/api/ops/')) {
      if (!operations) return json(503,{error:'ADB 연결을 확인하세요.'});
      return operations.handle(req,res,new URL(req.url,`http://${req.headers.host}`),csrfToken);
    }
    if (route === '/api/connection' || route === '/api/device/settings' || route === '/api/device/tool' || route === '/api/device/app'||['/api/device/privacy-indicators','/api/device/gps-indicator'].includes(route)&&req.method!=='GET'&&req.method!=='HEAD') {
      if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return json(405, { error: 'POST 요청만 지원합니다.' }); }
      if (req.headers.origin !== `http://${req.headers.host}` || req.headers['x-adb-desk-token'] !== csrfToken) return json(403, { error: '페이지를 새로고침한 뒤 다시 시도해 주세요.' });
      if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) return json(415, { error: 'JSON 요청만 지원합니다.' });
      const handler = route === '/api/connection' ? act : route==='/api/device/gps-indicator'?deviceControl?.gpsIndicatorMutate:route==='/api/device/privacy-indicators'?deviceControl?.privacyIndicatorsMutate:route === '/api/device/tool' ? deviceControl?.tool : route === '/api/device/app' ? deviceControl?.appAction : deviceControl?.mutate;
      if (!handler) return json(503, { error: adbError || 'ADB를 사용할 수 없습니다.' });
      try { const result = await handler(await readJson(req)); return json(result.ok ? 200 : 502, result); }
      catch (error) { return json(error.status || 500, { error: error.status ? error.message : '연결 작업을 처리하지 못했습니다.',...(['/api/device/privacy-indicators','/api/device/gps-indicator'].includes(route)?{code:error.code||null,requiredAccessKo:error.requiredAccessKo||null,rawError:error.rawError||null,mayHaveChanged:error.mayHaveChanged===true,writeBlocked:error.writeBlocked===true,writeAccess:error.writeAccess||null,stored:error.stored||null}:{}) }); }
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Allow', 'GET, HEAD'); return json(405, { error: '지원하지 않는 요청입니다.' }); }
    if (route === '/api/health') return json(200, { app: 'adb-desk', version, ready: !!readDevices, port });
    if (route === '/api/session') return json(200, { csrfToken });
    if (route === '/api/help-reference') {try{const query=new URL(req.url,`http://${req.headers.host}`).searchParams;let device;if(query.has('id')){device=readDevices?(await readDevices()).devices?.find(item=>item.id===query.get('id')):(await deviceControl?.resolve?.(query.get('id')))?.device;if(!device)throw new ActionError('현재 목록에서 기기를 찾지 못했습니다.',404);}return json(200,helpReference({firmware:query.get('firmware'),edition:query.get('edition'),device}));}catch(error){return json(error.status||409,{error:error.message});}}
    if(route==='/api/device/feature-help'){
      if(!deviceControl?.featureHelpRead)return json(503,{error:'기능의 현재 상태를 조회할 수 없습니다. ADB 연결을 확인하세요.'});
      const query=new URL(req.url,`http://${req.headers.host}`).searchParams,values={};
      for(const name of ['package','user','path','namespace','key','pid','service','buffer','method','direction','mode','query','tool','permission','op','component','imeId'])if(query.has(name))values[name]=query.get(name);
      try{return json(200,await deviceControl.featureHelpRead(query.get('id'),query.get('action'),values));}
      catch(error){return json(error.status||503,{error:error.status?error.message:'현재 상태를 읽지 못했습니다. 연결 상태와 조회 권한을 확인한 뒤 다시 조회하세요.',reasonKo:error.reasonKo||null,requiredAccessKo:error.requiredAccessKo||null,rawError:error.rawError||null});}
    }
    if(route==='/api/device/user-profile-help'){
      const deviceId=new URL(req.url,`http://${req.headers.host}`).searchParams.get('id'),operationReview=userOperationReview(deviceId,{root});
      if(!deviceControl?.userProfileHelpRead)return json(503,{error:'사용자·프로필 상태 안내를 조회할 수 없습니다. ADB 연결을 확인하세요.',...(operationReview?{operationReview}:{})});
      try{return json(200,{...await deviceControl.userProfileHelpRead(deviceId),...(operationReview?{operationReview}:{})});}
      catch(error){return json(error.status||503,{error:error.message,requiredAccessKo:error.requiredAccessKo||null,rawError:error.rawError||null,...(operationReview?{operationReview}:{})});}
    }
    if(route==='/api/device/gps-indicator'){
      if(!deviceControl?.gpsIndicatorRead)return json(503,{error:'ADB 연결을 확인하세요. 앱별 위치 표시 분류 조회를 사용할 수 없습니다.'});
      const query=new URL(req.url,`http://${req.headers.host}`).searchParams;
      try{return json(200,await deviceControl.gpsIndicatorRead(query.get('id'),query.get('package'),query.get('user')||'current'));}
      catch(error){return json(error.status||503,{error:error.message,code:error.code||null,requiredAccessKo:error.requiredAccessKo||null,rawError:error.rawError||null,mayHaveChanged:false});}
    }
    if(route==='/api/device/privacy-indicators'){
      if(!deviceControl?.privacyIndicatorsRead)return json(503,{error:'ADB 연결을 확인하세요. 개인정보 표시 설정 조회를 사용할 수 없습니다.'});
      try{return json(200,await deviceControl.privacyIndicatorsRead(new URL(req.url,`http://${req.headers.host}`).searchParams.get('id')));}
      catch(error){return json(error.status||503,{error:error.message,code:error.code||null,requiredAccessKo:error.requiredAccessKo||null,rawError:error.rawError||null,mayHaveChanged:error.mayHaveChanged===true});}
    }
    if(route==='/api/mirror/sessions'){
      const deviceId=new URL(req.url,`http://${req.headers.host}`).searchParams.get('deviceId');
      if(!deviceId)return json(400,{error:'대상 기기를 선택하세요.'});
      if(!mirrors?.diagnostics)return json(503,{error:'화면 연결 기록을 사용할 수 없습니다.'});
      return json(200,mirrors.diagnostics.list(deviceId));
    }
    if(route==='/api/mirror/capabilities'){
      if(!mirrorCapabilities)return json(503,{error:'ADB 연결을 확인하세요.'});
      try{const query=new URL(req.url,`http://${req.headers.host}`).searchParams;return json(200,await mirrorCapabilities.read(query.get('deviceId'),query.get('kind')||'all'));}
      catch(error){return json(error.status||503,{error:error.message});}
    }
    if(route==='/api/mirror-recordings'||route.startsWith('/api/mirror-recordings/')){
      if(!mirrors?.media)return json(503,{error:'화면 저장 기능을 사용할 수 없습니다.'});
      try{
        const deviceId=new URL(req.url,`http://${req.headers.host}`).searchParams.get('deviceId');
        if(!deviceId)throw new ActionError('대상 기기를 선택하세요.');
        if(route==='/api/mirror-recordings')return json(200,await mirrors.media.list(deviceId));
        const artifact=await mirrors.media.download(route.slice('/api/mirror-recordings/'.length),deviceId);
        res.writeHead(200,{'Content-Type':artifact.mime,'Content-Length':artifact.size,'Content-Disposition':`attachment; filename="recording"; filename*=UTF-8''${encodeURIComponent(artifact.name)}`});
        if(req.method==='HEAD')res.end();else await pipeline(createReadStream(artifact.path),res).catch(()=>{});return;
      }catch(error){if(res.headersSent)res.destroy();else return json(error.status||404,{error:error.message});return;}
    }
    if(['/api/device','/api/device/info','/api/device/app-users','/api/device/inventory','/api/device/apps'].includes(route)&&!deviceControl)return json(503,{error:adbError||'ADB를 사용할 수 없습니다. PC의 ADB 경로를 확인하세요.'});
    if (route === '/api/device') {
      if (!deviceControl) return json(503, { error: adbError || 'ADB를 사용할 수 없습니다.' });
      try { return json(200, await deviceControl.read(new URL(req.url, `http://${req.headers.host}`).searchParams.get('id'))); }
      catch (error) { return json(error.status || 503, { error: error.message }); }
    }
    if (route === '/api/device/info') {
      try { return json(200, await deviceControl.info(new URL(req.url, `http://${req.headers.host}`).searchParams.get('id'))); }
      catch (error) { return json(error.status || 503, { error: error.message }); }
    }
    if (route === '/api/device/app-users') {
      try { return json(200,await deviceControl.users(new URL(req.url,`http://${req.headers.host}`).searchParams.get('id'))); }
      catch(error){return json(error.status||503,{error:error.message});}
    }
    if (route === '/api/device/inventory' || route === '/api/device/apps') {
      try { const method = route.endsWith('/apps') ? deviceControl.apps : deviceControl.inventory,params=new URL(req.url, `http://${req.headers.host}`).searchParams; return json(200, await method(params.get('id'),{restorable:params.get('restorable')==='1',user:params.get('user')||'current'})); }
      catch (error) { return json(error.status || 503, { error: error.message }); }
    }
    if (route === '/api/devices') {
      if (!readDevices) return json(503, { error: adbError, updatedAt: new Date().toISOString() });
      try { return json(200, await readDevices()); } catch (error) { return json(503, { error: error.message, updatedAt: new Date().toISOString() }); }
    }
    const extensionAsset=resolveExtensionAsset(route);
    if(extensionAsset){try{const body=await readFile(extensionAsset.file);res.writeHead(200,{'Content-Type':extensionAsset.contentType,'Content-Length':body.length});return res.end(req.method==='HEAD'?undefined:body);}catch{return json(404,{error:'확장 파일을 찾을 수 없습니다.'});}}
    const asset = assets.get(route);
    if (!asset) return json(404, { error: '페이지를 찾을 수 없습니다.' });
    try {
      let body = await readFile(path.join(root, 'public', asset[0]));
      if(asset[0]==='index.html')body=Buffer.from(body.toString('utf8').replace('</head>',`<meta name="adb-style-nonce" content="${styleNonce}"></head>`));
      res.writeHead(200, { 'Content-Type': asset[1], 'Content-Length': body.length });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch { json(500, { error: '페이지 파일을 읽을 수 없습니다.' }); }
  });
  server.requestTimeout = 15 * 60 * 1000;
  server.headersTimeout = 10000;
  if (deviceControl && adbPath){mirrors=attachMirroring({ server, root, adbPath, deviceControl, csrfToken, access });mirrorReady=Promise.resolve(mirrors.media?.setActivity?.(operations?.activity));}
  if (deviceControl && adbPath) attachShell({server,adbPath,deviceControl,csrfToken,access});
  if (deviceControl && adbPath) attachLiveLogs({server,adbPath,deviceControl,csrfToken,access});
  server.on('close', () => {server.cleanupPromise=Promise.allSettled([operations?.close(),mirrorReady.then(()=>mirrors?.media?.close())]);});
  server.once('listening', () => operations?.start());
  return server;
}
