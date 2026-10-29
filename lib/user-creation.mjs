const TYPE='android.os.usertype.full.SECONDARY';

// Creation capacity is independent of profile capacity and the switcher UI.
// Only runtime user-service evidence is used; no model or firmware is assumed.
export function assessUserCreation(dump,users=[]){
  const lines=String(dump||'').split(/\r?\n/);
  const maxRows=lines.filter(line=>/^\s*Max (?:switchable )?users:\s*\d+\b/i.test(line));
  const maxLine=maxRows.length===1?maxRows[0]:'';
  const maxUsers=maxLine?Number(/users:\s*(\d+)/i.exec(maxLine)[1]):null;
  const globalLimitReached=maxLine?/\(limit reached\)/i.test(maxLine):null;
  const starts=lines.flatMap((line,index)=>/^\s*(?:Type:\s*)?android\.os\.usertype\.full\.SECONDARY:\s*$/.test(line)?[index]:[]);
  let block='';
  if(starts.length===1){
    const start=starts[0],indent=lines[start].search(/\S/),rows=[];
    for(let index=start+1;index<lines.length;index++){
      if(lines[index].trim()&&lines[index].search(/\S/)<=indent)break;
      rows.push(lines[index]);
    }
    block=rows.join('\n');
  }
  const field=name=>{const matches=[...block.matchAll(new RegExp('^[ \\t]*'+name+':[ \\t]*([^\\r\\n]+)$','gm'))];return matches.length===1?matches[0][1].trim():null;};
  const enabledText=field('mEnabled'),enabled=enabledText==='true'?true:enabledText==='false'?false:null;
  const limitText=field('mMaxAllowed'),typeLimit=/^(?:-1|\d+)$/.test(limitText||'')&&Number(limitText)<=1000000?Number(limitText):null;
  const countKnown=users.length>0&&users.every(user=>typeof user.type==='string'&&user.type);
  const typeCount=countKnown?users.filter(user=>user.type===TYPE).length:null;
  const result={type:TYPE,enabled,typeLimit,typeCount,maxUsers,globalLimitReached,state:'unverified',canCreate:null,reasonKo:'현재 사용자 서비스 응답으로 일반 사용자 생성 정원을 확인하지 못했습니다. 현재 상태를 다시 조회하세요.'};
  const blocked=reasonKo=>({...result,state:'blocked',canCreate:false,reasonKo});
  if(enabled===false)return blocked('현재 기기에서 일반 사용자 유형의 생성이 비활성화되어 있습니다. 보안 폴더·관리 프로필 지원 여부와는 별개입니다.');
  if(typeLimit===0)return blocked('현재 기기에서 새 일반 사용자 유형의 허용 정원이 0명입니다. 이 유형의 사용자를 추가할 수 없습니다. 보안 폴더·관리 프로필의 정원은 별개입니다.');
  if(typeLimit!==null&&typeLimit>0&&typeCount!==null&&typeCount>=typeLimit)return blocked(`일반 사용자 유형의 허용 정원 ${typeLimit}명에 도달했습니다. 이 유형의 사용자를 더 만들 수 없습니다.`);
  if(globalLimitReached)return blocked(`현재 기기가 일반 사용자 수 상한에 도달했다고 보고했습니다${maxUsers!==null?'(최대 '+maxUsers+'명)':''}. 새 일반 사용자를 추가할 수 없습니다. 보안 폴더·관리 프로필의 정원은 별개입니다.`);
  if(enabled===true&&globalLimitReached===false&&(typeLimit===-1||typeLimit!==null&&typeLimit>0&&typeCount!==null&&typeCount<typeLimit))return {...result,state:'conditional',canCreate:true,reasonKo:'조회한 일반 사용자 정원에는 여유가 있습니다. 실행 직전에 다시 확인하며, 실제 생성은 기기 권한·정책에 따라 제한될 수 있습니다.'};
  return result;
}
