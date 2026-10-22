(() => {
  const panel=document.getElementById('monitor-panel'),tools=panel?.querySelector('.monitor-tools');
  if(!panel||!tools)return;
  const property='--monitor-tools-height';let frame=null;
  function fit(){
    frame=null;
    if(window.innerWidth<=1150||panel.hidden||!tools.getClientRects().length){if(tools.style.getPropertyValue(property))tools.style.removeProperty(property);return;}
    const top=tools.getBoundingClientRect().top;if(!Number.isFinite(top))return;
    const height=Math.max(240,Math.floor(window.innerHeight-top-12))+'px';
    if(tools.style.getPropertyValue(property)!==height)tools.style.setProperty(property,height);
  }
  function schedule(){if(frame===null)frame=requestAnimationFrame(fit);}
  window.addEventListener('resize',schedule);window.addEventListener('scroll',schedule,{passive:true});window.visualViewport?.addEventListener('resize',schedule);
  if(typeof ResizeObserver==='function'){
    const observer=new ResizeObserver(schedule);
    for(const node of [tools,panel,document.querySelector('.device-tabs'),document.querySelector('.page-heading'),document.querySelector('.device-breadcrumb'),document.getElementById('device-feedback'),document.getElementById('ops-jobs'),document.getElementById('error-banner')])if(node)observer.observe(node);
  }
  if(typeof MutationObserver==='function'){
    const observer=new MutationObserver(schedule);
    for(const node of [panel,document.getElementById('device-view'),document.body])if(node)observer.observe(node,{attributes:true,attributeFilter:['hidden','class']});
  }
  window.addEventListener('pagehide',()=>{if(frame!==null){cancelAnimationFrame(frame);frame=null;}});
  window.addEventListener('pageshow',schedule);schedule();
})();
