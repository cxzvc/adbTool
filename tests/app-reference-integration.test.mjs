import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/device.js',import.meta.url),'utf8');
function fixture(){let callback,user='0',painted=0,errors=[];const pending=[];const s={id:'phone',epoch:1},inventories={apps:{data:[{package:'com.example.app',label:'real label'}],requestId:1}};
 const AppReference={refreshInventory:rows=>new Promise((resolve,reject)=>pending.push({rows,resolve,reject}))};
 const context={s,inventories,AppReference,window:{AppReference},appScope:()=>user,document:{addEventListener:(_,fn)=>callback=fn},renderInventory:()=>painted++,notice:message=>errors.push(message)};
 vm.runInNewContext(source.slice(source.indexOf('  let referenceRefresh='),source.indexOf("  window.addEventListener('pagehide'")),context);
 return{run:()=>callback(),pending,s,inventories,user(value){user=value;},get painted(){return painted;},errors};
}
test('reference update enriches existing app rows without requesting phone inventory',async()=>{const h=fixture(),rows=[{package:'com.example.app',label:'real label',knowledge:{summary:'updated'}}];const task=h.run();assert.equal(h.pending[0].rows,h.inventories.apps.data);h.pending[0].resolve(rows);await task;assert.equal(h.inventories.apps.data,rows);assert.equal(h.painted,1);});
test('reference update rejects stale updates and errors after newer revisions or profile changes',async()=>{const h=fixture(),old=h.run(),fresh=h.run(),rows=[{package:'com.example.app',knowledge:{summary:'new'}}];h.pending[1].resolve(rows);await fresh;h.pending[0].resolve([{package:'old'}]);await old;assert.equal(h.inventories.apps.data,rows);assert.equal(h.painted,1);const profile=h.run();h.user('10');h.pending[2].reject(new Error('old profile'));await profile;assert.equal(h.errors.length,0);assert.equal(h.painted,1);});
