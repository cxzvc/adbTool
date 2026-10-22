import test from 'node:test';
import assert from 'node:assert/strict';
import {WORKBENCH_ACTIONS} from '../lib/workbench-catalog.mjs';
import {WORKBENCH_ACCESS,WORKBENCH_ACCESS_KINDS,withWorkbenchAccess} from '../lib/workbench-access.mjs';
import {createWorkbench} from '../lib/workbench.mjs';

const access=id=>WORKBENCH_ACTIONS.find(action=>action.id===id).access;
test('all catalog actions have an explicitly reviewed Korean access contract without stale IDs',()=>{
  assert.equal(WORKBENCH_ACTIONS.length,141);
  assert.deepEqual(Object.keys(WORKBENCH_ACCESS).sort(),WORKBENCH_ACTIONS.map(action=>action.id).sort());
  for(const action of WORKBENCH_ACTIONS){
    assert.ok(WORKBENCH_ACCESS_KINDS.includes(action.access.kind),action.id);
    assert.match(action.access.label,/[가-힣]/,action.id);assert.ok(action.access.label.length<=20,action.id);
    assert.match(action.access.description,/[가-힣]/,action.id);
    assert.ok(action.access.description.length>20,action.id);
  }
  assert.throws(()=>withWorkbenchAccess({id:'not-reviewed'}),/권한 분류/);
});
test('root requirements stay separate from requesting debug adbd and returning to ordinary adbd',()=>{
  assert.deepEqual(WORKBENCH_ACTIONS.filter(action=>action.access.kind==='root-required').map(action=>action.id).sort(),['advanced-disable-verity','advanced-enable-verity','advanced-remount']);
  assert.equal(access('advanced-root').kind,'debug-build');assert.match(access('advanced-root').description,/루팅 도구가 아니며/);
  assert.equal(access('advanced-unroot').kind,'adb');assert.match(access('advanced-unroot').description,/일반 adbd/);
  assert.equal(access('sideload').kind,'recovery');assert.match(access('sideload').description,/root 권한은 필수 조건이 아닙니다/);
});
test('app data changes access explanation with the selected existing method without pretending all apps support run-as',()=>{
  for(const id of ['appdata-check','appdata-backup','appdata-restore']){
    const definition=WORKBENCH_ACTIONS.find(action=>action.id===id),meta=definition.access;
    assert.equal(meta.kind,'root-optional');assert.equal(meta.field,'method');
    assert.deepEqual(Object.keys(meta.variants).sort(),definition.fields.find(field=>field.name==='method').options.map(option=>option.value).sort());
    assert.equal(meta.variants.root.kind,'root-required');assert.match(meta.variants.root.description,/UID가 0/);assert.match(meta.variants.root.description,/자동 root 요청은 하지 않습니다/);
    assert.equal(meta.variants['run-as'].kind,'privileged');assert.match(meta.variants['run-as'].description,/debuggable/);
    assert.ok(Object.isFrozen(meta.variants));
  }
});
test('ordinary ADB inspection, runtime permission changes and settings are never advertised as root-only',()=>{
  const ordinary=['diagnostic-battery-usage','diagnostic-thermal','diagnostic-network-usage','diagnostic-services','diagnostic-service','diagnostic-properties','diagnostic-crashes','diagnostic-tool-help','users-detail','permission-grant','permission-revoke','appops-set','settings-put','settings-delete','settings-import','trace','jdwp-list','jdwp-forward','shizuku-start','shizuku-stop','shizuku-restart','connection-keygen','connection-host-info'];
  for(const id of ordinary)assert.equal(access(id).kind,'adb',id);
  assert.equal(access('diagnostic-files').kind,'root-optional');
  for(const id of ['heap','file-chmod','logs-buffers','logs-clear','logs-resize','logs-capture','ports-socket-add'])assert.equal(access(id).kind,'privileged',id);
  assert.match(access('heap').description,/debuggable 앱/);assert.match(access('ports-socket-add').description,/TCP 터널은 일반 ADB/);
  assert.match(access('logs-capture').description,/일반 로그 버퍼는 ADB/);
});
test('catalog exposes access metadata without probing, changing or even resolving any phone',()=>{
  const unexpected=()=>assert.fail('metadata must not call a device or start a job');
  const wb=createWorkbench({root:'unused',jobs:new Map(),resolve:unexpected,run:unexpected,shell:unexpected,startJob:unexpected},{readDevices:unexpected,fileTools:{},captures:{},processes:{}});
  const catalog=wb.catalog();
  assert.equal(catalog.actions.length,141);
  assert.equal(catalog.actions.find(action=>action.id==='appdata-backup').access.variants.root.kind,'root-required');
});
test('known read permission contracts do not classify a normal ADB diagnostic as root or require app usage settings',()=>{
  for(const id of ['diagnostic-thermal','diagnostic-power-detail','diagnostic-storage-detail','diagnostic-input','diagnostic-window','diagnostic-display-detail','diagnostic-battery-usage','diagnostic-process-memory','diagnostic-crashes']){
    const meta=access(id);assert.equal(meta.kind,'adb',id);assert.deepEqual(meta.requiredPermissions,['android.permission.DUMP'],id);assert.match(meta.permissionDescription,/루트 필수라는 뜻은 아닙니다/);assert.ok(Object.isFrozen(meta.requiredPermissions));
  }
  assert.match(access('diagnostic-crashes').permissionDescription,/UID 2000.*예외/);
  assert.equal(access('diagnostic-service').field,'service');assert.equal(access('diagnostic-service').variants.power.permissionLabel,'DUMP 진단 권한');assert.equal(access('diagnostic-service').variants['vendor.unknown'],undefined);
  assert.equal(access('diagnostic-wifi').requiredPermissions,undefined);assert.equal(access('diagnostic-properties').requiredPermissions,undefined);
});
