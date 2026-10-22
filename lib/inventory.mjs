import { settingHelp } from './setting-help.mjs';
import { applyFirmwareSettingReview, firmwareReviewSummary } from './firmware-setting-review.mjs';
import { ActionError } from './connections.mjs';
import { lookupAppKnowledge } from './app-knowledge.mjs';
import {compatibility} from './compatibility.mjs';
import { getCachedAppLabels, applyCachedAppLabel } from './app-labels.mjs';
import { getCachedAppUsage,getCachedAppStorage } from './app-insights.mjs';
import { inventoryUser, parseInventoryUsers, parsePackageMetadata, parsePackageInventoryDump, parseLauncherPackages, parseCachedAppSizeFile } from './app-inventory-data.mjs';
export function parseSettingList(output, namespace, fingerprint = '') {
  return output.split(/\r?\n/).flatMap(line => {
    const match = /^([A-Za-z0-9_.:-]+)=(.*)$/.exec(line); if (!match) return [];
    const [, key, raw] = match;
    const sensitive = /password|passwd|passcode|secret|token|android_id|bluetooth_address|wifi.*(?:ssid|key)|account|auth_|(?:^|[_.])pin(?:$|_code$)|_pin$/.test(key.toLowerCase());
    const help = applyFirmwareSettingReview(settingHelp(key, namespace,{fingerprint}), namespace, key, fingerprint);
    const provenance = help.sourceFingerprint ? { sourceMatchesDevice: fingerprint === help.sourceFingerprint, codeBuildNote: fingerprint === help.sourceFingerprint ? '현재 기기와 분석 빌드 일치' : `이 설명은 ${help.sourceModel||'이전 기기'} · ${help.sourceBuild||'이전 빌드'}에서 분석한 참고 자료입니다. 현재 빌드와의 일치는 확인되지 않았습니다.` } : {};
    const assessment=help.compatibility||compatibility({evidence:help.sourceFingerprint===fingerprint&&fingerprint?'current':help.sourceFingerprint?'previous':'unverified',reasonKo:'저장값을 읽었습니다. 값 존재는 기능 지원·변경 권한·실제 효과의 증거가 아닙니다.'});
    return [{ ...help, ...provenance,compatibility:{...assessment,canRead:true}, key, namespace, value: sensitive ? '민감값 숨김' : raw, redacted: sensitive }];
  });
}
export function packageNames(output) {
  return [...new Set(output.split(/\r?\n/).flatMap(line => /^package:([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)$/.exec(line.trim())?.slice(1) || []))];
}
export function createInventory({ resolve, command, root }) {
  async function userContext(serial, value = 'current') {
    const requested = inventoryUser(value), errors = [];
    const results = await Promise.allSettled([command(serial,['shell','pm','list','users']),command(serial,['shell','am','get-current-user'])]);
    const current = results[1].status === 'fulfilled' && /^\d{1,5}$/.test(results[1].value.trim()) ? String(Number(results[1].value.trim())) : null;
    const users = results[0].status === 'fulfilled' ? parseInventoryUsers(results[0].value,current) : [];
    if(!current)errors.push('현재 사용자 ID를 확인하지 못했습니다. current 범위로만 조회합니다.');
    if(!users.length)errors.push('사용자·프로필 목록을 확인하지 못했습니다.');
    if(requested!=='current' && !users.some(row=>row.id===requested))throw new ActionError('기기에 존재하는 사용자·프로필을 목록에서 선택하세요.',409);
    return {userId:requested==='current'?current||'current':requested,currentUserId:current,users,errors};
  }
  async function users(deviceId) { const {serial}=await resolve(deviceId); return {...await userContext(serial),updatedAt:new Date().toISOString()}; }
  async function settings(deviceId) {
    const { serial } = await resolve(deviceId);
    const namespaces = ['system', 'secure', 'global'];
    const fingerprint = await command(serial, ['shell','getprop','ro.build.fingerprint']).catch(()=> '');
    const results = await Promise.allSettled(namespaces.map(async namespace => parseSettingList(await command(serial, ['shell', 'settings', '--user', 'current', 'list', namespace]), namespace, fingerprint.trim())));
    const entries = results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
    return { entries, firmwareReview: firmwareReviewSummary(entries, fingerprint.trim()), errors: results.flatMap((result, index) => result.status === 'rejected' ? [`${namespaces[index]}: ${result.reason.message}`] : []), updatedAt: new Date().toISOString() };
  }
  async function apps(deviceId, options = {}) {
    const { serial } = await resolve(deviceId);
    const context=await userContext(serial,options.user),user=context.userId,errors=[...context.errors];
    if(options.restorable){const [all,installed]=await Promise.all([command(serial,['shell','pm','list','packages','--user',user,'-s','-u']),command(serial,['shell','pm','list','packages','--user',user])]);const present=new Set(packageNames(installed));return {...context,apps:packageNames(all).filter(name=>!present.has(name)).sort().map(name=>({package:name,kind:'system',enabled:false,restorable:true})),updatedAt:new Date().toISOString()};}
    // One package metadata dump and one launcher query serve the whole list.
    // Do not pull every APK or issue one ADB command per installed package.
    const requests=[
      ['목록',()=>command(serial,['shell','pm','list','packages','--user',user])],
      ['사용자 앱 분류',()=>command(serial,['shell','pm','list','packages','--user',user,'-3'])],
      ['비활성 앱 분류',()=>command(serial,['shell','pm','list','packages','--user',user,'-d'])],
      ['앱 UID·버전',()=>command(serial,['shell','pm','list','packages','--user',user,'-f','-U','--show-versioncode'])],
      ['앱 설치 정보',()=>command(serial,['shell','dumpsys','package','packages'],{timeout:30000,maxBuffer:16*1024*1024})],
      ['실행 화면',()=>command(serial,['shell','cmd','package','query-activities','--brief','--components','--user',user,'-a','android.intent.action.MAIN','-c','android.intent.category.LAUNCHER'])],
      ['저장소 캐시',()=>user==='0'?command(serial,['shell','cat','/data/system/diskstats_cache.json'],{timeout:15000,maxBuffer:4*1024*1024}):Promise.resolve('')],
    ];
    const outputs=[];
    // At most three concurrent reads, even with thousands of installed packages.
    let next=0; await Promise.all(Array.from({length:3},async()=>{while(next<requests.length){const index=next++,entry=requests[index];try{const output=await entry[1]();if(/^(?:Error(?: type \d+)?:|Failure|Exception|Security exception|Permission Denial|Unknown (?:option|command))/im.test(output))throw new Error(output.trim().slice(0,200));outputs[index]=output;}catch(error){outputs[index]=null;errors.push(index===6?'기존 용량 통계 파일을 읽지 못했습니다. 시스템 전용 파일이거나 아직 수집된 통계가 없어, 해당 용량은 미확인으로 둡니다. 권한을 바꾸거나 새 통계를 생성하지 않습니다.':`${entry[0]}: ${error.message}`);}}}));
    if(outputs[0]===null)throw new ActionError('선택한 사용자에서 앱 목록을 읽지 못했습니다.',502);
    const userApps=outputs[1]===null?null:new Set(packageNames(outputs[1])),disabled=outputs[2]===null?null:new Set(packageNames(outputs[2]));
    const metadata=parsePackageMetadata(outputs[3]||''),details=parsePackageInventoryDump(outputs[4]||'',/^\d+$/.test(user)?user:null),launchers=outputs[5]===null?null:parseLauncherPackages(outputs[5]),sizes=parseCachedAppSizeFile(outputs[6]||'',user);
    const labelCache=await getCachedAppLabels(deviceId,user,root?{root}:{}),usage=getCachedAppUsage(deviceId,user),liveStorage=getCachedAppStorage(deviceId,user);
    const entries=await Promise.all(packageNames(outputs[0]).sort().map(async name=>{
      let knowledge;try{const data=await lookupAppKnowledge(name,root?{root}:{});knowledge={found:data.found,title:data.title,summary:data.summaryKo,category:data.category?.code||null,categoryLabel:data.category?.label||null,removal:data.removal?.code||null,removalLabel:data.removal?.label||null,translationStatus:data.translationStatus,function:data.functionKo||null,removalImpact:data.removalImpactKo||null,alternative:data.alternativeKo||null,functionalExplanationStatus:data.functionalExplanationStatus||null,labels:data.labels||[]};}catch{knowledge={found:false,title:name,summary:'앱 설명 참고 자료 조회 실패',translationStatus:'unavailable'};}
      const fresh=liveStorage?.records.get(name),version=details.get(name)?.versionCode||metadata.get(name)?.versionCode;
      const directStorage=fresh&&((fresh.storageStatus==='unavailable'&&(!fresh.versionCode||fresh.versionCode===version))||(fresh.versionCode&&fresh.versionCode===version))?fresh:null;
      const sizeRecord=directStorage||sizes.get(name);
      // Storage failures clear size observations, never newer installation identity.
      const {package:storagePackage,versionCode:storageVersion,...sizeFields}=sizeRecord||{};
      return applyCachedAppLabel({package:name,kind:userApps?userApps.has(name)?'user':'system':'unknown',enabled:disabled?!disabled.has(name):null,userId:user,
        codePath:null,uid:null,versionCode:null,versionName:null,label:null,labelSource:null,firstInstallTime:null,lastUpdateTime:null,splitNames:null,splitCount:null,
        appBytes:null,apkBytes:null,dataBytes:null,cacheBytes:null,storageBytes:null,optimizedBytes:null,sizeSource:null,sizeCached:false,sizeKind:null,storageStatus:'unknown',sizeIssue:null,sizeCheckedAt:null,sizeCacheUpdatedAt:null,
        ...metadata.get(name),...details.get(name),...sizeFields,lastUsedAt:null,lastUsedTimestamp:null,usageStatus:'unknown',...usage?.records.get(name),launchable:launchers?launchers.has(name):null,knowledge},labelCache);
    }));
    return {...context,apps:entries,errors,compatibility:compatibility({support:'supported',access:'allowed',readable:true,reasonKo:'현재 사용자의 패키지 목록을 읽었습니다. 앱별 상세 조회·권한 변경·삭제 가능 여부는 별도로 확인합니다.'}),usageCheckedAt:usage?.checkedAt||null,usageNote:usage?.note||'최근 사용 기록은 명시적으로 조회한 뒤 표시됩니다.',sourceNotes:['앱 이름은 기기가 실제 문자열을 제공한 경우만 표시합니다. 참고 설명 제목은 앱의 표시 이름과 다릅니다.','기본 용량은 읽기가 허용된 기존 통계 파일에 있는 사용자 0의 과거 참고값입니다. 캐시 작성 시각과 현재 앱 버전의 일치는 별개입니다. 새 통계 수집이나 성능 검사는 실행하지 않습니다.','선택 앱 용량은 해당 프로필의 StorageStats 직접 조회를 우선합니다. 제한되면 읽을 수 있는 APK 파일 크기만 별도로 표시하며, 앱 데이터·캐시·최적화 파일이 포함된 전체 사용량으로 표시하지 않습니다.','앱 데이터 크기에 캐시가 포함되어 있으므로 합계에 캐시를 다시 더하지 않습니다.'],updatedAt:new Date().toISOString()};
  }
  async function appAction(body) {
    if (!body || !['open', 'settings'].includes(body.action) || typeof body.package !== 'string' || body.package.length > 255 || !/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/.test(body.package)) throw new ActionError('앱과 작업을 확인해 주세요.');
    const { serial } = await resolve(body.deviceId);
    const requested=inventoryUser(body.user),user=requested==='current'?'current':(await userContext(serial,requested)).userId;
    const installed = packageNames(await command(serial, ['shell', 'pm', 'list', 'packages', '--user', user]));
    if (!installed.includes(body.package)) throw new ActionError('현재 기기에 설치된 앱을 선택해 주세요.', 409);
    let args;
    if (body.action === 'settings') args = ['shell', 'am', 'start', '--user',user,'-a', 'android.settings.APPLICATION_DETAILS_SETTINGS', '-d', `package:${body.package}`];
    else {
      const resolved = await command(serial, ['shell', 'cmd', 'package', 'resolve-activity', '--brief', '--user', user, '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.LAUNCHER', body.package]);
      const component = resolved.split(/\r?\n/).map(line => line.trim()).find(line => /^[A-Za-z0-9_.$]+\/[A-Za-z0-9_.$]+$/.test(line) && line.split('/')[0] === body.package);
      if (!component) throw new ActionError('이 앱에는 직접 열 수 있는 실행 화면이 없습니다. 앱 설정은 확인할 수 있습니다.', 409);
      args = ['shell', 'am', 'start', '--user',user,'-n', `'${component}'`];
    }
    const result = await command(serial, args);
    if (/error:|exception|unable to resolve/i.test(result)) throw new ActionError('앱 화면을 열지 못했습니다.', 502);
    return { ok: true, message: `${body.package}: ${body.action === 'open' ? '앱 실행' : '앱 설정 열기'}을 요청했습니다.` };
  }
  return { settings, apps, users, appAction };
}
