import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/operations.js',import.meta.url),'utf8');
function fixture(){
 const nodes=new Map(),states=[],calls=[];const get=id=>{if(!nodes.has(id))nodes.set(id,{value:'',dataset:{},hidden:false,textContent:'',innerHTML:'',checked:false,querySelector:()=>({id:'empty-log-state'})});return nodes.get(id);};
 get('logs-buffer').value='kernel';get('logs-level').value='W';get('logs-package').value='com.example';get('logs-package').dataset.user='10';
 const s={id:'phone',epoch:1,busy:new Set(),logs:[],seen:new Set(),logAfter:0};
 const context={s,$:get,window:{AppInventory:{user:'10',currentUser:'0'},DeskErrors:{isFailureText:text=>/Permission denied/.test(text)}},DeskFeedback:{state:(host,options)=>states.push({host,options})},DeskUI:{filterLogs:rows=>rows,formatLogTime:()=>''},esc:String,when:String,guarded:async(_key,work)=>work(s.epoch),api:async(route,params)=>{calls.push({route,params});return {entries:[],notice:'Permission denied opening kernel log buffer'};}};
 vm.runInNewContext(source.slice(source.indexOf('  let logScopeRevision=0;'),source.indexOf("  $('logs-refresh').onclick="))+'\nthis.load=loadLogs;',context);return{context,s,get,states,calls};
}
test('denied logs offer public buffers only on click, preserve app and user scope, and use GET reader',async()=>{
 const f=fixture();await f.context.load();const card=f.states.findLast(row=>row.host===f.get('logs-error')&&row.options).options;
 assert.equal(f.calls.length,1);assert.equal(card.actions.length,3);assert.ok(card.actions.every(action=>action.description.includes('같은 자료는 아닙니다')));
 await card.actions.find(action=>action.label==='일반 앱 로그 조회').onAction();assert.equal(f.calls.length,2);assert.equal(f.calls[1].route,'logs');assert.equal(f.calls[1].params.buffer,'main');assert.equal(f.calls[1].params.package,'com.example');assert.equal(f.calls[1].params.user,'10');assert.equal(f.calls[1].params.level,'W');
});
test('changing a log filter or device epoch expires old alternatives',async()=>{
 const f=fixture();await f.context.load();const card=f.states.findLast(row=>row.host===f.get('logs-error')&&row.options).options,choice=card.actions[0];f.get('logs-package').value='com.other';await choice.onAction();assert.equal(f.calls.length,1);f.get('logs-package').value='com.example';f.s.epoch++;await choice.onAction();assert.equal(f.calls.length,1);
});
