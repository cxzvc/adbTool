import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { ActionError } from './connections.mjs';
const execute = promisify(execFile);
import { SETTINGS, CATEGORIES,settingsForDevice } from './settings-catalog.mjs';
import { createInventory, parseSettingList } from './inventory.mjs';
import { acquireSettingsMutation } from './settings-lock.mjs';
import { applyFirmwareSettingReview, firmwareReviewSummary, settingWriteNeedsReview, settingWriteRestriction } from './firmware-setting-review.mjs';
import {createPrivacyIndicators} from './privacy-indicators.mjs';
import {createDeviceConfigWriteAccessReader} from './deviceconfig-write-access.mjs';
import {createGpsIndicator} from './gps-indicator.mjs';
import {createUserProfileHelp} from './user-profile-help.mjs';
import {createFeatureHelpContext} from './feature-help-context.mjs';
import {compatibility} from './compatibility.mjs';
export { SETTINGS, CATEGORIES };

export function validateSetting(setting, value) {
  if (typeof value !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(value) || value.length > 15) throw new ActionError('설정값은 허용된 숫자로 입력해 주세요.');
  const number = Number(value);
  if (setting.options ? !setting.options.some(option => Number(option.value) === number) : number < setting.min || number > setting.max || Math.abs((number - setting.min) / setting.step - Math.round((number - setting.min) / setting.step)) > 0.00001) throw new ActionError('이 설정에서 허용하는 값의 범위를 확인해 주세요.');
  return value;
}

