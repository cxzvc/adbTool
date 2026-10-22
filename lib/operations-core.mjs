import {storagePaths} from './local-paths.mjs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { createReadStream } from 'node:fs';
import { finished } from 'node:stream/promises';
import { ActionError } from './connections.mjs';
import { createActivityHistory } from './activity-history.mjs';

export const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
export function remotePath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.length > 2048 || /[\x00-\x1f\x7f]/.test(value) || value.split('/').includes('..')) throw new ActionError('올바른 기기 경로를 선택하세요.');
  return path.posix.normalize(value);
}
export function fileName(value) {
  if (typeof value !== 'string' || !value || value.length > 255 || /[\\/\x00-\x1f\x7f]/.test(value) || ['.', '..'].includes(value)) throw new ActionError('파일 이름을 확인하세요.');
  return value;
}
export function packageName(value) {
  if (typeof value !== 'string' || value.length > 255 || !/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/.test(value)) throw new ActionError('패키지 이름을 확인하세요.');
  return value;
}
export function createOperationsCore({ adbPath, resolve, root, history = true, activityHistory }) {
  const paths=storagePaths(root);
  const runtime = paths.runtime;
  const backupRoot = paths.backupRoot;
  const jobs = new Map(), uploads = new Map();
  const activity=history===false?null:activityHistory||createActivityHistory({root,runtime,backupRoot});
  const pendingJobs=new Set();
  async function removeOwned(target) {
    const absolute = path.resolve(target);
    if (!absolute.startsWith(runtime + path.sep)) throw new Error('Not an owned temporary path');
    await rm(absolute, { recursive: true, force: true });
  }
  async function tempDir() { const directory = path.join(runtime, randomUUID()); await mkdir(directory, { recursive: true }); return directory; }
  function run(serial, args, { timeout = 20000, maxBytes = 4 * 1024 * 1024, job, stdoutFile, stdinFile, preserveOutput = false } = {}) {
    if (job?.cancelled) return Promise.reject(new ActionError('작업을 취소했습니다.', 409));
    return new Promise((resolveResult, reject) => {
      const child = spawn(adbPath, serial ? ['-s', serial, ...args] : args, { windowsHide: true, stdio: [stdinFile?'pipe':'ignore', 'pipe', 'pipe'] });
      if (job) job.child = child;
      let out = '', err = '', size = 0, failed = null;
      let input,writing;
      if(stdinFile){input=createReadStream(stdinFile);input.on('error',error=>{failed=error;child.kill();});child.stdin.on('error',()=>{});input.pipe(child.stdin);}
      if(stdoutFile){child.stdout.pipe(stdoutFile);writing=finished(stdoutFile).catch(error=>{failed=error;child.kill();});}
      const outputDecoder = new StringDecoder('utf8'), errorDecoder = new StringDecoder('utf8');
      const timer = setTimeout(() => { failed = new ActionError('ADB 작업 제한 시간이 초과되었습니다.', 504); child.kill(); }, timeout);
      child.stdout.on('data', chunk => {
        size += chunk.length;
        if(size>maxBytes){failed=new ActionError('응답 크기 한도를 초과했습니다.',413);child.kill();}
        else if(!stdoutFile)out += outputDecoder.write(chunk);
        if (job) { const match = /\[\s*(\d+)%\]/.exec(chunk.toString()); if (match) job.progress = Number(match[1]); }
      });
      child.stderr.on('data', chunk => { err = (err + errorDecoder.write(chunk)).slice(-8000); if (job) { const match = /\[\s*(\d+)%\]/.exec(chunk.toString()); if (match) job.progress = Number(match[1]); } });
      child.on('error', error => { failed = new ActionError(error.code === 'ENOENT' ? 'ADB 실행 파일이 없습니다.' : error.message, 502); });
      child.on('close', async code => {
        input?.destroy();if(writing)await writing;
        out += outputDecoder.end(); err += errorDecoder.end();
        clearTimeout(timer); if (job) job.child = null;
        if (failed) reject(failed);
        else if (job?.cancelled) reject(new ActionError('작업을 취소했습니다.', 409));
        else if (code !== 0) reject(new ActionError((err || out || `ADB 종료 코드 ${code}`).trim().slice(-1500), 502));
        else resolveResult({ stdout: preserveOutput ? out : out.trim(), stderr: err.trim() });
      });
    });
  }
  const shell = async (serial, command, options) => (await run(serial, ['shell', command], options)).stdout;
  function publicJob(job) { return { id: job.id, deviceId: job.deviceId, kind: job.kind, title: job.title, state: job.state, progress: job.progress, createdAt: job.createdAt, finishedAt: job.finishedAt, message: job.message, output:(job.output||'').slice(0,4000),outputTruncated:(job.output||'').length>4000, downloadName: job.downloadName, downloadUrl: job.artifact ? `/api/ops/download-job?id=${job.id}` : null, historySaved:job.historySaved===true,historyError:job.historyError||null }; }
  function startJob(deviceId, kind, title, execute) {
    if ([...jobs.values()].filter(job => job.state === 'running').length >= 4) throw new ActionError('진행 중인 작업이 많습니다. 완료 후 다시 시도하세요.', 429);
    const job = { id: randomUUID(), deviceId, kind, title, state: 'running', progress: null, createdAt: new Date().toISOString(), message: '', cancelled: false };
    jobs.set(job.id, job);
    const task=Promise.resolve().then(async()=>{
      // Record the start before any phone operation. A restarted pending entry is never replayed.
      if(activity)await activity.record(job);
      if(job.cancelled)throw new Error('작업을 취소했습니다.');
      return execute(job);
    }).then(result=>{
      if(result?.history)job.history=result.history;
      else if(result?.before!==undefined||result?.after!==undefined)job.history={before:result.before,after:result.after};
      if(result?.historySummary)job.historySummary=result.historySummary;
      if(job.cancelled)throw new Error('작업을 취소했습니다.');
      job.state='success';job.progress=100;job.message=result?.message||'완료했습니다.';
      if(result?.output)job.output=String(result.output).slice(0,131072);
    }).catch(error=>{job.state=job.cancelled?'cancelled':'error';job.message=job.cancelled?'진행 중인 작업을 중단했습니다. 이미 전송·설치·삭제된 결과는 되돌리지 않습니다.':error.message;})
      .finally(async()=>{
        job.finishedAt=new Date().toISOString();job.child=null;
        if(activity){try{await activity.record(job);job.historySaved=true;}catch{job.historySaved=false;job.historyError='작업 결과를 기록 파일에 저장하지 못했습니다. 현재 작업 결과를 확인하세요.';}}
      });
    pendingJobs.add(task);task.finally(()=>pendingJobs.delete(task)).catch(()=>{});
    return publicJob(job);
  }
  function cancel(id) { const job = jobs.get(id); if (!job || job.state !== 'running') throw new ActionError('진행 중인 작업이 아닙니다.', 409); job.cancelled = true; job.child?.kill(); return { ok: true }; }
  async function pruneHistory(){if(activity)await activity.prune({activeDirectories:[...jobs.values()].filter(job=>job.state==='running').map(job=>job.directory).concat([...uploads.values()].map(upload=>upload.directory))});}
  async function flushHistory(){await Promise.allSettled([...pendingJobs]);await activity?.flush();}
  return { adbPath, root, paths, resolve, runtime, backupRoot, jobs, uploads, removeOwned, tempDir, run, shell, publicJob, startJob, cancel, activity, pruneHistory, flushHistory };
}
