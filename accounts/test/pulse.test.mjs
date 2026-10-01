// Телеметрия лендинга: разбор пачек от brand/sr-pulse.js, приём по HTTP и сводка.
//
//   npm run test:accounts
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { openStore } from '../store.mjs';
import { createApp } from '../app.mjs';
import { openPulse, parseBatch, device, summaryText } from '../pulse.mjs';

const PASS = 'верный-пароль-1';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';
const IPAD_AS_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';

const batch = (ev, extra = {}) => ({ v: 1, id: 'a1b2c3d4e5f60718', path: '/', ev, ...extra });

test('устройство и браузер по строке браузера', () => {
  assert.deepEqual(device(IPHONE), { platform: 'iPhone', os: 'iOS 18.6', browser: 'Safari' });
  assert.deepEqual(device(IPHONE.replace('Safari/604.1', 'Instagram 350.0')), { platform: 'iPhone', os: 'iOS 18.6', browser: 'Instagram' });
  assert.equal(device(IPAD_AS_MAC, true).platform, 'iPad', 'iPad притворяется Mac — выдаёт сенсорный экран');
  assert.equal(device(IPAD_AS_MAC, false).platform, 'компьютер');
  assert.deepEqual(device(ANDROID), { platform: 'Android', os: 'Android 14', browser: 'Chrome' });
});

test('разбор пачки: лишнее отбрасывается, длины обрезаются', () => {
  assert.equal(parseBatch(null), null);
  assert.equal(parseBatch(batch([{ k: 'view', load: 900 }], { id: 'не номер' })), null);
  assert.equal(parseBatch(batch([{ k: 'view' }], { path: 'https://evil' })), null);
  assert.equal(parseBatch(batch([{ k: 'hack' }])), null, 'неизвестные события — пусто');
  const b = parseBatch(batch([
    { k: 'error', t: 12.4, msg: 'x'.repeat(1000), src: '/app.js', line: 5, col: 2, evil: '<script>' },
    { k: 'step', name: 'telegram', info: 'copy-ok' },
    { k: 'step', name: 'чужое' },
    { k: 'view', load: 1e12 },
  ], { env: { vw: 390, touch: true, standalone: 'yes', storage: 'blocked', extra: 1 } }));
  assert.equal(b.events.length, 3, 'шаг не из списка отброшен');
  assert.equal(b.events[0].data.msg.length, 300);
  assert.equal(b.events[0].t, 12);
  assert.equal('evil' in b.events[0].data, false);
  assert.equal(b.events[2].data.load, 600000, 'время ограничено 10 минутами');
  assert.deepEqual(b.env, { vw: 390, vh: null, dpr: null, touch: true, standalone: false, storage: 'blocked' });
});

test('сводка: визиты, ушедшие до загрузки, ошибки по устройствам', () => {
  const store = openStore(':memory:');
  const pulse = openPulse(store.db);
  const visit = (id, ev, ua, env = {}) => pulse.add(parseBatch({ v: 1, id, path: '/', ev, env }), ua);
  visit('0000000000000001', [{ k: 'view', load: 1000 }], IPHONE, { storage: 'blocked' });
  visit('0000000000000002', [{ k: 'view', load: 3000 }, { k: 'error', msg: 'boom', src: 'https://belayarod.ru/app.js', line: 7 }], IPHONE);
  visit('0000000000000003', [{ k: 'left', state: 'interactive' }], IPHONE);
  visit('0000000000000004', [{ k: 'view', load: 800 }, { k: 'step', name: 'drum', info: 'running session' }], ANDROID);
  assert.equal(visit('0000000000000005', [{ k: 'view', load: 1 }], 'Googlebot/2.1'), 0, 'роботы не пишутся');
  const s = pulse.summary(7);
  const iphone = s.platforms.find(p => p.platform === 'iPhone');
  assert.deepEqual([iphone.visits, iphone.loaded, iphone.leftEarly, iphone.noStorage], [3, 2, 1, 1]);
  assert.equal(iphone.medianMs, 3000);
  assert.deepEqual(s.ios, [{ key: 'iOS 18.6 · Safari', count: 3 }]);
  assert.equal(s.errors[0].key, 'boom');
  assert.equal(s.errors[0].where, '/app.js:7');
  assert.deepEqual(s.errors[0].platforms, ['iPhone 18.6 Safari']);
  assert.equal(s.steps[0].key, 'drum: running session');
  assert.match(summaryText(s), /iPhone: 3 · 2 · 1/);
});

