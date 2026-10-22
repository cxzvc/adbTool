(() => {
  function create(options={}){
    const performanceNow=options.performanceNow||(()=>performance.now()/1000),getAudioContext=options.getAudioContext||(()=>null),schedule=options.schedule||((fn,ms)=>setTimeout(fn,ms)),cancel=options.cancel||clearTimeout;
    const buffer=()=>Math.max(.02,Math.min(.5,Number(options.bufferSeconds?.()??.1))),maxFrames=options.maxVideoFrames||12,maxBytes=options.maxVideoBytes||64*1024*1024;
    let closed=false,provider=null,offset=0,lastNow=null,originPts=null,originTime=0,videoMode='webcodecs',queue=[],queuedBytes=0,timer=null,lastAudioAt=-Infinity,lastVideoAt=-Infinity,lastVideoPts=null,lastAudioPts=null,lastStatusAt=-Infinity,statusText='',mse=[],mseCursor=0,lastMseSeek=-Infinity,generation=0;
    const counters={videoDrawn:0,videoDropped:0,audioDropped:0,resets:0};
    function now(){
      const context=getAudioContext(),next=context?.state==='running'?context:null;
      if(provider!==next){const previous=provider?provider.currentTime:performanceNow(),continuation=lastNow===null?(next?next.currentTime:performanceNow()):Math.max(lastNow,previous+offset);provider=next;offset=continuation-(next?next.currentTime:performanceNow());}
      const value=(provider?provider.currentTime:performanceNow())+offset;lastNow=lastNow===null?value:Math.max(lastNow,value);return lastNow;
    }
    function notify(text,extra={}){const at=now();if(at-lastStatusAt<.5&&!extra.critical)return;statusText=text;lastStatusAt=at;options.status?.({text,mode:videoMode,queuedVideo:queue.length,...counters,...extra});}
    function outputDelay(){
      const context=getAudioContext();if(!context||context.state!=='running'||now()-lastAudioAt>2)return{seconds:0,measured:false};
      try{const stamp=context.getOutputTimestamp?.(),perf=performanceNow();if(stamp&&Number.isFinite(stamp.contextTime)&&stamp.contextTime>=0&&Number.isFinite(stamp.performanceTime)&&stamp.performanceTime>0&&Math.abs(perf-stamp.performanceTime/1000)<1){const seconds=context.currentTime-(stamp.contextTime+perf-stamp.performanceTime/1000);if(seconds>=0&&seconds<.5)return{seconds,measured:true};}}catch{}
      return{seconds:Math.max(0,Math.min(.5,(Number(context.baseLatency)||0)+(Number(context.outputLatency)||0))),measured:false};
    }
    const valid=pts=>Number.isSafeInteger(pts)&&pts>=0;
    const release=item=>{try{item.dispose?.();}catch{}};
    function render(item){try{item.draw();counters.videoDrawn++;return true;}catch{notify('영상 프레임 표시 실패 · 다음 프레임을 기다립니다.',{limited:true,critical:true});return false;}finally{release(item);}}
    function clearVideo(){if(timer!==null)cancel(timer);timer=null;for(const item of queue)release(item);queue=[];queuedBytes=0;}
    function rebase(pts,reason){clearVideo();originPts=pts;originTime=now()+buffer();lastAudioPts=null;lastVideoPts=null;generation++;counters.resets++;options.reset?.(reason);notify(reason,{limited:true,critical:true});}
    function target(pts){if(!valid(pts))throw new Error('기기의 재생 시각이 올바르지 않습니다.');if(originPts===null){originPts=pts;originTime=now()+buffer();}return originTime+(pts-originPts)/1000000;}
    function audioPlan(pts,duration){
      if(closed||!valid(pts)||!Number.isFinite(duration)||duration<=0||duration>5)return{drop:true};const context=getAudioContext(),at=now();
      if(!context||context.state!=='running'){counters.audioDropped++;notify('소리 재생 대기 · 소리 재생 버튼을 눌러 주세요.',{limited:true});return{drop:true};}
      let when=target(pts);
      if(lastAudioPts!==null&&pts<lastAudioPts-2000000){rebase(pts,'기기 시각이 바뀌어 영상·소리 기준을 다시 맞췄습니다.');when=target(pts);}
      else if(when<at-.25||when>at+1){rebase(pts,'전송 지연으로 영상·소리 기준을 다시 맞췄습니다.');when=target(pts);}
      lastAudioPts=pts;lastAudioAt=at;const trim=Math.max(0,at-when);
      if(trim>=duration){counters.audioDropped++;notify('늦게 도착한 소리 조각을 건너뛰고 있습니다.',{limited:true});return{drop:true};}
      const remaining=Math.max(0,when-at),delay=outputDelay();
      notify(videoMode==='mse'?'호환 영상·소리 시각 보정 · 브라우저 버퍼에 따라 오차가 남습니다.':lastVideoAt>-Infinity?'영상·소리 공통 시계 사용'+(delay.measured?' · 출력 시각 보정':' · 출력 지연은 브라우저 추정값'):'소리 시각으로 재생 중 · 영상 시각 대기',{limited:videoMode==='mse'||!delay.measured,outputDelayMs:Math.round(delay.seconds*1000)});
      return{drop:false,when:context.currentTime+remaining,offset:trim,duration:duration-trim,generation};
    }
    function pump(){
      timer=null;if(closed||!queue.length)return;const at=now(),delayInfo=outputDelay(),delay=delayInfo.seconds;
      while(queue.length&&queue[0].target+delay<at-.12){const item=queue.shift();queuedBytes-=item.bytes;release(item);counters.videoDropped++;}
      let chosen=null;
      while(queue.length&&queue[0].target+delay<=at+.002){if(chosen){release(chosen);counters.videoDropped++;}chosen=queue.shift();queuedBytes-=chosen.bytes;}
      if(chosen&&render(chosen))notify(now()-lastAudioAt<2?'영상·소리 공통 시계 사용':'기기 영상 시각으로 표시 중',{videoLatenessMs:Math.round((at-chosen.target-delay)*1000),outputDelayMs:Math.round(delay*1000),limited:now()-lastAudioAt<2&&!delayInfo.measured});
      if(queue.length){const wait=Math.max(1,Math.min(50,(queue[0].target+delay-now())*1000));timer=schedule(pump,wait);}
    }
    function video(item){
      if(closed||!valid(item.pts)){release(item);return false;}const at=now();lastVideoAt=at;
      let when=target(item.pts);const audioRecent=at-lastAudioAt<2;
      if((when<at-.5||when>at+1)&&!audioRecent){rebase(item.pts,'영상 전송 지연으로 표시 시각을 다시 맞췄습니다.');when=target(item.pts);}
      if(lastVideoPts!==null&&item.pts<lastVideoPts-2000000&&audioRecent){counters.videoDropped++;release(item);notify('영상·소리의 기기 시각이 다릅니다. 새 연결 또는 다른 인코더를 사용하세요.',{limited:true});return false;}
      lastVideoPts=item.pts;
      const bytes=Number.isFinite(item.bytes)?Math.max(0,item.bytes):0;
      if(bytes>maxBytes){clearVideo();render(item);notify('해상도가 커서 대기 없이 표시합니다. 동기화하려면 해상도를 낮추세요.',{limited:true,critical:true});return true;}
      if(when<at-.12||when>at+1||queue.length>=maxFrames||queuedBytes+bytes>maxBytes){counters.videoDropped++;release(item);notify('영상 처리 지연 · 늦은 프레임을 건너뛰고 있습니다.',{limited:true});return false;}
      queue.push({...item,target:when,bytes});queue.sort((a,b)=>a.target-b.target);queuedBytes+=bytes;if(timer!==null)cancel(timer);timer=schedule(pump,Math.max(1,Math.min(50,(queue[0].target+outputDelay().seconds-now())*1000)));return true;
    }
    function setVideoMode(mode){if(videoMode!==mode){clearVideo();videoMode=mode;}if(mode==='mse'){mse=[];mseCursor=0;notify('H.264 호환 재생 · 영상 시각을 추정해 보정하며 정확한 동기화는 제한됩니다.',{limited:true,critical:true});}}
    function mseFeed(pts,durationMs){
      if(closed||!valid(pts)||!Number.isFinite(durationMs)||durationMs<=0)return;target(pts);mse.push({pts,time:mseCursor});mseCursor+=Math.floor(durationMs)/1000;if(mse.length>256)mse.shift();
    }
    function atTime(time){if(!mse.length||time<mse[0].time-.05)return null;let found=mse[0];for(const point of mse){if(point.time>time+.003)break;found=point;}return found.pts;}
    function msePlan(mediaTime){
      if(closed||!Number.isFinite(mediaTime)||!mse.length||now()-lastAudioAt>2)return{rate:1,limited:true};const pts=atTime(mediaTime);if(pts===null){notify('호환 영상 시각을 확인하지 못했습니다. 영상·소리 동기화가 제한됩니다.',{limited:true});return{rate:1,limited:true};}
      const at=now(),skew=at-target(pts)-outputDelay().seconds,expected=originPts+(at-outputDelay().seconds-originTime)*1000000;
      if(expected>mse.at(-1).pts+200000){notify('호환 영상 수신 대기 · 소리보다 영상이 늦습니다.',{limited:true});return{rate:1,limited:true,skewMs:Math.round(skew*1000)};}
      let wanted=null;for(const point of mse){if(point.pts>expected)break;wanted=point.time;}
      const result={rate:Math.abs(skew)<.025?1:skew>0?1.05:.95,skewMs:Math.round(skew*1000),limited:true};
      if(Math.abs(skew)>.25&&wanted!==null&&at-lastMseSeek>1){result.seekTo=wanted;lastMseSeek=at;}
      notify('호환 영상·소리 시각 보정 · 예상 차이 '+Math.round(skew*1000)+'ms',{limited:true,skewMs:result.skewMs});return result;
    }
    return{audioPlan,video,mseFeed,msePlan,setVideoMode,clearVideo,now,reset(reason='재생 시각을 초기화했습니다.'){clearVideo();originPts=null;lastAudioPts=null;lastVideoPts=null;lastAudioAt=-Infinity;lastVideoAt=-Infinity;mse=[];mseCursor=0;generation++;options.reset?.(reason);notify(reason);},close(){closed=true;clearVideo();mse=[];},get stats(){return{...counters,queuedVideo:queue.length,queuedBytes,generation,originPts,originTime,mode:videoMode};}};
  }
  window.MirrorPlaybackClock={create};
})();
