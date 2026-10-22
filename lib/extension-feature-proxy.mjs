import {getRegisteredFeature,requireExtensionFeature,subscribeExtensions} from './extensions.mjs';
import {ActionError} from './connections.mjs';

export function registeredImplementation(id){
  const value=getRegisteredFeature(id);
  if(!value)throw Object.assign(new ActionError('이 기능을 제공하는 제조사 확장이 활성화되어 있지 않습니다.',409),{code:'extension_unavailable',mayHaveChanged:false});
  return value;
}
export function createExtensionFeatureProxy(id,factory,args){
  let activity=args.activity;const instances=new Map();
  subscribeExtensions(()=>instances.clear());
  const resolve=async deviceId=>{const value=await args.resolve(deviceId);requireExtensionFeature(id,value.device||{});return value;};
  async function invoke(method,deviceId,parameters){
    registeredImplementation(id);
    const resolved=await resolve(deviceId),extension=requireExtensionFeature(id,resolved.device||{});
    let handler=instances.get(extension);
    if(!handler){handler=extension.features[id][factory]({...args,resolve,activity});instances.set(extension,handler);}
    return handler[method](...parameters);
  }
  return {read:(deviceId,...rest)=>invoke('read',deviceId,[deviceId,...rest]),mutate:body=>invoke('mutate',body?.deviceId,[body]),setActivity(value){activity=value;for(const handler of instances.values())handler.setActivity?.(value);}};
}
