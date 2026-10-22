import {fileURLToPath} from 'node:url';
import {loadConfiguration} from '../lib/configuration.mjs';
try{
  const {config,paths}=await loadConfiguration(fileURLToPath(new URL('../',import.meta.url)));
  console.log(JSON.stringify({port:config.port,lanEnabled:config.lan.enabled,localRoot:paths.localRoot}));
}catch(error){console.error(error.message);process.exitCode=1;}
