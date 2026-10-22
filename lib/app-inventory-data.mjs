import { ActionError } from './connections.mjs';

const packagePattern = /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/;
const integer = value => /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
export function inventoryUser(value) {
  if (value == null || value === '' || value === 'current') return 'current';
  if (!/^\d{1,5}$/.test(String(value))) throw new ActionError('사용자·프로필을 목록에서 선택하세요.');
  return String(Number(value));
}

export function parseInventoryUsers(output, currentUserId = null) {
  const result = new Map();
  for (const line of String(output).split(/\r?\n/)) {
    const match = /UserInfo\{(\d+):(.+):([0-9a-fA-F]+)\}(.*)/.exec(line);
    if (!match) continue;
    const id = String(Number(match[1])), flags = parseInt(match[3], 16);
    result.set(id, { id, name: match[2], current: id === String(currentUserId), running: /\brunning\b/.test(match[4]), managed: Boolean(flags & 0x20), guest: Boolean(flags & 0x4), restricted: Boolean(flags & 0x8) });
  }
  return [...result.values()].sort((a,b) => Number(a.id) - Number(b.id));
}

// pm list packages -f -U --show-versioncode. Split at the last '=' because APK
// installation directories themselves can contain '=' characters.
export function parsePackageMetadata(output) {
  const result = new Map();
  for (const line of String(output).split(/\r?\n/)) {
    const match = /^package:(\S+)(.*)$/.exec(line.trim()); if (!match) continue;
    const pair = match[1], split = pair.lastIndexOf('='), name = split < 0 ? pair : pair.slice(split+1);
    if (!packagePattern.test(name)) continue;
    result.set(name, { package: name, codePath: split < 0 ? null : pair.slice(0, split), uid: integer(/\buid:(\d+)\b/.exec(match[2])?.[1]), versionCode: /\bversionCode:(\d+)\b/.exec(match[2])?.[1] || null });
  }
  return result;
}

