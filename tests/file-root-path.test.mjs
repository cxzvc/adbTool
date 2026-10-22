import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

test('main file navigation normalizes legacy root paths before loading, error display and retry',async()=>{
  const text=await readFile(new URL('../public/operations.js',import.meta.url),'utf8');
  const code=text.slice(text.indexOf('  async function loadFiles('),text.indexOf("  $('files-search').oninput="));
  const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,{value:'',scrollTop:0});return nodes.get(id);};
  const s={id:'mock-phone',epoch:1,path:'/',busy:new Set(),nextPath:null},requests=[],loading=[],states=[];
  const context={s,$:get,window:{},DeskFeedback:{state:(host,config)=>states.push(config)},showFileLoading:(...args)=>loading.push(args),guarded:async(label,work)=>{try{await work(s.epoch);}catch{}},api:async(route,params)=>{requests.push({route,params});throw new Error('Permission denied');},renderFiles(){assert.fail('a failed read must not replace the old listing');}};
  vm.runInNewContext(code+'\nthis.load=loadFiles;',context);await context.load('//data');
  assert.equal(requests[0].params.path,'/data');assert.equal(loading[0][1],'/data');assert.match(states.at(-1).message,/^\/data 위치.*이전.*\//);assert.equal(states.at(-1).rawError,'Permission denied');assert.doesNotMatch(states.at(-1).message,/\/\/data/);
  await states.at(-1).onAction();assert.equal(requests[1].params.path,'/data');assert.equal(get('files-path').value,'/');
});
