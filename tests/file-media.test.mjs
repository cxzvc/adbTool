import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import fileSystem from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { Writable } from 'node:stream';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, stat } from 'node:fs/promises';
import { mediaType, parseMediaRange, archiveName, inspectArchive, extractArchive, createFileMedia, crc32, FILE_MEDIA_LIMITS } from '../lib/file-media.mjs';

const png=Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]);
async function temporary(t){const folder=await mkdtemp(path.join(os.tmpdir(),'adb-media-test-'));t.after(()=>rm(folder,{recursive:true,force:true}));return folder;}
function zipBytes(items){
  const bodies=[],central=[];let offset=0;
  for(const item of items){const name=Buffer.from(item.name),data=Buffer.from(item.data||''),crc=item.crc??crc32(data),local=Buffer.alloc(30),dir=Buffer.alloc(46);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800|(item.flags||0),6);local.writeUInt16LE(item.method||0,8);local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(item.size??data.length,22);local.writeUInt16LE(name.length,26);
    dir.writeUInt32LE(0x02014b50);dir.writeUInt16LE(3<<8|20,4);dir.writeUInt16LE(20,6);dir.writeUInt16LE(0x800|(item.flags||0),8);dir.writeUInt16LE(item.method||0,10);dir.writeUInt32LE(crc,16);dir.writeUInt32LE(data.length,20);dir.writeUInt32LE(item.size??data.length,24);dir.writeUInt16LE(name.length,28);dir.writeUInt32LE(((item.mode||0)<<16)>>>0,38);dir.writeUInt32LE(offset,42);bodies.push(local,name,data);central.push(dir,name);offset+=local.length+name.length+data.length;
  }
  const cd=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(items.length,8);end.writeUInt16LE(items.length,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...bodies,cd,end]);
}
async function fixture(folder,items,name='input.zip'){const file=path.join(folder,name);await writeFile(file,zipBytes(items));return file;}
function mockCore(directory,bytes=png){
  let count=0;const core={jobs:new Map(),calls:[],resolveCount:0,metadata:`regular file|${bytes.length}|12|45`,
    async resolve(){core.resolveCount++;return {serial:'mock'};},async tempDir(){const d=path.join(directory,'owned-'+(++count));await mkdir(d);return d;},
    async removeOwned(d){assert.ok(path.resolve(d).startsWith(path.resolve(directory)+path.sep));await rm(d,{recursive:true,force:true});},
    async shell(serial,command,options){assert.equal(serial,'mock');core.calls.push(command);if(core.handler)return core.handler(command,options);if(command.startsWith('stat '))return core.metadata;throw new Error('unexpected mock command: '+command);},
    async run(serial,args,options){assert.equal(serial,'mock');core.calls.push(args);if(args[0]==='exec-out'){options.stdoutFile.end(bytes);return {stdout:''};}if(args[0]==='push'){if(core.onPush)await core.onPush(args);return {stdout:''};}throw new Error('unexpected mock command');},
    publicJob(j){return {id:j.id,deviceId:j.deviceId,state:j.state,kind:j.kind,progress:j.progress,message:j.message,downloadUrl:j.artifact?'/download/'+j.id:null};},
    startJob(deviceId,kind,title,execute){const job={id:'job-'+core.jobs.size,deviceId,kind,title,state:'running',cancelled:false};core.jobs.set(job.id,job);job.promise=Promise.resolve().then(()=>execute(job)).then(result=>{job.state='success';job.message=result?.message;return result;},e=>{job.state=job.cancelled?'cancelled':'error';throw e;});job.promise.catch(()=>{});return core.publicJob(job);}
  };return core;
}
class Response extends Writable{constructor(){super();this.chunks=[];this.headers={};}writeHead(status,headers){this.status=status;this.headers=headers;}_write(chunk,e,done){this.chunks.push(Buffer.from(chunk));done();}}

