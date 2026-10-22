import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { openStore } from '../store.mjs';
import { openLanding, LANDING_PAGES } from '../landing.mjs';
import { createApp } from '../app.mjs';

test('Landing copy: persists plain-text changes and rejects invalid pages and keys', () => {
  const store = openStore(':memory:');
  const editor = openLanding(store.db);
  assert.equal(LANDING_PAGES.length, 11);
  assert.deepEqual(editor.get('index.html'), {page:'index.html', revision:0, changes:{}, updatedAt:null});
  const key = '#top>div:nth-of-type(1)>h1:nth-of-type(1)~0';
  const first = editor.save('index.html', 0, {[key]:'Новый заголовок <script>plain text only</script>'}, 'admin-id');
  assert.equal(first.revision, 1);
  assert.equal(editor.get('index.html').changes[key], 'Новый заголовок <script>plain text only</script>');
  assert.equal(editor.get('therapy.html').revision, 0);
  assert.throws(() => editor.save('index.html', 0, {[key]:'Конфликт'}, 'admin-id'), e => e.status === 409);
  assert.throws(() => editor.save('../private', 0, {}, 'admin-id'), e => e.status === 400);
  assert.throws(() => editor.save('index.html', 1, {['__proto__']:'anything'}, 'admin-id'), e => e.status === 400);
  assert.throws(() => editor.save('index.html', 1, {[key]: {html:'<h1>x</h1>'}}, 'admin-id'), e => e.status === 400);
  assert.throws(() => editor.save('index.html', 1, {[key]:'x'.repeat(3001)}, 'admin-id'), e => e.status === 400);
  editor.save('index.html', 1, {}, 'admin-id');
  assert.deepEqual(editor.get('index.html').changes, {});
  store.db.close();
});

test('Landing copy: public GET; only signed-in admin can POST with same-origin protection', async t => {
  const store = openStore(':memory:');
  const admin = store.createUser({email:'admin@sample.ru',name:'Редактор',role:'admin'});
  const student = store.createUser({email:'student@sample.ru',name:'Читатель'});
  const env = {PUBLIC_ORIGIN:'https://belayarod.ru', COOKIE_DOMAIN:'.belayarod.ru'};
  const srv = createServer(createApp({store,env}));
  await new Promise(resolve => srv.listen(0, '127.0.0.1',resolve));
  t.after(() => new Promise(resolve => srv.close(() => {store.db.close();resolve();})));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const read = async path => fetch(base + path);
  const post = async (token, body, headers = {}) => fetch(base + '/account/api/admin/landing', {
    method:'POST',
    headers:{
      Cookie:'sr_session=' + (token || ''),
      Origin:'https://belayarod.ru', 'Content-Type':'application/json', 'X-SR':'1',
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const empty = await read('/account/api/landing?page=index.html');
  assert.equal(empty.status, 200);
  assert.equal((await empty.json()).revision, 0);
  assert.equal(empty.headers.get('cache-control'), 'no-store');
  assert.equal((await read('/account/api/landing?page=nope')).status, 400);
  const key = '#top>h1:nth-of-type(1)~0';
  const update = {page:'index.html',revision:0,changes:{[key]:'Ручная редактура'}};
  assert.equal((await post('',update)).status, 401);
  const studentSession = store.createSession(student.id);
  assert.equal((await post(studentSession.token,update)).status, 403);
  const adminSession = store.createSession(admin.id);
  assert.equal((await post(adminSession.token,update,{Origin:'https://evil.example'})).status, 403);
  const published = await post(adminSession.token,update);
  assert.equal(published.status, 200);
  assert.equal((await published.json()).revision, 1);
  assert.equal((await post(adminSession.token,update)).status, 409);
  assert.equal((await (await read('/account/api/landing?page=index.html')).json()).changes[key], 'Ручная редактура');
});

test('Landing copy: правка с исходным текстом, история версий и возврат', () => {
  const store = openStore(':memory:');
  const editor = openLanding(store.db);
  const key = '#top>div:nth-of-type(1)>h1:nth-of-type(1)~0';
  const v1 = editor.save('index.html', 0, {[key]: {text: 'Первый', base: 'Ваш запрос.'}}, 'admin-id');
  assert.deepEqual(v1.changes[key], {text: 'Первый', base: 'Ваш запрос.'});
  // лишние поля и не-строки — отказ
  assert.throws(() => editor.save('index.html', 1, {[key]: {text: 'x', base: 'y', html: '<b>'}}, 'a'), e => e.status === 400);
  assert.throws(() => editor.save('index.html', 1, {[key]: {text: 'x', base: 5}}, 'a'), e => e.status === 400);
  editor.save('index.html', 1, {[key]: {text: 'Второй', base: 'Ваш запрос.'}}, 'admin-id');
  const h = editor.history('index.html');
  assert.equal(h.current.revision, 2);
  assert.deepEqual(h.versions.map(v => v.revision), [1]);
  assert.equal(h.versions[0].count, 1);
  // возврат версии 1 — новая версия 3 с текстом «Первый», история не теряется
  const back = editor.restore('index.html', 2, 1, 'admin-id');
  assert.equal(back.revision, 3);
  assert.equal(back.changes[key].text, 'Первый');
  assert.deepEqual(editor.history('index.html').versions.map(v => v.revision), [2, 1]);
  // версия 0 — исходные тексты страницы
  assert.equal(Object.keys(editor.restore('index.html', 3, 0, 'admin-id').changes).length, 0);
  assert.throws(() => editor.restore('index.html', 4, 99, 'a'), e => e.status === 404);
  assert.throws(() => editor.restore('index.html', 1, 1, 'a'), e => e.status === 409);
  store.db.close();
});

test('Landing copy: история и возврат — только администратору', async t => {
  const store = openStore(':memory:');
  const admin = store.createUser({email:'admin@sample.ru',name:'Редактор',role:'admin'});
  const student = store.createUser({email:'student@sample.ru',name:'Читатель'});
  const srv = createServer(createApp({store, env:{PUBLIC_ORIGIN:'https://belayarod.ru'}}));
  await new Promise(resolve => srv.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => srv.close(() => {store.db.close(); resolve();})));
  const base = 'http://127.0.0.1:' + srv.address().port + '/account/api/admin/landing';
  const as = (user) => ({Cookie: 'sr_session=' + store.createSession(user.id).token});
  const write = (user, path, body) => fetch(base + path, {method:'POST', headers:{...as(user), Origin:'https://belayarod.ru', 'Content-Type':'application/json', 'X-SR':'1'}, body: JSON.stringify(body)});
  const key = '#top>h1:nth-of-type(1)~0';
  assert.equal((await write(admin, '', {page:'index.html', revision:0, changes:{[key]:{text:'A', base:'Б'}}})).status, 200);
  assert.equal((await write(admin, '', {page:'index.html', revision:1, changes:{}})).status, 200);
  assert.equal((await fetch(base + '/history?page=index.html', {headers: as(student)})).status, 403);
  const h = await (await fetch(base + '/history?page=index.html', {headers: as(admin)})).json();
  assert.equal(h.current.revision, 2);
  assert.equal(h.versions[0].updatedBy, 'Редактор');
  assert.equal((await write(student, '/restore', {page:'index.html', revision:2, to:1})).status, 403);
  const restored = await write(admin, '/restore', {page:'index.html', revision:2, to:1});
  assert.equal(restored.status, 200);
  assert.equal((await restored.json()).changes[key].text, 'A');
});
