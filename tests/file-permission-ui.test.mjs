import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/operations.js',import.meta.url),'utf8');
function fixture(reply){
  const nodes=new Map(),states=[],calls=[];
  const get=id=>{if(!nodes.has(id))nodes.set(id,{id,value:id==='files-sort'?'name':'',textContent:'',innerHTML:'',scrollTop:0});return nodes.get(id);};
  const old={path:'/old',entries:[{path:'/old/kept.txt',name:'kept.txt',type:'file',size:9,modified:1}]};
  const s={id:'mock-phone',epoch:1,path:'/old',fileData:old,busy:new Set(),nextPath:null};
  const context={s,$:get,window:{DeviceTargets:{updateFiles(){}}},esc:String,bytes:String,when:String,DeskFeedback:{state:(host,options)=>states.push({host:host.id,options})},showFileLoading(){},guarded:async(_key,work)=>{try{await work(s.epoch);}catch{}},api:async(route,params)=>{calls.push({route,params});return reply;}};
  const render=source.slice(source.indexOf('  function renderFiles('),source.indexOf('  function showFileLoading('));
  const load=source.slice(source.indexOf('  async function loadFiles('),source.indexOf("  $('files-search').oninput="));
  vm.runInNewContext(render+'\n'+load+'\nthis.load=loadFiles;',context);return{context,s,get,states,calls,old};
}
test('a completely denied folder read retains the last successful path and retries only that failed read',async()=>{
  const f=fixture({path:'/data',parent:'/',entries:[],partial:true,errors:[{path:'/data',operation:'list',rawError:'Permission denied'}]});await f.context.load('/data');
  assert.equal(f.s.path,'/old');assert.equal(f.s.fileData,f.old);
  const card=f.states.at(-1).options;assert.equal(card.type,'error');assert.match(card.message,/\/data.*이전/);assert.equal(card.rawError,'Permission denied');assert.equal(card.errorContext.context,'files');
  assert.equal(f.calls.length,1);await card.onAction();assert.equal(f.calls.length,2);assert.equal(f.calls[1].params.path,'/data');assert.ok(f.calls.every(call=>call.route==='files'));
});
test('a readable folder with unreadable entry metadata is not rendered as a genuinely empty folder',async()=>{
  const f=fixture({path:'/restricted',parent:'/',entries:[],partial:true,warnings:['stat failed'],errors:[{path:'/restricted/hidden',operation:'stat',rawError:'Permission denied'}]});await f.context.load('/restricted');
  assert.equal(f.s.path,'/restricted');const list=f.states.find(row=>row.host==='file-list'&&row.options)?.options;
  assert.equal(list.type,'warning');assert.doesNotMatch(list.title,/빈 폴더/);assert.match(list.message,/빈 폴더라고 단정하지/);assert.match(f.get('files-count').textContent,/일부 목록 미확인/);
  assert.equal(f.states.at(-1).options.rawError,'/restricted/hidden: Permission denied');
});
test('partial folder results keep readable files and a true empty folder keeps its empty state',async()=>{
  const partial=fixture({path:'/partial',parent:'/',entries:[{name:'visible',path:'/partial/visible',type:'file',size:3,modified:1}],partial:true,errors:[{path:'/partial/hidden',operation:'stat',rawError:'EACCES'}]});await partial.context.load('/partial');
  assert.match(partial.get('file-list').innerHTML,/visible/);assert.equal(partial.states.at(-1).options.type,'warning');
  const empty=fixture({path:'/empty',parent:'/',entries:[],partial:false,errors:[]});await empty.context.load('/empty');
  const card=empty.states.find(row=>row.host==='file-list'&&row.options).options;assert.equal(card.type,'empty');assert.equal(card.title,'빈 폴더입니다');
});
test('denied folders offer an explicit read of the shared store without retrying the protected path',async()=>{
 const f=fixture({path:'/data/private',entries:[],partial:true,errors:[{path:'/data/private',operation:'list',rawError:'Permission denied'}]});await f.context.load('/data/private');
 const choices=f.states.at(-1).options.actions;assert.equal(f.calls.length,1);assert.ok(choices.every(choice=>/조회$/.test(choice.label)));const shared=choices.find(choice=>choice.label==='공유 저장소 조회');assert.match(shared.description,/앱 내부 자료와는 다릅니다/);await shared.onAction();assert.equal(f.calls.length,2);assert.equal(f.calls[1].params.path,'/sdcard');assert.ok(f.calls.every(call=>call.route==='files'));
});
test('file alternative choices expire when the current folder or device changes',async()=>{
 const f=fixture({path:'/data/private',entries:[],partial:true,errors:[{path:'/data/private',operation:'list',rawError:'EACCES'}]});await f.context.load('/data/private');const choice=f.states.at(-1).options.actions[0];
 f.s.path='/other';await choice.onAction();assert.equal(f.calls.length,1);f.s.path='/old';f.s.id='different-device';await choice.onAction();assert.equal(f.calls.length,1);
});
test('a disconnected folder has no permission-based alternative choices',async()=>{
 const f=fixture({path:'/data',entries:[],partial:true,errors:[{operation:'list',rawError:'device offline'}]});await f.context.load('/data');assert.equal(f.states.at(-1).options.actions.length,0);
});
