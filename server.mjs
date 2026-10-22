import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { findAdb, createAdbReader } from './lib/adb.mjs';
import { createConnectionController, createCommandRunner } from './lib/connections.mjs';
import { createAppServer } from './lib/http-app.mjs';
import { createDeviceControl } from './lib/device-control.mjs';
import {loadConfiguration} from './lib/configuration.mjs';
import {configureExtensions} from './lib/extensions.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const version=JSON.parse(await readFile(path.join(root,'package.json'),'utf8')).version;
const configuration=await loadConfiguration(root),{config,paths}=configuration;
await configureExtensions({root,enabled:config.extensions,localRoot:paths.localRoot});
const port=config.port;
let adbPath = '', adbError = '', readDevices, act, deviceControl;
if(process.env.ADB_DESK_DISABLE_ADB==='1'){
  adbError='테스트 설정으로 ADB 실행이 비활성화되어 있습니다.';
  readDevices=async()=>({devices:[],services:[],updatedAt:new Date().toISOString()});
}else try {
  adbPath = await findAdb(config);
  readDevices = createAdbReader(adbPath);
  act = createConnectionController({ readDevices, run: createCommandRunner(adbPath) });
  deviceControl = createDeviceControl({ adbPath, readDevices,root });
} catch (e) { adbError = e.message; }
const server = createAppServer({ root, readDevices, act, adbError, deviceControl, adbPath, lan: config.lan, version,configuration });
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? `포트 ${port}를 이미 사용 중입니다. 실행 중인 ADB Desk를 열거나 .local/config.json의 port를 변경해 주세요.` : error.message);
  process.exitCode = 1;
});
server.listen(port, config.lan?.enabled ? '0.0.0.0' : '127.0.0.1', () => {
  console.log(`ADB Desk: http://127.0.0.1:${port}`);
  console.log(adbPath ? `ADB: ${adbPath}` : adbError);
});