export function parsePackageInventoryDump(output, userId = null) {
  const result = new Map(), headers = [...String(output).matchAll(/^([ \t]*)Package \[([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)\][^\r\n]*$/gm)];
  for (let i=0; i<headers.length; i++) {
    const header=headers[i], text=output.slice(header.index,headers[i+1]?.index ?? output.length), name=header[2];
    // Hidden system-package copies are not installed versions. First package wins.
    if (result.has(name)) continue;
    const field = key => new RegExp('^\\s*'+key+'=([^\\r\\n]*)','m').exec(text)?.[1]?.trim() || null;
    const userLine = userId == null ? null : new RegExp('^\\s*User '+userId+':([^\\r\\n]*)','m').exec(text)?.[1];
    const splitValue=field('splits') || field('splitNames');
    const splitNames=splitValue==null?null:splitValue.replace(/^\[|\]$/g,'').split(',').map(value=>value.trim()).filter(value=>value && value!=='null' && value!=='base');
    const label=field('nonLocalizedLabel');
    const versionCode=/^\s*versionCode=(\d+)/m.exec(text)?.[1] || null;
    const appFlags=/^\s*(?:flags|pkgFlags)=\[([^\]]*)\]/m.exec(text)?.[1];
    const userFlag=key=>{const value=new RegExp('\\b'+key+'=(true|false)\\b').exec(userLine||'')?.[1];return value===undefined?null:value==='true';};
    const row={ versionName:field('versionName'), versionCode, label:label && label!=='null' ? label.replace(/^['"]|['"]$/g,'') : null,
      labelSource:label && label!=='null'?'기기 패키지의 nonLocalizedLabel':null,
      firstInstallTime:field('firstInstallTime'), lastUpdateTime:field('lastUpdateTime'),
      splitNames, splitCount:splitNames?.length ?? null,
      allowBackup:appFlags===undefined?null:/\bALLOW_BACKUP\b/.test(appFlags),allowBackupSource:appFlags===undefined?null:'패키지 ApplicationInfo ALLOW_BACKUP 플래그',
      suspended:userFlag('suspended'),stopped:userFlag('stopped'),installedForUser:userFlag('installed'),
      targetSdk:integer(/\btargetSdk=(\d+)/.exec(text)?.[1]), minSdk:integer(/\bminSdk=(\d+)/.exec(text)?.[1]) };
    // Some builds store install time under a User block: use only selected user.
    if (userId != null) {
      const match=new RegExp('^([ \\t]*)User '+userId+':[^\\r\\n]*','m').exec(text);
      if(match){const rest=text.slice(match.index+match[0].length),next=/^\s*User \d+:/m.exec(rest),block=next?rest.slice(0,next.index):rest;
        row.firstInstallTime=/^\s*firstInstallTime=([^\r\n]*)/m.exec(block)?.[1]?.trim() || (text.slice(0,match.index).match(/^\s*firstInstallTime=([^\r\n]*)/m)?.[1]?.trim() ?? null);}
    }
    result.set(name,row);
  }
  return result;
}

export function parseLauncherPackages(output) {
  if (/^(?:Error|Exception|Unknown|Failure|Security exception|Permission)/im.test(output)) return null;
  const names=new Set();
  for(const line of String(output).split(/\r?\n/)){const match=/^\s*([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)\/[A-Za-z0-9_.$]+\s*$/.exec(line);if(match)names.add(match[1]);}
  // An empty successful output can mean zero launchable activities.
  return names;
}

export function parseCachedAppSizes(output, userId) {
  // AOSP DiskStatsFileLogger.filterOnlyPrimaryUser explicitly keeps user 0.
  if(String(userId)!=='0')return new Map();
  const fields={};
  for(const [name,label] of Object.entries({names:'Package Names',app:'App Sizes',data:'App Data Sizes',cache:'Cache Sizes'})) {
    const raw=new RegExp('^'+label+':\\s*(\\[[^\\r\\n]*\\])\\s*$','m').exec(output)?.[1];
    try { fields[name]=raw?JSON.parse(raw):null; } catch { return new Map(); }
  }
  if(!Array.isArray(fields.names)||!['app','data','cache'].every(key=>Array.isArray(fields[key])&&fields[key].length===fields.names.length))return new Map();
  const result=new Map();
  fields.names.forEach((name,i)=>{if(!packagePattern.test(name))return;const values=[fields.app[i],fields.data[i],fields.cache[i]];if(values.some(value=>typeof value!=='number'||!Number.isSafeInteger(value)||value<0))return;
    if(!Number.isSafeInteger(values[0]+values[1]))return;
    result.set(name,{appBytes:values[0],apkBytes:null,dataBytes:values[1],cacheBytes:values[2],storageBytes:values[0]+values[1],sizeSource:'Android 저장소 통계 캐시 · 사용자 0 · 코드 전체는 APK만의 크기와 다름 · 앱 데이터에 캐시 포함',sizeCached:true});});
  return result;
}

// Read the file already written by Android's scheduled collector. Invoking
// dumpsys diskstats can itself run a write benchmark on the connected phone.
export function parseCachedAppSizeFile(output,userId,now=Date.now()) {
  if(String(userId)!=='0'||typeof output!=='string'||output.length>4*1024*1024)return new Map();
  let data;try{data=JSON.parse(output);}catch{return new Map();}
  if(!data||Array.isArray(data)||!Number.isSafeInteger(data.queryTime)||data.queryTime<=0||data.queryTime>now+60000)return new Map();
  const arrays=['packageNames','appSizes','appDataSizes','cacheSizes'];
  if(!arrays.every(key=>Array.isArray(data[key]))||data.packageNames.length>20000||new Set(data.packageNames).size!==data.packageNames.length)return new Map();
  const labels=['Package Names','App Sizes','App Data Sizes','Cache Sizes'];
  const rows=parseCachedAppSizes(arrays.map((key,i)=>labels[i]+': '+JSON.stringify(data[key])).join('\n'),'0');
  const cacheUpdatedAt=new Date(data.queryTime).toISOString();
  for(const row of rows.values())Object.assign(row,{sizeKind:'diskstats-cache',storageStatus:'cached',sizeCacheUpdatedAt:cacheUpdatedAt,sizeSource:'기존 Android 통계 파일 · 사용자 0의 과거 참고값 · 현재 앱 버전과의 일치는 확인하지 못함'});
  return rows;
}
