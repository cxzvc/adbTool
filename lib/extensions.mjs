import path from 'node:path';
import {existsSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {ActionError} from './connections.mjs';

const APP_ROOT=fileURLToPath(new URL('..',import.meta.url));
const bundled=Object.freeze([{id:'samsung',name:'Samsung Galaxy',manufacturer:'samsung',entry:'extensions/samsung/index.mjs'}]);
let currentRoot=APP_ROOT,active=[],issues=new Map(),generation=0;
const listeners=new Set();
const manufacturer=device=>String(typeof device==='string'?device.split('/')[0]:device?.manufacturer||device?.fingerprint?.split('/')[0]||'').trim().toLowerCase();
const matches=(extension,device)=>manufacturer(device)!==''&&extension.manufacturer.toLowerCase()===manufacturer(device);

export async function configureExtensions({root=APP_ROOT,enabled=[],localRoot}={}){
  if(!Array.isArray(enabled)||enabled.some(id=>typeof id!=='string'||!bundled.some(row=>row.id===id)))throw new ActionError('설치된 확장 목록에서 활성화할 항목을 선택하세요.',400);
  const token=++generation,next=[],nextIssues=new Map();currentRoot=path.resolve(root);
  for(const id of [...new Set(enabled)]){
    const descriptor=bundled.find(row=>row.id===id),entry=path.join(currentRoot,descriptor.entry);
    if(!existsSync(entry)){nextIssues.set(id,'확장 파일이 설치되어 있지 않습니다. 공통 기능은 계속 사용할 수 있습니다.');continue;}
    try{
      const module=await import(pathToFileURL(entry).href);
      const extension=await module.createExtension({root:currentRoot,localRoot});
      if(extension?.id!==id||extension.manufacturer!==descriptor.manufacturer||!Array.isArray(extension.settings)||!extension.features)throw new Error('Invalid extension manifest');
      next.push(extension);
    }catch{nextIssues.set(id,'확장 자료를 읽지 못했습니다. 설치 상태를 확인하세요. 공통 기능은 계속 사용할 수 있습니다.');}
  }
  if(token!==generation)return describeExtensions();
  active=next;issues=nextIssues;
  for(const listener of listeners)listener([...active]);
  return describeExtensions();
}
export function subscribeExtensions(listener){listeners.add(listener);listener([...active]);return()=>listeners.delete(listener);}
export const enabledExtensionIds=()=>active.map(row=>row.id);
export const getEnabledExtensions=()=>[...active];
export const getExtensionsForDevice=device=>active.filter(row=>matches(row,device));
export const getExtensionForFeature=(featureId,device)=>active.find(row=>matches(row,device)&&Object.hasOwn(row.features,featureId))||null;
export const getRegisteredFeature=featureId=>active.find(row=>Object.hasOwn(row.features,featureId))?.features[featureId]||null;
export function requireExtensionFeature(featureId,device){
  const extension=getExtensionForFeature(featureId,device);
  if(!extension)throw Object.assign(new ActionError('이 기기에서 활성화된 제조사 확장이 제공하는 기능이 아닙니다. 확장 설정과 기기 제조사를 확인하세요.',409),{code:'extension_unavailable',mayHaveChanged:false});
  return extension;
}
export function listAvailableExtensions(){return bundled.map(row=>({id:row.id,name:row.name,manufacturer:row.manufacturer,installed:existsSync(path.join(currentRoot,row.entry)),enabled:active.some(ext=>ext.id===row.id),reasonKo:issues.get(row.id)||null}));}
export function describeExtensions(device){
  const matched=device?getExtensionsForDevice(device):[],features={privacyIndicators:false,gpsIndicator:false,samsungSettings:false,firmwareReference:false};
  for(const ext of matched)for(const feature of Object.values(ext.features))if(feature.publicName)features[feature.publicName]=true;
  return {extensions:listAvailableExtensions().map(row=>({...row,matched:matched.some(ext=>ext.id===row.id)})),features,assets:{scripts:[...new Set(matched.flatMap(ext=>ext.assets?.scripts||[]))],styles:[...new Set(matched.flatMap(ext=>ext.assets?.styles||[]))]}};
}
export function resolveExtensionAsset(route){
  for(const extension of active){
    const scripts=extension.assets?.scripts||[],styles=extension.assets?.styles||[];
    if(!scripts.includes(route)&&!styles.includes(route))continue;
    const name=path.posix.basename(route);if(!/^[a-z0-9-]+\.(?:js|css)$/i.test(name))return null;
    return {file:path.join(currentRoot,'extensions',extension.id,'public',name),contentType:scripts.includes(route)?'text/javascript; charset=utf-8':'text/css; charset=utf-8'};
  }
  return null;
}
