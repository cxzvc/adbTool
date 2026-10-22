import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {feedbackFixture} from './mirror-feedback-fixture.mjs';

const source=await readFile(new URL('../public/mirror-media-ui.js',import.meta.url),'utf8');
function fixture({fetchHandler,feedback}={}){
  const nodes=new Map(),requests=[],sent=[];let applied=0;
  class Element{
    constructor(tag='div'){this.tagName=tag.toUpperCase();this.value='';this.checked=false;this.disabled=false;this.textContent='';this.options=[];this.handlers=new Map();this.children=[];this._html='';}
    set id(value){this._id=value;nodes.set(value,this);}get id(){return this._id;}
    set innerHTML(value){
      this._html=value;
      if(this.tagName==='SELECT'){this.options=[...value.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)].map(match=>({value:match[1].match(/value="([^"]*)"/)?.[1]||'',disabled:/\bdisabled\b/.test(match[1]),selected:/\bselected\b/.test(match[1])}));this.value=(this.options.find(o=>o.selected)||this.options[0])?.value||'';return;}
      for(const match of value.matchAll(/<(select|input|button|p|div)\b([^>]*\bid="([^"]+)"[^>]*)>/g)){
        const element=new Element(match[1]);element.id=match[3];element.checked=/\bchecked\b/.test(match[2]);element.disabled=/\bdisabled\b/.test(match[2]);element.parentElement=this;this.children.push(element);
        if(match[1]==='select'){const end=value.indexOf('</select>',match.index);element.innerHTML=value.slice(match.index+match[0].length,end);}
      }
    }
    get innerHTML(){return this._html;}
    after(element){this.following=element;}
    addEventListener(type,handler){const handlers=this.handlers.get(type)||[];handlers.push(handler);this.handlers.set(type,handlers);}
    dispatchEvent(event){this['on'+event.type]?.(event);for(const handler of this.handlers.get(event.type)||[])handler(event);}
    click(){if(!this.disabled)return this.onclick?.({type:'click'});}
    replaceChildren(){this.children=[];this._html='';}
  }
  const anchor=new Element(),streamAudio=new Element('input'),streamApply=new Element('button');streamAudio.id='stream-audio';streamApply.id='stream-apply';streamApply.onclick=()=>applied++;
  const window={DeskFeedback:feedback};vm.runInNewContext(source,{window,document:{readyState:'complete',getElementById:id=>nodes.get(id)||null,querySelector:selector=>selector==='.stream-audio-controls'?anchor:null,createElement:tag=>new Element(tag)},URL,URLSearchParams,Event:class{constructor(type,options={}){this.type=type;Object.assign(this,options);}},setTimeout:()=>1,clearTimeout(){},fetch:async url=>{requests.push(url);if(fetchHandler)return fetchHandler(url);throw new Error('Unexpected request');}});
  const socket={readyState:1,addEventListener(){},send:data=>sent.push(JSON.parse(data))};window.MirrorMediaUI.setConnection(socket,{codec:'vp9'});
  return{api:window.MirrorMediaUI,window,node:id=>nodes.get(id),requests,sent,get applied(){return applied;}};
}

test('all media connection choices remain local until the common apply action',()=>{
  const f=fixture();assert.equal(f.node('media-audio-apply'),undefined);
  f.node('media-audio-only').checked=true;f.node('media-audio-only').dispatchEvent({type:'change'});assert.equal(f.node('stream-audio').checked,true);
  f.node('media-source').value='mic';f.node('media-source').dispatchEvent({type:'change'});assert.equal(f.node('media-duplicate').disabled,true);
  f.node('media-audio-codec').value='opus';f.node('media-audio-codec').dispatchEvent({type:'change'});
  f.api.setCapabilities({encoders:[{kind:'audio',codec:'opus',name:'c2.android.opus.encoder'}]});f.node('media-audio-encoder').value='c2.android.opus.encoder';
  for(const[id,value]of [['media-audio-bitrate','192'],['media-buffer','500'],['media-format','webm']]){f.node(id).value=value;f.node(id).dispatchEvent({type:'change'});}
  for(const id of ['media-duplicate','media-audio-playback','media-audio-required']){f.node(id).checked=!f.node(id).checked;f.node(id).dispatchEvent({type:'change'});}
  const options=f.api.params();assert.equal(options.get('audioCodec'),'opus');assert.equal(options.get('audioSource'),'mic');assert.equal(options.get('audioOnly'),'1');assert.equal(options.get('audioEncoder'),'c2.android.opus.encoder');
  f.node('media-use-raw').click();assert.equal(f.api.params().get('audioCodec'),'raw');assert.deepEqual(f.requests,[]);assert.deepEqual(f.sent,[]);assert.equal(f.applied,0);
  assert.doesNotMatch(source,/\.click\(|new WebSocket|startMirror|restart\(/);
});

test('native recording start, save and cancel remain explicit independent actions',()=>{
  const f=fixture();f.node('media-start').click();f.node('media-stop').click();f.node('media-cancel').click();assert.deepEqual(f.sent.map(message=>message.type),['media-start','media-stop','media-cancel']);assert.equal(f.applied,0);assert.deepEqual(f.requests,[]);assert.equal(f.sent[0].format,'mkv');assert.equal(f.sent[0].maxMinutes,30);assert.equal(f.sent[0].maxMB,512);
});

test('media markup groups connection choices, PC playback and native recording without removing retained controls',()=>{
  const f=fixture(),markup=f.node('mirror-media-options').innerHTML;
  for(const group of ['connection','playback','recording'])assert.ok(markup.includes(`data-media-section="${group}"`));
  for(const id of ['media-source','media-buffer','media-audio-codec','media-audio-encoder','media-audio-playback','media-audio-required','media-start','media-stop','media-cancel','media-load-encoders','media-refresh'])assert.ok(f.node(id),id);
  assert.match(markup,/상단 적용/);assert.match(markup,/원본 녹화/);assert.match(markup,/재생 여부·버퍼는 상단 적용 후 반영/);assert.doesNotMatch(markup,/<details|소리 옵션 적용/);
});

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const response=data=>({ok:true,json:async()=>data});
const turn=()=>new Promise(resolve=>setImmediate(resolve));
test('PCM shortcut notifies dependent local controls once without applying the connection',()=>{const f=fixture();let changes=0;f.node('media-audio-codec').value='opus';f.node('media-audio-codec').addEventListener('change',()=>changes++);f.node('media-use-raw').click();assert.equal(changes,1);assert.equal(f.api.params().get('audioCodec'),'raw');assert.equal(f.node('media-audio-bitrate').disabled,true);assert.deepEqual(f.sent,[]);assert.deepEqual(f.requests,[]);});
test('a late recording list response cannot overwrite a newer refresh for the same device',async()=>{const pending=[],f=fixture({fetchHandler:()=>{const d=deferred();pending.push(d);return d.promise;}});f.api.setDevice('A');pending[0].resolve(response({items:[]}));await turn();const older=f.node('media-refresh').click(),newer=f.node('media-refresh').onclick();pending[2].resolve(response({items:[{name:'new-file.mkv',url:'/api/mirror-recordings/12345678-1234-1234-1234-123456789abc?deviceId=A',state:'complete',created:new Date().toISOString(),bytes:1024}]}));await newer;const html=f.node('media-recordings').innerHTML;assert.match(html,/new-file.mkv/);pending[1].resolve(response({items:[]}));await older;assert.equal(f.node('media-recordings').innerHTML,html);});
test('encoder lookup from the previous device cannot keep a button locked or release the next lookup',async()=>{const pending=[],f=fixture({fetchHandler:url=>{if(url.startsWith('/api/mirror-recordings'))return response({items:[]});const d=deferred();pending.push(d);return d.promise;}});f.api.setDevice('A');const older=f.node('media-load-encoders').click();assert.equal(f.node('media-load-encoders').disabled,true);f.api.setDevice('B');assert.equal(f.node('media-load-encoders').disabled,false);const newer=f.node('media-load-encoders').click();pending[0].resolve(response({encoders:[{kind:'audio',codec:'opus',name:'old.encoder'}]}));await older;assert.equal(f.node('media-load-encoders').disabled,true);pending[1].resolve(response({encoders:[]}));await newer;assert.equal(f.node('media-load-encoders').disabled,false);assert.doesNotMatch(f.node('media-audio-encoder').innerHTML,/old.encoder/);});
test('preflight validates the captured options and a late prior-device failure does not replace the new help',async()=>{const f=fixture(),pending=deferred(),codecs=[];f.window.MirrorAudioDecoder={preflight:codec=>{codecs.push(codec);return pending.promise;}};f.api.setDevice('A');const older=f.api.preflight({audioEnabled:true,playbackEnabled:true,audioCodec:'opus'});assert.deepEqual(codecs,['opus']);f.api.setDevice('B');f.node('media-codec-help').textContent='new device help';pending.reject(new Error('old audio unsupported'));await assert.rejects(older,/old audio/);assert.equal(f.node('media-codec-help').textContent,'new device help');await f.api.preflight({audioEnabled:false,playbackEnabled:true,audioCodec:'aac'});assert.deepEqual(codecs,['opus']);});
test('refreshing capabilities preserves an encoder that remains supported for the selected codec',()=>{const f=fixture();f.node('media-audio-codec').value='opus';f.api.setCapabilities({encoders:[{kind:'audio',codec:'opus',name:'chosen.encoder'}]});f.node('media-audio-encoder').value='chosen.encoder';f.api.setCapabilities({encoders:[{kind:'audio',codec:'opus',name:'chosen.encoder'},{kind:'audio',codec:'aac',name:'aac.encoder'}]});assert.equal(f.node('media-audio-encoder').value,'chosen.encoder');f.node('media-audio-codec').value='aac';f.node('media-audio-codec').dispatchEvent({type:'change'});assert.equal(f.node('media-audio-encoder').value,'');});
test('saved-file reads show pending and an offline retry never restarts recording',async()=>{const feedback=feedbackFixture(),pending=[],f=fixture({feedback:feedback.api,fetchHandler:()=>{const d=deferred();pending.push(d);return d.promise;}});f.api.setDevice('A');assert.equal(f.node('media-list-state').state.type,'loading');assert.equal(f.node('media-refresh').busy,true);pending[0].reject(new Error('Failed to fetch'));await turn();assert.equal(f.node('media-list-state').state.type,'offline');assert.equal(f.node('media-refresh').disabled,false);assert.equal(f.requests.length,1);const retry=f.node('media-list-state').state.onAction();pending[1].resolve(response({items:[]}));await retry;assert.equal(f.node('media-list-state').state.type,'empty');assert.equal(f.node('media-refresh').busy,false);assert.deepEqual(f.sent,[]);});
test('encoder absence and explicit unsupported errors use different states and close cancels busy feedback',async()=>{const feedback=feedbackFixture(),pending=[],f=fixture({feedback:feedback.api,fetchHandler:url=>url.includes('recordings')?response({items:[]}):new Promise(resolve=>pending.push(resolve))});f.api.setDevice('A');const empty=f.node('media-load-encoders').click();assert.equal(f.node('media-encoder-state').state.type,'loading');pending[0](response({encoders:[]}));await empty;assert.equal(f.node('media-encoder-state').state.type,'empty');const unsupported=f.node('media-load-encoders').click();pending[1]({ok:false,json:async()=>({error:'audio encoders not supported'})});await unsupported;assert.equal(f.node('media-encoder-state').state.type,'warning');const last=f.node('media-load-encoders').click();assert.equal(f.node('media-load-encoders').busy,true);f.api.setDevice(null);assert.equal(f.node('media-load-encoders').busy,false);pending[2](response({encoders:[]}));await last;assert.equal(f.node('media-encoder-state').state,null);assert.deepEqual(f.sent,[]);});
