import test from 'node:test';
import assert from 'node:assert/strict';
import { VideoParser, encodeControl } from '../lib/mirror.mjs';
test('scrcpy 5 session metadata and fragmented frames survive arbitrary TCP boundaries', () => {
  const session = Buffer.alloc(12); session[0] = 0x80; session.writeUInt32BE(596, 4); session.writeUInt32BE(1280, 8);
  const frame = Buffer.alloc(16); frame[0] = 0x20; frame.writeUInt32BE(4, 8); Buffer.from([0, 0, 1, 0x65]).copy(frame, 12);
  const received = [], parser = new VideoParser(value => received.push(value));
  for (const byte of Buffer.concat([Buffer.from('h264'), session, frame, session, frame])) parser.push(Buffer.from([byte]));
  assert.deepEqual(received[0], { type: 'dimensions', width: 596, height: 1280 });
  assert.deepEqual(received[1], frame); assert.equal(received.length, 4);
});
test('oversized packet lengths and invalid video dimensions are rejected', () => {
  const parser = new VideoParser(() => {}), oversized = Buffer.alloc(12); oversized.writeUInt32BE(100000000, 8);
  assert.throws(() => parser.push(Buffer.concat([Buffer.from('h264'), oversized])), /너무 큽니다/);
});
test('touch messages use video coordinates, press/release pressure, and fixed pointer identity', () => {
  const size = { width: 596, height: 1280 };
  const message = encodeControl({ type: 'touch', action: 0, x: 100, y: 400, ...size }, size);
  assert.equal(message.length, 32); assert.equal(message[0], 2); assert.equal(message.readUInt32BE(10), 100); assert.equal(message.readUInt16BE(20), 1280); assert.equal(message.readUInt16BE(22), 65535);
  assert.equal(encodeControl({ type: 'touch', action: 1, x: 100, y: 400, ...size }, size).readUInt16BE(22), 0);
  assert.throws(() => encodeControl({ type: 'touch', action: 0, x: 9999, y: 0, ...size }, size));
  assert.throws(() => encodeControl({ type: 'touch', action: 0, x: 0, y: 0, width: 1280, height: 596 }, size));
});
test('only known control actions and bounded Unicode paste are encoded', () => {
  const key = encodeControl({ type: 'key', keycode: 3 }, {}); assert.equal(key.length, 28); assert.equal(key[15], 1);
  const paste = encodeControl({ type: 'paste', text: '안녕하세요' }, {}); assert.equal(paste.subarray(14).toString(), '안녕하세요'); assert.equal(paste[9], 1);
  assert.throws(() => encodeControl({ type: 'key', keycode: 999 }, {}));
  assert.throws(() => encodeControl({ type: 'paste', text: '가'.repeat(3000) }, {}));
  assert.throws(() => encodeControl({ type: 'shell', command: 'reboot' }, {}));
});
