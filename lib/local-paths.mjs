import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {lstatSync,realpathSync} from 'node:fs';

export const APPLICATION_ROOT=path.resolve(fileURLToPath(new URL('../',import.meta.url)));

export function samePath(a,b){return path.relative(path.resolve(a),path.resolve(b))==='';}
export function insidePath(base,target){const relative=path.relative(path.resolve(base),path.resolve(target));return relative===''||!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep);}
export function physicalPath(location){
  let current=path.resolve(location);const missing=[];
  while(true){
    let found=false;
    try{
      lstatSync(current);found=true;
      const resolved=realpathSync(current);
      // A non-directory ancestor cannot be written through. Keep its projected
      // physical path so stores can report their established read-only/memory
      // fallback; migrations separately require directoryAncestors().
      return path.resolve(resolved,...missing);
    }catch(error){
      if(found&&error.code==='ENOENT')throw new Error('저장 경로의 링크가 끊어져 실제 위치를 확인하지 못했습니다.',{cause:error});
      if(error.code!=='ENOENT'&&error.code!=='ENOTDIR')throw error;
      const parent=path.dirname(current);if(parent===current)throw new Error('저장 경로의 실제 위치를 확인하지 못했습니다.');
      missing.unshift(path.basename(current));current=parent;
    }
  }
}
export function assertLocalLocation(project,location,{allowLegacyConfig=false}={}){
  const ignored=path.join(project,'.local'),legacy=path.join(project,'config.json');
  const permitted=(root,ignoredRoot,target,legacyFile)=>!insidePath(root,target)||insidePath(ignoredRoot,target)||allowLegacyConfig&&samePath(legacyFile,target);
  if(!permitted(project,ignored,location,legacy))throw new Error('프로젝트 내부의 개인 자료는 Git에서 제외되는 .local 폴더에 저장해야 합니다. 공개 소스 경로는 사용할 수 없습니다.');
  const physicalProject=physicalPath(project),physicalTarget=physicalPath(location);
  if(!permitted(physicalProject,path.join(physicalProject,'.local'),physicalTarget,path.join(physicalProject,'config.json')))throw new Error('링크의 실제 저장 위치가 공개 소스 폴더입니다. 개인 자료를 저장하지 않았습니다.');
  return location;
}

// Public assets stay under root/data. All generated and personal files belong
// below localRoot; changing this location never changes the public asset root.
export function storagePaths(root=APPLICATION_ROOT,{env=process.env}={}){
  const project=path.resolve(root),localRoot=path.resolve(project,env.ADB_DESK_HOME||'.local');
  const configFile=env.ADB_DESK_CONFIG?path.resolve(project,env.ADB_DESK_CONFIG):path.join(localRoot,'config.json');
  const paths={root:project,localRoot,dataRoot:path.join(localRoot,'data'),runtime:path.join(localRoot,'runtime'),backupRoot:path.join(localRoot,'backups'),configFile};
  for(const name of ['localRoot','dataRoot','runtime','backupRoot'])assertLocalLocation(project,paths[name]);
  assertLocalLocation(project,configFile,{allowLegacyConfig:true});
  return Object.freeze(paths);
}
