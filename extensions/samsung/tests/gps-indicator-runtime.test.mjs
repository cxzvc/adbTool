import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdtemp,writeFile,readFile,rm,mkdir,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createGpsIndicatorRuntime} from '../../../lib/gps-indicator-runtime.mjs';

const execute=promisify(execFile),pkg='com.example.gps',expected={uid:10123,flags:769,granted:true,versionCode:'42',codePath:'/data/app/unique/com.example.gps/base.apk'};
const input=(extra={})=>({serial:'MOCK_ONLY',package:pkg,userId:'0',expected:{...expected},value:0,...extra});
const response=(value,exp=expected)=>({ok:true,uid:exp.uid,flags:(exp.flags&~256)|value,granted:exp.granted,versionCode:exp.versionCode,codePath:exp.codePath,peers:[pkg],beforeFlags:exp.flags,beforeGranted:exp.granted,attempted:(exp.flags&256)!==value,changed:(exp.flags&256)!==value,verified:true,mayHaveChanged:false});
async function fixture(options={}){
  const directory=await mkdtemp(path.join(os.tmpdir(),'gps-runtime-test-')),helperPath=path.join(directory,'helper.dex'),bytes=Buffer.alloc(112);bytes.write('dex\n035\0','latin1');await writeFile(helperPath,bytes);
  const digest=createHash('sha256').update(bytes).digest('hex'),calls=[];let remote;
  const runtime=createGpsIndicatorRuntime({helperPath:options.missing?path.join(directory,'missing.dex'):helperPath,command:async(serial,args,settings)=>{
    assert.equal(serial,'MOCK_ONLY');calls.push({args,settings});
    if(args[0]==='push'){remote=args[2];assert.match(remote,/^\/data\/local\/tmp\/adb-desk-gps-[a-f0-9]{32}\.dex$/);if(options.pushError)throw options.pushError;return 'pushed';}
    assert.equal(args[0],'shell');assert.equal(args.length,2);const shell=args[1];
    if(shell.startsWith("'sha256sum'"))return(options.hash||digest)+'  '+remote+'\n';
    if(shell.startsWith("'rm'")){assert.equal(shell,`'rm' '-f' '--' '${remote}'`);if(options.cleanupError)throw options.cleanupError;return '';}
    assert.match(shell,/^CLASSPATH='\/data\/local\/tmp\/adb-desk-gps-[a-f0-9]{32}\.dex' 'app_process' '\/' 'com\.adbdesk\.gps\.GpsIndicator' 'change'/);
    if(options.executeError)throw options.executeError;
    if(options.output!==undefined)return options.output;
    return 'ADB_DESK_GPS_RESULT='+JSON.stringify(options.result||response(options.value??0,options.expected||expected))+'\n';
  }});
  return{runtime,calls,helperPath,async close(){await rm(directory,{recursive:true,force:true});}};
}
const invoked=f=>f.calls.some(call=>call.args[1]?.startsWith('CLASSPATH='));
const cleaned=f=>f.calls.some(call=>call.args[1]?.startsWith("'rm' '-f' '--'"));

