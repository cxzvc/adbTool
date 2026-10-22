import path from 'node:path';
import {readdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url)),coreOnly=process.argv.includes('--core-only');
const files=[];
async function collect(directory){
 let entries;try{entries=await readdir(directory,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return;throw error;}
 for(const entry of entries){if(entry.isSymbolicLink())continue;const file=path.join(directory,entry.name);if(entry.isDirectory())await collect(file);else if(entry.isFile()&&entry.name.endsWith('.test.mjs'))files.push(file);}
}
await collect(path.join(root,'tests'));
if(!coreOnly){let installed=[];try{installed=await readdir(path.join(root,'extensions'),{withFileTypes:true});}catch(error){if(error.code!=='ENOENT')throw error;}for(const entry of installed)if(entry.isDirectory()&&!entry.isSymbolicLink())await collect(path.join(root,'extensions',entry.name,'tests'));}
if(!files.length)throw new Error('실행할 공개 테스트가 없습니다.');
const child=spawn(process.execPath,['--import',pathToFileURL(path.join(root,'tests/setup-extensions.mjs')).href,'--test','--test-reporter=spec',...files.sort()],{cwd:root,env:{...process.env,...(coreOnly?{ADB_DESK_TEST_CORE_ONLY:'1'}:{})},windowsHide:true,stdio:'inherit'});
child.once('error',error=>{console.error(error.message);process.exitCode=1;});
child.once('exit',(code,signal)=>{process.exitCode=signal?1:code??1;});
