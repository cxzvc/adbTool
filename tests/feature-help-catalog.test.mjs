import test from 'node:test';
import assert from 'node:assert/strict';
import {FEATURE_HELP,SPECIALIZED_USER_HELP_IDS,withFeatureHelp} from '../lib/feature-help-catalog.mjs';
import {WORKBENCH_ACTIONS} from '../lib/workbench-catalog.mjs';

test('every registered feature has reviewed Korean purpose, usage, impact, interpretation and support requirements',()=>{
  assert.deepEqual(Object.keys(FEATURE_HELP).sort(),WORKBENCH_ACTIONS.map(action=>action.id).sort());
  for(const action of WORKBENCH_ACTIONS){
    const help=withFeatureHelp(action).help;assert.equal(help,FEATURE_HELP[action.id]);
    for(const key of ['purpose','usage','effect','interpretation','executionLabel'])assert.match(help[key],/[가-힣]/,action.id+' '+key);
    assert.ok(help.requirements.length,action.id);assert.ok(help.requirements.every(value=>/[가-힣]/.test(value)),action.id);
    assert.equal(help.renderer,SPECIALIZED_USER_HELP_IDS.includes(action.id)?'user-profile':'feature');
  }
  assert.equal(SPECIALIZED_USER_HELP_IDS.length,9);assert.equal(Object.values(FEATURE_HELP).filter(value=>value.renderer==='feature').length,132);
});
test('write:false capture, collection, backup, waits and network tests never become harmless read labels',()=>{
  for(const id of ['screen-native-capture','screen-ui-tree','logs-capture','appdata-backup','folder-download','package-certificates','connection-wait','network-ping','network-dns-query','network-tcp-check','network-http-check']){
    assert.equal(FEATURE_HELP[id].observationOnly,false,id);assert.doesNotMatch(FEATURE_HELP[id].executionLabel,/실행 시 조회/,id);
  }
  for(const id of ['settings-read','app-permissions','display-read','users-list','diagnostic-thermal'])assert.equal(FEATURE_HELP[id].observationOnly,true,id);
});
test('backup, stored settings, root and shell descriptions retain actual scope and limitations',()=>{
  assert.match(FEATURE_HELP['appdata-backup'].effect+FEATURE_HELP['appdata-backup'].interpretation,/APK|암호화|Keystore|키/);
  assert.match(FEATURE_HELP['settings-put'].interpretation,/실제|효과/);
  assert.match(FEATURE_HELP['advanced-root'].effect+FEATURE_HELP['advanced-root'].interpretation,/루팅|Magisk|su|일반/);
  assert.match(FEATURE_HELP['shell-batch'].effect+FEATURE_HELP['shell-batch'].interpretation,/부분|앞서|자동|되돌/);
});
