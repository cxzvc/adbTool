(() => {
  const state={zoom:1,x:0,y:0,angle:0,flipX:false,flipY:false,fill:false,paused:false,pan:false,ready:false,drag:null,width:0,height:0};let api,geometry=null;
  const $=id=>document.getElementById(id),clamp=(n,min,max)=>Math.max(min,Math.min(max,n)),number=value=>parseFloat(value)||0;
  const angle=value=>((value%360)+540)%360-180;
  // The border-box center remains fixed. Screen-axis stretching after rotation
  // makes the complete rotated bounds fit even when the aspect ratio is ignored.
  function makeTransform(box,area,options={}){
    const radians=angle(Number(options.angle)||0)*Math.PI/180,c=Math.cos(radians),s=Math.sin(radians),w=box.width,h=box.height;
    if(!(w>0&&h>0&&area.width>0&&area.height>0))return null;
    const rotatedWidth=Math.abs(c)*w+Math.abs(s)*h,rotatedHeight=Math.abs(s)*w+Math.abs(c)*h;
    const fit=Math.min(1,area.width/rotatedWidth,area.height/rotatedHeight),fitX=options.fill?area.width/rotatedWidth:fit,fitY=options.fill?area.height/rotatedHeight:fit,z=clamp(Number(options.zoom)||1,.25,16),fx=options.flipX?-1:1,fy=options.flipY?-1:1;
    const a=fitX*z*c*fx,b=fitY*z*s*fx,cc=-fitX*z*s*fy,d=fitY*z*c*fy;
    return {a,b,c:cc,d,fitX,fitY,boundsWidth:Math.abs(a)*w+Math.abs(cc)*h,boundsHeight:Math.abs(b)*w+Math.abs(d)*h};
  }
  function transformedPoint(event,rect,box,matrix,size,clip=null){
    if(!matrix||!size.width||!size.height||!Number.isFinite(event.clientX)||!Number.isFinite(event.clientY))return null;
    if(clip&&(event.clientX<clip.left||event.clientY<clip.top||event.clientX>clip.left+clip.width||event.clientY>clip.top+clip.height))return null;
    const determinant=matrix.a*matrix.d-matrix.b*matrix.c;if(!Number.isFinite(determinant)||Math.abs(determinant)<1e-10)return null;
    const dx=event.clientX-(rect.left+rect.width/2),dy=event.clientY-(rect.top+rect.height/2);
    const x=(matrix.d*dx-matrix.c*dy)/determinant+box.width/2-box.left,y=(-matrix.b*dx+matrix.a*dy)/determinant+box.height/2-box.top;
    const width=box.width-box.left-box.right,height=box.height-box.top-box.bottom,epsilon=1e-6;
    // A bounding-box corner or a captured pointer outside the image must never
    // be clamped into a phone-edge touch.
    if(width<=0||height<=0||x< -epsilon||y< -epsilon||x>width+epsilon||y>height+epsilon)return null;
    return {x:clamp(Math.floor(clamp(x/width,0,1)*size.width+epsilon),0,size.width-1),y:clamp(Math.floor(clamp(y/height,0,1)*size.height+epsilon),0,size.height-1)};
  }
  function mapPoint(event,rect,border,zoom,size){const box={width:rect.width/zoom,height:rect.height/zoom,left:border.left,right:border.right,top:border.top,bottom:border.bottom};return transformedPoint(event,rect,box,{a:zoom,b:0,c:0,d:zoom},size);}
  function readBox(canvas){
    const style=getComputedStyle(canvas),left=number(style.borderLeftWidth)+number(style.paddingLeft),right=number(style.borderRightWidth)+number(style.paddingRight),top=number(style.borderTopWidth)+number(style.paddingTop),bottom=number(style.borderBottomWidth)+number(style.paddingBottom);
    let width=number(style.width)||number(canvas.style.width),height=number(style.height)||number(canvas.style.height);
    if(style.boxSizing==='content-box'){if(width)width+=left+right;if(height)height+=top+bottom;}
    width=width||canvas.offsetWidth||geometry?.box.width||canvas.getBoundingClientRect().width;height=height||canvas.offsetHeight||geometry?.box.height||canvas.getBoundingClientRect().height;
    return {width,height,left,right,top,bottom};
  }
  function point(canvas,event,size){
    if(canvas!==api?.canvas||!state.ready||canvas.hidden||!geometry)return null;
    const stage=api.stage,stageRect=stage.getBoundingClientRect?.(),clip=stageRect?{left:stageRect.left+(stage.clientLeft||0),top:stageRect.top+(stage.clientTop||0),width:stage.clientWidth,height:stage.clientHeight}:null;
    return transformedPoint(event,canvas.getBoundingClientRect(),geometry.box,geometry.matrix,size,clip);
  }
  function relativeDelta(dx,dy){
    if(state.paused||state.pan||!Number.isFinite(dx)||!Number.isFinite(dy))return null;
    const matrix=geometry?.matrix;if(!matrix)return {dx,dy};
    const length=Math.hypot(dx,dy);if(!length)return {dx:0,dy:0};
    const determinant=matrix.a*matrix.d-matrix.b*matrix.c;if(!Number.isFinite(determinant)||Math.abs(determinant)<1e-10)return null;
    const x=(matrix.d*dx-matrix.c*dy)/determinant,y=(-matrix.b*dx+matrix.a*dy)/determinant,mappedLength=Math.hypot(x,y);
    if(!Number.isFinite(mappedLength)||mappedLength===0)return null;
    // Preserve relative-mouse sensitivity; only the displayed direction changes.
    return {dx:x*length/mappedLength,dy:y*length/mappedLength};
  }
  function update(){
    if(!$('mirror-view-pause'))return;
    $('mirror-view-pause').disabled=!state.ready;$('mirror-view-pause').textContent=state.paused?'표시 다시 재생':'PC 표시 일시정지';$('mirror-view-pause').setAttribute('aria-pressed',String(state.paused));$('mirror-view-pan').checked=state.pan;$('mirror-view-zoom').value=String(Math.round(state.zoom*100));$('mirror-view-ratio').textContent=Math.round(state.zoom*100)+'%';
    $('mirror-view-angle').value=String(state.angle);$('mirror-view-flip-x').checked=state.flipX;$('mirror-view-flip-y').checked=state.flipY;$('mirror-view-fill').value=state.fill?'fill':'contain';
    const transform=`PC ${state.angle}°${state.flipX?' · 좌우 반전':''}${state.flipY?' · 상하 반전':''}${state.fill?' · 비율 무시':''}`;
    $('mirror-view-status').textContent=state.paused?'PC 표시만 멈췄습니다. 폰·소리·원본 녹화는 계속되며 기기 입력은 잠시 막습니다.':state.pan?`${transform} · 화면 이동 모드: 드래그는 PC 표시 이동, 휠은 확대·축소입니다.`:`${transform} · 보이는 영상 안쪽만 터치됩니다. 여백·테두리·화면 밖에는 입력하지 않습니다.`;
    api?.canvas.classList.toggle('pc-view-pan',state.paused||state.pan);if($('mirror-view-paused'))$('mirror-view-paused').hidden=!state.paused;
  }
  function layout(){
    if(!api)return;const canvas=api.canvas,stage=api.stage,style=getComputedStyle(stage),box=readBox(canvas),area={width:Math.max(1,stage.clientWidth-number(style.paddingLeft)-number(style.paddingRight)),height:Math.max(1,stage.clientHeight-number(style.paddingTop)-number(style.paddingBottom))};
    const matrix=makeTransform(box,area,state);if(!matrix)return;
    if(!canvas.hidden&&state.ready){state.x=clamp(state.x,-Math.max(0,(matrix.boundsWidth-area.width)/2),Math.max(0,(matrix.boundsWidth-area.width)/2));state.y=clamp(state.y,-Math.max(0,(matrix.boundsHeight-area.height)/2),Math.max(0,(matrix.boundsHeight-area.height)/2));}
    geometry={box,area,matrix};const n=value=>Math.abs(value)<1e-12?0:Number(value.toFixed(12));
    canvas.style.transform=`${getComputedStyle(canvas).position==='absolute'?'translate(-50%, -50%) ':''}translate(${state.x}px,${state.y}px) matrix(${[matrix.a,matrix.b,matrix.c,matrix.d,0,0].map(n).join(',')})`;canvas.style.transformOrigin='center center';update();
  }
  function setZoom(value){const valueNumber=Number(value);if(!Number.isFinite(valueNumber))return;state.zoom=clamp(valueNumber,.25,16);layout();}
  function resetFit(){state.zoom=1;state.x=0;state.y=0;layout();}
  function transformChange(change){api?.releaseInputs?.();state.drag=null;Object.assign(state,change,{x:0,y:0});layout();api?.changed?.();}
  function setRotation(value){const next=Number(value);if(!Number.isFinite(next))return;transformChange({angle:Math.round(angle(next)*10)/10});}
  function setFlip(axis,on){if(!['x','y'].includes(axis))return;transformChange({[axis==='x'?'flipX':'flipY']:!!on});}
  function setFill(on){transformChange({fill:!!on,zoom:1});}
  function resetTransform(){transformChange({zoom:1,angle:0,flipX:false,flipY:false,fill:false});}
  function natural(){if(!api||!state.ready)return;state.fill=false;layout();const width=geometry.box.width-geometry.box.left-geometry.box.right;if(width>0){state.x=state.y=0;setZoom(api.canvas.width/width/geometry.matrix.fitX);}}
  function togglePause(){if(!state.ready)return;if(!state.paused)api.releaseInputs?.();state.paused=!state.paused;state.drag=null;update();api.changed?.();}
  function setPan(on){if(on&&!state.pan)api?.releaseInputs?.();state.pan=!!on;state.drag=null;update();api?.changed?.();}
  function configure(value){
    api=value;const host=$('mirror-tools');if(!host||$('mirror-view-panel'))return;
    host.insertAdjacentHTML('afterbegin','<section id="mirror-view-panel" class="mirror-tool-section"><h3>PC 표시 · 폰 상태는 그대로</h3><div class="mirror-tool-buttons"><button id="mirror-view-pause" disabled>PC 표시 일시정지</button><button id="mirror-view-fit">화면에 맞춤</button><button id="mirror-view-natural">원본 1:1</button><button id="mirror-view-minus" aria-label="PC 표시 축소">−</button><button id="mirror-view-plus" aria-label="PC 표시 확대">＋</button></div><label>표시 확대 <input id="mirror-view-zoom" type="range" min="25" max="1600" step="25" value="100"><output id="mirror-view-ratio">100%</output></label><div class="mirror-view-rotation"><button id="mirror-view-left">왼쪽 90°</button><button id="mirror-view-right">오른쪽 90°</button><button id="mirror-view-reset">기본 표시</button><label>PC 회전 각도<input id="mirror-view-angle" type="number" min="-180" max="180" step="0.1" value="0" aria-label="PC 표시 회전 각도"></label><button id="mirror-view-angle-apply">각도 적용</button></div><div class="mirror-view-flips"><label><input id="mirror-view-flip-x" type="checkbox">좌우 반전</label><label><input id="mirror-view-flip-y" type="checkbox">상하 반전</label></div><label>화면 비율<select id="mirror-view-fill"><option value="contain">원래 비율 유지 · 전체 보이기</option><option value="fill">비율 무시 · 표시 영역 채움</option></select></label><label><input id="mirror-view-pan" type="checkbox">PC 화면 이동 모드 · 드래그/휠</label><small class="mirror-view-note">이 웹 화면에만 적용합니다. 캡처·녹화의 원본 방향은 그대로입니다. 임의 각도에서는 모서리에 여백이 남을 수 있습니다.</small><p id="mirror-view-status" role="status"></p></section>');
    const badge=document.createElement('div');badge.id='mirror-view-paused';badge.className='mirror-view-paused';badge.hidden=true;badge.textContent='PC 표시 일시정지';api.stage.append(badge);api.stage.classList.add('has-view-tools');
    $('mirror-view-pause').onclick=togglePause;$('mirror-view-fit').onclick=resetFit;$('mirror-view-natural').onclick=natural;$('mirror-view-plus').onclick=()=>setZoom(state.zoom*1.25);$('mirror-view-minus').onclick=()=>setZoom(state.zoom/1.25);$('mirror-view-zoom').oninput=e=>setZoom(Number(e.target.value)/100);$('mirror-view-pan').onchange=e=>setPan(e.target.checked);
    $('mirror-view-left').onclick=()=>setRotation(state.angle-90);$('mirror-view-right').onclick=()=>setRotation(state.angle+90);$('mirror-view-reset').onclick=resetTransform;$('mirror-view-angle-apply').onclick=()=>{const field=$('mirror-view-angle');if(!field.reportValidity||field.reportValidity())setRotation(field.value);};$('mirror-view-angle').onkeydown=e=>{if(e.key==='Enter'){$('mirror-view-angle-apply').click();e.preventDefault();}};
    $('mirror-view-flip-x').onchange=e=>setFlip('x',e.target.checked);$('mirror-view-flip-y').onchange=e=>setFlip('y',e.target.checked);$('mirror-view-fill').onchange=e=>setFill(e.target.value==='fill');
    const canvas=api.canvas,local=()=>state.ready&&(state.pan||state.paused);
    canvas.addEventListener('pointerdown',event=>{if(!local()||event.button!==0)return;event.preventDefault();event.stopImmediatePropagation();state.drag={id:event.pointerId,x:event.clientX,y:event.clientY,px:state.x,py:state.y};try{canvas.setPointerCapture(event.pointerId);}catch{}},true);
    canvas.addEventListener('pointermove',event=>{if(!state.drag||state.drag.id!==event.pointerId)return;event.preventDefault();event.stopImmediatePropagation();state.x=state.drag.px+event.clientX-state.drag.x;state.y=state.drag.py+event.clientY-state.drag.y;layout();},true);
    const end=event=>{if(state.drag?.id!==event.pointerId)return;event.preventDefault();event.stopImmediatePropagation();state.drag=null;try{canvas.releasePointerCapture(event.pointerId);}catch{}};canvas.addEventListener('pointerup',end,true);canvas.addEventListener('pointercancel',end,true);canvas.addEventListener('lostpointercapture',()=>{state.drag=null;},true);
    canvas.addEventListener('wheel',event=>{if(!local())return;event.preventDefault();event.stopImmediatePropagation();setZoom(state.zoom*(event.deltaY<0?1.1:1/1.1));},{capture:true,passive:false});
    window.addEventListener('blur',()=>{state.drag=null;});update();
  }
  function frame(width,height){const changed=!state.ready||state.width!==width||state.height!==height;state.ready=true;state.width=width;state.height=height;if(changed)layout();}
  function reset(){Object.assign(state,{zoom:1,x:0,y:0,angle:0,flipX:false,flipY:false,fill:false,paused:false,pan:false,ready:false,drag:null,width:0,height:0});layout();}
  window.MirrorView={configure,frame,layout,reset,point,mapPoint,makeTransform,transformedPoint,relativeDelta,setZoom,resetFit,natural,togglePause,setPan,setRotation,setFlip,setFill,resetTransform,get paused(){return state.paused;},get inputBlocked(){return state.paused||state.pan;},get state(){return {...state};}};
})();
