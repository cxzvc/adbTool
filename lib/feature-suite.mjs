import {createFirmwareCompare} from './firmware-compare.mjs';
import {createApkTrackers} from './apk-trackers.mjs';
import {createFolderSync} from './folder-sync.mjs';
import {createTraceAnalysis} from './trace-analysis.mjs';
import {createPcapTools} from './pcap-tools.mjs';
export function createFeatureSuite(core){
 const firmware=createFirmwareCompare(core),trackers=createApkTrackers(core),sync=createFolderSync(core),trace=createTraceAnalysis(core),pcap=createPcapTools(core);
 const post={'firmware-capture':firmware.capture,'firmware-compare':firmware.compare,'firmware-import':firmware.import,'apk-trackers':trackers.start,'sync-preview':sync.preview,'sync-execute':sync.execute,'trace-analyze':trace.analyze,'pcap-analyze':pcap.analyze,'pcap-start':pcap.start,'pcap-control':pcap.control};
 const get={'firmware-list':p=>firmware.list(p.get('deviceId')),'firmware-snapshot':p=>firmware.get(p.get('deviceId'),p.get('id')),'firmware-result':p=>firmware.result(p.get('deviceId'),p.get('id')),'apk-trackers-result':p=>trackers.result(p.get('deviceId'),p.get('id')),'tracker-definitions':()=>trackers.definitions(),'sync-result':p=>sync.result(p.get('deviceId'),p.get('id')),'trace-capabilities':()=>trace.capabilities(),'trace-inputs':p=>trace.inputs(p.get('deviceId')),'trace-result':p=>trace.result(p.get('deviceId'),p.get('id')),'pcap-result':p=>pcap.result(p.get('deviceId'),p.get('id')),'pcap-capability':p=>pcap.capability(p.get('deviceId')),'pcap-list':p=>pcap.list(p.get('deviceId')),'pcap-status':p=>pcap.status(p.get('deviceId'),p.get('id'))};
 return{post,get,content:sync.content,close:pcap.close};
}
