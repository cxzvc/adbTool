import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

async function fixture(){
  const values=new Map(),events=new Map(),frames=new Map(),observed=[],mutations=[];let top=255,writes=0,next=0;
  const panel={hidden:false,querySelector:()=>tools},tools={style:{getPropertyValue:key=>values.get(key)||'',setProperty(key,value){values.set(key,value);writes++;},removeProperty(key){values.delete(key);writes++;}},getClientRects:()=>panel.hidden?[]:[{}],getBoundingClientRect:()=>({top})};
  const window={innerWidth:1265,innerHeight:720,addEventListener:(name,handler)=>events.set(name,handler)};
  const context={window,document:{getElementById:id=>id==='monitor-panel'?panel:null,querySelector:()=>null,body:{}},requestAnimationFrame:handler=>{const id=++next;frames.set(id,handler);return id;},cancelAnimationFrame:id=>frames.delete(id),ResizeObserver:class{constructor(callback){this.callback=callback;observed.push(this);}observe(){}},MutationObserver:class{constructor(callback){this.callback=callback;mutations.push(this);}observe(){}},fetch(){assert.fail('Layout must not issue network or phone requests.');}};
  vm.runInNewContext(await readFile(new URL('../public/monitor-layout.js',import.meta.url),'utf8'),context);
  const flush=()=>{const ready=[...frames.values()];frames.clear();for(const callback of ready)callback();};
  return{window,panel,values,events,observed,mutations,flush,frames,get writes(){return writes;},set top(value){top=value;}};
}

test('desktop monitor tools fit below their current visible top, including scrolling',async()=>{
  const f=await fixture();f.flush();assert.equal(f.values.get('--monitor-tools-height'),'453px');assert.equal(f.writes,1);
  f.top=90;f.events.get('scroll')();f.events.get('resize')();assert.equal(f.frames.size,1);f.flush();assert.equal(f.values.get('--monitor-tools-height'),'618px');
  f.top=650;f.events.get('scroll')();f.flush();assert.equal(f.values.get('--monitor-tools-height'),'240px');
});

test('resize notifications do not rewrite identical heights and hidden/mobile layouts clear the limit',async()=>{
  const f=await fixture();f.flush();f.observed[0].callback();f.flush();assert.equal(f.writes,1);
  f.window.innerWidth=1100;f.events.get('resize')();f.flush();assert.equal(f.values.has('--monitor-tools-height'),false);const writes=f.writes;f.observed[0].callback();f.flush();assert.equal(f.writes,writes);
  f.window.innerWidth=1265;f.events.get('resize')();f.flush();assert.equal(f.values.get('--monitor-tools-height'),'453px');f.panel.hidden=true;f.mutations[0].callback();f.flush();assert.equal(f.values.has('--monitor-tools-height'),false);
  f.panel.hidden=false;f.mutations[0].callback();f.flush();assert.equal(f.values.get('--monitor-tools-height'),'453px');
});
