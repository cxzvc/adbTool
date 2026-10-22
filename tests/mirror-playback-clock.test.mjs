import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../public/mirror-playback-clock.js',import.meta.url),'utf8');
function fixture(options={}){
  let perf=100,audioTime=10,next=1;const tasks=new Map(),statuses=[],resets=[],drawn=[],disposed=[];
  const audio={state:'running',get currentTime(){return audioTime;},baseLatency:.003,outputLatency:.017,getOutputTimestamp(){return{contextTime:audioTime-.02,performanceTime:perf*1000};}};
  const window={};vm.runInNewContext(source,{window,performance:{now:()=>perf*1000},setTimeout(){},clearTimeout(){}});
  const clock=window.MirrorPlaybackClock.create({performanceNow:()=>perf,getAudioContext:()=>options.noAudio?null:audio,schedule:(fn,ms)=>{const id=next++;tasks.set(id,{fn,at:perf+ms/1000});return id;},cancel:id=>tasks.delete(id),status:s=>statuses.push(s),reset:r=>resets.push(r),...options});
  function advance(ms){const end=perf+ms/1000;let count=0;while(true){const item=[...tasks.entries()].filter(([,v])=>v.at<=end+1e-9).sort((a,b)=>a[1].at-b[1].at)[0];if(!item)break;if(++count>1000)throw new Error('timer loop');const delta=Math.max(0,item[1].at-perf);perf+=delta;if(audio.state==='running')audioTime+=delta;tasks.delete(item[0]);item[1].fn();}const delta=end-perf;perf=end;if(audio.state==='running')audioTime+=delta;}
  const video=(pts,bytes=100)=>clock.video({pts,bytes,draw:()=>drawn.push(pts),dispose:()=>disposed.push(pts)});
  return{clock,audio,advance,video,tasks,statuses,resets,drawn,disposed};
}
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<.00001,`${actual} != ${expected}`);

test('same device PTS maps audio and video to a shared AudioContext clock with output delay compensation',()=>{
  const f=fixture(),plan=f.clock.audioPlan(1000000,.02);near(plan.when,10.1);f.video(1000000);f.advance(117);assert.equal(f.drawn.length,0);f.advance(4);assert.deepEqual(f.drawn,[1000000]);assert.deepEqual(f.disposed,[1000000]);
  near(f.clock.audioPlan(1040000,.02).when,10.14);f.clock.close();
});
test('audio arriving after video uses the existing common origin, not a new per-track delay',()=>{
  const f=fixture();f.video(5000000);f.advance(20);const plan=f.clock.audioPlan(5000000,.02);near(plan.when,10.1);f.advance(101);assert.equal(f.drawn.length,1);f.clock.close();
});
test('late audio is trimmed at its common target time instead of replaying old samples late',()=>{
  const f=fixture();f.clock.audioPlan(1000000,.03);f.advance(110);const plan=f.clock.audioPlan(1000000,.03);near(plan.offset,.01);near(plan.duration,.02);near(plan.when,10.11);f.advance(40);assert.equal(f.clock.audioPlan(1000000,.03).drop,true);f.clock.close();
});
test('a discontinuous audio PTS resets both scheduled tracks and drops old video resources',()=>{
  const f=fixture();f.clock.audioPlan(1000000,.02);f.video(1000000);const plan=f.clock.audioPlan(9000000,.02);assert.equal(plan.drop,false);assert.equal(f.resets.length,1);assert.deepEqual(f.disposed,[1000000]);assert.equal(f.clock.stats.queuedVideo,0);near(plan.when,10.1);f.clock.close();
});

