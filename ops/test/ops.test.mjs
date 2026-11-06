import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { collectStatus, packStatus, alarmsOf, dbNameOf, envValue, latestBackup, mskTime } from '../status.mjs';
import { createOpsBot } from '../bot.mjs';

const NOW = Date.parse('2026-11-05T09:00:00Z');
const H = 36e5;

function fakeHost({ down = [], missing = [], files = {}, counts = {}, codes = {}, online = { plamya: [], rod: null } } = {}) {
  const runImpl = async (cmd, args) => {
    if (cmd === 'systemctl') {
      const unit = args[1];
      if (missing.includes(unit)) return null;
      return args[0] === 'cat' ? `# ${unit}` : (down.includes(unit) ? null : 'active');
    }
    if (cmd === 'runuser') {
      const sql = args.at(-1);
      const key = Object.keys(counts).find((k) => sql.includes(k));
      return key ? String(counts[key]) : null;
    }
    return null;
  };
  const fetchImpl = async (url, init = {}) => {
    const host = new URL(url).host;
    if (url.includes('/sr-internal/online')) {
      if (init.headers?.['X-SR-Secret'] !== 'inner') return { ok: false, status: 404 };
      const list = online[host.endsWith(':3000') ? 'plamya' : 'rod'];
      return list === null ? { ok: false, status: 404 } : { ok: true, status: 200, json: async () => ({ online: list.map((name) => ({ name })) }) };
    }
    if (codes[host] === 0) throw new Error('ECONNREFUSED');
    return { status: codes[host] ?? 200 };
  };
  return {
    runImpl, fetchImpl, now: NOW, domain: 'belayarod.ru',
    readdir: () => Object.keys(files), stat: (p) => ({ mtimeMs: files[p.split('/').pop()], size: 100 }),
    readFile: (f) => (f.endsWith('.env.local') ? 'DATABASE_URL=postgres://flame_user:x@127.0.0.1:5432/flame_recovery_20261101\n' : 'MemTotal: 4000000 kB\nMemAvailable: 1000000 kB\n'),
    disk: 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/vda1 41000000 12000000 29000000 30% /',
    meminfo: 'MemTotal: 4000000 kB\nMemAvailable: 1000000 kB\n', loadavg: [0.5, 0, 0], cpus: 2, internalSecret: 'inner',
  };
}

const freshFiles = {
  'rod-20261105T080000Z.tar.gz': NOW - 1 * H, 'rod-20261104T200000Z.tar.gz': NOW - 13 * H,
  'flame-20261105T080000Z.tar.gz': NOW - 1 * H, 'hub-20261105T080000Z.tar.gz': NOW - 1 * H,
  'runes-20261105-081500.tar.gz': NOW - 0.75 * H, 'taro-20261105-081500.tar.gz': NOW - 0.75 * H,
};

test('мелочи: имя базы, значение из .env, время по Москве', () => {
  assert.equal(dbNameOf('postgresql://u:p@127.0.0.1:5432/rodology?schema=public'), 'rodology');
  assert.equal(dbNameOf('"postgres://u:p@h/flame_db"'), 'flame_db');
  assert.equal(dbNameOf('postgres://u:p@h/bad;name'), null);
  assert.equal(envValue('/x', 'B', { readFile: () => 'A=1\nB="два"\n' }), 'два');
  assert.equal(envValue('/x', 'B', { readFile: () => { throw new Error('нет'); } }), null);
  assert.equal(mskTime(NOW), '12:00');
});

test('копии: берётся самая свежая с нужным префиксом', () => {
  const files = { 'rod-a.tar.gz': NOW - 20 * H, 'rod-b.tar.gz': NOW - 2 * H, 'rod-c.tar.gz.sha256': NOW, 'runes-x.tar.gz': NOW };
  const b = latestBackup('/d', 'rod-', { now: NOW, readdir: () => Object.keys(files), stat: (p) => ({ mtimeMs: files[p.split('/').pop()], size: 1 }) });
  assert.equal(b.hours, 2);
  assert.equal(latestBackup('/d', 'rod-', { readdir: () => { throw new Error('нет'); } }), null);
});

