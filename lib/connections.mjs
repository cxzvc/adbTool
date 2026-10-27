import { execFile } from 'node:child_process';
import { isIP } from 'node:net';
import { serviceTransports,serviceEndpointTransports } from './adb.mjs';
import {beginAdbConnectionLog} from './adb-connection-log.mjs';

export class ActionError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export function validEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length > 160) return false;
  const match = endpoint.match(/^(?:\[([^\]]+)\]|([^:]+)):(\d{1,5})$/);
  if (!match || match[0] !== endpoint || Number(match[3]) < 1 || Number(match[3]) > 65535) return false;
  const host = match[1] || match[2];
  if (match[1]) {
    const [ip, zone, ...extra] = host.split('%');
    return isIP(ip) === 6 && !extra.length && (zone === undefined || /^[a-zA-Z0-9_.-]+$/.test(zone));
  }
  return isIP(host) === 4;
}

function validTransport(serial) {
  return validEndpoint(serial) || (typeof serial === 'string' && serial.length <= 255 && /^[A-Za-z0-9][A-Za-z0-9_.-]*\._adb(?:-tls-connect)?\._tcp\.?$/.test(serial));
}

function failureDescription(action, rawError) {
  if (action === 'disconnect') return { code: 'disconnect-unconfirmed', message: '선택한 기기의 연결 해제를 모두 확인하지 못했습니다. 현재 연결 상태를 다시 조회해 남은 연결을 확인하세요.' };
  if (action === 'pair') return { code: 'pairing-unconfirmed', message: '페어링 완료를 확인하지 못했습니다. 현재 응답만으로 코드 만료·인증 거부·통신 문제 중 원인을 확정할 수 없습니다.' };
  if (/SSLV3_ALERT_CERTIFICATE_UNKNOWN|TLSV1_ALERT_UNKNOWN_CA|certificate[_ ]unknown|unknown[_ ]ca/i.test(rawError)) return { code: 'tls-certificate-rejected', message: '연결 상대가 이 PC의 ADB 인증서를 인정하지 않아 TLS 인증이 중단됐습니다. 기존 PC 인증키를 유지하고 ‘기존 키로 다시 페어링’으로 등록을 갱신하세요. 기존 등록 삭제나 PC 키 초기화는 우선 필요하지 않습니다. OS 업데이트 등 인증서 거부의 원인은 이 응답만으로 확정할 수 없습니다.' };
  if (/failed to authenticate|authentication failed|unauthorized/i.test(rawError)) return { code: 'authentication-rejected', message: '기기가 ADB 인증 요청을 받아들이지 않았습니다. 인증 정보와 페어링 상태는 별도 확인이 필요하며, 이 오류만으로 처음 연결하는 기기라고 판단할 수 없습니다.' };
  if (/connection refused|actively refused|대상 컴퓨터에서 연결을 거부/i.test(rawError)) return { code: 'connection-refused', message: '해당 주소에서 ADB 연결 요청을 거부했습니다. 현재 검색 주소와 연결 포트를 확인하세요.' };
  if (/timed?\s*out|timeout|no route to host|network is unreachable|응답 시간이 초과/i.test(rawError)) return { code: 'connection-unreachable', message: '제한 시간 안에 해당 주소와 ADB 연결을 확인하지 못했습니다. 현재 검색 주소와 네트워크 상태를 확인하세요.' };
  return { code: 'connection-unconfirmed', message: '무선 서비스는 검색됐지만 ADB 연결이 확인되지 않았습니다. 현재 응답만으로 포트 변경·연결 거부·인증 문제 중 원인을 확정할 수 없습니다.' };
}

