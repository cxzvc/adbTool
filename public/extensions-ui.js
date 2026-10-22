(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const extensionId=/^[a-z][a-z0-9-]{0,63}$/;
  const assetLoads=new Map();
  const device={id:null,tab:'overview',epoch:0,data:null,loading:false,error:'',abort:null};
  const configuration={epoch:0,data:null,draft:new Set(),busy:false,error:'',notice:'',abort:null};
  function note(message,{loading=false,retry=false}={}){
    const root=$('device-extension-note');if(!root)return;
    root.hidden=!message;root.innerHTML=message?`<span>${esc(message)}</span>${loading?'<progress aria-label="확장 지원 조건 조회 중"></progress>':''}${retry?'<button type="button" data-extension-retry>다시 조회</button>':''}`:'';
    root.onclick=event=>{if(event.target?.closest?.('[data-extension-retry]'))void refreshDevice();};
  }
  function apply(){
    const flags=device.data?.features||{};
    for(const [id,visible]of [['privacy-indicators-panel',flags.privacyIndicators],['gps-indicator-panel',flags.gpsIndicator],['explorer-reference',flags.firmwareReference],['explorer-reference-oneui9',flags.firmwareReference]]){const node=$(id);if(node)node.hidden=visible!==true;}
    window.PrivacyIndicators?.activate(flags.privacyIndicators===true&&device.tab==='settings');
    window.GpsIndicator?.activate(flags.gpsIndicator===true&&device.tab==='apps');
  }
  function close(){
    device.epoch++;device.abort?.abort();device.abort=null;device.id=null;device.tab='overview';device.data=null;device.loading=false;device.error='';
    window.PrivacyIndicators?.close();window.GpsIndicator?.close();window.CompatibilityUI?.closeDetails();apply();note('');
  }
  function validateFeatures(data,id){
    if(!data||data.deviceId!==id||!Array.isArray(data.extensions)||!data.features||!data.assets||!Array.isArray(data.assets.scripts)||!Array.isArray(data.assets.styles))throw new Error('현재 기기의 확장 지원 응답을 확인하지 못했습니다.');
    for(const name of ['privacyIndicators','gpsIndicator','firmwareReference'])if(typeof data.features[name]!=='boolean')throw new Error('확장 기능의 지원 상태 형식이 올바르지 않습니다.');
    const matchedIds=new Set(data.extensions.filter(row=>row&&extensionId.test(row.id)&&row.enabled===true&&row.matched===true).map(row=>row.id));
    if(!matchedIds.size&&(Object.values(data.features).some(value=>value===true)||data.assets.scripts.length||data.assets.styles.length))throw new Error('기기 제조사와 확장 지원 응답이 일치하지 않습니다.');
    for(const [kind,items]of [['script',data.assets.scripts],['style',data.assets.styles]]){
      if(new Set(items).size!==items.length||items.some(url=>{const match=typeof url==='string'&&/^\/extensions\/([a-z][a-z0-9-]{0,63})\/([a-z][a-z0-9-]*)\.(js|css)$/.exec(url);return !match||!matchedIds.has(match[1])||match[3]!==({script:'js',style:'css'})[kind];}))throw new Error('확장 화면 파일의 경로를 확인하지 못했습니다.');
    }
    for(const [flag,name]of [['privacyIndicators','privacy-indicators'],['gpsIndicator','gps-indicator']])if(data.features[flag]&&![...matchedIds].some(owner=>data.assets.scripts.includes(`/extensions/${owner}/${name}.js`)&&data.assets.styles.includes(`/extensions/${owner}/${name}.css`)))throw new Error('확장 화면 파일 목록이 불완전합니다.');
    return data;
  }
  function loadAsset(url,kind){
    if(assetLoads.has(url))return assetLoads.get(url);
    const promise=new Promise((resolve,reject)=>{
      const node=document.createElement(kind==='style'?'link':'script');
      if(kind==='style'){node.rel='stylesheet';node.href=url;}else{node.src=url;node.async=false;}
      let timer=setTimeout(()=>fail(),15000);
      function fail(){clearTimeout(timer);node.remove?.();assetLoads.delete(url);reject(new Error('확장 화면 파일을 불러오지 못했습니다. 공통 기능은 계속 사용할 수 있습니다.'));}
      node.onload=()=>{clearTimeout(timer);resolve();};node.onerror=fail;document.head.append(node);
    });
    assetLoads.set(url,promise);return promise;
  }
  async function refreshDevice(){
    if(!device.id||device.loading)return;
    const id=device.id,epoch=++device.epoch,abort=new AbortController();device.abort=abort;device.loading=true;device.data=null;device.error='';
    window.PrivacyIndicators?.close();window.GpsIndicator?.close();apply();note('사용할 수 있는 제조사 확장을 확인하고 있습니다.',{loading:true});
    const timer=setTimeout(()=>abort.abort(),15000);
    try{
      const response=await fetch('/api/device/features?'+new URLSearchParams({id}),{cache:'no-store',signal:abort.signal});
      const data=await response.json();if(device.id!==id||device.epoch!==epoch)return;
      if(!response.ok)throw new Error(data.error||'확장 지원 정보를 읽지 못했습니다.');
      validateFeatures(data,id);
      for(const url of data.assets.styles){if(device.id!==id||device.epoch!==epoch)return;await loadAsset(url,'style');}
      for(const url of data.assets.scripts){if(device.id!==id||device.epoch!==epoch)return;await loadAsset(url,'script');}
      if(device.id!==id||device.epoch!==epoch)return;
      if(data.features.privacyIndicators&&!window.PrivacyIndicators||data.features.gpsIndicator&&!window.GpsIndicator)throw new Error('확장 화면을 초기화하지 못했습니다. 다시 조회해 주세요.');
      device.data=data;
      if(data.features.privacyIndicators)window.PrivacyIndicators.open(id);
      if(data.features.gpsIndicator){window.GpsIndicator.open(id);const app=window.DeviceTargets?.app;if(app)window.GpsIndicator.selectApp(app,app.userId??window.AppInventory?.currentUser);}
      apply();note('');
    }catch(error){
      if(device.id!==id||device.epoch!==epoch)return;
      device.data=null;device.error=/[가-힣]/.test(error.message||'')?error.message:'확장 지원 정보를 읽지 못했습니다. 연결을 확인하고 다시 조회해 주세요.';apply();note(device.error+' 공통 기능은 계속 사용할 수 있습니다.',{retry:true});
    }finally{clearTimeout(timer);if(device.id===id&&device.epoch===epoch){device.loading=false;device.abort=null;}}
  }
  window.DeviceExtensions=Object.freeze({
    open(id){close();device.id=id;void refreshDevice();},
    close,
    activate(tab){device.tab=tab;apply();},
    refresh:refreshDevice,
    allows(feature){return device.data?.features?.[feature]===true;},
    refreshPrivacy(){if(device.data?.features?.privacyIndicators===true)return window.PrivacyIndicators?.refresh();}
  });

  const configuredIds=data=>data?.configured||data?.enabled||[];
  function configurationMessage(){
    if(configuration.busy)return '확장 설정을 처리하고 있습니다.';
    if(configuration.data?.environmentOverride===true)return '확장 목록이 ADB_DESK_EXTENSIONS 환경변수로 지정되어 있습니다. 환경변수를 변경한 뒤 웹 도구 서버를 다시 시작해 주세요.';
    if(!configuration.error&&configuredIds(configuration.data).some(id=>!configuration.data.available.some(row=>row.id===id)))return '설치되지 않은 확장의 활성화 설정이 남아 있습니다. 설정 저장을 누르면 현재 설치된 확장 선택만 보존합니다.';
    return configuration.error||configuration.notice||'확장 설정은 이 PC의 웹 도구에만 적용됩니다. 폰 설정을 변경하지 않습니다.';
  }
  function renderConfiguration(){
    const root=$('extensions-list'),feedback=$('extensions-feedback');if(!root||!feedback)return;
    const rows=configuration.data?.available||[],missing=configuredIds(configuration.data).filter(id=>!rows.some(row=>row.id===id));
    root.innerHTML=rows.length?rows.map(row=>`<label class="extension-option"><input type="checkbox" data-extension-id="${esc(row.id)}" ${configuration.draft.has(row.id)?'checked':''} ${configuration.busy||configuration.data?.environmentOverride===true?'disabled':''}><span><strong>${esc(row.name||row.id)}</strong><small>활성화 후 해당 제조사의 기기에서만 기능이 표시됩니다.</small></span></label>`).join(''):configuration.busy?'<p>확장 목록을 읽고 있습니다.</p>':'<p>설치된 제조사 확장이 없습니다. Android 공통 기능은 사용할 수 있습니다.</p>';
    const unavailable=Array.isArray(configuration.data?.unavailable)?configuration.data.unavailable.filter(row=>typeof row?.reasonKo==='string'&&/[가-힣]/.test(row.reasonKo)).map(row=>row.reasonKo):[];
    feedback.textContent=[configurationMessage(),...new Set(unavailable)].join('\n');feedback.classList.toggle('is-error',!!configuration.error);
    $('extensions-progress').hidden=!configuration.busy;$('extensions-refresh').disabled=configuration.busy;$('extensions-save').disabled=configuration.busy||configuration.data?.environmentOverride===true||!rows.length&&!missing.length||!!configuration.error;
    root.onchange=event=>{const input=event.target?.closest?.('[data-extension-id]');if(!input||configuration.busy||configuration.data?.environmentOverride===true)return;if(input.checked)configuration.draft.add(input.dataset.extensionId);else configuration.draft.delete(input.dataset.extensionId);};
  }
  function validateConfiguration(data){
    if(!data||!Array.isArray(data.available)||!Array.isArray(data.enabled)||data.configured!==undefined&&!Array.isArray(data.configured)||data.available.some(row=>!row||typeof row.id!=='string'||!extensionId.test(row.id)||typeof row.name!=='string')||new Set(data.available.map(row=>row.id)).size!==data.available.length||[data.enabled,configuredIds(data)].some(ids=>new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!extensionId.test(id))))throw new Error('확장 설정 응답을 확인하지 못했습니다.');
    return data;
  }
  async function readConfiguration(){
    if(configuration.busy)return;const epoch=++configuration.epoch,abort=new AbortController();configuration.abort=abort;configuration.busy=true;configuration.error='';configuration.notice='';renderConfiguration();const timeout=setTimeout(()=>abort.abort(),15000);
    try{const response=await fetch('/api/extensions',{cache:'no-store',signal:abort.signal}),data=await response.json();if(epoch!==configuration.epoch)return;if(!response.ok)throw new Error(data.error||'확장 설정을 읽지 못했습니다.');configuration.data=validateConfiguration(data);configuration.draft=new Set(configuredIds(data));if(data.restartRequired)configuration.notice='저장된 변경 사항은 웹 도구 서버를 다시 시작한 뒤 적용됩니다.';}
    catch(error){if(epoch===configuration.epoch){configuration.error=/[가-힣]/.test(error.message||'')?error.message:'확장 설정을 읽지 못했습니다. 목록 다시 조회를 눌러 주세요.';}}
    finally{clearTimeout(timeout);if(epoch===configuration.epoch){configuration.busy=false;configuration.abort=null;renderConfiguration();}}
  }
  async function saveConfiguration(){
    if(configuration.busy||configuration.error||!configuration.data||configuration.data.environmentOverride===true)return;
    const known=new Set(configuration.data.available.map(row=>row.id)),enabled=[...configuration.draft].filter(id=>known.has(id));
    const epoch=++configuration.epoch,abort=new AbortController();configuration.abort=abort;configuration.busy=true;configuration.error='';configuration.notice='';renderConfiguration();const timeout=setTimeout(()=>abort.abort(),15000);
    try{
      const sessionResponse=await fetch('/api/session',{cache:'no-store',signal:abort.signal}),session=await sessionResponse.json();
      if(epoch!==configuration.epoch)return;if(!sessionResponse.ok||!session.csrfToken)throw new Error('페이지 인증을 확인하지 못했습니다. 목록을 다시 조회하세요.');
      const response=await fetch('/api/extensions',{method:'POST',headers:{'Content-Type':'application/json','X-ADB-Desk-Token':session.csrfToken},body:JSON.stringify({enabled}),signal:abort.signal}),data=await response.json();
      if(epoch!==configuration.epoch)return;if(!response.ok)throw new Error(data.error||'확장 설정을 저장하지 못했습니다.');
      if(Array.isArray(data.available)&&Array.isArray(data.enabled)){configuration.data=validateConfiguration(data);configuration.draft=new Set(configuredIds(data));}
      configuration.notice=data.restartRequired===false?'확장 설정을 저장했습니다.':'확장 설정을 저장했습니다. 웹 도구 서버를 다시 시작한 뒤 적용됩니다.';
      if(data.restartRequired===false)void refreshDevice();
    }catch(error){if(epoch===configuration.epoch)configuration.error=/[가-힣]/.test(error.message||'')?error.message:'저장 결과를 확인하지 못했습니다. 목록 다시 조회로 현재 설정을 확인하세요.';}
    finally{clearTimeout(timeout);if(epoch===configuration.epoch){configuration.busy=false;configuration.abort=null;renderConfiguration();}}
  }
  function initialize(){
    const dialog=$('extensions-dialog');if(!dialog)return;
    $('extensions-open')?.addEventListener('click',()=>{if(!dialog.open)dialog.showModal();void readConfiguration();});
    $('extensions-close')?.addEventListener('click',()=>dialog.close());
    $('extensions-refresh')?.addEventListener('click',()=>void readConfiguration());
    $('extensions-form')?.addEventListener('submit',event=>{event.preventDefault();void saveConfiguration();});
    dialog.addEventListener('close',()=>{configuration.epoch++;configuration.abort?.abort();configuration.abort=null;configuration.busy=false;$('extensions-open')?.focus?.();});
    const address=$('host-address');if(address)address.textContent=window.location?.host||'현재 PC';
    renderConfiguration();apply();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialize);else initialize();
})();
