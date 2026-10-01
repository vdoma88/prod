// Доступность сайтов: оповещения «не отвечает» / «снова работает», сертификаты, сводка.
//
//   npm run test:accounts
import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../store.mjs';
import { openUptime, parseTargets, probe } from '../uptime.mjs';

const TARGETS = [{ name: 'лендинг', url: 'https://belayarod.ru/' }, { name: 'Руны', url: 'https://runes.belayarod.ru/' }];

function setup({ cert = new Date('2027-01-01T00:00:00Z') } = {}) {
  let clock = new Date('2026-10-01T09:00:00Z');
  const down = new Set();
  const sent = [];
  let botUp = true;
  const fetchImpl = async (url) => {
    if (down.has(url)) throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    return new Response('ok', { status: 200 });
  };
  const store = openStore(':memory:');
  const uptime = openUptime({
    db: store.db, targets: TARGETS, now: () => clock, fetchImpl, certImpl: async () => cert,
    send: async (e) => { if (botUp) sent.push(e); return botUp; },
  });
  return {
    uptime, sent, down,
    tick: async (min = 5) => { await uptime.tick(); clock = new Date(clock.getTime() + min * 60e3); },
    bot: (v) => { botUp = v; },
  };
}

test('разовый сбой молчит; два подряд — одно оповещение; восстановление — с простоем', async () => {
  const s = setup();
  await s.tick();
  s.down.add('https://runes.belayarod.ru/');
  await s.tick();
  assert.equal(s.sent.length, 0, 'один сбой — тишина');
  await s.tick();
  assert.equal(s.sent.length, 1);
  assert.equal(s.sent[0].site, 'down');
  assert.deepEqual(s.sent[0].lines, ['Руны — runes.belayarod.ru/', 'нет ответа (ECONNREFUSED), не отвечает 5 мин']);
  await s.tick(); await s.tick();
  assert.equal(s.sent.length, 1, 'пока лежит — не повторяем');
  s.down.clear();
  await s.tick();
  assert.equal(s.sent.length, 2);
  assert.equal(s.sent[1].site, 'up');
  assert.deepEqual(s.sent[1].lines, ['Руны — runes.belayarod.ru/', 'простой 20 мин']);
});

test('бот недоступен — «не отвечает» и «снова работает» досылаются позже', async () => {
  const s = setup();
  s.down.add('https://belayarod.ru/');
  s.bot(false);
  await s.tick(); await s.tick();
  assert.equal(s.sent.length, 0);
  s.bot(true);
  await s.tick();
  assert.equal(s.sent.filter(e => e.site === 'down').length, 1);
  s.down.clear();
  s.bot(false);
  await s.tick();
  s.bot(true);
  await s.tick();
  assert.equal(s.sent.filter(e => e.site === 'up').length, 1);
});

test('сертификат меньше чем на 14 дней — предупреждение раз в сутки', async () => {
  const s = setup({ cert: new Date('2026-10-10T00:00:00Z') });
  await s.tick(); await s.tick();
  const certs = s.sent.filter(e => e.site === 'cert');
  assert.equal(certs.length, 2, 'по одному на хост за сутки');
  assert.deepEqual(certs[0].lines, ['Сертификат belayarod.ru', 'истекает через 8 дн. (2026-10-10) — проверьте certbot']);
  const fine = setup();
  await fine.tick();
  assert.equal(fine.sent.length, 0, 'запас больше 14 дней — тихо');
});

test('строка в утренней сводке', async () => {
  const s = setup();
  assert.deepEqual(s.uptime.digestLines(), ['Доступность: проверок не было']);
  await s.tick();
  assert.deepEqual(s.uptime.digestLines(), ['Доступность: все сайты (2) отвечали весь день']);
  s.down.add('https://runes.belayarod.ru/');
  await s.tick(); await s.tick();
  assert.deepEqual(s.uptime.digestLines(), ['Доступность: сбои — Руны 2× (≈10 мин)']);
});

test('список адресов из UPTIME_TARGETS и проверка кода ответа', async () => {
  assert.equal(parseTargets('').length, 6);
  assert.deepEqual(parseTargets('off'), []);
  assert.deepEqual(parseTargets('Таро=https://taro.belayarod.ru/, мусор'), [{ name: 'Таро', url: 'https://taro.belayarod.ru/' }]);
  assert.equal((await probe('x', async () => new Response('', { status: 502 }))).ok, false);
  assert.equal((await probe('x', async () => new Response('', { status: 200 }))).ok, true);
});
