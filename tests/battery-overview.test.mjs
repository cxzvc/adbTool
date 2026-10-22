import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/resource-overview.js',import.meta.url),'utf8');
function render(charging){
  const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,{hidden:false,innerHTML:'',textContent:'',value:'',clientWidth:800,classList:{toggle(){}},addEventListener(){},querySelector(){return null;},querySelectorAll(){return [];}});return nodes.get(id);};
  const window={},context={window,document:{getElementById:get},ResizeObserver:class{observe(){}},DeskUI:{formatBytes:()=>''}};vm.runInNewContext(source,context);
  const at=Date.UTC(2026,9,16),point={at,event:'sample',session:'test',battery:70,charging};
  window.ResourceOverview.render({collecting:false,error:null,count:1,latest:point,points:[point],sessions:[],serverTime:at,firstAt:at,lastAt:at,intervalMs:5000,range:'all'});
  return{svg:get('overview-plot').innerHTML,label:get('overview-charge-label').textContent};
}
test('unknown charging states remain visibly unknown in both overview line and isolated point',()=>{
  for(const value of [null,undefined,'unexpected']){const view=render(value);assert.match(view.label,/조회 불가/);assert.match(view.svg,/overview-line battery charge-unknown/);assert.match(view.svg,/overview-dot battery charge-unknown/);assert.doesNotMatch(view.svg,/not-charging|overview-charge-band/);}
});
test('known full and not-charging states retain their distinct labels',()=>{
  assert.equal(render('full').label,'충전 완료');assert.equal(render('not-charging').label,'충전하지 않음');assert.equal(render('discharging').label,'방전 중');assert.equal(render('charging').label,'충전 중');
});
