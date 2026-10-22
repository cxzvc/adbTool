(() => {
  const key='adb-desk-appearance-v1',root=document.documentElement;
  const media=window.matchMedia?.('(prefers-color-scheme: dark)');let choice='system';
  try{const saved=localStorage.getItem(key);if(['light','dark','system'].includes(saved))choice=saved;}catch{}
  function apply(){root.dataset.theme=choice==='system'?(media?.matches?'dark':'light'):choice;root.dataset.appearance=choice;}
  apply();
  // Adapt existing same-origin CSS paint values, retaining semantic hues and layout.
  // Pixels in video/canvas/images are never filtered or modified.
  function tone(value,role='color'){
    return String(value).replace(/#[\da-f]{3,8}\b|rgba?\([^)]*\)|\bwhite\b|\bblack\b/gi,token=>{
      let r,g,b,a=1;if(/^#/i.test(token)){let hex=token.slice(1);if(hex.length===3||hex.length===4)hex=hex.split('').map(c=>c+c).join('');if(![6,8].includes(hex.length))return token;[r,g,b]=[0,2,4].map(i=>parseInt(hex.slice(i,i+2),16));if(hex.length===8)a=parseInt(hex.slice(6),16)/255;}
      else if(/^white$/i.test(token))[r,g,b]=[255,255,255];else if(/^black$/i.test(token))[r,g,b]=[0,0,0];else{const parts=token.match(/[\d.]+%?/g)||[];if(parts.length<3)return token;[r,g,b]=parts.slice(0,3).map(v=>v.endsWith('%')?parseFloat(v)*2.55:Number(v));if(parts[3])a=parts[3].endsWith('%')?parseFloat(parts[3])/100:Number(parts[3]);}
      if(a===0)return token;const max=Math.max(r,g,b)/255,min=Math.min(r,g,b)/255,l=(max+min)/2,s=max===min?0:(max-min)/(1-Math.abs(2*l-1));
      const background=/background|shadow|(?:^|-)bg|surface|canvas|selected|sidebar|white/.test(role),border=/border|outline|line/.test(role);let target;
      if(background){if(l<.28)return token;target=s<.18?.105+(.98-Math.min(.98,l))*.16:Math.min(.28,.13+(1-l)*.18);}
      else if(border)target=s<.2?.26:Math.min(.52,.30+s*.16);
      else target=s<.18?Math.max(.78,Math.min(.96,1-l*.20)):Math.max(.72,Math.min(.87,.76+(l-.5)*.12));
      // Preserve HSL hue; reduce overly saturated surfaces, keep status text legible.
      let h=215;if(s>=.18&&max!==min){if(max===r/255)h=((g-b)/255/(max-min))%6;else if(max===g/255)h=(b-r)/255/(max-min)+2;else h=(r-g)/255/(max-min)+4;h=(h*60+360)%360;}
      const sat=s<.18?(background?.28:.18):Math.min(s,background?.42:.80),c=(1-Math.abs(2*target-1))*sat,x=c*(1-Math.abs((h/60)%2-1)),m=target-c/2;
      let rgb=h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x];
      rgb=rgb.map(v=>Math.round((v+m)*255));return `rgba(${rgb.join(',')},${Math.min(1,Math.max(0,a)).toFixed(3)})`;
    });
  }
  function scopeSelectors(text){const selectors=[];let start=0,depth=0,quote=null,escape=false;for(let i=0;i<text.length;i++){const c=text[i];if(escape){escape=false;continue;}if(c==='\\'){escape=true;continue;}if(quote){if(c===quote)quote=null;continue;}if(c==='"'||c==="'"){quote=c;continue;}if(c==='('||c==='[')depth++;else if(c===')'||c===']')depth--;else if(c===','&&depth===0){selectors.push(text.slice(start,i).trim());start=i+1;}}selectors.push(text.slice(start).trim());return selectors.map(selector=>/^:root\b/.test(selector)?selector.replace(/^:root\b/,'html[data-theme="dark"]'):/^html\b/.test(selector)?selector.replace(/^html\b/,'html[data-theme="dark"]'):'html[data-theme="dark"] '+selector).join(',');}
  function buildPalette(){let style=document.getElementById('desk-dark-palette');if(!style){style=document.createElement('style');style.id='desk-dark-palette';document.head.append(style);}let count=0;
    function rules(items){let text='';for(const rule of Array.from(items||[])){if(rule.selectorText&&rule.style){const declarations=[];for(const property of Array.from(rule.style)){if(!/color|background|border|outline|shadow|fill|stroke|accent|^--/.test(property))continue;const value=rule.style.getPropertyValue(property);if(/url\(/i.test(value))continue;const adapted=tone(value,property);if(adapted!==value)declarations.push(property+':'+adapted+(rule.style.getPropertyPriority(property)?' !important':'')+';');}if(declarations.length){text+=scopeSelectors(rule.selectorText)+'{'+declarations.join('')+'}\n';count++;}}
      else if(rule.cssRules&&rule.conditionText)text+=(String(rule.cssText||'').trim().startsWith('@supports')?'@supports ':'@media ')+rule.conditionText+'{'+rules(rule.cssRules)+'}\n';}return text;}
    let text='';for(const sheet of Array.from(document.styleSheets||[])){if(sheet.ownerNode===style)continue;try{text+=rules(sheet.cssRules);}catch{}}
    style.textContent=text;root.dataset.darkPaletteRules=String(count);
  }
  function mount(){const host=document.querySelector('.topbar-right');if(host&&!document.getElementById('appearance-choice')){const label=document.createElement('label');label.className='appearance-control';label.innerHTML='<span>테마</span><select id="appearance-choice" aria-label="웹 화면 테마"><option value="system">PC 설정에 맞춤</option><option value="light">밝게</option><option value="dark">어둡게</option></select>';host.prepend(label);const select=document.getElementById('appearance-choice');select.value=choice;select.onchange=()=>{if(!['system','light','dark'].includes(select.value))return;choice=select.value;try{localStorage.setItem(key,choice);}catch{}apply();};}buildPalette();}
  media?.addEventListener?.('change',()=>{if(choice==='system')apply();});window.addEventListener?.('storage',event=>{if(event.key===key){choice=['light','dark','system'].includes(event.newValue)?event.newValue:'system';apply();const select=document.getElementById('appearance-choice');if(select)select.value=choice;}});
  window.DeskAppearance={tone,scopeSelectors,rebuild:buildPalette,get choice(){return choice;}};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
})();
