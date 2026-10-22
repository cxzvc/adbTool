(() => {
  const tasks=new Map(),scopes=new Map(),quiet=new Set(),renders=new Map(),buttons=new Map();let next=0,renderId=0;
  const $=id=>document.getElementById(id);
  function buttonNode(value){return typeof value==='string'?$(value):value;}
  function syncButton(button){
    const pending=buttons.get(button),busy=!!pending?.size;
    button.classList?.toggle('desk-pending',busy);
    if(busy){button.setAttribute('aria-busy','true');button.setAttribute('data-pending-label',[...pending.values()].at(-1));}
    else{button.removeAttribute('aria-busy');button.removeAttribute('data-pending-label');buttons.delete(button);}
  }
  function update(){
    const root=$('device-busy');if(!root)return;
    const visible=[...tasks].filter(([id])=>!quiet.has(id)).map(([,label])=>label);root.classList.toggle('active',visible.length>0);root.setAttribute('aria-busy',String(visible.length>0));root.setAttribute('aria-hidden',String(visible.length===0));
    const label=$('device-busy-label');if(label)label.textContent=visible.length?visible.at(-1)+(visible.length>1?` · ${visible.length}개 작업`:''):'';
  }
  function start(label,options={}){
    const id=++next,button=buttonNode(options?.button);tasks.set(id,String(label||'처리 중'));scopes.set(id,options?.scope||'device');if(options?.quiet)quiet.add(id);
    if(button?.setAttribute){if(!buttons.has(button))buttons.set(button,new Map());buttons.get(button).set(id,String(label||'처리 중'));syncButton(button);}
    update();let done=false;
    return()=>{if(done)return;done=true;tasks.delete(id);scopes.delete(id);quiet.delete(id);if(button&&buttons.get(button)?.delete(id))syncButton(button);update();};
  }
  const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
  async function paint(label,work){const finish=start(label),revision=++renderId;renders.set(label,revision);try{await frame();await frame();if(renders.get(label)!==revision)return;return await work();}finally{await frame();finish();}}
  function explainState(root,options){
    const helper=window.DeskErrors;if(!helper||options.explainError===false)return options;
    const failure=['error','offline','disconnected','unsupported'].includes(options.type)||options.rawError!=null||options.type==='warning'&&helper.isFailureText(options.message);
    if(!failure)return options;
    const owner=(root.id||'')+' '+(root.closest?.('[role="tabpanel"]')?.id||'');
    const selected=document.querySelector?.('.device-tabs [aria-selected="true"]')?.id||'';
    const hint=owner+' '+selected,context=/file|target-picker/.test(hint)?'files':/network|\bna-/.test(hint)?'network':/logs/.test(hint)?'logs':/history/.test(hint)?'history':/mirror|screen|media|stream/.test(hint)?'mirror':/settings|explorer/.test(hint)?'settings':/apps|package|install/.test(hint)?'apps':/monitor|process|domain/.test(hint)?'diagnostics':'workbench';
    const info=helper.explain(options.rawError??options.error??options.message,{context,...(typeof options.errorContext==='object'?options.errorContext:options.errorContext?{context:options.errorContext}:{})});
    if(!info.recognized&&!info.technicalError&&helper.hasKorean(info.rawError)&&!options.requiredAccessKo&&!options.alternativesKo)return options;
    const preserveMessage=helper.hasKorean(options.message||'')&&!helper.isFailureText(options.message||'')&&!helper.isTechnicalText?.(options.message||'');
    const originalRaw=options.rawError??info.rawError,raw=originalRaw?String(originalRaw).slice(0,24000)+(String(originalRaw).length>24000?'\n[긴 원문은 앞부분만 표시합니다.]':''):'';
    const explanationKo=options.explanationKo??(preserveMessage&&(info.recognized||info.technicalError)&&!options.requiredAccessKo&&!String(options.message).includes(info.reasonKo)?info.reasonKo:'');
    const confirmed=info.permissions?.length&&['permission-denied','cross-user-denied','usage-access-denied'].includes(info.code)?info.permissions.join(' · '):'';
    return {...options,title:helper.hasKorean(options.title||'')?options.title:info.titleKo,message:preserveMessage?options.message:info.reasonKo,explanationKo,requiredAccessKo:options.requiredAccessKo??info.requiredAccessKo,alternativesKo:options.alternativesKo??info.alternativesKo,actionAccessLabel:options.actionAccessLabel??confirmed,actionAccessTitle:options.actionAccessTitle??info.requiredAccessKo,rawError:raw&&String(raw)!==String(info.reasonKo)?String(raw):null};
  }
  function state(host,options){
    const root=buttonNode(host);if(!root)return null;
    root.replaceChildren();root.hidden=!options;if(!options)return null;
    options=explainState(root,options);
    const known=['loading','error','offline','empty','info','success','warning','disconnected','unsupported'],type=known.includes(options.type)?options.type:'info';
    const card=document.createElement('div');card.className='desk-state desk-state-'+type;card.setAttribute('data-state',type);card.setAttribute('role',['error','offline','disconnected'].includes(type)?'alert':'status');card.setAttribute('aria-live','polite');
    const content=document.createElement('div');content.className='desk-state-content';
    if(options.title){const title=document.createElement('strong');title.textContent=String(options.title);content.append(title);}
    if(options.message){const message=document.createElement('p');message.textContent=String(options.message);content.append(message);}
    if(options.explanationKo){const explanation=document.createElement('p');explanation.className='desk-error-explanation';explanation.textContent=String(options.explanationKo);content.append(explanation);}
    if(options.requiredAccessKo){const needed=document.createElement('p');needed.className='desk-required-access';needed.textContent='필요한 접근: '+String(options.requiredAccessKo);content.append(needed);}
    if(options.alternativesKo){const alternative=document.createElement('p');alternative.className='desk-access-alternative';alternative.textContent='가능한 확인: '+String(options.alternativesKo);content.append(alternative);}
    if(options.rawError){const details=document.createElement('details'),summary=document.createElement('summary'),raw=document.createElement('pre');details.className='desk-error-details';summary.textContent='기술 오류 원문';raw.textContent=String(options.rawError);details.append(summary,raw);content.append(details);}
    card.append(content);
    if(type==='loading'){card.setAttribute('aria-busy','true');const progress=document.createElement('progress');progress.setAttribute('aria-label',String(options.title||'처리 중'));card.append(progress);}
    let actionBusy=false;const actionButtons=[];
    function actionButton(label,run,accessLabel,accessTitle){
      const button=document.createElement('button');button.type='button';button.className='desk-state-action';button.textContent=String(label);actionButtons.push(button);
      if(accessLabel){const badge=document.createElement('span');badge.className='desk-access-badge';badge.textContent=String(accessLabel);if(accessTitle)badge.setAttribute('title',String(accessTitle));button.append(badge);}
      button.onclick=async event=>{
        if(actionBusy||root.contains&&!root.contains(card))return;actionBusy=true;for(const action of actionButtons)action.disabled=true;const finish=start(String(label),{button,quiet:true});
        try{await run(event);}catch(error){
          if(root.contains?.(card))state(root,{type:'error',title:'요청을 완료하지 못했습니다',message:error?.message||'연결 상태를 확인한 뒤 다시 시도해 주세요.',errorContext:options.errorContext,actionLabel:options.actionLabel,onAction:options.onAction,actions:options.actions});
        }finally{finish();actionBusy=false;for(const action of actionButtons)if(action.isConnected!==false)action.disabled=false;}
      };return button;
    }
    if(options.actionLabel&&typeof options.onAction==='function')card.append(actionButton(options.actionLabel,options.onAction,options.actionAccessLabel,options.actionAccessTitle));
    const choices=Array.isArray(options.actions)?options.actions.filter(action=>action?.label&&typeof action.onAction==='function'):[];
    if(choices.length){const group=document.createElement('div');group.className='desk-state-choices';group.setAttribute('role','group');group.setAttribute('aria-label','현재 권한에서 가능한 대체 조회');for(const choice of choices){const item=document.createElement('div');item.className='desk-state-choice';item.append(actionButton(choice.label,choice.onAction,choice.accessLabel,choice.accessTitle));if(choice.description){const description=document.createElement('small');description.textContent=String(choice.description);item.append(description);}group.append(item);}card.append(group);}
    root.append(card);return card;
  }
  window.DeskFeedback={start,paint,state,clear(scope){
    renders.clear();
    for(const id of [...tasks.keys()])if(!scope||scopes.get(id)===scope){tasks.delete(id);scopes.delete(id);quiet.delete(id);for(const[button,pending]of buttons)if(pending.delete(id))syncButton(button);}
    update();
  }};

  const tabs=document.querySelector('.device-tabs');
  if(tabs)new ResizeObserver(()=>document.documentElement.style.setProperty('--device-tabs-height',tabs.offsetHeight+'px')).observe(tabs);
})();