test('GPS runtime uploads only the fixed helper, verifies SHA-256, invokes fixed ABI and removes its exact unique file',async()=>{
  const f=await fixture();try{const result=await f.runtime.change(input());assert.equal(result.flags,513);assert.equal(result.granted,true);assert.equal(result.verified,true);assert.equal(result.beforeFlags,769);assert.equal(f.calls.length,4);assert.ok(cleaned(f));
    assert.match(f.calls[2].args[1],/'change' 'com\.example\.gps' '0' '10123' '769' 'true' '42' '\/data\/app\/unique\/com\.example\.gps\/base\.apk' '0'$/);
    assert.ok(!f.calls.some(call=>/chmod|revoke|grant|appops|settings\s|device_config/.test(call.args.join(' '))));
  }finally{await f.close();}
});
test('GPS runtime restoration preserves a subsequently revoked grant and every flag except256',async()=>{
  const exp={...expected,flags:513,granted:false},f=await fixture({expected:exp,value:256});try{
    const result=await f.runtime.change(input({expected:exp,value:256}));assert.equal(result.granted,false);assert.equal(result.flags,769);assert.equal(result.beforeGranted,false);assert.match(f.calls[2].args[1],/'513' 'false' '42'/);
  }finally{await f.close();}
});
test('GPS runtime accepts verified no-op without claiming a write',async()=>{
  const exp={...expected,flags:513},f=await fixture({expected:exp});try{const result=await f.runtime.change(input({expected:exp}));assert.equal(result.attempted,false);assert.equal(result.changed,false);assert.equal(result.verified,true);}finally{await f.close();}
});
test('GPS runtime rejects nonprimary profiles, arbitrary bit masks and incomplete identities before any phone command',async()=>{
  const f=await fixture();try{for(const extra of [{userId:'current'},{userId:10},{value:1},{value:512},{value:'0'},{serial:'bad\nserial'},{expected:null},{expected:{...expected,uid:1000}},{expected:{...expected,flags:-1}},{expected:{...expected,granted:'true'}},{expected:{...expected,versionCode:42}},{expected:{...expected,codePath:'/data/../app/x'}},{package:'com.example;reboot'}])await assert.rejects(f.runtime.change(input(extra)));assert.equal(f.calls.length,0);}finally{await f.close();}
});
test('GPS runtime refuses absent or corrupt PC helpers without phone commands',async()=>{
  for(const missing of [true,false]){const f=await fixture({missing});try{if(!missing)await writeFile(f.helperPath,'not a dex');await assert.rejects(f.runtime.change(input()),error=>error.code==='gps_helper_unavailable'&&error.mayHaveChanged===false);assert.equal(f.calls.length,0);}finally{await f.close();}}
});
test('GPS runtime hash mismatch and failed push cannot execute permission code and still clean only the owned file',async()=>{
  for(const options of [{hash:'0'.repeat(64)},{pushError:new Error('permission denied')}]){const f=await fixture(options);try{await assert.rejects(f.runtime.change(input()),error=>error.mayHaveChanged===false&&error.attempted===false);assert.equal(invoked(f),false);assert.ok(cleaned(f));}finally{await f.close();}}
});
test('GPS runtime permission refusal gives Korean access guidance without marking the bit as changed',async()=>{
  const result={ok:false,code:'gps_helper_permission_denied',message:'SecurityException: denied',attempted:true,changed:false,verified:false,mayHaveChanged:false,beforeFlags:769,beforeGranted:true},f=await fixture({result});
  try{await assert.rejects(f.runtime.change(input()),error=>error.code==='gps_helper_permission_denied'&&/[가-힣]/.test(error.message)&&error.mayHaveChanged===false&&error.beforeFlags===769);assert.ok(cleaned(f));}finally{await f.close();}
});
test('GPS runtime helper refusals preserve before snapshot and distinguish stale app from shared UID',async()=>{
  for(const code of ['gps_helper_stale','gps_helper_shared_uid','gps_helper_profile_unsupported']){const f=await fixture({result:{ok:false,code,message:'refused',attempted:false,changed:false,verified:false,mayHaveChanged:false,beforeFlags:769,beforeGranted:true}});try{await assert.rejects(f.runtime.change(input()),error=>error.code===code&&error.mayHaveChanged===false&&error.beforeFlags===769);assert.ok(cleaned(f));}finally{await f.close();}}
});
test('GPS runtime preserves uncertain post-write readback denial and describes it separately from a rejected setter',async()=>{
  const f=await fixture({result:{ok:false,code:'gps_helper_readback_denied',message:'SecurityException: readback denied',attempted:true,changed:false,verified:false,mayHaveChanged:true,beforeFlags:769,beforeGranted:true}});
  try{await assert.rejects(f.runtime.change(input()),error=>error.code==='gps_helper_readback_denied'&&error.mayHaveChanged===true&&error.attempted===true&&error.verified===false&&error.beforeFlags===769&&/저장 명령은 반환/.test(error.message));assert.ok(cleaned(f));}finally{await f.close();}
});
test('GPS runtime interrupted execution or malformed/duplicate response remains uncertain and keeps restoration evidence',async()=>{
  for(const options of [{executeError:new Error('offline')},{output:'unreadable'},{output:'ADB_DESK_GPS_RESULT={}\n'},{output:'ADB_DESK_GPS_RESULT={\n'},{output:'ADB_DESK_GPS_RESULT={}\nADB_DESK_GPS_RESULT={}\n'}]){const f=await fixture(options);try{await assert.rejects(f.runtime.change(input()),error=>error.attempted===true&&error.mayHaveChanged===true&&error.verified===false);assert.ok(cleaned(f));}finally{await f.close();}}
});
test('GPS runtime refuses success claiming a different grant, unrelated flags, UID peer, identity or stale before snapshot',async()=>{
  for(const changed of [{granted:false},{flags:512},{uid:10124},{versionCode:'43'},{codePath:'/data/app/other/base.apk'},{peers:[pkg,'com.other']},{beforeFlags:768},{beforeGranted:false},{verified:false},{changed:false},{attempted:false}]){const f=await fixture({result:{...response(0),...changed}});try{await assert.rejects(f.runtime.change(input()),error=>error.code==='gps_helper_verify_failed'&&error.mayHaveChanged===true);assert.ok(cleaned(f));}finally{await f.close();}}
});
test('GPS helper source has only the fixed fine-location masked update and no permission/AppOps mutation paths',async()=>{
  const source=await readFile(new URL('../tools/gps-indicator/GpsIndicator.java',import.meta.url),'utf8');assert.match(source,/private static final String FINE = "android.permission.ACCESS_FINE_LOCATION"/);assert.match(source,/private static final int MASK = 256/);assert.match(source,/pkg, FINE, MASK, target, true, DEVICE, user/);assert.match(source,/before\.granted != Boolean\.parseBoolean/);assert.match(source,/after\.granted != before\.granted/);assert.doesNotMatch(source,/grantRuntimePermission|revokeRuntimePermission|setMode|setUidMode|setAppOp|device_config|settings put/);
});

