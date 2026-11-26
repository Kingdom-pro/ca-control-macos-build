'use strict';

const element = id => document.getElementById(id);
const tabs = [...document.querySelectorAll('[data-view]')];
const fields = ['endpoint', 'username', 'password', 'expected'];
const uplinkLabels = { wifi: 'Wi-Fi', ethernet: 'Ethernet', other: 'Другая сеть' };
let state = {};
let initialized = false;
let busy = false;

function show(view) {
  for (const tab of tabs) {
    const selected = tab.dataset.view === view;
    if (selected) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
    element(tab.dataset.view).hidden = !selected;
  }
}

function notice(message) {
  element('notice').textContent = message;
  element('notice').hidden = !message;
}

function paint(next) {
  if (next) state = next;
  const profile = state.settings;
  if (!initialized && next) {
    element('endpoint').value = profile?.endpoint ?? '';
    element('username').value = profile?.username ?? '';
    element('expected').value = profile?.expectedIp ?? '';
    initialized = true;
  }
  element('profile-status').textContent = profile ? 'Профиль сохранён' : 'Настройка прокси';
  element('profile-detail').textContent = profile ? 'Проверка отправляет один запрос через сохранённый прокси.' : 'Добавьте прокси для проверки подключения.';
  element('exit-ip').textContent = state.lastIp || '—';
  element('uplink').textContent = uplinkLabels[state.uplink] || 'Тип сети не определён';
  element('proxy-address').textContent = profile?.endpoint ?? '—';
  element('expected-ip').textContent = profile?.expectedIp || 'Любой подтверждённый IP';
  element('log').textContent = state.journal?.join('\n') || 'Записей пока нет';
  element('storage-note').textContent = state.storageError || (profile
    ? 'Оставьте пароль пустым, чтобы сохранить прежний для этого прокси и логина.'
    : 'Пароль хранится в Связке ключей macOS.');
  element('check-profile').textContent = profile ? 'Проверить прокси' : 'Настроить прокси';
  element('save-profile').textContent = busy ? 'Проверяем…' : 'Проверить и сохранить';
  for (const id of [...fields, 'save-profile', 'check-profile']) element(id).disabled = busy;
}

async function check(input) {
  if (busy) return;
  busy = true;
  paint();
  notice('Проверяем выход через прокси…');
  try {
    const result = await window.caMac.check(input);
    if (result.ok && input) element('password').value = '';
    notice(result.message);
    paint(result.state);
  } catch {
    notice('Приложение не завершило проверку.');
  } finally {
    busy = false;
    paint();
  }
}

for (const tab of tabs) tab.addEventListener('click', () => show(tab.dataset.view));
element('check-profile').addEventListener('click', () => {
  if (state.settings) check();
  else { show('settings'); element('endpoint').focus(); }
});
element('proxy-form').addEventListener('submit', event => {
  event.preventDefault();
  check({ endpoint: element('endpoint').value, username: element('username').value,
    password: element('password').value, expectedIp: element('expected').value });
});

async function refresh() {
  try { paint(await window.caMac.status()); }
  catch { if (!initialized) notice('Не удалось прочитать состояние CA Control.'); }
  finally { setTimeout(refresh, 8000); }
}
refresh();
