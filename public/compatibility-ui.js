(() => {
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const records=new Map();let sequence=0,dialog=null,returnFocus=null;
  function present(data,opts={}){
    const mode=opts.mode||'write',canAct=opts.canAct??(mode==='read'?data?.canRead:data?.canWrite),canRead=opts.canRead??data?.canRead;
    let label,tone,reason='';
    if(opts.loading){label='조회 중';tone='pending';}
    else if(opts.error){label='조회 실패';tone='error';reason='현재 상태를 확인하지 못했습니다. 다시 조회해 주세요.';}
    else if(opts.selectionRequired){label='대상 선택';tone='unknown';reason='목록에서 조회할 대상을 선택해 주세요.';}
    else if(!data){label='조회 전';tone='unknown';}
    else if(data.support?.state==='unsupported'){label='미지원';tone='blocked';reason='현재 기기에서 이 작업을 지원하지 않습니다.';}
    else if(data.access?.state==='denied'){label=canRead?'조회만 가능':'조회 제한';tone='blocked';reason='현재 ADB 권한이나 기기 정책으로 이 작업이 제한됩니다.';}
    else if(canAct===true){label=mode==='read'?'조회 가능':'변경 요청 가능';tone='available';}
    else if(mode==='write'&&data.evidence?.state==='previous'){label='현재 빌드 확인 필요';tone='unknown';reason='현재 빌드의 동작을 검증하지 못해 조회만 제공합니다.';}
    else if(canRead){label='조회만 가능';tone='unknown';reason='변경에 필요한 조건을 확인하지 못했습니다.';}
    else {label='현재 상태 확인 필요';tone='unknown';reason='현재 상태를 조회한 뒤 사용 조건을 확인해 주세요.';}
    if(typeof opts.reason==='string')reason=opts.reason;
    const effect=opts.effectUntested===true||opts.effectUntested!==false&&mode==='write'&&data&&data.effect?.state!=='verified'?'실제 효과 미확인':'';
    return {label,tone,reason,effect};
  }
  function badge(data,opts={}){const view=present(data,opts);return `<span class="compatibility-badge is-${esc(view.tone)}">${esc(view.label)}</span>`;}
  function detailButton(data,opts={}){
    const id=String(++sequence);records.set(id,{data,opts:{title:opts.title,sections:opts.sections}});
    while(records.size>4096)records.delete(records.keys().next().value);
    return `<button type="button" class="compatibility-detail-button" data-compatibility-details="${id}" aria-haspopup="dialog">상세 정보</button>`;
  }
  function summary(data,opts={}){
    const view=present(data,opts);
    return `<div class="compatibility-status">${opts.showStatus!==false?badge(data,opts):''}${opts.showReason!==false&&view.reason?`<p class="compatibility-reason">${esc(view.reason)}</p>`:''}<div class="compatibility-meta">${opts.showEffect!==false&&view.effect?`<small>${esc(view.effect)}</small>`:''}${opts.showDetails!==false?detailButton(data,opts):''}</div></div>`;
  }
  function detailContent(data,opts={}){
    const rows=[['support','기능 지원'],['access','현재 권한'],['evidence','코드 검증'],['effect','실제 효과']].filter(([key])=>data?.[key]);
    const source=data?.source;
    const sections=[...rows.map(([key,label])=>({label,text:data[key].labelKo||data[key].state})),...(data?.reasonKo?[{label:'상세 판정 이유',text:data.reasonKo}]:[]),...(data?.requiredAccessKo?[{label:'필요한 권한',text:data.requiredAccessKo}]:[]),...(source?[{label:'검증 자료',text:[source.model,source.build,source.fingerprint,source.method].filter(Boolean).join('\n')}]:[]),...(Array.isArray(opts.sections)?opts.sections:[])].filter(row=>row&&typeof row.label==='string'&&typeof row.text==='string'&&row.text.trim());
    const unique=[...new Map(sections.map(row=>[row.label+'\0'+row.text,row])).values()];
    return `<dl class="compatibility-detail-list">${unique.map(row=>`<div><dt>${esc(row.label)}</dt><dd>${esc(row.text)}</dd></div>`).join('')}</dl>`;
  }
  function closeDetails(){if(dialog?.open)dialog.close();}
  function openDetails(data,opts={},trigger){
    if(typeof document==='undefined'||!document.createElement||!document.body)return;
    if(!dialog){
      dialog=document.createElement('dialog');dialog.id='compatibility-detail-dialog';dialog.className='compatibility-detail-dialog';dialog.setAttribute('aria-labelledby','compatibility-detail-title');document.body.append(dialog);
      dialog.addEventListener('close',()=>{const target=returnFocus;returnFocus=null;if(target?.isConnected!==false)target?.focus?.();});
      dialog.addEventListener('click',event=>{if(event.target?.closest?.('[data-compatibility-close]'))closeDetails();});
    }
    returnFocus=trigger||document.activeElement;
    dialog.innerHTML=`<header><h2 id="compatibility-detail-title">${esc(opts.title||'상세 정보')}</h2><button type="button" data-compatibility-close aria-label="상세 정보 닫기" autofocus>닫기</button></header><p class="compatibility-detail-notice">조회한 자료와 검증 근거입니다. 이 창에서는 기기를 변경하지 않습니다.</p>${detailContent(data,opts)}`;
    if(!dialog.open)dialog.showModal();dialog.querySelector?.('[data-compatibility-close]')?.focus?.();
  }
  if(typeof document!=='undefined')document.addEventListener?.('click',event=>{const trigger=event.target?.closest?.('[data-compatibility-details]');if(!trigger)return;const record=records.get(trigger.dataset.compatibilityDetails);if(record)openDetails(record.data,record.opts,trigger);});
  window.CompatibilityUI=Object.freeze({present,badge,badges:badge,summary,details:summary,detailButton,detailContent,openDetails,closeDetails});
})();
