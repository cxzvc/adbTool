import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../public/app-inventory.js',import.meta.url),'utf8');
for(const button of ['apps-labels-read','apps-usage-read','apps-storage-read','apps-apk-size-read'])test(`${button} cannot dispatch an old-device request after a delayed session token`,async()=>{
  const elements=[],calls=[];let device='old',release;const gate=new Promise(resolve=>release=resolve),make=tag=>{const item={tag,children:[],events:{},value:'',setAttribute(){},append(...rows){this.children.push(...rows);},before(){},replaceChildren(...rows){this.children=rows;},addEventListener(type,callback){this.events[type]=callback;},get options(){return this.children;}};elements.push(item);return item;},get=id=>elements.find(item=>item.id===id)||null;make('div').id='apps-list';
  const ctx={window:{},document:{getElementById:get,createElement:make,querySelectorAll:selector=>selector.includes(':checked')?[{value:'com.test'}]:[]},URLSearchParams,setTimeout,fetch:async url=>{calls.push(url);if(url==='/api/session')return gate;throw new Error('An old-device POST was dispatched');}};vm.runInNewContext(source,ctx);const api=ctx.window.AppInventory;api.init({getDevice:()=>device,onEnriched:()=>assert.fail('must not refresh another device')});api.setContext({currentUserId:'0',users:[{id:'0',name:'owner',current:true}],apps:[]});const pending=get(button).events.click();device='new';api.reset();release({ok:true,json:async()=>({csrfToken:'token'})});await pending;assert.deepEqual(calls,['/api/session']);assert.doesNotMatch(get('apps-inventory-note').textContent,/old-device/);assert.equal(get(button).disabled,false);
});
