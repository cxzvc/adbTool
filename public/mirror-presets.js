(() => {
  const KEY='adb-desk.mirror-preferences.v1',MAX=12,$=id=>document.getElementById(id);
  const fields=['stream-size','stream-fps','stream-bitrate','stream-volume','stream-audio','mo-source','mo-codec','mo-orientation','mo-crop','mo-preview','mo-new-display','mo-vd-width','mo-vd-height','mo-vd-dpi','mo-flex','mo-decorations','mo-destroy','mo-ime','mo-limit','mo-decoder','mo-verbosity','mo-camera-facing','mo-camera-fps','mo-camera-zoom','mo-camera-high-speed','mo-camera-ar','mo-camera-ar-custom','media-source','media-buffer','media-duplicate','media-audio-codec','media-audio-bitrate','media-audio-playback','media-audio-required','media-format','media-minutes','media-maxmb'];
  const message=text=>{if($('mirror-preset-note'))$('mirror-preset-note').textContent=text;};
  function validate(value){
    if(!value||value.version!==1||!value.values||typeof value.values!=='object'||Array.isArray(value.values))throw new Error('저장한 화면 선호 형식이 올바르지 않습니다.');
    const values={};for(const key of fields){const v=value.values[key];if(v===undefined)continue;if(typeof v!=='boolean'&&(typeof v!=='string'||v.length>160||/[\x00-\x1f\x7f]/.test(v)))throw new Error('저장한 선호 값이 올바르지 않습니다.');values[key]=v;}
    const video=value.video||{angle:'0',downsize:'',rows:[]};if(!Array.isArray(video.rows)||video.rows.length>16||JSON.stringify(video).length>8192)throw new Error('저장한 코덱 옵션이 너무 큽니다.');window.MirrorSessionOptions?.validateRows(video.rows);if(video.audioRows!==undefined){if(!Array.isArray(video.audioRows)||video.audioRows.length>16)throw new Error('저장한 소리 옵션이 올바르지 않습니다.');window.MirrorSessionOptions?.validateAudioRows?.(video.audioRows);}if(!['','1','2','4','8','16'].includes(String(video.alignment??'')))throw new Error('저장한 크기 정렬이 올바르지 않습니다.');
    if(!Number.isFinite(Number(video.angle??0))||Math.abs(Number(video.angle??0))>180||!['','on','off'].includes(video.downsize??''))throw new Error('저장한 영상 각도·크기 정책이 올바르지 않습니다.');
    return{version:1,values,video};
  }
  function list(){let raw;try{raw=localStorage.getItem(KEY);}catch{return[];}if(!raw)return[];if(raw.length>131072)return[];try{const rows=JSON.parse(raw);if(!Array.isArray(rows))return[];return rows.slice(0,MAX).flatMap(row=>{try{if(!row||typeof row.id!=='string'||!/^[A-Za-z0-9-]{1,80}$/.test(row.id)||typeof row.name!=='string'||!row.name.trim()||row.name.length>40||/[\x00-\x1f\x7f]/.test(row.name))return[];return[{id:row.id,name:row.name,data:validate(row.data)}];}catch{return[];}});}catch{return[];}}
  function capture(){const values={};for(const id of fields){const el=$(id);if(el)values[id]=el.type==='checkbox'?!!el.checked:String(el.value);}return validate({version:1,values,video:window.MirrorSessionOptions?.videoPreferences?.()||{angle:'0',downsize:'',rows:[]}});}
  function apply(data){
    const value=validate(data),skipped=[];
    // Load preferences into controls only. Never dispatch connection/apply events.
    for(const id of ['mo-codec','media-audio-codec',...fields.filter(id=>!['mo-codec','media-audio-codec'].includes(id))]){
      const el=$(id),v=value.values[id];if(!el||v===undefined)continue;
      if(el.type==='checkbox'){if(typeof v==='boolean')el.checked=v;else skipped.push(id);}
      else if(typeof v==='string'){if(el.tagName==='SELECT'&&![...el.options].some(o=>o.value===v)){skipped.push(id);continue;}el.value=v;}
      if(['mo-codec','media-audio-codec','media-source','mo-camera-ar'].includes(id))el.dispatchEvent(new Event('change',{bubbles:true}));
    }
    // A saved preference must never carry an app/user, device-specific encoder or power action.
    for(const id of ['ms-control-only','media-audio-only','mo-keep-active','ms-show-touches','ms-stay-awake','ms-power-on','ms-screen-off','ms-power-off-close','ms-start-force-stop'])if($(id))$(id).checked=false;
    for(const [id,v]of [['ms-screen-timeout',''],['mo-display','0'],['mo-camera-id',''],['mo-camera-size',''],['mo-encoder',''],['media-audio-encoder','']])if($(id))$(id).value=v;
    $('mo-camera-ar')?.dispatchEvent(new Event('change',{bubbles:true}));$('mo-app-clear')?.click();window.MirrorSessionOptions?.applyVideoPreferences?.(value.video);window.MirrorLayout?.refreshMode?.();window.MirrorOptions?.refresh?.();
    message('선호를 입력칸에 불러왔습니다. 현재 연결은 그대로입니다. 상단 연결 시작·옵션 적용을 눌러 반영하세요.'+(skipped.length?' 현재 목록에 없는 값은 유지했습니다.':''));return{skipped};
  }
  function write(rows){try{localStorage.setItem(KEY,JSON.stringify(rows));}catch{throw new Error('이 브라우저에 선호를 저장할 수 없습니다. 저장 공간·사이트 권한을 확인하세요.');}}
  function save(name){name=String(name??'').trim();if(!name||name.length>40||/[\x00-\x1f\x7f]/.test(name))throw new Error('선호 이름은 1~40자로 입력하세요.');const rows=list(),found=rows.find(row=>row.name===name);if(!found&&rows.length>=MAX)throw new Error(`선호는 최대 ${MAX}개입니다. 쓰지 않는 항목을 지워 주세요.`);const row={id:found?.id||`${Date.now()}-${Math.random().toString(16).slice(2,14)}`,name,data:capture()};if(found)rows[rows.indexOf(found)]=row;else rows.push(row);write(rows);render(row.id);message('현재 영상·소리 선호를 이 브라우저에 저장했습니다. 연결을 실행하지 않았습니다.');return row;}
  function load(id){const row=list().find(row=>row.id===id);if(!row)throw new Error('불러올 선호를 선택하세요.');apply(row.data);if($('mirror-preset-name'))$('mirror-preset-name').value=row.name;return row;}
  function remove(id){const rows=list();if(!rows.some(row=>row.id===id))throw new Error('삭제할 선호를 선택하세요.');write(rows.filter(row=>row.id!==id));render();message('저장한 선호를 삭제했습니다. 폰과 현재 연결은 변경하지 않았습니다.');}
  function render(selected){const select=$('mirror-preset-list');if(!select)return;select.replaceChildren();const empty=document.createElement('option');empty.value='';empty.textContent='저장한 선호 선택';select.append(empty);for(const row of list()){const option=document.createElement('option');option.value=row.id;option.textContent=row.name;select.append(option);}if(selected)select.value=selected;}
  function configure(){const host=$('mirror-tools');if(!host||$('mirror-preset-panel'))return;host.insertAdjacentHTML('afterbegin','<section id="mirror-preset-panel" class="mirror-tool-section"><h3>영상·소리 선호 저장</h3><div class="mirror-preset-grid"><input id="mirror-preset-name" maxlength="40" placeholder="예: 고화질 작업용" aria-label="저장할 선호 이름"><button id="mirror-preset-save" type="button">현재 선호 저장</button><select id="mirror-preset-list" aria-label="저장한 선호"></select><button id="mirror-preset-load" type="button">불러오기</button><button id="mirror-preset-delete" type="button">삭제</button></div><small>이 브라우저·접속 주소에 최대 12개 저장합니다. 같은 이름은 덮어씁니다. 불러오기는 입력칸만 바꿉니다. 앱·사용자·기기 ID·인코더·전원/세션 변경은 저장하지 않으며 불러올 때 해제됩니다.</small><p id="mirror-preset-note" role="status">화질·영상 방향·가상 화면 크기·소리·녹화 형식·코덱 추가 옵션을 저장합니다.</p></section>');for(const [id,fn]of [['mirror-preset-save',()=>save($('mirror-preset-name').value)],['mirror-preset-load',()=>load($('mirror-preset-list').value)],['mirror-preset-delete',()=>remove($('mirror-preset-list').value)]])$(id).onclick=()=>{try{fn();}catch(error){message(error.message);}};render();}
  window.MirrorPresets={configure,capture,apply,save,load,remove,list,validate};
})();
