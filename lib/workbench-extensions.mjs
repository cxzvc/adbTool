import { createNetworkAdvanced, NETWORK_ADVANCED_ACTIONS } from './network-advanced.mjs';
import { BROWSER_DEBUG_ACTIONS } from './browser-debug.mjs';
import { ActionError } from './connections.mjs';
import { createFileExtras, FILE_EXTRA_ACTIONS } from './file-extras.mjs';
import { createAppExtras, APP_EXTRA_ACTIONS } from './app-extras.mjs';
import { createConnectionExtras, CONNECTION_EXTRA_ACTIONS } from './connection-extras.mjs';
import { createInputExtras, INPUT_EXTRA_ACTIONS } from './input-extras.mjs';
import { createDiagnosticExtras, DIAGNOSTIC_EXTRA_ACTIONS } from './diagnostic-extras.mjs';
import { createShizukuTools, SHIZUKU_ACTIONS } from './shizuku-tools.mjs';
import { createDeviceDomainActions, DEVICE_DOMAIN_ACTIONS } from './device-domain-actions.mjs';
import { createShizukuManagement, SHIZUKU_MANAGEMENT_ACTIONS } from './shizuku-management.mjs';

export const EXTRA_ACTIONS=[...FILE_EXTRA_ACTIONS,...APP_EXTRA_ACTIONS,...CONNECTION_EXTRA_ACTIONS,...INPUT_EXTRA_ACTIONS,...DIAGNOSTIC_EXTRA_ACTIONS,...SHIZUKU_ACTIONS,...NETWORK_ADVANCED_ACTIONS,...BROWSER_DEBUG_ACTIONS,...DEVICE_DOMAIN_ACTIONS,...SHIZUKU_MANAGEMENT_ACTIONS];
export function createWorkbenchExtensions(core,{readDevices,history}){
  const files=createFileExtras(core),apps=createAppExtras(core),connections=createConnectionExtras(core),input=createInputExtras(core),diagnostics=createDiagnosticExtras(core);
  const handlers=new Map();
  const networkAdvanced=createNetworkAdvanced(core);for(const def of NETWORK_ADVANCED_ACTIONS)handlers.set(def.id,networkAdvanced);
  const shizuku=createShizukuManagement(core,{base:createShizukuTools(core)});for(const def of [...SHIZUKU_ACTIONS,...SHIZUKU_MANAGEMENT_ACTIONS])handlers.set(def.id,shizuku);
  const deviceDomainActions=createDeviceDomainActions(core);for(const def of DEVICE_DOMAIN_ACTIONS)handlers.set(def.id,deviceDomainActions);
  for(const [definitions,handler] of [[FILE_EXTRA_ACTIONS,files],[APP_EXTRA_ACTIONS,apps],[CONNECTION_EXTRA_ACTIONS,connections],[INPUT_EXTRA_ACTIONS,input],[DIAGNOSTIC_EXTRA_ACTIONS,diagnostics]])for(const def of definitions)handlers.set(def.id,handler);
  handlers.set('diagnostic-service',diagnostics);
  handlers.set('file-text',{async run(action,serial,body,job){const data=await files.readText(serial,body,job);return {message:`UTF-8 파일 ${data.bytes}바이트를 읽었습니다.`,output:data.text};}});
  const knownTransports=new Map();
  async function resolve(def,deviceId){
    if(def.scope==='host'||def.resolve==='host')return null;
    if(['stored','stored-usb','transport','usb'].includes(def.resolve)){
      const snapshot=await readDevices(),device=snapshot.devices.find(d=>d.id===deviceId);
      if(device?.transports?.length)knownTransports.set(deviceId,device.transports);
      const rows=device?.transports?.length?device.transports:knownTransports.get(deviceId)||[];
      const transport=['stored-usb','usb'].includes(def.resolve)?rows.find(t=>t.type==='usb'):rows.find(t=>t.state==='device')||rows[0];
      if(!transport)throw new ActionError('선택 기기의 연결 주소를 확인할 수 없습니다. 기기 목록에서 연결을 다시 선택하세요.',409);
      return transport.serial;
    }
    return (await core.resolve(deviceId)).serial;
  }
  async function options(body){
    const {kind,deviceId}=body;
    if(typeof deviceId!=='string'||!deviceId)throw new ActionError('대상 기기를 선택하세요.');
    if(kind==='log-jobs')return {options:[...core.jobs.values()].filter(j=>j.deviceId===deviceId&&j.state==='running'&&j.kind==='log-capture').map(j=>({value:j.id,label:`${j.title} · ${j.createdAt}`}))};
    if(kind==='settings-history')return {options:(history.get(deviceId)||[]).filter(h=>!h.undone&&h.undoEligible!==false).map(h=>({value:h.id,label:`${h.namespace}.${h.key} · ${h.at}`}))};
    const {serial}=await core.resolve(deviceId);
    if(['device-ime','notification-key','device-jobs'].includes(kind))return deviceDomainActions.options(serial,kind,body);
    if(['app-permissions','app-components'].includes(kind)){
      const data=await apps.inspect(serial,body.package,{user:body.user||'current'});
      const options=kind==='app-permissions'?data.permissions.filter(p=>p.requested&&p.kind==='런타임 권한').map(p=>({value:p.name,label:`${p.description||p.name} · ${p.status} (${p.name})`})):
        data.components.filter(c=>body.action!=='app-component-open'||c.kind==='activity').map(c=>({value:c.name,label:`${c.kind} · ${c.name} · ${c.state}`}));
      return {options};
    }
    if(kind==='appops')return {options:await apps.appOpsOptions(serial,body.package,{user:body.user||'current'})};
    if(kind==='jdwp'){const result=await core.run(serial,['jdwp'],{timeout:15000});return {options:result.stdout.split(/\s+/).filter(v=>/^\d+$/.test(v)).map(v=>({value:v,label:'디버깅 프로세스 PID '+v}))};}
    if(kind==='tunnels')return connections.options(serial,'tunnels',{});
    if(kind==='users-current'){
      const listed=await diagnostics.options(serial,'users',{}),user=String(await core.shell(serial,'am get-current-user')).trim();
      if(!/^(?:0|[1-9]\d{0,4})$/.test(user))throw new ActionError('현재 사용자 번호를 확인하지 못했습니다. 목록을 다시 읽으세요.',409);
      return {...listed,user};
    }
    if(['services','cmd-services','users','processes'].includes(kind))return diagnostics.options(serial,kind,{profileRole:kind==='users'?({'user-switch':'switch','profile-create':'parent'}[body.action]):undefined});
    throw new ActionError('지원하지 않는 선택 목록입니다.');
  }
  return {
    has:id=>handlers.has(id),
    async execute(def,body,job){const serial=await resolve(def,body.deviceId);return handlers.get(def.id).run(def.id,serial,body,job);},
    options,validateAppOp:apps.validateAppOp,
    async readText(body){const {serial}=await core.resolve(body.deviceId);return files.readText(serial,body);},
  };
}
