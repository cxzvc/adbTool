export function createAccess(config = {}) {
  const allowedHosts = port => [`127.0.0.1:${port}`, `localhost:${port}`, ...(config.enabled ? (config.addresses || []).map(ip => `${ip}:${port}`) : [])];
  return { allowedHosts, authorized: () => true };
}
