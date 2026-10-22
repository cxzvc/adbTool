import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSettingList, packageNames, createInventory } from '../lib/inventory.mjs';
test('all settings preserve namespace and equals signs, label known keys and mask sensitive values', () => {
  const entries = parseSettingList('screen_brightness=75\ncustom_key=a=b=c\nandroid_id=secret-id\nnoise without key\n', 'system');
  assert.equal(entries.length, 3); assert.equal(entries[0].title, '화면 밝기'); assert.equal(entries[0].editable, true);
  assert.equal(entries[1].value, 'a=b=c'); assert.equal(entries[1].editable, false);
  assert.equal(entries[2].value, '민감값 숨김'); assert.ok(!JSON.stringify(entries).includes('secret-id'));
});
test('package parser discards malformed lines and deduplicates', () => {
  assert.deepEqual(packageNames('package:com.example.app\npackage:android\npackage:com.example.app\npackage:bad;reboot\n'), ['com.example.app', 'android']);
});
test('app launch must match an installed package and an activity belonging to it', async () => {
  const calls = [];
  const inventory = createInventory({ resolve: async () => ({ serial: 'PHONE' }), command: async (serial, args) => {
    calls.push(args);
    if (args[1] === 'pm') return 'package:com.example.app';
    if (args[1] === 'cmd') return 'com.other/.Activity';
    return '';
  } });
  await assert.rejects(inventory.appAction({ deviceId:'id', action:'open', package:'bad;reboot' }), /확인/);
  await assert.rejects(inventory.appAction({ deviceId:'id', action:'open', package:'com.missing' }), /설치된/);
  await assert.rejects(inventory.appAction({ deviceId:'id', action:'open', package:'com.example.app' }), /실행 화면/);
  assert.ok(!calls.some(args => args[1] === 'am'));
});
test('failed namespace reads return partial inventory without pretending to be complete', async () => {
  const inventory = createInventory({ resolve: async () => ({ serial: 'PHONE' }), command: async (serial, args) => {
    if (args.at(-1) === 'secure') throw new Error('denied');
    return 'example=1';
  } });
  const result = await inventory.settings('id'); assert.equal(result.entries.length, 2); assert.deepEqual(result.errors, ['secure: denied']);
});
test('installed launcher activity is passed as a single quoted remote argument', async () => {
  const calls = [];
  const inventory = createInventory({ resolve: async () => ({ serial: 'PHONE' }), command: async (serial, args) => {
    calls.push(args); if (args[1] === 'pm') return 'package:com.example.app';
    if (args[1] === 'cmd') return 'com.example.app/.Main$Activity';
    return 'Starting: Intent';
  } });
  assert.equal((await inventory.appAction({ deviceId:'id', action:'open', package:'com.example.app' })).ok, true);
  assert.deepEqual(calls.at(-1), ['shell','am','start','--user','current','-n', "'com.example.app/.Main$Activity'"]);
});
