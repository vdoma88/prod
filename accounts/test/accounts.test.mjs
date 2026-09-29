// Общий вход без сети: база в памяти, сервер на случайном порту, курсы — подделка fetch.
//
//   npm run test:accounts
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { openStore, MIN_PASSWORD } from '../store.mjs';
import { createApp } from '../app.mjs';

const PASS = 'верный-пароль-1';

function withClock(start = '2026-10-01T09:00:00Z') {
  let clock = new Date(start);
  return { now: () => clock, advance: (h) => { clock = new Date(clock.getTime() + h * 3600e3); } };
}

// ─── Хранилище ───

test('пароль задаётся только по ссылке и проверяется', () => {
  const store = openStore(':memory:');
  const u = store.createUser({ email: ' Kate@Example.RU ', name: 'Екатерина', role: 'admin' });
  assert.equal(u.email, 'kate@example.ru');
  assert.equal(u.hasPassword, false);
  assert.equal(store.checkPassword('kate@example.ru', ''), null, 'без пароля не войти');
  const { token } = store.createReset(u.id);
  assert.throws(() => store.useReset(token, 'короткий'), /не короче/);
  store.useReset(token, PASS);
  assert.throws(() => store.useReset(token, PASS), /устарела/, 'ссылка одноразовая');
  assert.ok(store.checkPassword('KATE@example.ru', PASS));
  assert.equal(store.checkPassword('kate@example.ru', PASS + 'x'), null);
  assert.equal(store.checkPassword('nobody@example.ru', PASS), null);
  assert.ok(MIN_PASSWORD >= 10);
});

test('ссылка на пароль живёт 72 часа', () => {
  const c = withClock();
  const store = openStore(':memory:', c);
  const u = store.createUser({ email: 'a@b.ru', name: 'А' });
  const { token } = store.createReset(u.id);
  c.advance(73);
  assert.throws(() => store.useReset(token, PASS), /устарела/);
});

test('сессия: 30 дней, сбрасывается при смене пароля и выключении', () => {
  const c = withClock();
  const store = openStore(':memory:', c);
  const admin = store.createUser({ email: 'admin@b.ru', name: 'Админ', role: 'admin' });
  const u = store.createUser({ email: 'a@b.ru', name: 'А' });
  const s1 = store.createSession(u.id);
  assert.equal(store.sessionUser(s1.token).id, u.id);
  c.advance(24 * 31);
  assert.equal(store.sessionUser(s1.token), null);
  const s2 = store.createSession(u.id);
  store.setPassword(u.id, PASS);
  assert.equal(store.sessionUser(s2.token), null, 'новый пароль — старые входы недействительны');
  const s3 = store.createSession(u.id);
  store.updateUser(u.id, { active: false }, admin.id);
  assert.equal(store.sessionUser(s3.token), null);
  assert.equal(store.sessionUser('x'.repeat(500)), null);
});

test('курсы открываются и закрываются, последнего админа не убрать', () => {
  const store = openStore(':memory:');
  const admin = store.createUser({ email: 'admin@b.ru', name: 'Админ', role: 'admin' });
  const u = store.createUser({ email: 'a@b.ru', name: 'А' });
  assert.deepEqual(store.updateUser(u.id, { courses: { runes: true, taro: true, nope: true } }).courses.sort(), ['runes', 'taro']);
  assert.deepEqual(store.updateUser(u.id, { courses: { taro: false } }).courses, ['runes']);
  assert.deepEqual(store.updateUser(u.id, { courses: { plamya: true } }).courses, ['runes'], '«Язык Пламени» здесь не выдаётся');
  assert.throws(() => store.updateUser(admin.id, { role: 'curator' }), /единственный/);
  assert.throws(() => store.updateUser(admin.id, { active: false }), /единственный/);
  store.updateUser(u.id, { role: 'admin' });
  assert.equal(store.updateUser(admin.id, { role: 'curator' }).role, 'curator');
  assert.throws(() => store.createUser({ email: 'A@b.ru', name: 'Дубль' }), /уже есть/);
  assert.throws(() => store.createUser({ email: 'не почта', name: 'Х' }), /почту/);
});

// ─── HTTP ───

