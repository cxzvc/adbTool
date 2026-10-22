import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const fieldSource=await readFile(new URL('../public/workbench-fields.js',import.meta.url),'utf8');
const deviceSource=await readFile(new URL('../public/device.js',import.meta.url),'utf8');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function choices({selected='current',current='0',responseUser,late=false}={}){
  const nodes=new Map(),errors=[],calls=[];let alive=true;
  class Node{constructor(tag='DIV'){this.tagName=tag.toUpperCase();this.value='';this.children=[];this.events={};}setAttribute(){}append(...items){this.children.push(...items);if(this.tagName==='SELECT'&&this.children.length===items.length)this.value=String(items[0]?.value||'');}prepend(...items){this.children.unshift(...items);}replaceChildren(){this.children=[];this.value='';}addEventListener(type,fn){this.events[type]=fn;}removeEventListener(){}replaceWith(node){nodes.set(this.id,node);}}
  const get=id=>{if(!nodes.has(id)){const n=new Node(id.startsWith('wb-field-')?'SELECT':'DIV');n.id=id;nodes.set(id,n);}return nodes.get(id);};
  get('wb-field-user').value=selected;get('wb-field-mode').value='set';let resolveUsers;
  const window={};vm.runInNewContext(fieldSource,{window,document:{getElementById:get,createElement:tag=>new Node(tag)}});
  const request=async(route,body)=>{calls.push({...body});if(body.kind==='users-current'){if(late)await new Promise(resolve=>resolveUsers=resolve);return{user:current,options:[{value:'0',label:'개인'},{value:'10',label:'업무'}]};}return{user:responseUser??body.user,options:[{value:'com.example/.Ime',label:'키보드'}]};};
  const form=window.WorkbenchFields.mount({action:{id:'device-ime-manage',fields:[{name:'user',label:'사용자',choices:'users-current'},{name:'imeId',label:'키보드',choices:'device-ime'}]},deviceId:'phone',current:()=>alive,request,onBusy(){},onError:message=>errors.push(message)});
  return{form,calls,errors,get,leave(){alive=false;},release(){resolveUsers?.();}};
}
test('dependent choices and final field value pin current user before querying the device options',async()=>{
  const f=choices();await settle();assert.equal(f.calls.length,2);assert.equal(f.calls[1].user,'0');assert.equal(f.form.readValue('user'),'0');assert.equal(f.form.ready,true);
});
test('explicit work profile remains selected even when foreground user differs; conflicting scope is rejected',async()=>{
  const explicit=choices({selected:'10',current:'0'});await settle();assert.equal(explicit.form.readValue('user'),'10');assert.equal(explicit.form.ready,true);
  const stale=choices({responseUser:'10'});await settle();assert.equal(stale.form.ready,false);assert.match(stale.errors[0],/사용자.*바뀌/);
});
test('leaving while user selection is pending never queries the dependent device list',async()=>{
  const f=choices({late:true});f.leave();f.release();await settle();assert.equal(f.calls.length,1);assert.equal(f.form.ready,false);
});
test('curated changes send the user from the read snapshot and refuse writes without that snapshot',async()=>{
  const source=deviceSource.slice(deviceSource.indexOf('  async function changeSetting('),deviceSource.indexOf('  window.DeviceDesk ='));
  for(const userId of ['0',undefined]){const requests=[],notices=[],s={id:'phone',epoch:1,data:{userId,settings:[{key:'demo',value:'0'}]},drafts:new Map()},node={disabled:false,hidden:false,classList:{toggle(){}}};
    const context={s,DeskFeedback:{start:()=>()=>{}},notice:(text)=>notices.push(text),document:{querySelectorAll:()=>[]},session:async()=> 'token',fetch:async(url,options)=>{requests.push(JSON.parse(options.body));return{ok:true,json:async()=>({setting:{key:'demo',value:'1'},history:[],message:'done'})};},AbortSignal,renderSettings(){}};
    vm.runInNewContext(source+'\nglobalThis.run=changeSetting;',context);await context.run({action:'set',key:'demo',value:'1',expected:'0'});
    if(userId==='0'){assert.equal(requests.length,1);assert.equal(requests[0].expectedUserId,'0');}else{assert.equal(requests.length,0);assert.match(notices[0],/사용자 정보/);}
  }
});