export function createCommandRunner(adbPath,{execute=execFile,beginLog=beginAdbConnectionLog}={}) {
  const run = (args, input = '', timeout = 15000) => new Promise((resolve, reject) => {
    const child = execute(adbPath, args, { windowsHide: true, timeout, maxBuffer: 65536, encoding: 'utf8' }, (error, stdout, stderr) => {
      let output = `${stdout || ''}\n${stderr || ''}`.replace('Enter pairing code:', '').trim();
      if (input.trim()) output = output.replaceAll(input.trim(), '[코드 숨김]');
      if (error) return reject(new ActionError(error.killed ? 'ADB 응답 시간이 초과되었습니다. 상태를 새로고침한 뒤 다시 확인하세요.' : output.slice(0, 400) || 'ADB 명령을 실행할 수 없습니다.', 502));
      resolve(output);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
  return async(args,input='',context={})=>{
    const observation=args[0]==='connect'?await beginLog(run).catch(()=>null):null;
    let output='',failure;
    try{output=await run(args,input);}catch(error){failure=error;}
    const diagnostic=await observation?.finish({endpoint:args[1],serviceAlias:context.serviceAlias}).catch(()=>null);
    if(diagnostic&&(failure||!/^(?:already )?connected to\s/im.test(output))){
      const note='PC ADB log (same connection attempt): '+diagnostic.marker;
      if(failure)failure.message+='\n'+note;else output+='\n'+note;
    }
    if(failure)throw failure;return output;
  };
}

export function createConnectionController({ readDevices, run }) {
  let busy = false;
  return async function act(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ActionError('잘못된 요청입니다.');
    const { action, serviceId, endpoint, code } = body;
    if (!['connect', 'disconnect', 'pair'].includes(action)) throw new ActionError('올바른 기기와 작업을 선택해 주세요.');
    const hasServiceId = Object.hasOwn(body, 'serviceId'), hasEndpoint = Object.hasOwn(body, 'endpoint');
    if (action !== 'pair' && hasEndpoint) throw new ActionError('주소 직접 입력은 페어링에서만 사용할 수 있습니다. 연결·연결 해제는 검색된 기기를 선택해 주세요.');
    if (hasServiceId === hasEndpoint) throw new ActionError(action === 'pair' ? '검색된 페어링 서비스 또는 직접 입력한 페어링 주소 중 하나만 선택해 주세요.' : '연결·연결 해제할 검색 기기를 선택해 주세요.');
    if (hasServiceId && (typeof serviceId !== 'string' || serviceId.length !== 24 || !/^[a-f0-9]{24}$/.test(serviceId))) throw new ActionError('올바른 기기와 작업을 선택해 주세요.');
    if (hasEndpoint && !validEndpoint(endpoint)) throw new ActionError('기기에 표시된 페어링 IP 주소와 포트를 IP:포트 형식으로 입력해 주세요.');
    if (action === 'pair' && (typeof code !== 'string' || code.length !== 6 || !/^\d{6}$/.test(code))) throw new ActionError('기기에 표시된 숫자 6자리 페어링 코드를 입력해 주세요.');
    if (busy) throw new ActionError('다른 연결 작업이 진행 중입니다. 잠시 후 다시 시도해 주세요.', 409);
    busy = true;
    try {
      let before, service;
      if (hasEndpoint) {
        // A pairing address is explicitly supplied by the user. mDNS discovery is
        // optional here: failure to browse services must not block this request.
        service = { id: null, name: '직접 입력한 페어링 대상', serviceType: '_adb-tls-pairing._tcp', endpoint, pairing: true };
      } else {
        try { before = await readDevices({ force: true }); } catch { throw new ActionError('최신 기기 목록을 확인할 수 없습니다. 새로고침한 뒤 다시 시도해 주세요.', 503); }
        service = before.services.find(item => item.id === serviceId);
        if (!service) throw new ActionError('이 무선 서비스가 더 이상 검색되지 않습니다. 새로고침한 뒤 다시 선택해 주세요.', 409);
      }
      if (!validEndpoint(service.endpoint)) throw new ActionError('이 서비스의 연결 주소를 사용할 수 없습니다.');
      if ((action === 'pair') !== service.pairing) throw new ActionError(service.pairing ? '페어링 서비스입니다. 코드를 입력해 먼저 페어링해 주세요.' : '연결 서비스입니다. 페어링 서비스를 선택해 주세요.');
      let commandError = '', affectedCount = 0;
      try {
        if (action === 'disconnect') {
          const targets = [...new Set(serviceTransports(before.devices, service).map(t => t.serial))];
          // Never issue bare `adb disconnect`, which disconnects every network device.
          if (targets.some(target => !validTransport(target))) throw new ActionError('선택한 기기의 연결 식별자를 확인할 수 없습니다.');
          const results = await Promise.allSettled(targets.map(async target => {
            const out = await run(['disconnect', target]);
            if (!/^disconnected(?:\s|$)/im.test(out)) throw new ActionError(out || '연결 해제를 확인할 수 없습니다.', 502);
          }));
          affectedCount = results.filter(result => result.status === 'fulfilled').length;
          const failed = results.filter(result => result.status === 'rejected');
          if (failed.length) commandError = `${targets.length}개 중 ${failed.length}개의 연결을 해제하지 못했습니다. ${failed[0].reason.message}`;
        } else {
          const out = await run([action, service.endpoint], action === 'pair' ? `${code}\n` : '', {serviceAlias:`${service.name}.${service.serviceType}`});
          const confirmed = action === 'pair' ? /(?:^|\n)Successfully paired to\s/i.test(out.replace('Enter pairing code:', '').trim()) : /^(?:already )?connected to\s/im.test(out);
          if (!confirmed) throw new ActionError(out || 'ADB가 작업 완료를 확인하지 못했습니다.', 502);
          affectedCount = 1;
        }
      } catch (error) { commandError = error.message; }
      let snapshot = null, warning = '';
      try { snapshot = await readDevices({ force: true }); } catch { warning = '작업 후 상태를 조회하지 못했습니다. 새로고침해서 현재 상태를 확인하세요.'; }
      // A service name can survive a port change. An online alias only proves the
      // requested address when the refreshed advertisement still has that address.
      const sameAdvertisement = snapshot?.services?.some(item => item.id === service.id && item.endpoint === service.endpoint);
      const remaining = !snapshot ? [] : action === 'connect'
        ? serviceEndpointTransports(snapshot.devices, service, { allowAlias: sameAdvertisement === true })
        : serviceTransports(snapshot.devices, service);
      if (snapshot && !commandError && action === 'connect' && !remaining.some(t => t.state === 'device')) warning = '연결 명령을 보냈지만 아직 온라인 상태가 아닙니다. 기기의 디버깅 승인과 페어링 상태를 확인하세요.';
      if (snapshot && !commandError && action === 'disconnect' && remaining.length) warning = '무선 연결이 아직 남아 있거나 다시 연결되었습니다. ADB 자동 연결 또는 다른 프로그램의 재연결을 확인하세요.';
      const failure = commandError ? failureDescription(action, commandError) : null;
      const message = failure?.message || (action === 'pair' ? '페어링이 완료되었습니다. 기기 목록에서 ADB 온라인 상태를 확인하세요.' : action === 'connect' ? remaining.some(t => t.state === 'device') ? 'ADB 연결이 완료되었습니다.' : 'ADB 연결 명령을 처리했습니다.' : affectedCount ? `무선 ADB 연결 ${affectedCount}개의 해제 명령을 처리했습니다.` : '이미 연결이 해제된 기기입니다.');
      const redact = value => typeof code === 'string' && code ? String(value).replaceAll(code, '[코드 숨김]') : String(value);
      const result = { ok: !commandError, message: redact(message), ...(failure ? { code: failure.code, rawError: redact(commandError) } : {}), warning, snapshot,
        target: { action, serviceId: service.id, name: service.name, serviceType: service.serviceType, endpoint: service.endpoint, pairing: service.pairing } };
      // Do not return a pairing code even if a service name or refreshed diagnostic
      // happens to echo it. The code is sent only on stdin, never in process args.
      const redactResult = value => typeof value === 'string' ? redact(value) : Array.isArray(value) ? value.map(redactResult)
        : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactResult(item)])) : value;
      return action === 'pair' ? redactResult(result) : result;
    } finally { busy = false; }
  };
}