test('всё в порядке: ни одной тревоги, состояние влезает в 1024 байта', async () => {
  const st = await collectStatus(fakeHost({ files: freshFiles, counts: { ClientStep: 3, homework_submissions: 2, casting_requests: 0 } }));
  assert.deepEqual(st.queues, { rod: 3, homework: 2, casting: 0 });
  assert.equal(st.disk, 30);
  assert.equal(st.mem, 75);
  assert.equal(st.load, 25);
  assert.deepEqual(alarmsOf(st), []);
  const packed = packStatus(st);
  assert.ok(Buffer.byteLength(packed) <= 1024, `${Buffer.byteLength(packed)} байт`);
  const d = JSON.parse(packed);
  assert.equal(d.a, 0);
  assert.equal(d.t, '12:00');
  assert.deepEqual(d.q, [3, 2, 0]);
  assert.equal(d.s.length, 8 + 3);
});

test('тревоги: упавшая служба, недоступный сайт, старая и пропавшая копии, полный диск', async () => {
  const files = { ...freshFiles, 'flame-20261105T080000Z.tar.gz': NOW - 30 * H };
  delete files['runes-20261105-081500.tar.gz'];
  const host = fakeHost({ down: ['rodology'], missing: ['polkas'], files, codes: { 'rod.belayarod.ru': 502 } });
  host.disk = '/dev/vda1 1 1 1 93% /';
  const st = await collectStatus(host);
  assert.ok(!st.services.some((s) => s.unit === 'polkas'), 'не установленная служба не показывается');
  const a = alarmsOf(st);
  assert.deepEqual(a, [
    'служба «Род» не работает', 'сайт «Род» отвечает 502',
    'копия «Школа» старая: 30 ч', 'нет копии «Руны»', 'диск занят на 93%',
  ]);
  assert.equal(JSON.parse(packStatus(st)).a, 5);
  assert.deepEqual(st.queues, { rod: null, homework: null, casting: null }, 'нет базы — прочерк, не ноль');
});