test('an audio-led backward PTS reset accepts new video without comparing it to the previous timeline',()=>{
  const f=fixture();f.clock.audioPlan(10000000,.02);f.video(10000000);f.advance(121);
  assert.equal(f.clock.audioPlan(0,.02).drop,false);assert.equal(f.video(0),true);
  assert.equal(f.clock.audioPlan(40000,.02).drop,false);assert.equal(f.video(40000),true);f.advance(170);
  assert.deepEqual(f.drawn,[10000000,0,40000]);assert.equal(f.clock.stats.videoDropped,0);assert.equal(f.resets.length,1);f.clock.close();
});
test('late video is discarded while the recent audio clock remains authoritative',()=>{
  const f=fixture();f.clock.audioPlan(1000000,.02);f.advance(400);assert.equal(f.video(1000000),false);assert.equal(f.clock.stats.resets,0);assert.deepEqual(f.disposed,[1000000]);assert.equal(f.drawn.length,0);f.clock.close();
});
test('video queue respects frame/byte limits and every accepted or discarded frame is closed once',()=>{
  const f=fixture({maxVideoFrames:2,maxVideoBytes:200});f.video(1000000);f.video(1010000);assert.equal(f.video(1020000),false);assert.equal(f.clock.stats.queuedVideo,2);assert.equal(f.clock.stats.queuedBytes,200);f.advance(130);f.clock.close();assert.equal(f.disposed.length,3);assert.equal(new Set(f.disposed).size,3);assert.equal(f.tasks.size,0);
});
test('a single frame above the queue memory limit is displayed without claiming synchronization',()=>{
  const f=fixture({maxVideoBytes:50});f.video(1000000,100);assert.deepEqual(f.drawn,[1000000]);assert.equal(f.clock.stats.queuedBytes,0);assert.equal(f.statuses.at(-1).limited,true);assert.match(f.statuses.at(-1).text,/해상도/);f.clock.close();
});
test('closing playback disposes pending video and prevents delayed display',()=>{
  const f=fixture();f.video(1000000);f.clock.close();f.advance(500);assert.equal(f.drawn.length,0);assert.deepEqual(f.disposed,[1000000]);assert.equal(f.tasks.size,0);
});
test('suspended audio cannot accumulate queued sounds and video-only time keeps progressing',()=>{
  const f=fixture();f.audio.state='suspended';assert.equal(f.clock.audioPlan(1000000,.02).drop,true);f.video(1000000);f.advance(110);assert.equal(f.drawn.length,1);const before=f.clock.now();f.audio.state='running';const after=f.clock.now();near(after,before);f.advance(10);near(f.clock.now()-after,.01);f.clock.close();
});
test('video-only playback anchors and renders even when no AudioContext exists',()=>{
  const f=fixture({noAudio:true});f.video(1000000);f.advance(101);assert.equal(f.drawn.length,1);assert.equal(f.clock.stats.videoDropped,0);f.clock.close();
});
test('MSE maps integer mux timestamps to device PTS and reports approximation rather than exact sync',()=>{
  const f=fixture();f.clock.audioPlan(1000000,.02);f.clock.setVideoMode('mse');for(let i=0;i<30;i++)f.clock.mseFeed(1000000+i*40000,40);f.advance(440);const correction=f.clock.msePlan(0);assert.equal(correction.limited,true);assert.equal(correction.rate,1.05);assert.ok(correction.seekTo>=.28&&correction.seekTo<=.36);assert.equal(f.statuses.find(s=>s.mode==='mse').limited,true);f.clock.close();
});
test('MSE missing frame mapping or an exhausted buffer is visibly limited and does not seek beyond data',()=>{
  const f=fixture();f.clock.audioPlan(1000000,.02);f.clock.setVideoMode('mse');for(let i=0;i<300;i++)f.clock.mseFeed(1000000+i*40000,40);const missing=f.clock.msePlan(0);assert.equal(missing.rate,1);assert.equal(missing.seekTo,undefined);f.clock.close();
});
test('a display failure still releases its frame and schedules the next queued frame',()=>{
  const f=fixture();let closed=0;f.clock.video({pts:1000000,bytes:100,draw(){throw new Error('canvas failure');},dispose(){closed++;}});f.video(1100000);f.advance(220);assert.equal(closed,1);assert.deepEqual(f.drawn,[1100000]);assert.ok(f.statuses.some(s=>/표시 실패/.test(s.text)));f.clock.close();
});