async function server({ env = {}, courses = {} } = {}) {
  const store = openStore(':memory:');
  const calls = [];
  // Подделка курсов: courses.runes = (url, body) => ответ
  const fetchImpl = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, body, secret: init.headers['X-SR-Secret'] });
    const id = Object.keys(courses).find(k => url.startsWith(`http://${k}.test`));
    if (!id) throw new Error('ECONNREFUSED');
    const [status, data] = courses[id](url, body);
    return typeof data === 'string'
      ? new Response(data, { status, headers: { 'Content-Type': 'text/html' } })
      : new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  };
  const handle = createApp({ store, fetchImpl, env: {
    PUBLIC_ORIGIN: 'https://belayarod.ru', COOKIE_DOMAIN: '.belayarod.ru', SR_INTERNAL_SECRET: 'inner-secret',
    COURSE_RUNES_INTERNAL: 'http://runes.test', COURSE_TARO_INTERNAL: 'http://taro.test', ...env,
  } });
  const srv = createServer(handle);
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  let cookie = '';
  async function req(path, { body, headers = {}, raw = false } = {}) {
    const res = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST', redirect: 'manual',
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-SR': '1', Origin: 'https://belayarod.ru' }), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = /Max-Age=0/.test(set) ? '' : set.split(';')[0];
    return raw ? res : { status: res.status, data: await res.json().catch(() => null), setCookie: set };
  }
  const admin = store.createUser({ email: 'kate@b.ru', name: 'Екатерина', role: 'admin' });
  store.setPassword(admin.id, PASS);
  return { store, req, calls, admin, base, close: () => new Promise(r => srv.close(r)), logout: () => { cookie = ''; } };
}

test('вход, cookie на весь домен, выход', async (t) => {
  const s = await server(); t.after(s.close);
  assert.equal((await s.req('/account/api/me')).status, 401);
  assert.equal((await s.req('/account/api/login', { body: { email: 'kate@b.ru', password: 'нет' } })).status, 401);
  const r = await s.req('/account/api/login', { body: { email: 'kate@b.ru', password: PASS } });
  assert.equal(r.status, 200);
  assert.match(r.setCookie, /^sr_session=[\w-]+; Path=\/; Max-Age=2592000; HttpOnly; SameSite=Lax; Secure; Domain=\.belayarod\.ru$/);
  assert.equal(r.data.user.name, 'Екатерина');
  assert.ok(r.data.courses.every(c => c.enabled), 'админу открыты все курсы');
  assert.equal(r.data.courses.find(c => c.id === 'rod').url, 'https://rod.belayarod.ru/admin', 'администратору — сразу кабинет куратора');
  assert.equal(r.data.courses.find(c => c.id === 'runes').url, 'https://runes.belayarod.ru/#curator');
  assert.equal((await s.req('/account/api/me')).status, 200);
  await s.req('/account/api/logout', { body: {} });
  assert.equal((await s.req('/account/api/me')).status, 401);
});

