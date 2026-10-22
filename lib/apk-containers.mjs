import path from 'node:path';
import { access, mkdir, readdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { execFile } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import yauzl from 'yauzl';
import { ActionError } from './connections.mjs';

export const APK_LIMITS = { bytes: 2 * 1024 ** 3, entries: 4096, apks: 128, metadata: 1024 * 1024 };
export function archiveName(name) {
  if (typeof name !== 'string' || name.length > 1024 || /[\\\x00-\x1f\x7f:]/.test(name) || name.startsWith('/') || name.split('/').some(part => part === '..' || part === '.')) throw new ActionError('압축 파일에 허용되지 않는 경로가 있습니다.');
  return name;
}
/** Extract only APK payloads to generated names. Never use archive paths on the host. */
export async function extractApkContainer(file, directory) {
  await mkdir(directory, { recursive: true });
  return new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, zip) => {
    if (error) return reject(new ActionError('APK 묶음 압축을 읽지 못했습니다. 암호화·지원하지 않는 형식인지 확인하세요.'));
    const apks = [], names = new Set(), metadata = {}, skipped = [];
    let count = 0, declared = 0, actual = 0, settled = false;
    const fail = error => { if (!settled) { settled = true; zip.close(); reject(error); } };
    zip.on('error', fail);
    zip.on('entry', async entry => {
      try {
        const name = archiveName(entry.fileName), mode = (entry.externalFileAttributes >>> 16) & 0xf000;
        if (++count > APK_LIMITS.entries || names.has(name.toLowerCase()) || [0xa000, 0x6000, 0x2000, 0x1000, 0xc000].includes(mode) || entry.generalPurposeBitFlag & 1) throw new ActionError('압축 항목 중 중복 경로·링크·특수 파일·암호화 파일이 있습니다.');
        names.add(name.toLowerCase());
        declared += entry.uncompressedSize;
        if (declared > APK_LIMITS.bytes || entry.uncompressedSize > APK_LIMITS.bytes || entry.uncompressedSize > 1024 * 1024 && entry.uncompressedSize / Math.max(1, entry.compressedSize) > 1000) throw new ActionError('압축을 푼 크기 또는 압축률 한도를 초과했습니다.');
        if (name.endsWith('/')) { zip.readEntry(); return; }
        const isApk = /\.apk$/i.test(name), isMetadata = /(?:^|\/)(?:manifest|info)\.json$/i.test(name);
        if (!isApk && !isMetadata) { if (skipped.length < 40) skipped.push(name); zip.readEntry(); return; }
        if (isApk && apks.length >= APK_LIMITS.apks || isMetadata && entry.uncompressedSize > APK_LIMITS.metadata) throw new ActionError('APK 개수 또는 묶음 설명 파일이 너무 큽니다.');
        zip.openReadStream(entry, async (error, stream) => {
          if (error) return fail(error);
          try {
            const bound = new Transform({ transform(chunk, encoding, done) { actual += chunk.length; done(actual > APK_LIMITS.bytes ? new ActionError('압축 해제 크기 한도를 초과했습니다.') : null, chunk); } });
            if (isMetadata) {
              stream.on('error', error => bound.destroy(error));const chunks = []; for await (const chunk of stream.pipe(bound)) chunks.push(chunk);
              try { metadata[name] = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ActionError('APK 묶음의 JSON 설명을 읽지 못했습니다.'); }
            } else {
              const localPath = path.join(directory, `${String(apks.length).padStart(3, '0')}.apk`);
              await pipeline(stream, bound, createWriteStream(localPath, { flags: 'wx' }));
              apks.push({ name, localPath, size: entry.uncompressedSize });
            }
            zip.readEntry();
          } catch (error) { fail(error); }
        });
      } catch (error) { fail(error); }
    });
    zip.on('end', () => { if (settled) return; settled = true; apks.length ? resolve({ apks, metadata, skipped }) : reject(new ActionError('이 압축에 설치할 APK가 없습니다. 암호화 APKM·OBB 전용 묶음은 지원하지 않습니다.')); });
    zip.readEntry();
  }));
}

