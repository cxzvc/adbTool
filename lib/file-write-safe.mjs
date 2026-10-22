import path from 'node:path';
import { quote,remotePath } from './operations-core.mjs';
import { ActionError } from './connections.mjs';
export async function remoteExists(core,serial,target,job){const value=await core.shell(serial,`[ -e ${quote(target)} ] || [ -L ${quote(target)} ] && echo yes || echo no`,{job});if(!['yes','no'].includes(value))throw new ActionError('대상 경로 상태를 확인하지 못했습니다.');return value==='yes';}
export async function canonicalEntry(core,serial,target,job){const parent=remotePath((await core.shell(serial,`readlink -f -- ${quote(path.posix.dirname(target))}`,{job})).trim());return path.posix.join(parent,path.posix.basename(target));}
export async function publishNoReplace(core,serial,source,target,job){if(await remoteExists(core,serial,target,job))throw new ActionError('대상 경로에 같은 이름이 생겼습니다. 덮어쓰지 않았습니다.',409);await core.shell(serial,`mv -nT -- ${quote(source)} ${quote(target)}`,{job});if(await remoteExists(core,serial,source,job))throw new ActionError('대상 경로가 변경되어 이동하지 않았습니다.',409);if(!await remoteExists(core,serial,target,job))throw new ActionError('대상 경로에서 결과를 찾지 못했습니다.');}
