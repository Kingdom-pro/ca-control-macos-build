const assert = require('node:assert/strict');
const { once } = require('node:events');
const net = require('node:net');
const test = require('node:test');
const { normalizeProfile, probeProxy, execute } = require('../app/proxy-profile.cjs');

test('normalizes a user-configured proxy and an optional IPv6 exit IP', () => {
  assert.deepEqual(normalizeProfile({ endpoint: 'socks5://Example.test:12323', expectedIp: '2001:0DB8:0::1' }), {
    endpoint: 'socks5h://example.test:12323', username: '', password: '', expectedIp: '2001:db8::1',
  });
  assert.equal(normalizeProfile({ endpoint: '[2001:db8::2]:3128' }).endpoint, 'http://[2001:db8::2]:3128');
  for (const endpoint of ['ftp://proxy.test', 'https://user:pass@proxy.test', 'proxy.test:0', 'proxy.test/path', 'proxy.test:70000']) {
    assert.throws(() => normalizeProfile({ endpoint }));
  }
  assert.throws(() => normalizeProfile({ endpoint: 'proxy.test', username: 'with:colon' }));
  assert.throws(() => normalizeProfile({ endpoint: 'proxy.test', username: 'login', password: 'one\ntwo' }));
});

test('reuses a saved password only for the same proxy and account', () => {
  const saved = normalizeProfile({ endpoint: 'proxy.test:8080', username: 'owner', password: 'fixture-secret' });
  assert.equal(normalizeProfile({ endpoint: 'proxy.test:8080', username: 'owner' }, saved).password, saved.password);
  assert.equal(normalizeProfile({ endpoint: 'other.test:8080', username: 'owner' }, saved).password, '');
  assert.equal(normalizeProfile({ endpoint: 'proxy.test:8080', username: 'other' }, saved).password, '');
});

test('returns the discovered exit and rejects a mismatched or invalid address', async () => {
  const input = { endpoint: 'https://proxy.test:8443', username: 'fixture', password: 'test-"\\-secret' };
  const profile = normalizeProfile(input);
  const validateCall = async (_file, args, config) => {
    assert.equal(args[0], '--disable');
    assert.equal(args[args.indexOf('--noproxy') + 1], '');
    assert.equal(args[args.indexOf('--config') + 1], '-');
    assert.ok(!args.join(' ').includes(input.password));
    assert.ok(config.includes(`proxy-user = ${JSON.stringify(`${input.username}:${input.password}`)}`));
    assert.ok(config.includes(`proxy = ${JSON.stringify(profile.endpoint)}`));
    return { code: 0, stdout: '{"ip":"203.0.113.27"}\n200 200' };
  };
  assert.equal(await probeProxy(profile, validateCall), '203.0.113.27');
  await assert.rejects(probeProxy({ ...profile, expectedIp: '203.0.113.1' }, validateCall), /Ожидался/);
  await assert.rejects(probeProxy(profile, async () => ({ code: 0, stdout: '{"ip":"invalid"}\n200 200' })), /некорректный|корректный/);
});

test('curl sends CONNECT to the configured proxy despite NO_PROXY and reports 407', async () => {
  let received = '';
  const server = net.createServer(socket => {
    socket.once('data', bytes => {
      received = bytes.toString('utf8');
      socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const saved = process.env.NO_PROXY;
  process.env.NO_PROXY = '*';
  try {
    const profile = normalizeProfile({ endpoint: `127.0.0.1:${server.address().port}` });
    const curl = process.platform === 'win32' ? `${process.env.SystemRoot}\\System32\\curl.exe` : '/usr/bin/curl';
    await assert.rejects(probeProxy(profile, execute, curl), /407/);
    assert.match(received, /^CONNECT api64\.ipify\.org:443 HTTP\/1\.[01]/);
  } finally {
    if (saved === undefined) delete process.env.NO_PROXY;
    else process.env.NO_PROXY = saved;
    await new Promise(resolve => server.close(resolve));
  }
});
