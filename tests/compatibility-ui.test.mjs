import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/compatibility-ui.js',import.meta.url),'utf8');
const baseline=(extra={})=>({support:{state:'supported',labelKo:'지원 조건 확인'},access:{state:'allowed',labelKo:'접근 가능'},evidence:{state:'current',labelKo:'현재 빌드 코드 확인'},effect:{state:'untested',labelKo:'실제 효과 미시험'},canRead:true,canWrite:true,reasonKo:'전체 권한 판정 이유입니다.',requiredAccessKo:'android.permission.WRITE_DEVICE_CONFIG',source:{model:'TEST_MODEL',build:'TEST_BUILD',method:'정적 코드 분석'},...extra});
function harness(){
  const events=new Map(),nodes=[];let focused=null;
  class Element{
    constructor(tag){this.tagName=tag;this.open=false;this.events=new Map();this.attributes={};this.dataset={};this.isConnected=true;this.innerHTML='';this.closeButton={focus(){focused=this;}};}
    setAttribute(k,v){this.attributes[k]=v;}
    addEventListener(k,fn){this.events.set(k,fn);}
    querySelector(selector){return selector==='[data-compatibility-close]'?this.closeButton:null;}
    showModal(){this.open=true;}
    close(){this.open=false;this.events.get('close')?.();}
    focus(){focused=this;}
  }
  const document={body:{append(node){nodes.push(node);}},activeElement:null,createElement:tag=>new Element(tag),addEventListener:(name,fn)=>events.set(name,fn)};
  const context={window:{},document,fetch:()=>assert.fail('Detail viewing must not access the phone or network')};vm.runInNewContext(source,context);
  return {api:context.window.CompatibilityUI,nodes,focused:()=>focused,open(html){const trigger=new Element('button');trigger.dataset.compatibilityDetails=/data-compatibility-details="(\d+)"/.exec(html)[1];trigger.closest=selector=>selector==='[data-compatibility-details]'?trigger:null;events.get('click')({target:trigger});return trigger;}};
}
test('one primary status describes executable action rather than presenting four equal badges',()=>{
  const h=harness(),data=baseline({access:{state:'denied',labelKo:'권한 제한'},canWrite:false});
  const html=h.api.summary(data,{mode:'write',reason:'현재 ADB 허용 목록에 이 설정이 없어 변경할 수 없습니다.'});
  assert.equal((html.match(/class="compatibility-badge /g)||[]).length,1);
  assert.match(html,/조회만 가능/);assert.doesNotMatch(html,/지원 조건 확인|현재 빌드 코드 확인|WRITE_DEVICE_CONFIG|TEST_MODEL/);
  assert.equal((html.match(/실제 효과 미확인/g)||[]).length,1);assert.equal((html.match(/허용 목록/g)||[]).length,1);
});
test('presentation states are independent of code verification and never change server data',()=>{
  const h=harness();
  for(const [data,opts,label] of [[baseline(),{mode:'read'},'조회 가능'],[baseline(),{mode:'write'},'변경 요청 가능'],[baseline(),{loading:true},'조회 중'],[baseline(),{error:true},'조회 실패'],[baseline(),{selectionRequired:true},'대상 선택'],[null,{},'조회 전'],[baseline({support:{state:'unsupported'},canWrite:false}),{},'미지원'],[baseline({evidence:{state:'previous'},canWrite:false}),{},'현재 빌드 확인 필요']]){
    const before=JSON.stringify(data);assert.equal(h.api.present(data,opts).label,label);assert.equal(JSON.stringify(data),before);
  }
  assert.equal(h.api.present(baseline({access:{state:'denied'},canRead:false,canWrite:false}),{mode:'read',canAct:false}).label,'조회 제한');
});
test('empty short reason intentionally suppresses repeated explanation without discarding full details',()=>{
  const h=harness(),data=baseline(),opts={reason:'',showStatus:false,showEffect:false};
  assert.doesNotMatch(h.api.summary(data,opts),/판정 이유|compatibility-badge|실제 효과/);
  assert.match(h.api.detailContent(data,opts),/전체 권한 판정 이유/);
});
test('detail opens a read-only dialog with all evidence, restores focus and never makes a request',()=>{
  const h=harness(),html=h.api.summary(baseline(),{title:'시험 상세 정보',sections:[{label:'코드 근거',text:'Code.java:10\nFLAG = true'}]});
  const trigger=h.open(html),dialog=h.nodes[0];
  assert.equal(dialog.open,true);assert.equal(dialog.attributes['aria-labelledby'],'compatibility-detail-title');assert.equal(h.focused(),dialog.closeButton);
  assert.match(dialog.innerHTML,/기능 지원|현재 권한|코드 검증|실제 효과/);assert.match(dialog.innerHTML,/WRITE_DEVICE_CONFIG|TEST_MODEL|TEST_BUILD|Code.java:10/);
  assert.equal((dialog.innerHTML.match(/<button/g)||[]).length,1);assert.doesNotMatch(dialog.innerHTML,/<form|<input|data-privacy-set|data-gps-action/);
  h.api.closeDetails();assert.equal(dialog.open,false);assert.equal(h.focused(),trigger);
});
test('closing after the originating button was removed does not move focus into a stale view',()=>{
  const h=harness(),trigger=h.open(h.api.detailButton(baseline()));trigger.isConnected=false;
  h.api.closeDetails();assert.notEqual(h.focused(),trigger);
});
test('technical errors, source excerpts and titles are escaped, while no functional action is in details',()=>{
  const h=harness(),data=baseline({reasonKo:'<img src=x onerror=bad>',source:{build:'<script>bad</script>'}});
  h.open(h.api.detailButton(data,{title:'<script>상세</script>',sections:[{label:'<b>오류 원문</b>',text:'<button onclick="reboot()">실행</button>'}]}));
  const html=h.nodes[0].innerHTML;assert.doesNotMatch(html,/<script>|<img |<button onclick=/);assert.match(html,/&lt;script&gt;|&lt;img/);assert.equal((html.match(/<button/g)||[]).length,1);
});