export function createDeviceControl({ adbPath, readDevices, executeCommand, activity,root }) {
  const histories = new Map();
  const command = executeCommand || (async (serial, args, options={}) => {
    const timeout=Math.min(30000,Math.max(1000,Number(options.timeout)||10000)),maxBuffer=Math.min(16*1024*1024,Math.max(1024,Number(options.maxBuffer)||1048576));
    try { const stdout=(await execute(adbPath, ['-s', serial, ...args], { windowsHide: true, timeout, maxBuffer, encoding: 'utf8' })).stdout;return options.preserveWhitespace?stdout:stdout.trim(); }
    catch (error) { throw new ActionError(error.killed ? '기기 응답 시간이 초과되었습니다.' : String(error.stderr || '기기에서 명령을 실행하지 못했습니다.').trim().slice(0, 300), 502); }
  });
  async function resolve(deviceId) {
    if (typeof deviceId !== 'string' || deviceId.length > 255) throw new ActionError('기기를 선택해 주세요.');
    const data = await readDevices();
    const device = data.devices.find(item => item.id === deviceId);
    const transport = device?.transports.find(item => item.state === 'device');
    if (!transport) throw new ActionError('기기가 연결되어 있지 않습니다. 연결 상태를 확인해 주세요.', 409);
    return { device, serial: transport.serial };
  }
  const getValue = async (serial, setting, user='current') => {
    const value = await command(serial, ['shell', 'settings', '--user', user, 'get', setting.namespace, setting.key]);
    if (value === 'null') {
      // Android prints "null" for both an absent key and that literal string.
      const listing = await command(serial, ['shell', 'settings', '--user', user, 'list', setting.namespace]);
      if (listing.split(/\r?\n/).some(line => line.startsWith(setting.key + '='))) throw new ActionError('이 설정에는 숫자가 아닌 문자열이 저장되어 있어 변경할 수 없습니다. 설정 탐색에서 값을 확인하세요.', 409);
      return null;
    }
    if (!/^-?\d+(?:\.\d+)?$/.test(value)) throw new ActionError('이 기기에서 설정값을 읽을 수 없습니다.', 502);
    return value;
  };
  const restorableNumber=value=>value===null||typeof value==='string'&&/^-?\d+(?:\.\d+)?$/.test(value)&&value.length<=64;
  function savedHistory(row){
    const d=row?.details;
    if(row?.kind!=='settings-curated'||row.state!=='success'||d?.verified!==true||!SETTINGS.some(setting=>setting.namespace===d.namespace&&setting.key===d.key))return null;
    const valid=restorableNumber(d.before)&&restorableNumber(d.after)&&/^\d{1,5}$/.test(String(d.userId));
    return {id:row.id,key:d.key,namespace:d.namespace,userId:d.userId,title:SETTINGS.find(setting=>setting.key===d.key).title,before:d.before,after:d.after,at:row.createdAt,undone:d.undone===true,undoEligible:valid&&d.undoEligible!==false,undoReason:valid?d.undoReason||null:'저장된 변경값 또는 사용자를 정확히 확인할 수 없습니다.'};
  }
  async function loadHistory(deviceId,wantedId){
    if(!activity)return histories.get(deviceId)||[];
    const data=await activity.list({deviceId,kind:'settings-curated',state:'success',limit:100});
    const rows=data.items.map(savedHistory).filter(Boolean);
    if(wantedId&&!rows.some(row=>row.id===wantedId)){try{const row=savedHistory(await activity.get(wantedId,deviceId));if(row)rows.push(row);}catch(error){if(error.status!==404)throw error;}}
    histories.set(deviceId,rows.slice(0,20));return rows;
  }
  async function recordSetting(deviceId,row,state,kind='settings-curated'){
    if(!activity)return;
    return activity.record({id:row.id,deviceId,kind,title:row.title,createdAt:row.at,finishedAt:state==='running'?null:row.finishedAt||new Date().toISOString(),state,history:{namespace:row.namespace,key:row.key,userId:row.userId,target:{namespace:row.namespace,key:row.key,userId:row.userId},before:row.before,after:row.after,beforeExists:row.before!==null,afterExists:row.after!==null,verified:state==='success',undone:row.undone===true,undoEligible:state==='success'&&kind==='settings-curated'&&row.undoEligible!==false,undoReason:row.undoReason||null,...(row.undoOf?{undoOf:row.undoOf}:{})}});
  }
  async function read(deviceId) {
    const { device, serial } = await resolve(deviceId);
    const userId = (await command(serial, ['shell', 'am', 'get-current-user'])).trim();
    if (!/^(?:0|[1-9]\d{0,4})$/.test(userId)) throw new ActionError('현재 사용자 번호를 확인하지 못해 설정을 표시하지 않았습니다. 다시 조회하세요.', 409);
    const namespaces = ['system', 'secure', 'global'];
    const fingerprint = await command(serial, ['shell', 'getprop', 'ro.build.fingerprint']).catch(() => '');
    const results = await Promise.allSettled(namespaces.map(async namespace => parseSettingList(await command(serial, ['shell', 'settings', '--user', userId, 'list', namespace]), namespace, fingerprint.trim())));
    const listing = { entries: results.flatMap(result => result.status === 'fulfilled' ? result.value : []), errors: results.flatMap((result, index) => result.status === 'rejected' ? [`${namespaces[index]}: ${result.reason.message}`] : []) };
    const values = new Map(listing.entries.map(item => [`${item.namespace}:${item.key}`, item.value]));
    const items = settingsForDevice(device).map(setting => {
      const error = listing.errors.find(error => error.startsWith(`${setting.namespace}:`));
      const raw = values.get(`${setting.namespace}:${setting.key}`);
      const value = raw === undefined ? null : raw;
      const numeric = value === null || /^-?\d+(?:\.\d+)?$/.test(value);
      const manufacturerKnown=typeof device.manufacturer==='string'&&device.manufacturer.trim().length>0;
      const match = !setting.manufacturer || manufacturerKnown&&device.manufacturer.toLowerCase().includes(setting.manufacturer);
      const reviewed = applyFirmwareSettingReview(setting, setting.namespace, setting.key, fingerprint.trim());
      const unavailable = reviewed.firmwareReview?.unsupported === true;
      const restriction=settingWriteRestriction(setting.namespace,setting.key,fingerprint.trim(),device)||(!fingerprint.trim()&&settingWriteNeedsReview(setting.namespace,setting.key,device)?{label:'현재 빌드 확인 필요 · 조회 전용',reason:'현재 펌웨어를 확인하지 못해 이 설정의 변경 제한을 대조할 수 없습니다. 현재 상태를 다시 조회하세요.'}:null);
      const writeBlocked=!!restriction;
      const available = !error && numeric && match && !unavailable && !writeBlocked && (!setting.requiresExisting || value !== null);
      const support=error?'조회 실패':!numeric?'값 형식 확인 필요':!match?manufacturerKnown?'다른 제조사 전용':'제조사 확인 필요':unavailable?'현재 빌드 미지원 확인 · 조회 전용':writeBlocked?restriction.label:!available?'저장 키 없음 · 지원 여부 미확정':value===null?'기본값 사용 · 효과 미시험':'저장값 조회됨 · 효과 미시험';
      const assessment=compatibility({support:!match&&manufacturerKnown||unavailable?'unsupported':'unknown',access:error&&/permission|denied|권한/i.test(error)?'denied':'unknown',evidence:reviewed.compatibility?.evidence.state||'unverified',reasonKo:restriction?.reason||support,alternative:restriction?.alternative||null,readable:!error&&numeric,writeAllowed:available,source:reviewed.compatibility?.source||null});
      return {...reviewed,value,available:assessment.canWrite,readable:assessment.canRead,error,support,compatibility:assessment};
    });
    await loadHistory(deviceId);
    if ((await command(serial, ['shell', 'am', 'get-current-user'])).trim() !== userId) throw new ActionError('조회 중 사용자가 전환되어 설정을 표시하지 않았습니다. 다시 조회하세요.', 409);
    return { device, userId, categories: CATEGORIES, settings: items, firmwareReview: firmwareReviewSummary(items, fingerprint.trim()), history: histories.get(deviceId) || [], updatedAt: new Date().toISOString() };
  }
  async function mutate(body) {
    if (!body || !['set', 'undo'].includes(body.action)) throw new ActionError('설정 작업을 확인해 주세요.');
    const hasExpectedUser=Object.hasOwn(body,'expectedUserId');
    if(hasExpectedUser&&(typeof body.expectedUserId!=='string'||!/^(?:0|[1-9]\d{0,4})$/.test(body.expectedUserId)))throw new ActionError('미리 확인한 사용자 번호가 올바르지 않습니다.');
    const { deviceId } = body;
    const releaseMutation = acquireSettingsMutation(deviceId);
    try {
      const { serial, device } = await resolve(deviceId);
      const history = await loadHistory(deviceId,body.action==='undo'?body.historyId:null);
      const undo = body.action === 'undo' ? history.find(item => item.id === body.historyId && !item.undone) : null;
      const setting = settingsForDevice(device).find(item => item.key === (undo?.key || body.key));
      if (!setting || (body.action === 'undo' && !undo)) throw new ActionError('지원하는 설정을 선택해 주세요.');
      if(undo?.undoEligible===false)throw new ActionError(undo.undoReason||'이 기록은 변경 전 값을 정확히 복원할 수 없습니다.',409);
      const value = undo ? undo.before : validateSetting(setting, body.value);
      const pinUser=Boolean(activity)||hasExpectedUser;
      const userId=pinUser?(await command(serial,['shell','am','get-current-user'])).trim():'current';
      if(pinUser&&!/^\d{1,5}$/.test(userId))throw new ActionError('현재 사용자 번호를 확인하지 못해 변경하지 않았습니다.',409);
      if(hasExpectedUser&&userId!==body.expectedUserId)throw new ActionError('미리 확인한 사용자와 현재 사용자가 달라 적용하지 않았습니다. 다시 미리보기를 실행하세요.',409);
      if(undo?.userId!==undefined&&undo.userId!==userId)throw new ActionError('변경 당시 사용자와 현재 사용자가 다릅니다. 같은 사용자에서 복원하세요.',409);
      if(settingWriteNeedsReview(setting.namespace,setting.key,device)){
        const fingerprint=await command(serial,['shell','getprop','ro.build.fingerprint']);
        if(!fingerprint.trim())throw new ActionError('현재 펌웨어를 확인하지 못해 이 설정을 변경하지 않았습니다.',409);
        const restriction=settingWriteRestriction(setting.namespace,setting.key,fingerprint.trim(),device);
        if(restriction)throw new ActionError(`${restriction.label}: ${restriction.reason}${restriction.alternative?' 대체 항목: '+restriction.alternative:''}`,409);
      }
      const before = await getValue(serial, setting,userId);
      if(setting.manufacturer&&!device.manufacturer?.trim())throw new ActionError('현재 제조사를 확인하지 못해 제조사 전용 설정을 변경하지 않았습니다. 기기 정보를 다시 조회하세요.',409);
      if (setting.manufacturer && !device.manufacturer?.toLowerCase().includes(setting.manufacturer)) throw new ActionError('이 설정은 다른 제조사의 기기 전용입니다.');
      if (setting.requiresExisting && before === null && !undo) throw new ActionError('이 기기에서는 해당 설정 키를 확인할 수 없습니다.');
      const expected = undo ? undo.after : body.expected;
      if (before !== expected) throw new ActionError('기기의 값이 다른 곳에서 변경되었습니다. 현재 값을 새로고침한 뒤 다시 적용해 주세요.', 409);
      if (value === before) return { ok: true, message: '이미 같은 값으로 설정되어 있습니다.', setting: { ...setting, value: before, available: true }, history };
      const args = ['shell', 'settings', '--user', userId, value === null ? 'delete' : 'put', setting.namespace, setting.key];
      if (value !== null) args.push(value);
      const intent={id:randomUUID(),namespace:setting.namespace,key:setting.key,userId,title:setting.title,before,after:value,at:new Date().toISOString(),undone:false,undoEligible:!undo&&restorableNumber(before)&&restorableNumber(value),...(undo?{undoOf:undo.id}:{})};
      const kind=undo?'settings-curated-undo':'settings-curated';
      await recordSetting(deviceId,intent,'running',kind);
      let after;
      try{
        if(pinUser){if((await command(serial,['shell','am','get-current-user'])).trim()!==userId)throw new ActionError('변경 직전에 사용자가 전환되어 적용하지 않았습니다.',409);if(await getValue(serial,setting,userId)!==before)throw new ActionError('기기의 값이 변경되어 적용하지 않았습니다. 다시 확인하세요.',409);}
        const response = await command(serial, args);
        if (/exception|permission denial|error:/i.test(response)) throw new ActionError('기기가 이 설정 변경을 허용하지 않았습니다.', 502);
        after = await getValue(serial, setting,userId);
        if (after !== value) throw new ActionError('설정값이 적용되지 않았거나 기기가 값을 다시 변경했습니다. 현재 값을 새로고침해 주세요.', 502);
        intent.after=after;intent.finishedAt=new Date().toISOString();
        await recordSetting(deviceId,intent,'success',kind);
      }catch(error){await recordSetting(deviceId,{...intent,undoEligible:false},'error',kind).catch(()=>{});throw error;}
      if (undo) {undo.undone = true;undo.undoEligible=false;undo.undoReason='이미 변경 전 값으로 복원한 기록입니다.';await recordSetting(deviceId,undo,'success');}
      else history.unshift(intent);
      histories.set(deviceId, history.slice(0, 20));
      return { ok: true, message: `${setting.title}: ${undo ? '변경 전 값으로 복원했습니다.' : '설정값을 저장하고 다시 읽어 확인했습니다.'}${setting.experimental && !undo ? ' 실제 카메라 동작은 별도 확인이 필요합니다.' : ''}`, setting: { ...setting, value: after, available: true, support: setting.experimental ? '실험 항목' : '값 조회됨' }, history: histories.get(deviceId) };
    } finally { releaseMutation(); }
  }
  async function info(deviceId) {
    const { device, serial } = await resolve(deviceId);
    const queries=[['배터리',['shell','dumpsys','battery']],['화면 크기',['shell','wm','size']],['화면 밀도',['shell','wm','density']],['가동 시간',['shell','cat','/proc/uptime']]];
    const results=await Promise.allSettled(queries.map(async([label,args])=>{const text=await command(serial,args);if(/^\s*(?:Permission Denial|Permission denied|SecurityException|Security exception|Error:|Can't find service)/im.test(text))throw new ActionError(label+' 조회 권한 또는 기기 지원을 확인하세요. '+text.slice(-1000),403);return text;}));
    const value=i=>results[i].status==='fulfilled'?results[i].value:'',fields={};
    for(const line of value(0).split(/\r?\n/)){const match=/^\s*([\w ]+):\s*(.+)$/.exec(line);if(match)fields[match[1].trim()]=match[2].trim();}
    const numeric=key=>fields[key]!==undefined&&fields[key]!==''&&Number.isFinite(Number(fields[key]))?Number(fields[key]):null;
    const level=numeric('level'),scale=numeric('scale'),temperature=numeric('temperature'),uptimeText=value(3).trim().split(/\s+/)[0],uptime=uptimeText?Number(uptimeText):NaN;
    return{device,battery:{level,scale,percent:level!==null&&scale>0&&level>=0&&level<=scale?level/scale*100:null,temperature:temperature!==null&&temperature>=-500&&temperature<=1500?temperature/10:null,voltage:numeric('voltage'),status:fields.status??null,usb:fields['USB powered']??null,ac:fields['AC powered']??null,wireless:fields['Wireless powered']??null},size:value(1)||null,density:value(2)||null,uptimeSeconds:Number.isFinite(uptime)&&uptime>=0?uptime:null,unavailable:results.flatMap((r,i)=>r.status==='rejected'?[queries[i][0]+': '+r.reason.message]:[]),updatedAt:new Date().toISOString()};
  }

  async function tool(body) {
    const destinations = { settings: 'android.settings.SETTINGS', display: 'android.settings.DISPLAY_SETTINGS', sound: 'android.settings.SOUND_SETTINGS', wifi: 'android.settings.WIFI_SETTINGS', bluetooth: 'android.settings.BLUETOOTH_SETTINGS', battery: 'android.intent.action.POWER_USAGE_SUMMARY', apps: 'android.settings.APPLICATION_SETTINGS', developer: 'android.settings.APPLICATION_DEVELOPMENT_SETTINGS', deviceinfo: 'android.settings.DEVICE_INFO_SETTINGS' };
    if (!body || !Object.hasOwn(destinations, body.target)) throw new ActionError('지원하는 설정 화면을 선택해 주세요.');
    const { serial } = await resolve(body.deviceId);
    const result = await command(serial, ['shell', 'am', 'start', '-a', destinations[body.target]]);
    if (/error:|exception|unable to resolve/i.test(result)) throw new ActionError('이 기기에서 해당 설정 화면을 열지 못했습니다.', 502);
    return { ok: true, message: '폰에 설정 화면 열기를 요청했습니다. 잠겨 있으면 폰에서 잠금을 해제하세요.' };
  }
  const inventory = createInventory({ resolve, command,root });
  const privacyIndicators=createPrivacyIndicators({resolve,command,activity,root,readWriteAccess:createDeviceConfigWriteAccessReader({command})});
  const gpsIndicator=createGpsIndicator({resolve,command,activity,root});
  const userProfileHelp=createUserProfileHelp({resolve,command});
  const featureHelp=createFeatureHelpContext({resolve,command,readDevices});
  return { resolve, read, mutate, info, tool, featureHelpRead:featureHelp.read,userProfileHelpRead:userProfileHelp.read,gpsIndicatorRead:gpsIndicator.read,gpsIndicatorMutate:gpsIndicator.mutate,privacyIndicatorsRead:privacyIndicators.read,privacyIndicatorsMutate:privacyIndicators.mutate,setActivity(value){activity=value;histories.clear();privacyIndicators.setActivity(value);gpsIndicator.setActivity(value);},inventory: inventory.settings, apps: inventory.apps, users: inventory.users, appAction: inventory.appAction };
}
