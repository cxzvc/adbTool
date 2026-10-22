import { ActionError } from './connections.mjs';

// Curated controls and raw settings share one in-process mutation boundary.
// It prevents our own endpoints racing; Android still has no atomic Settings CAS.
const owners = new Map();
export function acquireSettingsMutation(deviceId) {
  if (typeof deviceId !== 'string' || !deviceId || deviceId.length > 255) throw new ActionError('기기를 선택해 주세요.');
  if (owners.has(deviceId)) throw new ActionError('이 기기의 설정 변경이 진행 중입니다. 완료 후 다시 시도해 주세요.', 409);
  const owner = Symbol(deviceId); owners.set(deviceId, owner);
  return () => { if (owners.get(deviceId) === owner) owners.delete(deviceId); };
}
