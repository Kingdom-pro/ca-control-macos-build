const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const http = require('node:http');
const net = require('node:net');
const test = require('node:test');
const { setTimeout: delay } = require('node:timers/promises');
const { execute } = require('../app/proxy-profile.cjs');
const { buildTransportConfig } = require('../lab/xray-transport.cjs');

const xray = process.env.CA_TEST_XRAY;

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

function close(server) {
  return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

async function ready(port, child) {
  for (let i = 0; i < 50 && child.exitCode === null; i++) {
    const socket = net.createConnection({ host: '127.0.0.1', port, timeout: 100 });
    try {
      const connected = await Promise.race([once(socket, 'connect'), once(socket, 'timeout').then(() => false)]);
      if (connected) return;
    } catch { /* retry until the listener is ready */ }
    finally { socket.destroy(); }
    await delay(40);
  }
  throw new Error('Xray loopback listener did not start');
}

test('builds one outbound, with SOCKS5 or verified TLS as required', () => {
  const config = buildTransportConfig({ endpoint: 'https://[2001:db8::12]:8443', username: 'user', password: 'test' }, 10815);
  assert.equal(config.inbounds[0].listen, '127.0.0.1');
  assert.equal(config.inbounds[0].settings.udp, false);
  assert.equal(config.outbounds.length, 1);
  assert.equal(config.outbounds[0].settings.servers[0].address, '2001:db8::12');
  assert.equal(config.outbounds[0].streamSettings.tlsSettings.allowInsecure, false);
  const socks = buildTransportConfig({ endpoint: 'socks5://proxy.test:1080' }, 10815);
  assert.equal(socks.outbounds[0].protocol, 'socks');
  assert.equal(buildTransportConfig({ endpoint: 'proxy.test' }, 10815).outbounds[0].settings.servers[0].port, 80);
  assert.equal(buildTransportConfig({ endpoint: 'https://proxy.test' }, 10815).outbounds[0].settings.servers[0].port, 443);
  assert.throws(() => buildTransportConfig({ endpoint: 'http://proxy.test' }, 80), RangeError);
});

test('runs local Xray and stops on upstream failure without sending traffic directly', { skip: !xray }, async () => {
  let direct = 0;
  let proxied = 0;
  let rejectAuth = false;
  let target;
  const sockets = new Set();
  const trap = http.createServer((_request, response) => { direct++; response.end('direct'); });
  const upstream = http.createServer();
  upstream.on('connect', (request, socket, head) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    if (request.url !== target || request.headers['proxy-authorization'] !== 'Basic dGVzdDpmaXh0dXJl' || rejectAuth) {
      socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    proxied++;
    const reply = () => socket.end('HTTP/1.1 200 OK\r\nContent-Length: 7\r\nConnection: close\r\n\r\nproxied');
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head.length) reply();
    else socket.once('data', reply);
  });

  const reserve = net.createServer();
  const port = await listen(reserve);
  await close(reserve);
  target = `127.0.0.1:${await listen(trap)}`;
  const proxyPort = await listen(upstream);
  const config = JSON.stringify(buildTransportConfig({ endpoint: `127.0.0.1:${proxyPort}`, username: 'test', password: 'fixture' }, port));
  let child;
  let done;
  try {
    for (const candidate of [config, ...['https', 'socks5'].map(scheme =>
      JSON.stringify(buildTransportConfig({ endpoint: `${scheme}://127.0.0.1:${proxyPort}` }, port)))]) {
      assert.equal((await execute(xray, ['run', '-test', '-c', 'stdin:'], candidate)).code, 0);
    }
    child = spawn(xray, ['run', '-c', 'stdin:'], { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true });
    done = new Promise(resolve => child.once('close', resolve));
    await once(child, 'spawn');
    child.stdin.on('error', () => {});
    child.stdin.end(config);
    await ready(port, child);

    const curl = process.platform === 'win32' ? `${process.env.SystemRoot}\\System32\\curl.exe` : '/usr/bin/curl';
    const request = () => execute(curl, ['--disable', '--silent', '--fail', '--max-time', '4', '--noproxy', '',
      '--socks5-hostname', `127.0.0.1:${port}`, `http://${target}/`]);
    const success = await request();
    assert.equal(success.code, 0);
    assert.equal(success.stdout, 'proxied');
    assert.equal(proxied, 1);

    rejectAuth = true;
    assert.notEqual((await request()).code, 0);
    for (const socket of sockets) socket.destroy();
    await close(upstream);
    assert.notEqual((await request()).code, 0);
    assert.equal(direct, 0);
  } finally {
    if (child && child.exitCode === null) child.kill();
    if (done) await done;
    for (const socket of sockets) socket.destroy();
    if (upstream.listening) await close(upstream);
    if (trap.listening) await close(trap);
  }
});
