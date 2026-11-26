const { normalizeProfile } = require('../app/proxy-profile.cjs');

function buildTransportConfig(input, port) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new RangeError('Invalid loopback port');
  const profile = normalizeProfile(input);
  const endpoint = new URL(profile.endpoint);
  const address = endpoint.hostname.replace(/^\[|\]$/g, '');
  const defaultPort = endpoint.protocol === 'https:' ? 443 : 80;
  const server = { address, port: endpoint.port ? Number(endpoint.port) : defaultPort };
  if (profile.username) server.users = [{ user: profile.username, pass: profile.password }];

  const proxy = {
    tag: 'configured-proxy',
    protocol: endpoint.protocol === 'socks5h:' ? 'socks' : 'http',
    settings: { servers: [server] },
  };
  if (endpoint.protocol === 'https:') {
    proxy.streamSettings = { security: 'tls', tlsSettings: { serverName: address, allowInsecure: false } };
  }
  return {
    log: { loglevel: 'none' },
    inbounds: [{ listen: '127.0.0.1', port, protocol: 'socks', settings: { udp: false } }],
    outbounds: [proxy],
  };
}

module.exports = { buildTransportConfig };
