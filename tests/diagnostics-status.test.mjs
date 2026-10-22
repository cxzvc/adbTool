import test from 'node:test';
import assert from 'node:assert/strict';
import {createDiagnostics,parseIntervalTop} from '../lib/diagnostics.mjs';
const top='\n  800%cpu 800%idle\n  1 root 0.0 0.0 1K init\n\n  800%cpu 640%idle\n  123 shell 40.0 0.2 1K test';
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(overrides={}){let at=0,resolutions=0;const shell=async(serial,command)=>{
  if(command==='cat /proc/meminfo')return 'MemTotal: 1000000 kB\nMemAvailable: 500000 kB';
  if(command==='cat /proc/uptime')return '0.00 0.00';
  if(command.startsWith('top '))return top;
  if(command==='dumpsys battery')return 'level: 50\nscale: 200\ntemperature: 320';
  return '';
};const core={resolve:async()=>{resolutions++;return{serial:'fake',device:{id:'fake'}};},shell,...overrides};const api=createDiagnostics(core,{now:()=>at});return{api,core,shell,setTime:value=>at=value,get resolutions(){return resolutions;}};}
test('blank and indented second top frame uses the actual interval header',()=>{const value=parseIntervalTop(top);assert.equal(value.usage,20);assert.equal(value.cores,8);assert.equal(value.processes.get(123).cpu,40);});
test('status preserves zero uptime, respects battery scale and refuses impossible values',async()=>{
  const f=fixture(),value=await f.api.status('phone');assert.equal(value.uptimeSeconds,0);assert.equal(value.battery.level,25);
  for(const invalid of ['level: -1\nscale: 100\ntemperature: 2147483647','level: 101\nscale: 100\ntemperature: -9999']){const f=fixture();const shell=f.core.shell;f.core.shell=(s,c)=>c==='dumpsys battery'?Promise.resolve(invalid):c==='cat /proc/uptime'?Promise.resolve('-1 0'):shell(s,c);const bad=await f.api.status('phone');assert.equal(bad.battery.level,null);assert.equal(bad.battery.temperature,null);assert.equal(bad.uptimeSeconds,null);}
});
test('pending status is shared beyond the freshness window and freshness starts at completion',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve),f=fixture(),shell=f.core.shell;f.core.shell=(s,c)=>c.startsWith('top ')?gate:shell(s,c);
  const first=f.api.status('phone');await settle();f.setTime(2000);const second=f.api.status('phone');release(top);const [a,b]=await Promise.all([first,second]);assert.equal(a,b);assert.equal(f.resolutions,1);f.setTime(2500);await f.api.status('phone');assert.equal(f.resolutions,1);
});
test('an older rejected request cannot evict a newer valid snapshot',async()=>{
  let reject;const gate=new Promise((_,no)=>reject=no),f=fixture();let calls=0;f.core.resolve=async()=>{if(++calls===1)return gate;return{serial:'fake',device:{id:'fake'}};};
  const old=f.api.status('phone');f.api.invalidate('phone');const fresh=await f.api.status('phone');reject(new Error('old connection'));await assert.rejects(()=>old);assert.equal(await f.api.status('phone'),fresh);assert.equal(calls,2);
});
test('successful dumpsys exit with permission or timeout text remains unavailable',async()=>{
  const f=fixture(),shell=f.core.shell;f.core.shell=(s,c)=>c==='dumpsys battery'?Promise.resolve('Permission Denial: cannot dump battery'):shell(s,c);const value=await f.api.status('phone');assert.equal(value.battery.level,null);assert.ok(value.unavailable.some(text=>text.startsWith('배터리:')));
});
