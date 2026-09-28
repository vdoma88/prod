// Бот «Сила Рода» без сети: поддельный Telegram записывает вызовы,
// часы подменяются, база — в памяти.
//
//   node --test bot/test
import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../store.mjs';
import { createBot, daytime } from '../logic.mjs';
import { telegramClient } from '../telegram.mjs';
import * as M from '../messages.mjs';

const ADMIN = 1000;
const USER = 42;

function setup({ start = '2026-10-01T09:00:00Z', failWith } = {}) {
  const store = openStore(':memory:');
  let clock = new Date(start);
  let messageId = 1;
  const calls = [];
  const tg = async (method, payload) => {
    calls.push({ method, ...payload });
    if (failWith && method === 'sendMessage' && payload.chat_id === USER) return failWith;
    return { ok: true, result: { message_id: messageId++ } };
  };
  const bot = createBot({ store, tg, now: () => clock, adminCode: 'secret' });
  const sent = (chatId) => calls.filter(c => c.method === 'sendMessage' && c.chat_id === chatId);
  return { store, bot, calls, sent, advance: (hours) => { clock = new Date(clock.getTime() + hours * 3600e3); } };
}

const message = (text, extra = {}) => ({ message: { chat: { id: USER, type: 'private' }, from: { id: USER, first_name: 'Мария', username: 'maria' }, text, ...extra } });
const press = (data, from = { id: USER, first_name: 'Мария', username: 'maria' }) => ({ callback_query: { id: 'cb', data, from, message: { chat: { id: USER } } } });

async function linkAdmin(bot) {
  await bot.handleUpdate({ message: { chat: { id: ADMIN, type: 'private' }, from: { id: ADMIN }, text: '/start admin-secret' } });
}

test('ночное время сдвигается на 10:00 МСК', () => {
  assert.equal(daytime(new Date('2026-10-01T12:00:00Z')).toISOString(), '2026-10-01T12:00:00.000Z'); // 15:00 МСК
  assert.equal(daytime(new Date('2026-10-01T19:30:00Z')).toISOString(), '2026-10-02T07:00:00.000Z'); // 22:30 → утро
  assert.equal(daytime(new Date('2026-10-01T02:00:00Z')).toISOString(), '2026-10-01T07:00:00.000Z'); // 05:00 → 10:00
});

test('/start: приветствие с выбором запроса и серия в очереди', async () => {
  const { bot, store, sent } = setup();
  await bot.handleUpdate(message('/start landing'));
  const [welcome] = sent(USER);
  assert.equal(welcome.text, M.WELCOME);
  assert.equal(welcome.reply_markup.inline_keyboard.length, M.ROUTES.length);
  assert.equal(store.person(USER).source, 'landing');
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM queue WHERE chat_id = ?').get(USER).n, M.FUNNEL.length);
});

test('серия уходит по расписанию и не дублируется', async () => {
  const { bot, sent, advance } = setup();
  await bot.handleUpdate(message('/start'));
  assert.equal(await bot.tick(), 0);
  advance(25);
  assert.equal(await bot.tick(), 1);
  assert.equal(await bot.tick(), 0, 'второй раз то же сообщение не уходит');
  advance(24 * 7);
  assert.equal(await bot.tick(), 2);
  assert.deepEqual(sent(USER).slice(1).map(m => m.text), M.FUNNEL.map(s => s.text));
});

test('заявка: Екатерина получает уведомление, серия прекращается', async () => {
  const { bot, store, sent, advance } = setup();
  await linkAdmin(bot);
  await bot.handleUpdate(message('/start'));
  await bot.handleUpdate(press('r:deep'));
  await bot.handleUpdate(press('s:deep'));
  const notice = sent(ADMIN).at(-1).text;
  assert.match(notice, /Новая заявка/);
  assert.match(notice, /@maria/);
  assert.match(notice, /Связь с Родом/);
  assert.equal(store.person(USER).status, 'lead');
  assert.equal(sent(USER).at(-1).text, M.SIGNUP_DONE);
  advance(24 * 30);
  assert.equal(await bot.tick(), 0, 'после заявки серия не приходит');
});

test('ответ Екатерины на уведомление пересылается человеку', async () => {
  const { bot, store, sent } = setup();
  await linkAdmin(bot);
  await bot.handleUpdate(message('Здравствуйте, хочу на консультацию <срочно>'));
  assert.match(sent(ADMIN).at(-1).text, /&lt;срочно&gt;/, 'текст человека экранирован');
  assert.equal(sent(USER).at(-1).text, M.FREE_TEXT_THANKS);

  const { admin_message_id: noticeId } = store.db.prepare('SELECT admin_message_id FROM relays WHERE chat_id = ?').get(USER);
  await bot.handleUpdate({ message: { chat: { id: ADMIN, type: 'private' }, from: { id: ADMIN }, text: 'Добрый день! Давайте в четверг?', reply_to_message: { message_id: noticeId } } });
  assert.equal(sent(USER).at(-1).text, 'Добрый день! Давайте в четверг?');
  assert.equal(sent(ADMIN).at(-1).text, 'Передано.');
});

test('/stop останавливает серию, повторный /start её не повторяет', async () => {
  const { bot, store, advance } = setup();
  await bot.handleUpdate(message('/start'));
  await bot.handleUpdate(message('/stop'));
  assert.equal(store.person(USER).status, 'stopped');
  advance(24 * 30);
  assert.equal(await bot.tick(), 0);
  await bot.handleUpdate(message('/start'));
  assert.equal(store.person(USER).status, 'active');
  assert.equal(await bot.tick(), 0, 'удалённые шаги заново не планируются');
});

test('заблокировавшего бота больше не беспокоим', async () => {
  const { bot, store, advance } = setup({ failWith: { ok: false, status: 403, description: 'Forbidden: bot was blocked by the user' } });
  await bot.handleUpdate(message('/start'));
  advance(25);
  await bot.tick();
  assert.equal(store.person(USER).status, 'stopped');
});

test('сетевой сбой — сообщение остаётся в очереди', async () => {
  const { bot, store, advance } = setup({ failWith: { ok: false, description: 'fetch failed' } });
  await bot.handleUpdate(message('/start'));
  advance(25);
  await bot.tick();
  const row = store.db.prepare(`SELECT sent_at FROM queue WHERE chat_id = ? AND step = 'day1'`).get(USER);
  assert.equal(row.sent_at, null);
});

test('чужой код админа не делает админом', async () => {
  const { bot, store } = setup();
  await bot.handleUpdate({ message: { chat: { id: 7, type: 'private' }, from: { id: 7 }, text: '/start admin-wrong' } });
  assert.equal(store.isAdmin(7), false);
});

test('клиент Telegram повторяет сетевой сбой и не повторяет 4xx', async () => {
  let n = 0;
  const flaky = telegramClient('t', { retryDelayMs: 1, fetchImpl: async () => { n++; if (n < 3) throw new Error('reset'); return new Response(JSON.stringify({ ok: true, result: 1 })); } });
  assert.equal((await flaky('getMe', {})).ok, true);
  assert.equal(n, 3);
  let m = 0;
  const denied = telegramClient('t', { retryDelayMs: 1, fetchImpl: async () => { m++; return new Response(JSON.stringify({ ok: false, description: 'Forbidden' }), { status: 403 }); } });
  const res = await denied('sendMessage', {});
  assert.equal(res.status, 403);
  assert.equal(m, 1);
});
