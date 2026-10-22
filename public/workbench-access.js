(() => {
  const labels={adb:'일반 ADB','root-required':'루트 필수','root-optional':'조건부 루트','debug-build':'개발용 빌드',privileged:'대상별 권한',recovery:'복구 모드'};
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function metadata(action,values={}){
    const base=action?.access||{},variant=base.field&&base.variants?base.variants[values[base.field]]:null;
    const value={...base,...variant},kind=Object.hasOwn(labels,value.kind)?value.kind:'adb';
    return {kind,label:value.label||labels[kind],description:value.description||'',permissionLabel:value.permissionLabel||'',permissionDescription:value.permissionDescription||'',requiredPermissions:Array.isArray(value.requiredPermissions)?value.requiredPermissions:[]};
  }
  function badge(action,values={}){const access=metadata(action,values);return (access.kind==='adb'?'':`<span class="wb-access-badge" data-access-kind="${access.kind}" title="${esc(access.description)}">${esc(access.label)}</span>`)+(access.permissionLabel?`<span class="wb-access-badge" data-access-kind="permission" title="${esc(access.permissionDescription)}">${esc(access.permissionLabel)}</span>`:'');}
  function note(action,values={}){const access=metadata(action,values),badges=badge(action,values);return !badges?'':`${badges}<span>${esc(access.kind==='adb'?access.permissionDescription:[access.description,access.permissionDescription].filter(Boolean).join(' '))}</span>`;}
  window.WorkbenchAccess={metadata,badge,note};
})();