test('media allowlist verifies signatures and rejects HTML/SVG/polyglot extensions',()=>{
  assert.equal(mediaType('/x.png',png).mime,'image/png');assert.equal(mediaType('/x.PDF',Buffer.from('%PDF-1.4')).kind,'pdf');assert.equal(mediaType('/x.mp4',Buffer.from('0000ftypisom')).mime,'video/mp4');
  for(const name of ['/x.html','/x.svg','/x.htm','/x.js'])assert.throws(()=>mediaType(name));assert.throws(()=>mediaType('/x.png',Buffer.from('<html>bad')));assert.throws(()=>mediaType('/x.mp4',Buffer.from('0000ftypavif')));
});
test('Range supports full, suffix and open-ended ranges without multi-range ambiguity',()=>{
  assert.equal(parseMediaRange(undefined,20),null);assert.deepEqual(parseMediaRange('bytes=2-5',20),{start:2,end:5});assert.deepEqual(parseMediaRange('bytes=7-',20),{start:7,end:19});assert.deepEqual(parseMediaRange('bytes=-4',20),{start:16,end:19});assert.deepEqual(parseMediaRange('bytes=0-999',20),{start:0,end:19});
  for(const value of ['bytes=20-','bytes=4-2','bytes=-0','bytes=','bytes=0-1,3-4','bytes=999999999999999999999-'])assert.throws(()=>parseMediaRange(value,20),e=>e.status===416);
});
test('archive names reject traversal, absolute/Windows aliases and invalid path characters',()=>{
  for(const name of ['../x','/x','a/../../x','a\\b','C:/x','CON','AUX.txt','a./b','a /b','a:b','a//b'])assert.throws(()=>archiveName(name));assert.equal(archiveName('folder/한글.txt').name,'folder/한글.txt');
});
test('CRC32 supports incremental calculation',()=>{assert.equal(crc32(Buffer.from('123456789')),0xcbf43926);assert.equal(crc32(Buffer.from('456789'),crc32(Buffer.from('123'))),0xcbf43926);});
test('ZIP list records file size and directory entries',async t=>{
  const d=await temporary(t),file=await fixture(d,[{name:'Folder/',mode:0x4000},{name:'Folder/a.txt',data:'abc'},{name:'한글.txt',data:'한글'}]);const result=await inspectArchive(file);assert.equal(result.entries.length,3);assert.equal(result.bytes,9);
});
test('ZIP rejects case and file/directory collisions, links and encrypted entries',async t=>{
  const d=await temporary(t),cases=[[{name:'a',data:'x'},{name:'A',data:'y'}],[{name:'a/b',data:'x'},{name:'A/c',data:'y'}],[{name:'a/b',data:'x'},{name:'a',data:'y'}],[{name:'link',data:'/sdcard',mode:0xa000}],[{name:'secret',data:'x',flags:1}]];
  for(let i=0;i<cases.length;i++)await assert.rejects(inspectArchive(await fixture(d,cases[i],i+'.zip')));
});
test('ZIP detects sparse logical-size bombs from central directory before extraction',async t=>{
  const d=await temporary(t),file=await fixture(d,[{name:'large',data:'x',size:FILE_MEDIA_LIMITS.expanded+1,method:8}]);await assert.rejects(inspectArchive(file),/한도/);
});
test('selected folder extracts its children and leaves unrelated files out',async t=>{
  const d=await temporary(t),file=await fixture(d,[{name:'folder/',mode:0x4000},{name:'folder/a.txt',data:'abc'},{name:'other.txt',data:'x'}]),out=path.join(d,'out');const result=await extractArchive(file,out,['folder']);assert.equal(result.entries,2);assert.equal(await readFile(path.join(out,'folder','a.txt'),'utf8'),'abc');await assert.rejects(stat(path.join(out,'other.txt')),{code:'ENOENT'});
});
test('ZIP CRC mismatch fails rather than publishing corrupted output',async t=>{const d=await temporary(t),file=await fixture(d,[{name:'bad.txt',data:'abc',crc:0}]);await assert.rejects(extractArchive(file,path.join(d,'out'),['bad.txt']),/CRC/);});
test('ZIP extraction cancellation and unknown selection stop before successful result',async t=>{
  const d=await temporary(t),file=await fixture(d,[{name:'a.txt',data:'abc'}]);await assert.rejects(extractArchive(file,path.join(d,'out'),['a.txt'],{cancelled:true}),/취소/);await assert.rejects(extractArchive(file,path.join(d,'out2'),['missing']),/선택/);
});
test('unsupported preview types and unconfirmed extraction issue no phone request',async t=>{
  const core=mockCore(await temporary(t)),media=createFileMedia(core);await assert.rejects(media.run({deviceId:'d',action:'preview',path:'/sdcard/x.svg'}));await assert.rejects(media.run({deviceId:'d',action:'archive-extract',destination:'/sdcard',name:'new'}));assert.equal(core.resolveCount,0);assert.equal(core.calls.length,0);
});
test('preview staging returns typed content only after successful signature validation',async t=>{
  const core=mockCore(await temporary(t)),media=createFileMedia(core),job=await media.run({deviceId:'d',action:'preview',path:'/sdcard/한글.png'});assert.equal(media.result('d',job.id).fileMedia,undefined);await core.jobs.get(job.id).promise;const result=media.result('d',job.id);assert.equal(result.fileMedia.mime,'image/png');assert.match(result.fileMedia.url,/file-media-content/);assert.throws(()=>media.result('other',job.id),e=>e.status===404);
});
test('wrong magic or changed source leaves no preview artifact',async t=>{
  const d=await temporary(t),core=mockCore(d,Buffer.from('<svg>')),media=createFileMedia(core),job=await media.run({deviceId:'d',action:'preview',path:'/sdcard/fake.png'});await assert.rejects(core.jobs.get(job.id).promise,/형식/);assert.equal(core.jobs.get(job.id).artifact,undefined);assert.deepEqual(await readdir(d),[]);
});
test('preview size guard checks source before binary read',async t=>{
  const core=mockCore(await temporary(t));core.metadata=`regular file|${FILE_MEDIA_LIMITS.source+1}|12|45`;const media=createFileMedia(core),job=await media.run({deviceId:'d',action:'preview',path:'/sdcard/big.mp4'});await assert.rejects(core.jobs.get(job.id).promise,/256MB/);assert.equal(core.calls.filter(Array.isArray).length,0);
});
test('media HTTP serves validated MIME, byte ranges and sandbox headers',async t=>{
  const core=mockCore(await temporary(t)),media=createFileMedia(core),j=await media.run({deviceId:'d',action:'preview',path:'/sdcard/x.png'});await core.jobs.get(j.id).promise;const url=new URL('http://localhost/?'+new URLSearchParams({deviceId:'d',id:j.id})),res=new Response();await media.serve({headers:{range:'bytes=1-3'},method:'GET'},res,url);assert.equal(res.status,206);assert.equal(res.headers['Content-Type'],'image/png');assert.equal(res.headers['Content-Range'],`bytes 1-3/${png.length}`);assert.match(res.headers['Content-Security-Policy'],/sandbox/);assert.deepEqual(Buffer.concat(res.chunks),png.subarray(1,4));
  const invalid=new Response();await media.serve({headers:{range:'bytes=999-'},method:'GET'},invalid,url);assert.equal(invalid.status,416);assert.equal(invalid.headers['Content-Range'],`bytes */${png.length}`);
});
test('PDF uses fixed PDF MIME and blocks document scripts without disabling the native viewer',async t=>{
  const core=mockCore(await temporary(t),Buffer.from('%PDF-1.4\n')),media=createFileMedia(core),j=await media.run({deviceId:'d',action:'preview',path:'/sdcard/x.pdf'});await core.jobs.get(j.id).promise;const res=new Response();await media.serve({headers:{},method:'GET'},res,new URL('http://localhost/?'+new URLSearchParams({deviceId:'d',id:j.id})));assert.equal(res.headers['Content-Type'],'application/pdf');assert.equal(res.headers['X-Content-Type-Options'],'nosniff');assert.match(res.headers['Content-Security-Policy'],/script-src 'none'/);assert.doesNotMatch(res.headers['Content-Security-Policy'],/sandbox/);
});
test('ZIP job lists validated entries and cannot cross device boundaries for extraction',async t=>{
  const d=await temporary(t),bytes=zipBytes([{name:'a.txt',data:'abc'}]),core=mockCore(d,bytes),media=createFileMedia(core),job=await media.run({deviceId:'d',action:'archive-list',path:'/sdcard/a.zip'});await core.jobs.get(job.id).promise;assert.equal(media.result('d',job.id).fileMedia.archive.entries[0].name,'a.txt');
  await assert.rejects(media.run({deviceId:'other',confirmDevice:'other',action:'archive-extract',sourceJobId:job.id,selected:['a.txt'],destination:'/sdcard',name:'result'}),/원본/);
});
test('existing destination prevents extraction push and no unsafe overwrite is issued',async t=>{
  const d=await temporary(t),bytes=zipBytes([{name:'a.txt',data:'abc'}]),core=mockCore(d,bytes),media=createFileMedia(core),source=await media.run({deviceId:'d',action:'archive-list',path:'/sdcard/a.zip'});await core.jobs.get(source.id).promise;
  core.handler=command=>command.startsWith('readlink')?'/storage/emulated/0':'yes';const j=await media.run({deviceId:'d',confirmDevice:'d',action:'archive-extract',sourceJobId:source.id,selected:['a.txt'],destination:'/sdcard',name:'existing'});await assert.rejects(core.jobs.get(j.id).promise,/같은 이름/);assert.ok(!core.calls.some(c=>Array.isArray(c)&&c[0]==='push'));
});
test('extraction publishes a new canonical folder after size checks and cleans remote staging',async t=>{
  const d=await temporary(t),bytes=zipBytes([{name:'a.txt',data:'abc'}]),core=mockCore(d,bytes),media=createFileMedia(core),source=await media.run({deviceId:'d',action:'archive-list',path:'/sdcard/a.zip'});await core.jobs.get(source.id).promise;let moved=false;
  core.handler=command=>{if(command.startsWith('readlink'))return '/storage/emulated/0';if(command.startsWith('mkdir'))return '';if(command.startsWith('find '))return '3';if(command.startsWith('mv -nT')){assert.match(command,/'\/storage\/emulated\/0\/new'/);moved=true;return '';}if(command.startsWith('rm -rf'))return '';return moved&&command.includes("'/storage/emulated/0/new'")?'yes':'no';};
  const j=await media.run({deviceId:'d',confirmDevice:'d',action:'archive-extract',sourceJobId:source.id,selected:['a.txt'],destination:'/sdcard',name:'new'});await core.jobs.get(j.id).promise;assert.equal(moved,true);assert.ok(core.calls.some(c=>typeof c==='string'&&c.startsWith('rm -rf')&&c.includes('.adb-desk-archive-')));assert.match(core.jobs.get(j.id).message,/new/);
});
test('source metadata change after staging invalidates preview',async t=>{
  const core=mockCore(await temporary(t));let reads=0;core.handler=()=>++reads===1?core.metadata:core.metadata.replace('|12|','|13|');const media=createFileMedia(core),j=await media.run({deviceId:'d',action:'preview',path:'/sdcard/x.png'});await assert.rejects(core.jobs.get(j.id).promise,/변경/);assert.equal(core.jobs.get(j.id).artifact,undefined);
});
test('new ZIP publication only accepts a same-device successful file batch download',async t=>{
  const core=mockCore(await temporary(t)),media=createFileMedia(core);core.jobs.set('old',{id:'old',deviceId:'d',kind:'preview',state:'success',artifact:'anything'});await assert.rejects(media.run({deviceId:'d',confirmDevice:'d',action:'archive-create',sourceJobId:'old',destination:'/sdcard',name:'a.zip'}),/ZIP/);assert.equal(core.resolveCount,0);
});
test('archive creation stages the existing bounded ZIP without reconstructing selections',async t=>{
  const d=await temporary(t),source=await fixture(d,[{name:'a.txt',data:'abc'}]),bytes=(await stat(source)).size,core=mockCore(d),media=createFileMedia(core);core.jobs.set('batch',{id:'batch',deviceId:'d',kind:'file-batch-download',state:'success',artifact:source});let moved=false;
  core.handler=command=>{if(command.startsWith('readlink'))return '/storage/emulated/0';if(command.startsWith('find '))return String(bytes);if(command.startsWith('mv -nT')){moved=true;return '';}if(command.startsWith('mkdir')||command.startsWith('rm -rf'))return '';return moved&&command.includes("'/storage/emulated/0/a.zip'")?'yes':'no';};
  const j=await media.run({deviceId:'d',confirmDevice:'d',action:'archive-create',sourceJobId:'batch',destination:'/sdcard',name:'a.zip'});await core.jobs.get(j.id).promise;assert.equal(core.calls.find(c=>Array.isArray(c)&&c[0]==='push')[1],source);assert.equal(moved,true);
});
test('UI close and reopen invalidates an earlier session before POST',async()=>{
  const requests=[],sessions=[];let dialog;
  function element(tag){const e={tag,open:false,textContent:'',hidden:false,classList:{toggle(){}},children:new Map(),append(){},setAttribute(){},removeAttribute(){},addEventListener(){},close(){this.open=false;},showModal(){this.open=true;},querySelector(selector){if(!this.children.has(selector))this.children.set(selector,element('child'));return this.children.get(selector);},querySelectorAll(){return [];}};Object.defineProperty(e,'innerHTML',{set(){this.children=new Map();}});return e;}
  const window={},context={window,URLSearchParams,setTimeout,document:{createElement(tag){const e=element(tag);if(tag==='dialog')dialog=e;return e;},body:{append(){}}},fetch(url,options){requests.push({url,options});if(url==='/api/session')return new Promise(resolve=>sessions.push(resolve));throw new Error('No POST expected from stale dialog');}};
  vm.runInNewContext(await readFile(new URL('../public/file-media.js',import.meta.url),'utf8'),context);
  const first=window.FileMedia.openPreview({deviceId:'d',path:'/sdcard/one.png'});window.FileMedia.close();const second=window.FileMedia.openPreview({deviceId:'d',path:'/sdcard/two.png'});sessions[0]({ok:true,json:async()=>({csrfToken:'mock'})});await first;assert.equal(requests.filter(r=>r.options?.method==='POST').length,0);assert.equal(dialog.open,true);sessions[1]({ok:false,json:async()=>({error:'test finish'})});await second;window.FileMedia.close();
});
test('ZIP cancellation waits for an in-flight mkdir before allowing cleanup',async t=>{
  const d=await temporary(t),file=await fixture(d,[{name:'nested/a.txt',data:'abc'}]),out=path.join(d,'out'),blocked=path.join(out,'nested'),original=fileSystem.mkdir,job={cancelled:false};let enter,release,created;
  const entered=new Promise(r=>{enter=r;}),gate=new Promise(r=>{release=r;}),made=new Promise(r=>{created=r;});
  fileSystem.mkdir=async(p,options)=>{if(p===blocked){enter();await gate;const result=await original(p,options);created();return result;}return original(p,options);};syncBuiltinESMExports();
  let rejected=false;try{const processing=extractArchive(file,out,['nested/a.txt'],job).catch(async()=>{rejected=true;await rm(out,{recursive:true,force:true});});await entered;job.cancelled=true;await new Promise(r=>setTimeout(r,130));release();await made;await processing;assert.equal(rejected,true);await assert.rejects(stat(out),e=>e.code==='ENOENT');}finally{release();fileSystem.mkdir=original;syncBuiltinESMExports();}
});
