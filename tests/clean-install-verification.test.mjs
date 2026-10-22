import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {entryAssets,isolatedEnvironment} from '../tools/verify-clean-install.mjs';
import {storagePaths} from '../lib/local-paths.mjs';

test('clean verification removes inherited configuration and keeps different fixture roots isolated',()=>{
  const root=path.resolve('test-fixture'),other=path.resolve('other-test-fixture');
  const env=isolatedEnvironment(root,{ADB_DESK_HOME:'/private',adb_desk_config:'/private/config.json',ADB_DESK_EXTENSIONS:'samsung',PORT:'4444',npm_config_registry:'https://private.invalid',KEEP_FIXTURE:'yes'});
  assert.equal(env.KEEP_FIXTURE,'yes');assert.equal(env.ADB_DESK_DISABLE_ADB,'1');assert.equal(env.ADB_DESK_HOME,undefined);assert.equal(env.adb_desk_config,undefined);assert.equal(env.ADB_DESK_EXTENSIONS,undefined);assert.equal(env.PORT,undefined);
  assert.equal(env.npm_config_registry,'https://registry.npmjs.org/');
  assert.equal(storagePaths(root,{env}).localRoot,path.join(root,'.local'));
  assert.equal(storagePaths(other,{env}).localRoot,path.join(other,'.local'));
});

test('fresh-install verification rejects empty HTML and an error page even when HTTP status is successful',()=>{
  for(const body of ['', '<html><body>Loading</body></html>', '<!doctype html><title>ADB Desk</title><body>Unavailable</body>'])assert.throws(()=>entryAssets(body),/필수 화면 파일/);
});

test('fresh-install verification requires the real common bootstrap links and accepts the published entry page',async()=>{
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const files=entryAssets(html);assert.ok(files.some(url=>url.startsWith('/extensions-ui.js')));
  assert.throws(()=>entryAssets(html.replace(/src="\/app\.js[^"]*"/g,'')),/필수 화면 파일/);
  assert.ok(files.every(url=>!url.startsWith('/extensions/samsung/')));
});
