(() => {
  function formatBytes(value) {
    if (!Number.isFinite(value) || value < 0) return '조회 불가';
    if (value === 0) return '0 B';
    const unit=Math.min(4,Math.floor(Math.log(Math.max(1,value))/Math.log(1000)));
    return `${(value/1000**unit).toLocaleString('ko-KR',{maximumFractionDigits:unit?2:0})} ${['B','KB','MB','GB','TB'][unit]}`;
  }
  function formatLogTime(value) {
    const date=new Date(value),pad=(n,width=2)=>String(n).padStart(width,'0');
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(),3)}`;
  }
  function filterLogs(entries,{pid='',level='V',exact=false,tag='',query='',buffer='all'}={}) {
    const order={V:0,D:1,I:2,W:3,E:4,F:5,A:5};
    return entries.filter(row=>(!pid||String(row.pid)===String(pid))&&(buffer==='all'||row.buffer===buffer)&&
      (exact?row.level===level:(order[row.level]??-1)>=(order[level]??0))&&
      row.tag.toLowerCase().includes(tag.toLowerCase())&&row.message.toLowerCase().includes(query.toLowerCase()));
  }
  function sortProcesses(rows,key='cpu',direction='desc') {
    if(!['pid','ppid','name','user','state','cpu','rss','virtual'].includes(key))key='cpu';
    const sign=direction==='asc'?1:-1;
    return [...rows].sort((a,b)=>{
      if(a[key]===null||a[key]===undefined)return b[key]===null||b[key]===undefined?a.pid-b.pid:1;
      if(b[key]===null||b[key]===undefined)return -1;
      const diff=typeof a[key]==='string'?a[key].localeCompare(b[key],'ko',{numeric:true}):a[key]-b[key];
      return diff*sign||a.pid-b.pid;
    });
  }
  globalThis.DeskUI={formatBytes,formatLogTime,filterLogs,sortProcesses};
})();
