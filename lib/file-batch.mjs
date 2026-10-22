import path from 'node:path';
import { mkdir, readdir, lstat, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import yazl from 'yazl';
import { quote, remotePath } from './operations-core.mjs';
import { relativeFile,validatePortableNames } from './file-tools.mjs';
import { ActionError } from './connections.mjs';

const LIMIT = 2 * 1024 ** 3;
const PROTECTED = ['/system', '/vendor', '/product', '/odm', '/apex', '/proc', '/sys', '/dev', '/etc'];
function sharedEntry(value) {
  const p = remotePath(value).replace(/\/$/, '') || '/';
  if (!/^\/(?:sdcard\/[^/]+|storage\/(?:emulated\/\d+|[^/]+)\/[^/]+|data\/media\/\d+\/[^/]+|mnt\/media_rw\/[^/]+\/[^/]+)/.test(p) ||
      PROTECTED.some(root => p === root || p.startsWith(root + '/')) || /^\/storage\/(?:emulated|self)(?:\/|$)/.test(p) && !/^\/storage\/emulated\/\d+\/[^/]+/.test(p)) {
    throw new ActionError('여러 항목 변경은 공유 저장소 안의 파일·폴더만 지원합니다. 저장소 자체와 시스템 경로는 선택할 수 없습니다.');
  }
  return p;
}
export function validateFileBatch(body) {
  if (!['download', 'copy', 'move', 'delete'].includes(body.action)) throw new ActionError('묶음 파일 작업을 확인하세요.');
  if (!Array.isArray(body.paths) || !body.paths.length || body.paths.length > 100) throw new ActionError('같은 폴더에서 1~100개 항목을 선택하세요.');
  const paths = body.paths.map(remotePath);
  if (new Set(paths).size !== paths.length || new Set(paths.map(p => path.posix.dirname(p))).size !== 1) throw new ActionError('중복 없이 같은 폴더의 항목을 선택하세요.');
  if (paths.some(p => p === '/')) throw new ActionError('루트 폴더 전체는 묶음 작업할 수 없습니다.');
  const changes = body.action !== 'download';
  if (changes) {
    paths.forEach(sharedEntry);
    if (!Array.isArray(body.confirmPaths) || JSON.stringify(body.confirmPaths) !== JSON.stringify(paths)) throw new ActionError('변경할 선택 항목을 확인하세요.');
  }
  const destination = ['copy', 'move'].includes(body.action) ? remotePath(body.destination) : null;
  if (destination) for (const source of paths) {
    const target = sharedEntry(path.posix.join(destination, path.posix.basename(source)));
    if (target === source || target.startsWith(source + '/')) throw new ActionError('원본 또는 원본의 하위 폴더로 복사·이동할 수 없습니다.');
  }
  if (body.action === 'download') validatePortableNames(paths.map(p=>path.posix.basename(p)));
  return { action: body.action, paths, destination, changes, continueOnError: body.continueOnError === true };
}
export function createFileBatch(core) {
  async function execute(body) {
    const options = validateFileBatch(body), { serial } = await core.resolve(body.deviceId);
    return core.startJob(body.deviceId, 'file-batch-' + options.action,
      `선택 ${options.paths.length}개 ${ { download: 'ZIP 받기', copy: '복사', move: '이동', delete: '삭제' }[options.action] }`, async job => {
        const directory = await core.tempDir(); job.directory = directory;
        const staging = path.join(directory, 'staging'); await mkdir(staging);
        const results = [], zipEntries = [], cleanupWarnings=[]; let bytes = 0, files = 0, failure = null;
        const cancelled = () => { if (job.cancelled) throw new ActionError('작업을 취소했습니다.', 409); };
        const shell = async command => { cancelled(); return core.shell(serial, command, { job, timeout: 20 * 60 * 1000 }); };
        const exists = async p => (await shell(`[ -e ${quote(p)} ] || [ -L ${quote(p)} ] && echo exists || echo absent`)) === 'exists';
        async function boundedPull(source, local) {
          let checking=false, scan=Promise.resolve(), boundError=null;
          async function check(){let total=0,count=0;async function walk(p){const info=await lstat(p);if(info.isSymbolicLink())throw new ActionError('전송 결과에 심볼릭 링크가 있습니다.');if(++count>20100)throw new ActionError('전송 항목 수 한도를 초과했습니다.');if(info.isFile()){total+=info.size;if(total>LIMIT)throw new ActionError('전송 중 합계 2GB 한도를 초과했습니다.');}else if(info.isDirectory())for(const name of await readdir(p))await walk(path.join(p,name));}await walk(staging);}
          const timer=setInterval(()=>{if(checking||boundError)return;checking=true;scan=check().catch(error=>{if(error.code!=='ENOENT'){boundError=error;job.child?.kill();}}).finally(()=>{checking=false;});},250);
          try { await core.run(serial, ['pull', source, local], { job, timeout: 30 * 60 * 1000 }); }
          catch(error){throw boundError||error;}
          finally {clearInterval(timer);await scan;}
          if(boundError)throw boundError;
        }
        async function inspect(local, name, entries) {
          cancelled(); const info = await lstat(local);
          if (info.isSymbolicLink()) throw new ActionError('심볼릭 링크가 포함되어 다운로드하지 않았습니다.');
          if (++files > 20000) throw new ActionError('묶음 다운로드는 폴더를 포함하여 20,000개까지 지원합니다.');
          relativeFile(name.replace(/\/$/, ''));
          if (info.isDirectory()) {
            entries.push({ directory: true, name: name + '/' });
            for (const entry of await readdir(local)) await inspect(path.join(local, entry), name + '/' + entry, entries);
          } else if (info.isFile()) {
            bytes += info.size; if (bytes > LIMIT) throw new ActionError('묶음 다운로드의 합계 2GB 한도를 초과했습니다.');
            entries.push({ local, name });
          } else throw new ActionError('일반 파일·폴더만 다운로드할 수 있습니다.');
        }
        try {
          if (options.destination && await shell(`[ -d ${quote(options.destination)} ] && echo yes || echo no`) !== 'yes') throw new ActionError('목적지 폴더가 없습니다.');
          for (const [index, source] of options.paths.entries()) {
            cancelled(); job.progress = Math.floor(index / options.paths.length * 90);
            job.message = `${index + 1}/${options.paths.length} · ${path.posix.basename(source)}`;
            try {
              if (!await exists(source)) throw new ActionError('원본이 없거나 접근할 수 없습니다.');
              if (await shell(`[ -L ${quote(source)} ] && echo link || echo ordinary`) === 'link') throw new ActionError('심볼릭 링크는 묶음 작업에서 제외하세요.');
              if (options.action === 'download') {
                if (await shell(`find ${quote(source)} -type l -print -quit`)) throw new ActionError('폴더 안에 심볼릭 링크가 있습니다.');
                const inventory=(await shell(`find ${quote(source)} -exec stat -c '%F|%s' {} +`)).split(/\r?\n/).filter(Boolean);
                let estimate=0;if(!inventory.length)throw new ActionError('항목 크기를 확인할 수 없습니다.');
                for(const row of inventory){const match=/^(regular(?: empty)? file|directory)\|(\d+)$/.exec(row);if(!match)throw new ActionError('일반 파일·폴더만 묶음 다운로드할 수 있습니다.');if(match[1]!=='directory')estimate+=Number(match[2]);}
                if (!Number.isSafeInteger(estimate) || bytes + estimate > LIMIT || files + inventory.length>20000) throw new ActionError('다운로드 한도(합계 2GB·20,000개)를 초과했습니다.');
                const remoteNames=(await shell(`find ${quote(source)} -print0`)).split('\0').filter(Boolean);
                if(remoteNames.length!==inventory.length||remoteNames.some(p=>p!==source&&!p.startsWith(source.replace(/\/$/,'')+'/')))throw new ActionError('읽는 동안 폴더 목록이 변경되었거나 경로 범위가 다릅니다.');
                const rootName=path.posix.basename(source),expectedNames=remoteNames.map(p=>p===source?rootName:rootName+'/'+p.slice(source.replace(/\/$/,'').length+1));validatePortableNames(expectedNames);const expectedSet=new Set(expectedNames);
                const local = path.join(staging, 'item-' + index);
                await boundedPull(source, local);
                const entries = []; await inspect(local, rootName, entries);const actualNames=entries.map(e=>e.name.replace(/\/$/,''));if(actualNames.length!==expectedNames.length||actualNames.some(p=>!expectedSet.has(p)))throw new ActionError('전송 후 파일·폴더 목록이 원본과 다릅니다. 누락된 ZIP은 제공하지 않습니다.');zipEntries.push(...entries);
              } else {
                const actualSource = sharedEntry((await shell(`readlink -f ${quote(source)}`)).trim());
                const target = options.destination && path.posix.join(options.destination, path.posix.basename(source));
                if (target) {
                  const actualParent = (await shell(`readlink -f ${quote(options.destination)}`)).trim();
                  const actualTarget = sharedEntry(path.posix.join(actualParent, path.posix.basename(source)));
                  if (actualTarget === actualSource || actualTarget.startsWith(actualSource + '/')) throw new ActionError('연결 경로가 원본 또는 원본의 하위 폴더를 가리킵니다.');
                  if (await exists(target)) throw new ActionError('목적지에 같은 이름이 있어 건너뛰었습니다. 덮어쓰지 않습니다.');
                  if(options.action==='copy'){
                    const remoteStage=path.posix.join(actualParent,'.adb-desk-copy-'+randomUUID()),payload=path.posix.join(remoteStage,'content');let created=false;
                    try{
                      await shell(`mkdir -- ${quote(remoteStage)}`);created=true;
                      await shell(`cp -RP -- ${quote(actualSource)} ${quote(payload)}`);
                      if(await exists(actualTarget))throw new ActionError('복사 중 목적지에 같은 이름이 생겼습니다. 기존 항목은 덮어쓰지 않습니다.');
                      await shell(`mv -nT -- ${quote(payload)} ${quote(actualTarget)}`);
                      if(await exists(payload))throw new ActionError('목적지가 변경되어 복사 결과를 배치하지 못했습니다.');
                    }finally{if(created)await core.shell(serial,`rm -rf -- ${quote(remoteStage)}`,{timeout:20000}).catch(error=>{cleanupWarnings.push({path:remoteStage,message:'임시 복사 폴더 정리 실패: '+error.message});});}
                  }else await shell(`mv -nT -- ${quote(actualSource)} ${quote(actualTarget)}`);
                  if (!await exists(actualTarget)) throw new ActionError('목적지에서 결과를 찾지 못했습니다.');
                  if (options.action === 'move' && await exists(actualSource)) throw new ActionError('원본이 남아 있어 이동을 완료하지 못했습니다.');
                } else {
                  await shell(`rm -rf -- ${quote(actualSource)}`);
                  if (await exists(actualSource)) throw new ActionError('삭제 후 원본이 남아 있습니다.');
                }
              }
              results.push({ path: source, state: 'success' });
            } catch (error) {
              results.push({ path: source, state: job.cancelled ? 'cancelled' : 'error', message: error.message });
              if (job.cancelled || !options.continueOnError) throw error;
            }
          }
          cancelled();
          if (options.action === 'download' && zipEntries.length) {
            const archive = path.join(directory, 'selected-files.zip'), zip = new yazl.ZipFile();
            const controller = new AbortController(), timer = setInterval(() => { if (job.cancelled) controller.abort(); }, 100);
            const writing = pipeline(zip.outputStream, createWriteStream(archive), { signal: controller.signal });
            try {
              for (const entry of zipEntries) entry.directory ? zip.addEmptyDirectory(entry.name) : zip.addFile(entry.local, entry.name);
              let reportName = '_adb-desk-results.json'; while (zipEntries.some(e => e.name.split('/')[0].normalize('NFC').toUpperCase() === reportName.toUpperCase())) reportName = '_' + reportName;
              zip.addBuffer(Buffer.from(JSON.stringify({ action: options.action, results }, null, 2)), reportName);
              zip.end(); await writing; cancelled();
            } catch (error) { zip.outputStream.destroy(error); await writing.catch(() => {}); throw error; }
            finally { clearInterval(timer); }
            job.artifact = archive; job.downloadName = '선택한-파일.zip';
          }
        } catch (error) { failure = error; }
        finally {
          for (const p of options.paths.slice(results.length)) results.push({ path: p, state: 'skipped', message: '앞선 중단으로 실행하지 않았습니다.' });
          const output = results.map(r => `${r.state === 'success' ? '완료' : r.state === 'error' ? '실패' : r.state === 'cancelled' ? '취소' : '미실행'} · ${r.path}${r.message ? ' · ' + r.message : ''}`).join('\n');
          job.output = output + cleanupWarnings.map(w=>'\n정리 필요 · '+w.path+' · '+w.message).join('');
          const report = path.join(directory, 'file-batch-results.json');
          await writeFile(report, JSON.stringify({ action: options.action, deviceId: body.deviceId, createdAt: new Date().toISOString(), results, cleanupWarnings }, null, 2));
          if (!job.artifact) { job.artifact = report; job.downloadName = '파일-작업-결과.json'; }
          await core.removeOwned(staging);
        }
        if (failure) throw failure;
        if(cleanupWarnings.length)throw new ActionError('파일 작업 후 임시 폴더 정리를 완료하지 못했습니다. 결과에 표시된 경로를 확인하세요.');
        const success = results.filter(r => r.state === 'success').length;
        if (success !== results.length) throw new ActionError(`${success}개 완료 · ${results.length - success}개 실패. 항목별 결과를 확인하세요.`);
        return { message: `${success}개 작업을 완료했습니다.`, output: job.output };
      });
  }
  return { execute };
}
