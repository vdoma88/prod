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
