import assert from 'node:assert/strict';
export function feedbackFixture(){
  const starts=[],states=[];
  const api={
    start(label,{button}={}){const row={label,button,finished:false};starts.push(row);if(button)button.busy=true;return()=>{if(row.finished)return;row.finished=true;if(button)button.busy=false;};},
    state(host,value){if(!host)return;if(value)assert.ok(['loading','error','offline','empty','info','success','warning'].includes(value.type),value.type);states.push({host,value});host.state=value;host.hidden=!value;host.textContent=value?value.title+(value.message?' '+value.message:''):'';}
  };
  return{api,starts,states};
}
