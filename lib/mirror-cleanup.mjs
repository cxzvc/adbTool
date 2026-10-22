// scrcpy 5.0.1 CleanUp uses settings user 0 and restores parseable existing values.
// Read only: actual changes/restoration remain owned by the official server.
export async function snapshotSessionSettings(options, read, currentUser) {
  const rows=[];
  if(options.showTouches||options.screenOffTimeoutMs!==undefined){
    if((await currentUser()).trim()!=='0')throw new Error('터치 표시·화면 자동 꺼짐의 세션 변경은 현재 기기 사용자가 기본 사용자 0일 때만 지원합니다.');
  }
  for(const [enabled,table,key,label,desired] of [
    [options.showTouches,'system','show_touches','터치 표시','1'],
    [options.stayAwake,'global','stay_on_while_plugged_in','충전 중 화면 유지','7'],
    [options.screenOffTimeoutMs!==undefined,'system','screen_off_timeout','화면 자동 꺼짐',String(options.screenOffTimeoutMs)],
  ]){
    if(!enabled)continue;
    const value=(await read(table,key)).trim();
    if(!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value))||Number(value)>2147483647||(key==='show_touches'&&!['0','1'].includes(value)))throw new Error(`${label}: 기존 설정값을 정확히 읽을 수 없어 세션 변경을 시작하지 않았습니다.`);
    // The official cleanup writes only when the old and requested values differ.
    if(value!==desired)rows.push({table,key,value,label});
  }
  return rows;
}

export async function confirmSessionRestored(rows,read,{timeoutMs=4500,intervalMs=150,delay=ms=>new Promise(resolve=>setTimeout(resolve,ms)),now=Date.now}={}){
  if(!rows.length)return;
  const deadline=now()+timeoutMs;let missing=rows;
  do{
    missing=[];
    for(const row of rows){try{if((await read(row.table,row.key)).trim()!==row.value)missing.push(row);}catch{missing.push(row);}}
    if(!missing.length)return;
    if(now()>=deadline)break;
    await delay(intervalMs);
  }while(now()<deadline);
  throw new Error(`이전 화면 연결의 설정 복원을 확인하지 못했습니다 (${missing.map(row=>row.label).join('·')}). 연결 상태와 폰의 설정을 확인한 뒤 다시 연결하세요.`);
}

export async function finishMirrorProcess(child,childClosed,{graceMs=1500,killWaitMs=1500}={}){
  if(!child)return;
  let timer;
  const expired=await Promise.race([childClosed.then(()=>false),new Promise(resolve=>{timer=setTimeout(()=>resolve(true),graceMs);})]);clearTimeout(timer);
  if(!expired)return;
  child.kill();
  const stillRunning=await Promise.race([childClosed.then(()=>false),new Promise(resolve=>{timer=setTimeout(()=>resolve(true),killWaitMs);})]);clearTimeout(timer);
  if(stillRunning)throw new Error('이전 화면 서버가 아직 종료되지 않았습니다. 정리가 끝난 뒤 다시 연결하세요.');
}