test('виджет: в лимитах Telegram (32 КБ и 4 КБ сжатый), без внешних адресов', () => {
  const html = fs.readFileSync(new URL('../widget.html', import.meta.url));
  assert.ok(html.length <= 32 * 1024);
  assert.ok(zlib.deflateSync(html, { level: 9 }).length <= 4096 - 200, 'запас до 4 КБ');
  assert.doesNotMatch(String(html), /src=|<link|@import|url\(/i);
  assert.doesNotMatch(String(html), /<input|<textarea|<select|<form/i, 'полей ввода в виджете нет');
});

function fakeBot(st) {
  const calls = [];
  const api = async (method, params) => {
    calls.push([method, params]);
    if (method === 'sendWidget') return { message_id: 77 };
    if (method === 'editMessageWidgetData' && params.chat_id === 999) throw new Error('editMessageWidgetData: Bad Request: message to edit not found');
    return true;
  };
  const state = {};
  let current = st;
  const bot = createOpsBot({ api, collect: async () => current, html: '<b>w</b>', admins: [117535475], state });
  return { bot, calls, state, set: (s) => { current = s; } };
}

test('бот: пульт только администратору, «Обновить» отвечает и обновляет сообщение', async () => {
  const st = await collectStatus(fakeHost({ files: freshFiles }));
  const { bot, calls, state } = fakeBot(st);
  await bot.onUpdate({ message: { text: '/pult', chat: { id: 5, type: 'private' }, from: { id: 5 } } });
  assert.deepEqual(calls.map((c) => c[0]), ['sendMessage'], 'чужому — отказ, без пульта');
  calls.length = 0;
  await bot.onUpdate({ message: { text: '/pult', chat: { id: 117535475, type: 'private' }, from: { id: 117535475 } } });
  assert.equal(calls[0][0], 'sendWidget');
  assert.equal(calls[0][1].allow_queries, true);
  assert.equal(state.dashboards['117535475'], 77);
  calls.length = 0;
  await bot.onUpdate({ widget_query: { id: 'q1', data: 'refresh', from: { id: 117535475 }, chat: { id: 117535475 }, message_id: 77 } });
  assert.deepEqual(calls.map((c) => c[0]), ['answerWidgetQuery', 'editMessageWidgetData']);
  assert.equal(JSON.parse(calls[0][1].data).a, 0);
  calls.length = 0;
  await bot.onUpdate({ widget_query: { id: 'q2', data: 'refresh', from: { id: 5 }, chat: { id: 5 }, message_id: 1 } });
  assert.deepEqual(calls, [['answerWidgetQuery', { widget_query_id: 'q2' }]], 'чужому — пустой ответ');
});

test('бот: плановое обновление, тревога один раз, «снова в порядке», пропавший пульт забывается', async () => {
  const ok = await collectStatus(fakeHost({ files: freshFiles }));
  const bad = await collectStatus(fakeHost({ files: freshFiles, down: ['flame-school'] }));
  const { bot, calls, state, set } = fakeBot(bad);
  state.dashboards['117535475'] = 77;
  state.dashboards['999'] = 1;
  await bot.tick();
  assert.equal(state.dashboards['999'], undefined);
  const alerts = () => calls.filter((c) => c[0] === 'sendMessage').map((c) => c[1].text);
  assert.match(alerts()[0], /Тревога.*\n• служба «Школа» не работает/);
  calls.length = 0;
  await bot.tick();
  assert.deepEqual(alerts(), [], 'та же тревога второй раз не присылается');
  set(ok);
  await bot.tick();
  assert.match(alerts()[0], /Снова в порядке:\n• служба «Школа» не работает/);
});

test('бот: /status — сводка текстом; виджет не принят — та же сводка текстом', async () => {
  const st = await collectStatus(fakeHost({ files: freshFiles, down: ['rodology'] }));
  const calls = [];
  const api = async (method, params) => {
    calls.push([method, params]);
    if (method === 'sendWidget') throw new Error('sendWidget: Not Found: method not found');
    return true;
  };
  const bot = createOpsBot({ api, collect: async () => st, html: '', admins: [1], state: {} });
  await bot.onUpdate({ message: { text: '/status', chat: { id: 1, type: 'private' }, from: { id: 1 } } });
  assert.match(calls[0][1].text, /^🔴 Тревог: 1 · 12:00 МСК\n\nСлужбы: 🟢 Школа  🔴 Род/);
  assert.match(calls[0][1].text, /• служба «Род» не работает$/);
  calls.length = 0;
  await bot.onUpdate({ message: { text: '/pult', chat: { id: 1, type: 'private' }, from: { id: 1 } } });
  assert.deepEqual(calls.map((c) => c[0]), ['sendWidget', 'sendMessage']);
  assert.match(calls[1][1].text, /^Пульт-виджет пока недоступен \(sendWidget: Not Found: method not found\)\. Сводка текстом:\n\n🔴 Тревог: 1/);
});

test('онлайн: школа и Род по служебному адресу с секретом; Род без секрета — прочерк', async () => {
  const st = await collectStatus(fakeHost({ files: freshFiles, online: { plamya: ['Анна Иванова', 'Мария'], rod: null } }));
  assert.deepEqual(st.online, { plamya: ['Анна', 'Мария'], rod: null });
  assert.deepEqual(JSON.parse(packStatus(st)).o, [2, null]);
  const { statusText } = await import('../status.mjs');
  assert.match(statusText(st), /\nОнлайн: школа 2 \(Анна, Мария\) · Род —\n/);
  const none = await collectStatus({ ...fakeHost({ files: freshFiles }), internalSecret: '' });
  assert.deepEqual(none.online, { plamya: null, rod: null }, 'без секрета никого не спрашиваем');
});

test('копии: курса нет на сервере — его копий не ждём и не тревожимся', async () => {
  const files = { ...freshFiles };
  delete files['runes-20261105-081500.tar.gz'];
  delete files['taro-20261105-081500.tar.gz'];
  const st = await collectStatus(fakeHost({ files, missing: ['runes', 'polkas'] }));
  assert.deepEqual(st.backups.map((b) => b.name), ['Род', 'Школа', 'Кабинет']);
  assert.deepEqual(alarmsOf(st), []);
});