const attr = (line, key) => new RegExp(`(?:^|\\s)${key}='(.*?)'(?=\\s+[A-Za-z][A-Za-z0-9_-]*=|\\s*$)`).exec(line || '')?.[1] ?? null;
const values = line => [...String(line || '').matchAll(/'([^']*)'/g)].map(match => match[1]);
export function parseApkBadging(text) {
  const lines = String(text).split(/\r?\n/), find = prefix => lines.find(line => line.startsWith(prefix)), pkg = find('package:');
  const name = attr(pkg, 'name');
  if (!name || !/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/.test(name)) throw new ActionError('APK에서 패키지 정보를 확인하지 못했습니다.');
  const split = attr(pkg, 'split');
  return { package: name, versionCode: attr(pkg, 'versionCode'), versionName: attr(pkg, 'versionName'), split,
    label: /^application-label:'(.*)'$/.exec(find('application-label:')||'')?.[1] || attr(find('application:'), 'label') || null,
    localizedLabels: Object.fromEntries(lines.flatMap(line=>{const match=/^application-label-([^:]+):'(.*)'$/.exec(line);return match?[[match[1],match[2]]]:[];})),
    iconPaths: [...new Set([attr(find('application:'),'icon'),...lines.filter(line=>/^application-icon-\d+:/.test(line)).flatMap(values)].filter(Boolean))],
    minSdk: values(find('sdkVersion:'))[0] || null, targetSdk: values(find('targetSdkVersion:'))[0] || null,
    abis: values(find('native-code:')), locales: values(find('locales:')).filter(value => value !== '--_--'), densities: values(find('densities:')),
    permissions: [...new Set(lines.filter(line => /^uses-permission(?:-sdk-\d+)?:/.test(line)).map(line => attr(line, 'name')).filter(Boolean))] };
}
export function parseApkSignatures(text) { return [...new Set([...String(text).matchAll(/^Signer #\d+ certificate SHA-256 digest:\s*((?:[a-f\d]{2}:){31}[a-f\d]{2}|[a-f\d]{64})\s*$/gim)].map(match => match[1].replaceAll(':', '').toLowerCase()))].sort(); }
export function parseApkBackupDeclaration(text){
  const lines=String(text).split(/\r?\n/);let applicationIndent=null;
  for(const line of lines){
    if(applicationIndent===null){const node=/^(\s*)E: application(?:\s|$)/.exec(line);if(node)applicationIndent=node[1].length;continue;}
    if(/^\s*E:/.test(line))break;
    if(line.trim()&&line.search(/\S/)<=applicationIndent)break;
    if(!/\bandroid:allowBackup(?:\(|=)/.test(line))continue;
    if(/=(?:\(type 0x12\))?\s*(?:0xffffffff|true)(?:\s|$)/i.test(line))return true;
    if(/=(?:\(type 0x12\))?\s*(?:0x0+|false)(?:\s|$)/i.test(line))return false;
    return null;
  }
  return applicationIndent===null?null:true;
}
export function parseApkManifestVersion(text){
  const lines=String(text).split(/\r?\n/);let indent=null,minor=null,major=0n;
  for(const line of lines){if(indent===null){const header=/^(\s*)E: manifest(?:\s|$)/.exec(line);if(header)indent=header[1].length;continue;}if(/^\s*E:/.test(line)||line.trim()&&line.search(/\S/)<=indent)break;
    const match=/\bandroid:(versionCodeMajor|versionCode)(?:\(0x[0-9a-f]+\))?=(?:\(type 0x(?:10|11)\))?\s*(0x[0-9a-f]+|\d+)(?:\s|$)/i.exec(line);if(!match)continue;const value=BigInt(match[2]);if(value>0xffffffffn)return null;if(match[1]==='versionCode')minor=value;else major=value;
  }return minor===null?null:{versionCodeMinor:minor.toString(),versionCodeMajor:major.toString(),versionCode:((major<<32n)|minor).toString()};
}
export async function findApkTools(adbPath) {
  if (!adbPath) return {};
  const root = path.resolve(path.dirname(adbPath), '../build-tools'); let versions = []; try { versions = await readdir(root); } catch {}
  let aapt2, signer;
  for (const version of versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))) {
    for (const [kind, candidate] of [['aapt2', path.join(root, version, process.platform === 'win32' ? 'aapt2.exe' : 'aapt2')], ['signer', path.join(root, version, 'lib', 'apksigner.jar')]]) try { await access(candidate); if (kind === 'aapt2' && !aapt2) aapt2 = candidate; if (kind === 'signer' && !signer) signer = candidate; } catch {}
  }
  let java = 'java'; for (const candidate of [process.env.JAVA_HOME && path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'), path.resolve(path.dirname(adbPath), '../../jdk/bin', process.platform === 'win32' ? 'java.exe' : 'java')].filter(Boolean)) try { await access(candidate); java = candidate; break; } catch {}
  return { aapt2, signer, java };
}
export const runApkTool = (file,args,job) => new Promise((resolve,reject)=>{if(job?.cancelled)return reject(new ActionError('APK 분석을 취소했습니다.',409));const child=execFile(file,args,{windowsHide:true,timeout:90000,maxBuffer:2*1024*1024,encoding:'utf8'},(error,stdout,stderr)=>{if(job?.child===child)job.child=null;if(job?.cancelled)return reject(new ActionError('APK 분석을 취소했습니다.',409));error?reject(new Error((stderr||stdout||error.message).slice(-1000))):resolve(stdout);});if(job)job.child=child;});
const hostRun = (file,args) => runApkTool(file,args);
export async function inspectApk(localPath, tools, run = hostRun) {
  const result = { metadata: null, inspection: 'unavailable', signatureStatus: 'unavailable', issues: [] };
  if (!tools.aapt2) result.issues.push('PC Android SDK의 aapt2가 없어 앱 정보 분석을 생략했습니다.');
  else try { result.metadata = parseApkBadging(await run(tools.aapt2, ['dump', 'badging', localPath])); result.inspection = 'verified'; } catch (error) { result.inspection = 'invalid'; result.issues.push(`APK 정보 분석 실패: ${error.message}`); }
  if(result.metadata){result.metadata.allowBackup=null;try{const manifest=await run(tools.aapt2,['dump','xmltree',localPath,'--file','AndroidManifest.xml']);result.metadata.allowBackup=parseApkBackupDeclaration(manifest);Object.assign(result.metadata,parseApkManifestVersion(manifest)||{});}catch{result.issues.push('APK의 전체 버전 번호·백업 허용 선언을 확인하지 못했습니다.');}}
  if (!tools.signer) result.issues.push('PC Android SDK의 apksigner가 없어 서명 검증을 생략했습니다.');
  else try { const signatures = parseApkSignatures(await run(tools.java, ['-jar', tools.signer, 'verify', '--print-certs', localPath])); if (!signatures.length) throw new Error('서명 인증서 지문이 없습니다.'); result.signatureStatus = 'verified'; result.signatureSha256 = signatures; if (result.metadata) result.metadata.signatureSha256 = signatures; } catch (error) { result.signatureStatus = 'invalid'; result.issues.push(`APK 서명 검증 실패: ${error.message}`); }
  return result;
}
export function validateApkGroup(items, { partialPackage, allowUnverified = false } = {}) {
  if (items.some(item => item.inspection === 'invalid' || item.signatureStatus === 'invalid')) throw new ActionError('분석 또는 서명 검증에 실패한 APK는 설치할 수 없습니다.');
  if (!allowUnverified && items.some(item => item.inspection !== 'verified' || item.signatureStatus !== 'verified')) throw new ActionError('분석 도구가 없는 APK입니다. 미확인 정보로 수동 설치할지 확인하세요.');
  const known = items.map(item => item.metadata).filter(Boolean), packages = new Set(known.map(item => item.package)), versions = new Set(known.map(item => item.versionCode).filter(Boolean)), signatures = new Set(items.filter(item => item.signatureStatus === 'verified').map(item => JSON.stringify(item.signatureSha256 || item.metadata?.signatureSha256)));
  if (packages.size > 1 || versions.size > 1 || signatures.size > 1) throw new ActionError('같은 앱 그룹에 서로 다른 패키지·버전·서명이 섞였습니다. 앱별로 그룹을 나누세요.');
  if (partialPackage && known.some(item => item.package !== partialPackage)) throw new ActionError('추가할 분할 APK와 선택한 앱의 패키지가 다릅니다.');
  if (known.length === items.length) {
    const base = known.filter(item => !item.split), splits = known.map(item => item.split || '<base>');
    if (new Set(splits).size !== splits.length || !partialPackage && base.length !== 1) throw new ActionError('앱 그룹에는 기본 APK 하나와 중복되지 않는 분할 APK를 선택하세요.');
  }
  return { package: known[0]?.package || null, versionCode: known[0]?.versionCode || null };
}
