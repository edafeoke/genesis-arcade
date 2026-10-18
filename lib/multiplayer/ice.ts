export function iceServers(): RTCIceServer[] {
  const configured = process.env.NEXT_PUBLIC_RTC_ICE_SERVERS;
  if (!configured) return [{ urls: 'stun:stun.l.google.com:19302' }];
  const servers = JSON.parse(configured) as RTCIceServer[];
  if (!Array.isArray(servers) || servers.length > 8 || servers.some(server => !server || !(typeof server.urls === 'string' || Array.isArray(server.urls)) || (typeof server.urls === 'string' ? [server.urls] : server.urls).some(url => typeof url !== 'string' || !/^(stun|stuns|turn|turns):/.test(url)))) throw new Error('Invalid ICE server configuration.');
  return servers;
}