test('старые записи удаляются через 30 дней', () => {
  let clock = new Date('2026-10-01T09:00:00Z');
  const store = openStore(':memory:');
  const pulse = openPulse(store.db, { now: () => clock });
  pulse.add(parseBatch(batch([{ k: 'view', load: 1 }])), IPHONE);
  clock = new Date('2026-11-05T09:00:00Z');
  pulse.cleanup();
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM pulse').get().n, 0);
});

async function server() {
  const store = openStore(':memory:');
  const handle = createApp({ store, env: { PUBLIC_ORIGIN: 'https://belayarod.ru' } });
  const srv = createServer(handle);
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const send = (body, headers = {}) => fetch(base + '/account/pulse', {
    method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'text/plain', Origin: 'https://belayarod.ru', 'User-Agent': IPHONE, ...headers },
  });
  return { store, base, send, close: () => new Promise(r => srv.close(r)) };
}

test('приём: только со своего сайта, без X-SR, ответ пустой', async (t) => {
  const s = await server(); t.after(s.close);
  const ok = await s.send(batch([{ k: 'view', load: 1200 }]));
  assert.equal(ok.status, 204);
  assert.equal(await ok.text(), '');
  assert.equal((await s.send(batch([{ k: 'view' }]), { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await s.send(batch([{ k: 'view' }]), { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await s.send('не json')).status, 400);
  assert.equal((await s.send('x'.repeat(20000))).status, 400, 'больше 16 КБ');
  assert.equal((await fetch(s.base + '/account/pulse')).status, 405);
  assert.equal(s.store.db.prepare('SELECT count(*) AS n FROM pulse').get().n, 1);
});

test('приём: не больше 300 событий с одного адреса за 10 минут', async (t) => {
  const s = await server(); t.after(s.close);
  const many = batch(Array.from({ length: 40 }, () => ({ k: 'step', name: 'dialog' })));
  for (let i = 0; i < 8; i++) assert.equal((await s.send(many)).status, 204);
  assert.equal((await s.send(many)).status, 429);
});

test('сводка в админке — только администратору', async (t) => {
  const s = await server(); t.after(s.close);
  await s.send(batch([{ k: 'view', load: 900 }]));
  assert.equal((await fetch(s.base + '/account/api/admin/pulse')).status, 401);
  const admin = s.store.createUser({ email: 'kate@b.ru', name: 'Екатерина', role: 'admin' });
  s.store.setPassword(admin.id, PASS);
  const student = s.store.createUser({ email: 'a@b.ru', name: 'А' });
  s.store.setPassword(student.id, PASS);
  const login = async (email) => (await fetch(s.base + '/account/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-SR': '1', Origin: 'https://belayarod.ru' },
    body: JSON.stringify({ email, password: PASS }),
  })).headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(s.base + '/account/api/admin/pulse', { headers: { Cookie: await login('a@b.ru') } })).status, 403);
  const r = await fetch(s.base + '/account/api/admin/pulse?days=30', { headers: { Cookie: await login('kate@b.ru') } });
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.equal(data.days, 30);
  assert.equal(data.platforms[0].platform, 'iPhone');
});

test('курсы на поддоменах: принимаются и помечаются, чужие домены — нет', async (t) => {
  const s = await server(); t.after(s.close);
  assert.equal((await s.send(batch([{ k: 'view', load: 800 }]), { Origin: 'https://taro.belayarod.ru', 'Sec-Fetch-Site': 'same-site' })).status, 204);
  assert.equal((await s.send(batch([{ k: 'view' }]), { Origin: 'https://belayarod.ru.evil.example' })).status, 403);
  assert.equal((await s.send(batch([{ k: 'view' }]), { Origin: 'https://evil-belayarod.ru' })).status, 403);
  assert.equal((await s.send(batch([{ k: 'view' }]), { Origin: 'http://taro.belayarod.ru' })).status, 403, 'только https, как у сайта');
  const row = s.store.db.prepare('SELECT path FROM pulse').get();
  assert.equal(row.path, 'taro.belayarod.ru/');
  const pulse = openPulse(s.store.db);
  assert.deepEqual(pulse.summary(1).sites, [{ site: 'taro.belayarod.ru', visits: 1 }]);
});