test('изменяющие запросы только со страницы входа', async (t) => {
  const s = await server(); t.after(s.close);
  const login = { email: 'kate@b.ru', password: PASS };
  assert.equal((await s.req('/account/api/login', { body: login, headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await s.req('/account/api/login', { body: login, headers: { 'X-SR': '0' } })).status, 403);
  assert.equal((await s.req('/account/api/login', { body: login, headers: { 'Content-Type': 'text/plain' } })).status, 403);
  assert.equal((await s.req('/account/api/login', { body: login, headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
});

test('перебор паролей: после 8 ошибок — пауза', async (t) => {
  const s = await server(); t.after(s.close);
  for (let i = 0; i < 8; i++) assert.equal((await s.req('/account/api/login', { body: { email: 'kate@b.ru', password: 'x' + i } })).status, 401);
  assert.equal((await s.req('/account/api/login', { body: { email: 'kate@b.ru', password: PASS } })).status, 429);
});

test('админ заводит ученицу, открывает курсы, ученица задаёт пароль по ссылке', async (t) => {
  const s = await server(); t.after(s.close);
  await s.req('/account/api/login', { body: { email: 'kate@b.ru', password: PASS } });
  const created = await s.req('/account/api/admin/users', { body: { email: 'maria@b.ru', name: 'Мария', courses: { runes: true } } });
  assert.equal(created.status, 201);
  assert.deepEqual(created.data.user.courses, ['runes']);
  const token = new URL(created.data.link).hash.replace('#reset=', '');
  assert.match(created.data.link, /^https:\/\/belayarod\.ru\/account\/#reset=/);

  s.logout();
  const me = await s.req('/account/api/reset', { body: { token, password: 'пароль-марии-1' } });
  assert.equal(me.status, 200);
  assert.deepEqual(me.data.courses.filter(c => c.enabled && !c.ownLogin).map(c => c.id), ['runes']);
  assert.equal(me.data.courses.find(c => c.id === 'plamya').ownLogin, true, 'у «Языка Пламени» свой вход — просто ссылка');
  assert.equal(me.data.courses.find(c => c.id === 'runes').url, 'https://runes.belayarod.ru/', 'ученице — сам курс');
  assert.equal((await s.req('/account/api/admin/users')).status, 403, 'ученице админка закрыта');
  assert.equal((await s.req(`/account/api/admin/users/${created.data.user.id}`, { body: { role: 'admin' } })).status, 403);
});

test('уроки: админка спрашивает сам курс, неподключённый курс — connected:false', async (t) => {
  const lessons = { l1: 'open', l2: 'locked' };
  const s = await server({ courses: {
    runes: (url, body) => {
      if (body) { lessons[body.lessonId] = body.status; return [200, { ok: true }]; }
      assert.match(url, /^http:\/\/runes\.test\/sr-internal\/lessons\?email=maria%40b\.ru$/);
      return [200, { lessons: Object.entries(lessons).map(([id, status]) => ({ id, title: id, status })) }];
    },
    taro: () => [200, '<!doctype html><title>Таро</title>'],
  } });
  t.after(s.close);
  await s.req('/account/api/login', { body: { email: 'kate@b.ru', password: PASS } });
  const { data: { user } } = await s.req('/account/api/admin/users', { body: { email: 'maria@b.ru', name: 'Мария', courses: { runes: true } } });
  const path = `/account/api/admin/users/${user.id}/lessons`;

  const got = await s.req(`${path}/runes`);
  assert.equal(got.data.connected, true);
  assert.equal(got.data.lessons.length, 2);
  assert.equal(s.calls.at(-1).secret, 'inner-secret');

  assert.equal((await s.req(`${path}/runes`, { body: { lessonId: 'l2', status: 'done' } })).status, 200);
  assert.equal(lessons.l2, 'done');
  assert.deepEqual(s.calls.at(-1).body, { email: 'maria@b.ru', name: 'Мария', lessonId: 'l2', status: 'done' });
  assert.equal((await s.req(`${path}/runes`, { body: { lessonId: 'l2', status: 'maybe' } })).status, 400);
  assert.equal((await s.req(`${path}/taro`, { body: { lessonId: 'l1', status: 'open' } })).status, 409, 'курс ей не открыт');
  assert.equal((await s.req(`${path}/plamya`)).status, 404, 'курс со своим входом общий вход не ведёт');
  assert.deepEqual((await s.req(`${path}/taro`)).data, { connected: false }, 'страница приложения вместо JSON');
  assert.equal((await s.req(`${path}/nope`)).status, 404);
});

test('внутренний адрес: только локально и с секретом', async (t) => {
  const s = await server(); t.after(s.close);
  const login = await s.req('/account/api/login', { body: { email: 'kate@b.ru', password: PASS } });
  const token = login.setCookie.split(';')[0].split('=')[1];
  const ask = (secret, tok = token) => fetch(s.base + '/account/internal/session', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(secret ? { 'X-SR-Secret': secret } : {}) }, body: JSON.stringify({ token: tok }),
  });
  assert.equal((await ask()).status, 401);
  assert.equal((await ask('wrong')).status, 401);
  const ok = await ask('inner-secret');
  assert.equal(ok.status, 200);
  const data = await ok.json();
  assert.equal(data.user.email, 'kate@b.ru');
  assert.deepEqual(data.courses, ['rod', 'taro', 'runes'], 'курсы со своим входом курсам не сообщаются');
  assert.equal((await ask('inner-secret', 'bad')).status, 401);
});

test('без секрета внутренний адрес выключен', async (t) => {
  const s = await server({ env: { SR_INTERNAL_SECRET: '' } }); t.after(s.close);
  const r = await s.req('/account/internal/session', { body: { token: 'x' } });
  assert.equal(r.status, 503);
});

test('страница отдаётся со строгим CSP', async (t) => {
  const s = await server(); t.after(s.close);
  const redirect = await s.req('/account', { raw: true });
  assert.equal(redirect.status, 301);
  const page = await s.req('/account/', { raw: true });
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self';/);
  const html = await page.text();
  assert.doesNotMatch(html, /<script>|\sstyle=|\son\w+=/, 'без inline-кода');
  assert.equal((await s.req('/account/../bot/server.mjs', { raw: true })).status, 404);
  assert.equal((await s.req('/account/store.mjs', { raw: true })).status, 404);
});
