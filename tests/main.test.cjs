const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const appDirectory = path.resolve(__dirname, '..', 'app');
const mainFile = path.join(appDirectory, 'main.cjs');
const realProfile = require('../app/proxy-profile.cjs');

test('validates a profile before writing Keychain and keeps passwords out of renderer status', async () => {
  const handlers = new Map();
  const events = [];
  const sender = {};
  let permitted = false;
  const context = vm.createContext({
    __dirname: appDirectory,
    process,
    require(name) {
      if (name === 'electron') {
        return { app: { requestSingleInstanceLock: () => false, quit() {} }, ipcMain: { handle: (key, handler) => handlers.set(key, handler) } };
      }
      if (name !== './proxy-profile.cjs') return require(name);
      return {
        ...realProfile,
        probeProxy: async () => {
          events.push('probe');
          if (!permitted) throw new realProfile.ProfileError('HTTP 407');
          return '203.0.113.25';
        },
        execute: async (_file, [action], json) => {
          events.push(action);
          assert.equal(action, 'save');
          assert.equal(JSON.parse(json).password, 'fixture-password');
          return { code: 0 };
        },
      };
    },
    sender,
  });
  vm.runInContext(fs.readFileSync(mainFile, 'utf8'), context);
  const url = vm.runInContext('window = { webContents: sender }; pageUrl', context);
  const check = handlers.get('ca-mac:check');
  const document = { sender, senderFrame: { url } };
  const draft = { endpoint: 'proxy.test:3128', username: 'fixture-user', password: 'fixture-password' };
  assert.equal((await check({ ...document, sender: {} }, draft)).ok, false);
  assert.deepEqual(events, []);
  assert.equal((await check(document, draft)).ok, false);
  assert.deepEqual(events, ['probe']);
  permitted = true;
  const success = await check(document, draft);
  assert.equal(success.ok, true);
  assert.equal(success.state.lastIp, '203.0.113.25');
  assert.equal(success.state.settings.endpoint, 'http://proxy.test:3128');
  assert.equal(Object.hasOwn(success.state.settings, 'password'), false);
  assert.ok(!JSON.stringify(success).includes(draft.password));
  assert.deepEqual(events, ['probe', 'probe', 'save']);
});
