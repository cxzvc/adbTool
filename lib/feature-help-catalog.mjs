import {readFileSync} from 'node:fs';
import {WORKBENCH_ACTIONS} from './workbench-catalog.mjs';
import {FILE_APP_HELP} from './feature-help-files-apps.mjs';
import {CONNECTION_LOG_HELP} from './feature-help-connection-logs.mjs';
import {DISPLAY_SETTING_HELP} from './feature-help-display-settings.mjs';
import {DIAGNOSTIC_ADVANCED_HELP} from './feature-help-diagnostics-advanced.mjs';

const copy=JSON.parse(readFileSync(new URL('../docs/3.7-메뉴배치.json',import.meta.url),'utf8')).copy;
export const SPECIALIZED_USER_HELP_IDS=Object.freeze(['users-list','users-detail','user-state','user-create','profile-create','user-switch','user-start','user-stop','user-remove']);
const special=new Set(SPECIALIZED_USER_HELP_IDS);
const reads=new Set(`file-text file-inspect file-checksum package-details permission-list appops-read appdata-check
app-permissions app-components app-diagnostics app-standby-read app-inactive-read app-links-read
connection-inspect connection-host-info connection-mdns connection-emulator-info input-displays display-read
users-list users-detail user-state ports-list logs-buffers diagnostic-battery-usage diagnostic-thermal
diagnostic-power-detail diagnostic-connectivity diagnostic-network-usage diagnostic-wifi diagnostic-bluetooth
diagnostic-storage-detail diagnostic-input diagnostic-window diagnostic-display-detail diagnostic-audio
diagnostic-sensors diagnostic-process-memory diagnostic-command-services diagnostic-command-help diagnostic-tool-help
diagnostic-services diagnostic-service diagnostic-properties diagnostic-crashes diagnostic-files jdwp-list
shizuku-status settings-read settings-history settings-compare advanced-capabilities`.split(/\s+/));
const network=new Set(['network-ping','network-tcp-check','network-dns-query','network-http-check']);
const capture=new Set(['screen-native-capture','screen-native-record','screen-ui-tree','trace','heap','logs-capture']);
const pcFiles=new Set(['folder-download','package-certificates','appdata-backup','connection-keygen']);
function executionLabel(action){
  if(reads.has(action.id))return '실행 시 조회';
  if(network.has(action.id))return '실행 시 통신 시험';
  if(capture.has(action.id))return '실행 시 화면·로그·자료 수집';
  if(pcFiles.has(action.id))return '실행 시 PC 파일 생성·분석';
  if(action.id==='connection-wait')return '실행 시 연결 상태 대기';
  if(action.id==='logs-capture-stop')return '실행 시 PC 수집 작업 중지';
  return '실행 시 변경·작업 요청';
}
const reviewed={};
for(const table of [FILE_APP_HELP,CONNECTION_LOG_HELP,DISPLAY_SETTING_HELP,DIAGNOSTIC_ADVANCED_HELP])for(const [id,help]of Object.entries(table)){
  if(reviewed[id])throw new Error('기능 안내가 중복됐습니다: '+id);
  reviewed[id]=help;
}
const known=new Set(WORKBENCH_ACTIONS.map(action=>action.id));
for(const id of Object.keys(reviewed))if(!known.has(id)||special.has(id))throw new Error('등록되지 않은 기능 안내입니다: '+id);
export const FEATURE_HELP=Object.freeze(Object.fromEntries(WORKBENCH_ACTIONS.map(action=>{
  const guide=reviewed[action.id];
  if(!guide&&!special.has(action.id))throw new Error('기능 안내가 없습니다: '+action.id);
  if(guide&&(!['usage','effect','interpretation'].every(key=>typeof guide[key]==='string'&&/[가-힣]/.test(guide[key]))||!Array.isArray(guide.requirements)||!guide.requirements.every(value=>typeof value==='string'&&/[가-힣]/.test(value))))throw new Error('기능 안내 형식이 다릅니다: '+action.id);
  return [action.id,Object.freeze({purpose:copy[action.id]?.[2]||action.description,...(guide||{usage:'사용자·프로필 전용 안내에서 대상과 사용 순서를 확인하세요.',effect:action.description,interpretation:'현재 화면 사용자와 실행·데이터 잠금 상태는 구분합니다.',requirements:[action.support||'기기 정책이 허용하는 사용자 관리 접근']}),renderer:special.has(action.id)?'user-profile':'feature',observationOnly:reads.has(action.id),executionLabel:executionLabel(action)})];
})));
export const withFeatureHelp=action=>({...action,help:FEATURE_HELP[action.id]});
