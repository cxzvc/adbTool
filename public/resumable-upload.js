(() => {
  const CHUNK=4*1024**2,MAX=2*1024**3;
  // Incremental SHA-256 also works on LAN HTTP where SubtleCrypto is unavailable.
  const K=Uint32Array.from([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
  const rotate=(n,b)=>(n>>>b)|(n<<(32-b));
  class Sha256{
    constructor(){this.state=Uint32Array.from([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);this.buffer=new Uint8Array(64);this.words=new Uint32Array(64);this.used=0;this.bytes=0;this.done=false;}
    block(b){const w=this.words;for(let i=0;i<16;i++){const p=i*4;w[i]=b[p]<<24|b[p+1]<<16|b[p+2]<<8|b[p+3];}for(let i=16;i<64;i++){const x=w[i-15],y=w[i-2];w[i]=(w[i-16]+(rotate(x,7)^rotate(x,18)^x>>>3)+w[i-7]+(rotate(y,17)^rotate(y,19)^y>>>10))>>>0;}let [a,bv,c,d,e,f,g,h]=this.state;for(let i=0;i<64;i++){const t1=(h+(rotate(e,6)^rotate(e,11)^rotate(e,25))+((e&f)^(~e&g))+K[i]+w[i])>>>0,t2=((rotate(a,2)^rotate(a,13)^rotate(a,22))+((a&bv)^(a&c)^(bv&c)))>>>0;h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=bv;bv=a;a=(t1+t2)>>>0;}[a,bv,c,d,e,f,g,h].forEach((value,i)=>{this.state[i]=(this.state[i]+value)>>>0;});}
    update(value){if(this.done)throw new Error('SHA-256은 이미 완료되었습니다.');const data=value instanceof Uint8Array?value:new Uint8Array(value);this.bytes+=data.length;let offset=0;while(offset<data.length){const take=Math.min(64-this.used,data.length-offset);this.buffer.set(data.subarray(offset,offset+take),this.used);this.used+=take;offset+=take;if(this.used===64){this.block(this.buffer);this.used=0;}}return this;}
    hex(){if(!this.done){const bytes=this.bytes,padding=new Uint8Array(this.used<56?64-this.used:128-this.used),view=new DataView(padding.buffer);padding[0]=128;view.setUint32(padding.length-8,Math.floor(bytes/0x20000000));view.setUint32(padding.length-4,(bytes*8)>>>0);this.update(padding);this.done=true;}return [...this.state].map(n=>n.toString(16).padStart(8,'0')).join('');}
  }
  const sha256=data=>new Sha256().update(data).hex();
  function check(signal){if(signal?.aborted){const error=new Error('PC 업로드를 중단했습니다. 같은 파일을 다시 선택하면 검증 후 이어서 업로드합니다.');error.name='AbortError';throw error;}}
  async function upload(file,options={},restarted=false){
    const {signal,onProgress}=options;check(signal);if(!file||typeof file.name!=='string'||!Number.isSafeInteger(file.size)||file.size<0||file.size>MAX)throw new Error('파일은 최대 2GB까지 선택할 수 있습니다.');
    const progress=(phase,loaded,total=file.size,extra={})=>onProgress?.({phase,loaded,total,percent:total?Math.round(loaded/total*100):100,name:file.name,...extra});
    const read=async(start,end)=>{check(signal);const data=new Uint8Array(await file.slice(start,end).arrayBuffer());check(signal);return data;};
    progress('hashing',0);const first=await read(0,Math.min(file.size,CHUNK)),lastStart=Math.max(0,file.size-CHUNK),last=lastStart===0?first:await read(lastStart,file.size),identity={name:file.name,size:file.size,lastModified:Number.isSafeInteger(file.lastModified)?file.lastModified:0};
    const fingerprint=sha256(new TextEncoder().encode(JSON.stringify({...identity,first:sha256(first),last:sha256(last)})));
    check(signal);const tokenResponse=await fetch('/api/session',{cache:'no-store',signal}),token=await tokenResponse.json();check(signal);if(!tokenResponse.ok)throw new Error(token.error||'접속 정보를 확인하지 못했습니다.');
    async function api(route,body,binary=false,params={},digest){check(signal);const headers={'X-ADB-Desk-Token':token.csrfToken,'Content-Type':binary?'application/octet-stream':'application/json'};if(binary)headers['X-Upload-Sha256']=digest||sha256(body);const response=await fetch('/api/ops/'+route+(binary?'?'+new URLSearchParams(params):''),{method:'POST',headers,body:binary?body:JSON.stringify(body),signal}),result=await response.json();check(signal);if(!response.ok){const e=new Error(result.error||'이어받기 업로드를 처리하지 못했습니다.');e.status=response.status;throw e;}return result;}
    let session=await api('resumable-begin',{...identity,fingerprint});check(signal);
    if(session.size!==file.size||session.chunkSize!==CHUNK||!Number.isSafeInteger(session.offset)||session.offset<0||session.offset>file.size||session.offset!==file.size&&session.offset%CHUNK||!Array.isArray(session.hashes)||session.hashes.length!==Math.ceil(session.offset/CHUNK))throw new Error('서버의 업로드 기록이 올바르지 않습니다.');
    const resumedBytes=session.offset,whole=new Sha256();let offset=0;
    while(offset<file.size){
      check(signal);const end=Math.min(offset+CHUNK,file.size),data=offset===0?first:offset===lastStart?last:await read(offset,end),digest=sha256(data);whole.update(data);
      if(offset<resumedBytes){
        progress('verifying',end,file.size,{resumedBytes});
        if(session.hashes[offset/CHUNK]!==digest){if(restarted)throw new Error('파일이 변경되었습니다. 새 파일을 선택하세요.');await api('resumable-discard',{id:session.id});progress('restart',0,file.size,{resumedBytes:0});return upload(file,options,true);}
      }else{
        progress('uploading',offset,file.size,{resumedBytes});session=await api('resumable-chunk',data,true,{id:session.id,offset:String(offset)},digest);if(session.offset!==end)throw new Error('업로드 위치가 바뀌었습니다. 같은 파일을 다시 선택해 기록을 확인하세요.');progress('uploading',end,file.size,{resumedBytes});
      }
      offset=end;await new Promise(resolve=>setTimeout(resolve,0));
    }
    check(signal);progress('finalizing',file.size,file.size,{resumedBytes});const result=await api('resumable-finalize',{id:session.id,sha256:whole.hex()});progress('complete',file.size,file.size,{resumedBytes});return {...result,resumedBytes};
  }
  async function uploadWithStatus(file,options={}){try{return await upload(file,options);}catch(error){if(error?.name!=='AbortError'&&(/fetch|network|connection|인터넷|연결|응답/i.test(error?.message||'')||error?.status>=500)){error.message='PC 업로드 응답을 확인하지 못했습니다. 같은 파일을 다시 선택하면 저장된 조각을 검증한 뒤 계속합니다. 폰으로 보내기는 PC 업로드 완료 후에만 진행됩니다. ('+(error.message||'연결 오류')+')';}throw error;}}
  window.ResumableUpload={upload:uploadWithStatus,chunkSize:CHUNK,Sha256,sha256};
})();
