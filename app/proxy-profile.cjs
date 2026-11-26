const { execFile } = require('node:child_process');
const { isIP } = require('node:net');

const protocols = { 'http:': 80, 'https:': 443, 'socks5:': 1080, 'socks5h:': 1080 };
const addressCheck = 'https://api64.ipify.org?format=json';

class ProfileError extends Error {}

function normalizeIp(value) {
  const address = typeof value === 'string' ? value.trim() : '';
  if (address.includes('%')) return '';
  if (isIP(address) === 4) return address;
  if (isIP(address) === 6) return new URL(`http://[${address}]`).hostname.slice(1, -1);
  return '';
}

function normalizeProfile(input, saved) {
  const endpoint = typeof input?.endpoint === 'string' ? input.endpoint.trim() : '';
  if (!endpoint || endpoint.length > 320 || /[\s\\]/.test(endpoint)) {
    throw new ProfileError('Введите адрес прокси и порт.');
  }
  let proxy;
  try { proxy = new URL(endpoint.includes('://') ? endpoint : `http://${endpoint}`); }
  catch { throw new ProfileError('Проверьте адрес и порт прокси.'); }
  if (!Object.hasOwn(protocols, proxy.protocol) || !proxy.hostname || proxy.search || proxy.hash ||
      (proxy.pathname && proxy.pathname !== '/')) {
    throw new ProfileError('Укажите адрес HTTP, HTTPS или SOCKS5 без пути и параметров.');
  }
  if (proxy.username || proxy.password) throw new ProfileError('Введите логин и пароль в отдельных полях.');
  if (proxy.port === '0') throw new ProfileError('Проверьте порт прокси.');

  const scheme = proxy.protocol === 'socks5:' ? 'socks5h:' : proxy.protocol;
  const normalized = `${scheme}//${proxy.hostname.toLowerCase()}:${proxy.port || protocols[proxy.protocol]}`;
  const login = typeof input.username === 'string' ? input.username : '';
  let password = typeof input.password === 'string' ? input.password : '';
  if (!password && saved?.endpoint === normalized && saved.username === login) password = saved.password;
  if (login.length > 255 || password.length > 1024 || /[:\x00-\x1f\x7f]/.test(login) ||
      /[\x00-\x1f\x7f]/.test(password) || (password && !login)) {
    throw new ProfileError('Проверьте логин и пароль прокси.');
  }
  const requestedIp = typeof input.expectedIp === 'string' ? input.expectedIp.trim() : '';
  const expectedIp = normalizeIp(requestedIp);
  if (requestedIp && !expectedIp) throw new ProfileError('Введите корректный ожидаемый IPv4 или IPv6.');
  return { endpoint: normalized, username: login, password, expectedIp };
}

function execute(file, args, input = '', timeout = 15000) {
  return new Promise(resolve => {
    const child = execFile(file, args, { encoding: 'utf8', timeout, maxBuffer: 16384, windowsHide: true },
      (error, stdout) => resolve({ code: error?.code ?? (error ? 1 : 0), stdout }));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

async function probeProxy(profile, run = execute, curl = '/usr/bin/curl') {
  const config = [`proxy = ${JSON.stringify(profile.endpoint)}`];
  if (profile.username) config.push(`proxy-user = ${JSON.stringify(`${profile.username}:${profile.password}`)}`);
  const args = ['--disable', '--config', '-', '--noproxy', '', '--proto', '=https', '--silent', '--fail',
    '--connect-timeout', '6', '--max-time', '12', '--max-filesize', '4096',
    '--write-out', '\n%{http_connect} %{http_code}', addressCheck];
  const { code, stdout } = await run(curl, args, `${config.join('\n')}\n`);
  const lastBreak = stdout.lastIndexOf('\n');
  const [connectCode, httpCode] = stdout.slice(lastBreak + 1).trim().split(' ');
  if (connectCode === '407' || httpCode === '407') throw new ProfileError('Прокси отклонил авторизацию (HTTP 407).');
  if (code === 60 || code === 35) throw new ProfileError('Не удалось подтвердить TLS-соединение при проверке прокси.');
  if (code !== 0 || httpCode !== '200') throw new ProfileError('Проверка через прокси не удалась. Проверьте адрес, порт и доступ.');
  let ip;
  try { ip = normalizeIp(JSON.parse(stdout.slice(0, lastBreak)).ip); } catch { /* checked below */ }
  if (!ip) throw new ProfileError('Проверка не вернула корректный выходной IP.');
  if (profile.expectedIp && ip !== profile.expectedIp) {
    throw new ProfileError(`Прокси вернул ${ip}. Ожидался ${profile.expectedIp}.`);
  }
  return ip;
}

module.exports = { ProfileError, execute, normalizeProfile, probeProxy };
