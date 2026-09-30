// Телеметрия в Telegram: сводка раз в сутки и оповещение о новой поломке.
//
//   npm run test:accounts
import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../store.mjs';
import { openPulse, parseBatch } from '../pulse.mjs';
import { openWatch, digestLines, problemKey, botSender } from '../pulse-watch.mjs';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';
const O = 'https://belayarod.ru';

function setup(start = '2026-10-01T06:00:00Z') { // 09:00 МСК
  let clock = new Date(start);
  const now = () => clock;
  const store = openStore(':memory:', { now });
  const pulse = openPulse(store.db, { now });
  const sent = [];
  let up = true;
  const watch = openWatch({ db: store.db, pulse, now, send: async (e) => { if (up) sent.push(e); return up; } });
  let n = 0;
  const visit = (ev, ua = IPHONE, path = '/') => pulse.add(parseBatch({ v: 1, id: (++n).toString(16).padStart(16, '0'), path, ev }), ua);
  return { watch, pulse, sent, visit, down: () => { up = false; }, upAgain: () => { up = true; }, at: (iso) => { clock = new Date(iso); } };
}

test('новая поломка приходит один раз; старая при первом запуске — нет', async () => {
  const s = setup();
  s.visit([{ k: 'broken', tag: 'img', url: O + '/assets/old.webp' }]);
  s.at('2026-10-01T06:05:00Z');
  assert.equal(await s.watch.alerts(), 0, 'первый запуск только запоминает');
  s.at('2026-10-01T06:06:00Z');
  s.visit([{ k: 'broken', tag: 'img', url: O + '/assets/old.webp' }, { k: 'broken', tag: 'img', url: O + '/assets/archaic/consult.webp' }], IPHONE, '/consultations.html');
  s.at('2026-10-01T06:10:00Z');
  assert.equal(await s.watch.alerts(), 1);
  assert.equal(s.sent[0].site, 'alert');
  assert.equal(s.sent[0].lines[0], 'Не загрузился файл /assets/archaic/consult.webp');
  assert.equal(s.sent[0].lines[1], '   iPhone iOS 18.6 Safari · /consultations.html');
  assert.equal(s.sent[0].url, 'https://belayarod.ru/account/');
  s.at('2026-10-01T06:11:00Z');
  s.visit([{ k: 'broken', tag: 'img', url: O + '/assets/archaic/consult.webp' }]);
  s.at('2026-10-01T06:15:00Z');
  assert.equal(await s.watch.alerts(), 0, 'та же поломка повторно не приходит');
  assert.equal(s.sent.length, 1);
});

test('бот недоступен — оповещение повторится в следующий раз', async () => {
  const s = setup();
  await s.watch.alerts();
  s.at('2026-10-01T06:06:00Z');
  s.visit([{ k: 'error', msg: 'TypeError: x is undefined', src: O + '/app.js', line: 7 }]);
  s.down();
  s.at('2026-10-01T06:10:00Z');
  assert.equal(await s.watch.alerts(), 0);
  s.upAgain();
  s.at('2026-10-01T06:15:00Z');
  assert.equal(await s.watch.alerts(), 1);
  assert.equal(s.sent[0].lines[0], 'Ошибка «TypeError: x is undefined» (/app.js:7)');
});

test('чужие скрипты, «Script error.» и чужие файлы не оповещают', () => {
  const r = (kind, data) => ({ kind, data, platform: 'iPhone', os: 'iOS 18.6', browser: 'Safari' });
  assert.equal(problemKey(r('error', { msg: 'Script error.', src: '', line: 0 }), O), null);
  assert.equal(problemKey(r('error', { msg: 'boom', src: 'safari-web-extension://abc/x.js', line: 1 }), O), null);
  assert.equal(problemKey(r('broken', { tag: 'img', url: 'https://cdn.example/x.png' }), O), null);
  assert.ok(problemKey(r('error', { msg: 'promise: boom', src: '', line: 0 }), O));
  assert.ok(problemKey(r('csp', { dir: 'img-src', uri: 'https://x.example' }), O));
});

test('сводка — раз в сутки после 10:00 МСК', async () => {
  const s = setup('2026-10-01T06:30:00Z'); // 09:30 МСК
  s.visit([{ k: 'view', load: 1500 }, { k: 'step', name: 'telegram', info: 'copy-fail' }, { k: 'step', name: 'dialog', info: 'open' }]);
  s.visit([{ k: 'left', state: 'loading' }]);
  assert.equal(await s.watch.digest(), false, 'до 10:00 МСК не шлём');
  s.at('2026-10-01T07:01:00Z');
  assert.equal(await s.watch.digest(), true);
  assert.equal(await s.watch.digest(), false, 'второй раз за день не шлём');
  const lines = s.sent[0].lines;
  assert.equal(lines[0], 'Визитов: 2 · iPhone 2');
  assert.equal(lines[1], 'iPhone: загрузка 1,5 с, у 90% — до 1,5 с; ушли до загрузки: 1');
  assert.ok(lines.includes('Ошибки скриптов: нет'));
  assert.ok(lines.includes('Заявка и бубен: окно заявки 1, Telegram 1 (текст не скопировался 1)'));
  s.at('2026-10-02T07:05:00Z');
  assert.equal(await s.watch.digest(), true, 'на следующий день — снова');
});

test('пустые сутки — так и пишем', () => {
  assert.match(digestLines({ platforms: [], errors: [], broken: [], csp: [], steps: [] })[0], /Визитов не было/);
});

test('отправка в бота: секрет в заголовке, сбой сети — false', async () => {
  let got;
  const ok = await botSender({ url: 'http://bot/notify', secret: 's3', fetchImpl: async (url, init) => { got = { url, init }; return new Response('{}', { status: 200 }); } })({ site: 'digest', lines: ['x'] });
  assert.equal(ok, true);
  assert.equal(got.init.headers['X-Notify-Secret'], 's3');
  assert.deepEqual(JSON.parse(got.init.body), { site: 'digest', lines: ['x'] });
  const fail = await botSender({ url: 'http://bot/notify', secret: 's3', fetchImpl: async () => { throw new Error('ECONNREFUSED'); } })({ site: 'alert', lines: ['x'] });
  assert.equal(fail, false);
});
