import path from 'node:path';
import {open} from 'node:fs/promises';

const LIMIT=64*1024;
// Never return raw daemon logs: they can contain other devices and private paths.
export function connectionLogFailure(text,{endpoint,serviceAlias}={}){
  const rows=String(text).split(/\r?\n/).flatMap(line=>{
    const match=/^\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+\s+(\d+)\s+\d+\s+[A-Z]\s+adb\s*:\s*(.*)$/.exec(line);
    return match?[{pid:match[1],message:match[2].replace(/^[A-Za-z0-9_.-]+:\d+\s+/,'')}]:[];
  });
  const allowed=new Set([endpoint,serviceAlias].filter(Boolean));
  const endings=rows.flatMap(row=>{const m=/^([^\s]+): connection terminated:/.exec(row.message);return m?[{...row,target:m[1]}]:[];});
  const target=endings.filter(row=>row.target===endpoint);
  if(!target.length||new Set(target.map(row=>row.pid)).size!==1)return null;
  const pid=target[0].pid,local=rows.filter(row=>row.pid===pid);
  if(endings.some(row=>row.pid===pid&&!allowed.has(row.target)))return null;
  // TLS worker and transport reader use different threads. Only correlate a
  // single observed handshake with a target termination; concurrent attempts
  // remain unconfirmed rather than borrowing another phone's certificate error.
  if(local.filter(row=>/Starting adbwifi tls handshake/.test(row.message)).length!==1)return null;
  const failures=local.filter(row=>/Post-handshake SSL_peek failed \[(SSLV3_ALERT_CERTIFICATE_UNKNOWN|TLSV1_ALERT_UNKNOWN_CA)\]/.test(row.message));
  if(failures.length!==1)return null;
  return {code:'tls-certificate-rejected',marker:/TLSV1_ALERT_UNKNOWN_CA/.test(failures[0].message)?'TLSV1_ALERT_UNKNOWN_CA':'SSLV3_ALERT_CERTIFICATE_UNKNOWN',source:'pc-adb-log'};
}

export async function beginAdbConnectionLog(run){
  let handle;
  try{
    const status=await run(['server-status'],'',3000);
    const match=/^log_absolute_path:\s*("(?:[^"\\]|\\.)*")\s*$/m.exec(status);
    if(!match)return null;
    const location=JSON.parse(match[1]);if(!path.isAbsolute(location))return null;
    handle=await open(location,'r');const before=await handle.stat();
    if(!before.isFile()){await handle.close();return null;}
    const offset=before.size,anchor=Buffer.alloc(Math.min(offset,128));
    if(anchor.length)await handle.read(anchor,0,anchor.length,offset-anchor.length);
    let finished=false;
    return {async finish(target){
      if(finished)return null;finished=true;
      try{
        const after=await handle.stat(),length=after.size-offset;
        if(length<=0||length>LIMIT)return null;
        if(anchor.length){const fresh=Buffer.alloc(anchor.length);await handle.read(fresh,0,fresh.length,offset-fresh.length);if(!fresh.equals(anchor))return null;}
        const bytes=Buffer.alloc(length),{bytesRead}=await handle.read(bytes,0,length,offset);
        if(bytesRead!==length)return null;
        return connectionLogFailure(bytes.toString('utf8'),target);
      }catch{return null;}finally{await handle.close().catch(()=>{});}
    }};
  }catch{await handle?.close().catch(()=>{});return null;}
}
