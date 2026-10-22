import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { quote } from './operations-core.mjs';
const execute = promisify(execFile);
export function parseMirrorCapabilities(output) {
  const encoders = [], displays = [], cameras = []; let camera = null, highSpeed = false;
  for (const line of String(output).split(/\r?\n/)) {
    let match;
    if ((match = /--(video|audio)-codec=(\S+)\s+--(?:video|audio)-encoder=(\S+)/.exec(line))) { encoders.push({ kind: match[1], codec: match[2], name: match[3], hardware: /\(hw\)/.test(line), description: line.trim() }); }
    else if ((match = /--display-id=(\d+)\s+\(([^)]+)\)/.exec(line))) displays.push({ id: Number(match[1]), description: match[2] });
    else if ((match = /--camera-id=(\S+)\s+\((.*)\)/.exec(line))) { camera = { id: match[1], facing: /^(front|back|external)/.exec(match[2])?.[1] || 'unknown', description: match[2], sizes: [] }; cameras.push(camera); highSpeed = false; }
    else if (camera && /High speed capture/.test(line)) highSpeed = true;
    else if (camera && (match = /^\s*-\s*(\d+x\d+)(.*)/.exec(line))) camera.sizes.push({ size: match[1], highSpeed, fps: [...match[2].matchAll(/\d+/g)].map(v => Number(v[0])) });
  }
  return { encoders: encoders.slice(0, 512), displays: displays.slice(0, 64), cameras: cameras.slice(0, 64), raw: String(output).slice(0, 262144) };
}
export function createMirrorCapabilities({ adbPath, root, resolve, run }) {
  const command = run || (async (serial, args) => execute(adbPath, ['-s', serial, ...args], { windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024, encoding: 'utf8' }));
  const busy = new Set();
  async function read(deviceId, kind = 'all') {
    if (!['all', 'encoders', 'displays', 'cameras'].includes(kind)) throw new Error('지원 목록 종류를 선택하세요.');
    if (busy.has(deviceId)) throw new Error('이 기기의 지원 목록을 조회하고 있습니다.'); busy.add(deviceId);
    let serial, remote;
    try {
      ({ serial } = await resolve(deviceId)); remote = `/data/local/tmp/adb-desk-capabilities-${randomUUID()}.jar`;
      await command(serial, ['push', path.join(root, 'vendor', 'scrcpy-server-v5.0.1'), remote]);
      const flags = kind === 'all' ? ['list_encoders=true', 'list_displays=true', 'list_camera_sizes=true'] : [({ encoders:'list_encoders=true', displays:'list_displays=true', cameras:'list_camera_sizes=true' })[kind]];
      const args = ['app_process', '/', 'com.genymobile.scrcpy.Server', '5.0.1', 'log_level=info', 'cleanup=true', ...flags];
      const result = await command(serial, ['shell', `CLASSPATH=${quote(remote)} ${args.map(quote).join(' ')}`]), output = typeof result === 'string' ? result : `${result.stdout || ''}\n${result.stderr || ''}`;
      if (!/List of (?:video|audio) encoders|List of displays|List of cameras/.test(output)) throw new Error(output.trim().slice(-1000) || '기기 지원 목록을 받지 못했습니다.');
      return { deviceId, kind, ...parseMirrorCapabilities(output) };
    } finally { if (remote && serial) await command(serial, ['shell', `rm -f ${quote(remote)}`]).catch(() => {}); busy.delete(deviceId); }
  }
  return { read };
}
