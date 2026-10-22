import {readFileSync} from 'node:fs';
import path from 'node:path';
import {storagePaths} from './local-paths.mjs';
// Personal historical evidence is never shipped as a public/current device fact.
export function userOperationReview(deviceId,{root,localRoot=storagePaths(root).localRoot}={}){
 try{
  const evidence=JSON.parse(readFileSync(path.join(localRoot,'private-evidence','user-operation-review.json'),'utf8'));
  if(evidence.live!==false||evidence.deviceId!==deviceId||!evidence.firmware?.fingerprint||!evidence.operations?.['profile-create']||!evidence.operations?.['user-start'])return null;
  return structuredClone(evidence);
 }catch{return null;}
}
