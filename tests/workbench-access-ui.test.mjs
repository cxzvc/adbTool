import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {WORKBENCH_ACTIONS} from '../lib/workbench-catalog.mjs';
const window={};vm.runInNewContext(await readFile(new URL('../public/workbench-access.js',import.meta.url),'utf8'),{window});
const action=id=>WORKBENCH_ACTIONS.find(item=>item.id===id);
test('root requirements are visible while ordinary ADB actions remain unbadged',()=>{
  assert.match(window.WorkbenchAccess.badge(action('advanced-remount')),/root-required/);
  assert.match(window.WorkbenchAccess.badge(action('advanced-root')),/debug-build/);
  assert.equal(window.WorkbenchAccess.badge(action('permission-grant')),'');
  assert.equal(window.WorkbenchAccess.badge(action('diagnostic-wifi')),'');
  assert.match(window.WorkbenchAccess.badge(action('diagnostic-files')),/root-optional/);
});
test('app data requirement follows the selected run-as or root method without claiming a rooted device',()=>{
  const item=action('appdata-backup');
  assert.equal(window.WorkbenchAccess.metadata(item).kind,'root-optional');
  assert.equal(window.WorkbenchAccess.metadata(item,{method:'root'}).kind,'root-required');
  assert.equal(window.WorkbenchAccess.metadata(item,{method:'run-as'}).kind,'privileged');
  assert.match(window.WorkbenchAccess.note(item,{method:'root'}),/UID.*0/);
});
test('requirement text is escaped and unknown classifications cannot inject attributes',()=>{
  const item={access:{kind:'root-required',label:'<script>x</script>',description:'" onmouseover="x'}};
  const html=window.WorkbenchAccess.badge(item);assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);assert.match(html,/&quot;/);
  assert.equal(window.WorkbenchAccess.badge({access:{kind:'" onclick="bad'}}),'');
});
test('verified diagnostic permissions display beside normal ADB buttons without a root warning',()=>{
  for(const id of ['diagnostic-thermal','diagnostic-power-detail','diagnostic-storage-detail','diagnostic-input','diagnostic-window','diagnostic-display-detail','diagnostic-battery-usage','diagnostic-process-memory','diagnostic-crashes']){
    const item=action(id),access=window.WorkbenchAccess.metadata(item),badge=window.WorkbenchAccess.badge(item);
    assert.equal(access.kind,'adb',id);assert.equal(access.permissionLabel,'DUMP 진단 권한',id);assert.match(badge,/data-access-kind="permission"/,id);assert.match(badge,/android.permission.DUMP/,id);assert.doesNotMatch(badge,/data-access-kind="root-/,id);assert.match(window.WorkbenchAccess.note(item),/일반 ADB shell에 이미 허용/);
  }
  assert.match(window.WorkbenchAccess.note(action('diagnostic-crashes')),/UID 2000.*예외/);
  assert.equal(window.WorkbenchAccess.badge(action('diagnostic-properties')),'');
});
test('service permission badges follow only a verified chosen service and preserve escaping',()=>{
  const item=action('diagnostic-service');
  assert.equal(window.WorkbenchAccess.badge(item),'');assert.equal(window.WorkbenchAccess.badge(item,{service:'vendor.unknown'}),'');
  assert.match(window.WorkbenchAccess.badge(item,{service:'power'}),/DUMP 진단 권한/);
  assert.match(window.WorkbenchAccess.note(item,{service:'meminfo'}),/UID 2000.*예외/);
  const escaped=window.WorkbenchAccess.badge({access:{kind:'adb',permissionLabel:'<b>권한</b>',permissionDescription:'" onclick="unsafe'}});
  assert.doesNotMatch(escaped,/<b>/);assert.match(escaped,/&lt;b&gt;/);assert.match(escaped,/&quot;/);
});