// JVM-only Android Binder doubles exercise helper decisions without adb, a phone,
// a pushed file, actual PermissionManager or any device permissions.
const javaHome=process.env.GPS_HELPER_JAVA_HOME||process.env.JAVA_HOME||'',suffix=process.platform==='win32'?'.exe':'';
const javac=path.join(javaHome,'bin','javac'+suffix),java=path.join(javaHome,'bin','java'+suffix);
let javaAvailable=true;try{await access(javac);await access(java);}catch{javaAvailable=false;}
test('GPS Java helper verifies fixed bit changes, stale snapshots, identity, UID peers, context and grant preservation with fake Android Binder', {skip:!javaAvailable},async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'gps-helper-jvm-')),classes=path.join(directory,'classes');
  const files={
    'fake/State.java':`package fake; public class State {public static int flags=Integer.getInteger("flags",769), writes=0; public static boolean granted=Boolean.parseBoolean(System.getProperty("granted","true")); public static String pkg="com.example.gps"; public static String after(String field,String fallback){return writes>0?System.getProperty("after."+field,fallback):fallback;} }`,
    'android/os/IBinder.java':'package android.os; public interface IBinder {}',
    'android/os/Process.java':'package android.os; public class Process {public static int myUid(){return Integer.getInteger("uid",2000);}}',
    'android/os/SELinux.java':'package android.os; public class SELinux {public static String getContext(){return System.getProperty("context","u:r:shell:s0");}}',
    'android/os/ServiceManager.java':'package android.os; public class ServiceManager {public static IBinder getService(String name){return new IBinder(){};}}',
    'android/app/ActivityManager.java':'package android.app; public class ActivityManager {public static int getCurrentUser(){return Integer.getInteger("currentUser",0);}}',
    'android/content/pm/ApplicationInfo.java':`package android.content.pm; public class ApplicationInfo {public int uid=10123; public String sourceDir=fake.State.after("path","/data/app/unique/com.example.gps/base.apk");}`,
    'android/content/pm/PackageInfo.java':`package android.content.pm; public class PackageInfo {public String[] requestedPermissions={"android.permission.ACCESS_FINE_LOCATION"}; public ApplicationInfo applicationInfo=new ApplicationInfo(); public long firstInstallTime=Long.parseLong(fake.State.after("firstInstall","1000")),lastUpdateTime=2000; public long getLongVersionCode(){return Long.parseLong(fake.State.after("version","42"));}}`,
    'android/content/pm/IPackageManager.java':`package android.content.pm; public interface IPackageManager {int checkPermission(String permission,String pkg,int user); int getPackageUid(String pkg,long flags,int user); String[] getPackagesForUid(int uid); PackageInfo getPackageInfo(String pkg,long flags,int user); public static class Stub {public static IPackageManager asInterface(android.os.IBinder binder){return new Impl();}} public static class Impl implements IPackageManager {public int checkPermission(String permission,String pkg,int user){if(permission.equals("android.permission.ACCESS_FINE_LOCATION"))return fake.State.granted?0:-1; return Boolean.getBoolean("noAccess")?-1:0;} public int getPackageUid(String pkg,long flags,int user){return 10123;} public String[] getPackagesForUid(int uid){return Boolean.getBoolean("shared")?new String[]{fake.State.pkg,"com.shared"}:new String[]{fake.State.pkg};} public PackageInfo getPackageInfo(String pkg,long flags,int user){return new PackageInfo();}} }`,
    'android/permission/IPermissionManager.java':`package android.permission; public interface IPermissionManager {int getPermissionFlags(String pkg,String permission,String device,int user); void updatePermissionFlags(String pkg,String permission,int mask,int values,boolean check,String device,int user); public static class Stub {public static IPermissionManager asInterface(android.os.IBinder binder){return new Impl();}} public static class Impl implements IPermissionManager {public int getPermissionFlags(String pkg,String permission,String device,int user){if(!permission.equals("android.permission.ACCESS_FINE_LOCATION")||!device.equals("default:0")||user!=0)throw new AssertionError("wrong read ABI");if(fake.State.writes>0&&Boolean.getBoolean("readbackDenied"))throw new SecurityException("readback denied after setter returned");return fake.State.flags;} public void updatePermissionFlags(String pkg,String permission,int mask,int values,boolean check,String device,int user){if(!permission.equals("android.permission.ACCESS_FINE_LOCATION")||!device.equals("default:0")||mask!=256||!check||user!=0||(values!=0&&values!=256))throw new AssertionError("wrong fixed update ABI");if(Boolean.getBoolean("denied"))throw new SecurityException("denied");fake.State.writes++;fake.State.flags=(fake.State.flags&~mask)|(values&mask);if(Boolean.getBoolean("changeGrant"))fake.State.granted=!fake.State.granted;if(Boolean.getBoolean("otherFlag"))fake.State.flags^=1;}} }`
  };
  try{
    const sources=[];for(const[name,content]of Object.entries(files)){const file=path.join(directory,name);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,content);sources.push(file);}await mkdir(classes);
    sources.push(fileURLToPath(new URL('../tools/gps-indicator/GpsIndicator.java',import.meta.url)));
    await execute(javac,['--release','8','-encoding','UTF-8','-d',classes,...sources],{windowsHide:true,timeout:30000});
    async function run(properties={},options={}){const exp={...expected,...options.expected};const args=['change',pkg,String(options.user??0),String(exp.uid),String(exp.flags),String(exp.granted),exp.versionCode,exp.codePath,String(options.value??0)];const{stdout}=await execute(java,[...Object.entries(properties).map(([key,value])=>'-D'+key+'='+value),'-cp',classes,'com.adbdesk.gps.GpsIndicator',...args],{windowsHide:true,timeout:15000});return JSON.parse(stdout.trim().split('ADB_DESK_GPS_RESULT=')[1]);}
    const hidden=await run();assert.equal(hidden.ok,true);assert.equal(hidden.flags,513);assert.equal(hidden.granted,true);assert.equal(hidden.beforeFlags,769);assert.equal(hidden.verified,true);
    const restored=await run({flags:513,granted:false},{expected:{flags:513,granted:false},value:256});assert.equal(restored.ok,true);assert.equal(restored.flags,769);assert.equal(restored.granted,false);
    const noop=await run({flags:513},{expected:{flags:513}});assert.equal(noop.ok,true);assert.equal(noop.attempted,false);assert.equal(noop.changed,false);
    for(const properties of [{uid:0},{context:'u:r:untrusted_app:s0'},{currentUser:10},{shared:true},{noAccess:true}]){const refused=await run(properties);assert.equal(refused.ok,false);assert.equal(refused.attempted,false);assert.equal(refused.mayHaveChanged,false);}
    for(const options of [{expected:{uid:10124}},{expected:{flags:768}},{expected:{granted:false}},{expected:{versionCode:'43'}},{expected:{codePath:'/data/app/other/base.apk'}}]){const stale=await run({},options);assert.equal(stale.code,'gps_helper_stale');assert.equal(stale.attempted,false);}
    const denied=await run({denied:true});assert.equal(denied.code,'gps_helper_permission_denied');assert.equal(denied.mayHaveChanged,false);
    const readbackDenied=await run({readbackDenied:true});assert.equal(readbackDenied.ok,false);assert.equal(readbackDenied.code,'gps_helper_readback_denied');assert.equal(readbackDenied.attempted,true);assert.equal(readbackDenied.mayHaveChanged,true);assert.equal(readbackDenied.verified,false);assert.equal(readbackDenied.beforeFlags,769);
    for(const properties of [{changeGrant:true},{otherFlag:true},{'after.version':'43'},{'after.path':'/data/app/reinstalled/base.apk'},{'after.firstInstall':'1001'}]){const changed=await run(properties);assert.equal(changed.ok,false);assert.equal(changed.attempted,true);assert.equal(changed.mayHaveChanged,true);assert.equal(changed.verified,false);}
  }finally{await rm(directory,{recursive:true,force:true});}
});
