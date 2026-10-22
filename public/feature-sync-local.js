(() => {
  function relative(value){if(typeof value!=='string'||!value||/[\\\x00-\x1f]/.test(value)||value.split('/').some(p=>!p||p==='.'||p==='..'))throw new Error('PC 저장 경로를 확인하세요.');return value;}
  async function save({directory,plan,downloads,jobId,isCurrent,fetchFile=fetch,hash=file=>window.FeatureHash.file(file),progress=()=>{}}){
    const check=()=>{if(!isCurrent())throw new Error('기기 또는 폴더 선택이 바뀌어 PC 저장을 중지했습니다. 준비된 ZIP에서 확인하세요.');};
    const rows=new Map(plan.rows.map(r=>[r.path,r]));let saved=0;
    async function handle(name,create=false){let dir=directory;const parts=relative(name).split('/');for(const part of parts.slice(0,-1)){check();dir=await dir.getDirectoryHandle(part,{create});}check();return dir.getFileHandle(parts.at(-1),{create});}
    async function existing(name){try{const entry=await handle(name);return{handle:entry,file:await entry.getFile()};}catch(error){if(error.name==='NotFoundError')return null;throw error;}}
    async function verify(name,row){check();const current=await existing(name);if(current?(!row.local||await hash(current.file)!==row.local.sha256):!!row.local)throw new Error('PC 대상 파일이 비교 후 바뀌어 덮어쓰지 않았습니다: '+name);check();return current;}
    async function writeFile(entry,blob,before){check();const writer=await entry.createWritable({mode:'exclusive'});try{check();if(before!==undefined){const fresh=await entry.getFile();if(before===null?fresh.size!==0:await hash(fresh)!==before)throw new Error('PC 대상 파일이 저장 직전에 바뀌어 덮어쓰지 않았습니다.');}check();await writer.write(blob);check();await writer.close();}catch(error){await writer.abort().catch(()=>{});throw error;}}
    for(const download of downloads){
      check();const row=rows.get(download.path);if(!row?.remote)throw new Error('비교 결과에 없는 PC 다운로드입니다.');relative(download.path);progress(download.path,saved,downloads.length);
      await verify(download.path,row);const response=await fetchFile(download.url);if(!response.ok)throw new Error('수신 파일을 다시 읽지 못했습니다. ZIP에서 확인하세요.');const blob=await response.blob();if(await hash(blob)!==row.remote.sha256)throw new Error('다운로드 파일 내용 검증에 실패했습니다.');
      const old=await verify(download.path,row);
      if(old){check();let backup=await directory.getDirectoryHandle('.adb-desk-sync-backups',{create:true});check();backup=await backup.getDirectoryHandle(jobId,{create:true});check();const entry=await backup.getFileHandle(String(saved)+'-'+download.path.split('/').at(-1),{create:true});await writeFile(entry,old.file);}
      await verify(download.path,row);const target=await handle(download.path,true);await writeFile(target,blob,row.local?.sha256??null);saved++;
    }return saved;
  }
  window.FeatureSyncLocal={save};
})();
