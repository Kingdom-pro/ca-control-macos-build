const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { ProfileError, execute, normalizeProfile, probeProxy } = require('./proxy-profile.cjs');

const page = path.join(__dirname, 'index.html');
const pageUrl = pathToFileURL(page).href;
const service = path.join(app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', 'build'), 'ca-local-services');
let window;
let profile = null;
let lastIp = '';
let uplink = 'unknown';
let busy = false;
let storageError = '';
let journal = [];

function status() {
  const settings = profile ? { endpoint: profile.endpoint, username: profile.username, expectedIp: profile.expectedIp } : null;
  return { settings, lastIp, uplink, storageError, journal };
}

async function loadSettings() {
  const result = await execute(service, ['read']);
  try {
    if (result.code !== 0) throw new Error('keychain');
    const saved = JSON.parse(result.stdout);
    if (saved !== null) profile = normalizeProfile(saved);
  } catch {
    storageError = 'Связка ключей недоступна. Проверьте разрешения CA Control.';
  }
}

function record(message) {
  journal = [...journal.slice(-99), `${new Date().toLocaleTimeString('ru-RU')} ${message}`];
}

function trusted(event) {
  return event.sender === window?.webContents && event.senderFrame?.url === pageUrl;
}

ipcMain.handle('ca-mac:status', async (event) => {
  if (!trusted(event)) return null;
  const result = await execute(service, ['uplink'], '', 4000);
  const kind = result.stdout.trim();
  uplink = result.code === 0 && ['wifi', 'ethernet', 'other'].includes(kind) ? kind : 'unknown';
  return status();
});

ipcMain.handle('ca-mac:check', async (event, input) => {
  if (!trusted(event) || busy) return { ok: false, message: 'Проверка уже выполняется.' };
  busy = true;
  try {
    if (!input && !profile) throw new ProfileError('Добавьте прокси в параметрах.');
    const candidate = input ? normalizeProfile(input, profile) : profile;
    const ip = await probeProxy(candidate);
    if (input) {
      const result = await execute(service, ['save'], JSON.stringify(candidate));
      if (result.code !== 0) throw new ProfileError('Связка ключей не сохранила профиль.');
      profile = candidate;
      storageError = '';
    }
    lastIp = ip;
    const message = input ? `Профиль сохранён. Выход через прокси ${ip}.` : `Выход через прокси ${ip}.`;
    record(message);
    return { ok: true, message, state: status() };
  } catch (error) {
    if (!input) lastIp = '';
    const message = error instanceof ProfileError ? error.message : 'Не удалось проверить профиль.';
    record(message);
    return { ok: false, message, state: status() };
  } finally {
    busy = false;
  }
});

function createWindow() {
  window = new BrowserWindow({
    width: 1000, height: 740, minWidth: 580, minHeight: 580, show: false,
    backgroundColor: '#050506', title: 'CA Control', titleBarStyle: 'hidden',
    trafficLightPosition: { x: 18, y: 14 },
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.on('closed', () => { window = null; });
  window.loadFile(page).then(() => window?.show());
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window?.isMinimized()) window.restore(); window?.focus(); });
  app.whenReady().then(async () => { await loadSettings(); createWindow(); });
  app.on('window-all-closed', () => app.quit());
}
