// Бот «Сила Рода»: вебхук Telegram + рассылка серии раз в минуту.
//
//   node bot/server.mjs      (Node ≥ 22.13, без npm install)
//
// Переменные окружения — bot/README.md. На сервере: /etc/rodbot.env,
// служба systemd «rodbot» (infra/vps/14-bot.sh).
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { openStore } from './store.mjs';
import { telegramClient } from './telegram.mjs';
import { createBot } from './logic.mjs';

const env = process.env;
const PORT = Number(env.PORT || 4310);
const HOST = env.HOST || '127.0.0.1';
const PATH = '/tg/rod-bot';
const SECRET = env.WEBHOOK_SECRET || '';
// Курсы на этом же сервере сообщают о сданных ДЗ, проверках и сообщениях: POST ${PATH}/notify с
// заголовком X-Notify-Secret. Снаружи адрес закрыт дважды: nginx пропускает
// только точный ${PATH}, а сюда принимаются лишь запросы с 127.0.0.1.
const NOTIFY_SECRET = env.NOTIFY_SECRET || '';
const TICK_MS = 60 * 1000;

if (!env.TELEGRAM_BOT_TOKEN) console.error('TELEGRAM_BOT_TOKEN не задан — бот не сможет отвечать');
if (!SECRET) console.error('WEBHOOK_SECRET не задан — вебхук примет запрос от кого угодно');

const store = openStore(env.BOT_DB_PATH || 'bot.sqlite');
for (const id of (env.ADMIN_CHAT_IDS || '').split(',').map(s => Number(s.trim())).filter(Boolean)) {
  store.addAdmin(id, new Date().toISOString());
}
const tg = telegramClient(env.TELEGRAM_BOT_TOKEN);
const bot = createBot({ store, tg, adminCode: env.ADMIN_CODE || '' });

const equal = (given, expected) => {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};
const sameSecret = (given) => !SECRET || equal(given, SECRET);
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function readBody(req, limit, done) {
  let body = '';
  req.setEncoding('utf8');
  req.on('data', chunk => {
    body += chunk;
    if (body.length > limit) req.destroy();
  });
  req.on('end', () => done(body));
}

function notify(req, res) {
  const reply = (status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };
  // Без секрета адрес выключен: иначе любой процесс на сервере слал бы Екатерине что угодно.
  if (!NOTIFY_SECRET) return reply(503, { ok: false, error: 'NOTIFY_SECRET не задан' });
  if (!LOOPBACK.has(req.socket.remoteAddress) || !equal(req.headers['x-notify-secret'], NOTIFY_SECRET)) {
    return reply(401, { ok: false });
  }
  readBody(req, 1e4, async body => {
    let event;
    try { event = JSON.parse(body); } catch { return reply(400, { ok: false, error: 'bad json' }); }
    try {
      const result = await bot.notifyCourse(event);
      reply(result.ok ? 200 : 400, result);
    } catch (error) {
      console.error('Уведомление из курса:', error);
      reply(500, { ok: false });
    }
  });
}

const server = createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (req.method === 'GET' && url === `${PATH}/health`) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, ...store.stats() }));
  }
  if (req.method === 'POST' && url === `${PATH}/notify`) return notify(req, res);
  if (req.method !== 'POST' || url !== PATH) {
    res.writeHead(404);
    return res.end();
  }
  if (!sameSecret(req.headers['x-telegram-bot-api-secret-token'])) {
    res.writeHead(401);
    return res.end();
  }
  readBody(req, 1e6, body => {
    // Telegram ждёт быстрый ответ, иначе шлёт обновление повторно:
    // отвечаем сразу, обрабатываем после.
    res.writeHead(200);
    res.end();
    let update;
    try { update = JSON.parse(body); } catch { return; }
    bot.handleUpdate(update).catch(error => console.error('Обработка обновления:', error));
  });
});

let ticking = false;
setInterval(async () => {
  if (ticking) return; // прошлый проход ещё идёт (медленный Telegram)
  ticking = true;
  try {
    const sent = await bot.tick();
    if (sent) console.log(`Серия: отправлено ${sent}`);
  } catch (error) {
    console.error('Рассылка серии:', error);
  } finally {
    ticking = false;
  }
}, TICK_MS).unref();

server.listen(PORT, HOST, async () => {
  console.log(`Бот слушает http://${HOST}:${PORT}${PATH}`);
  if (env.PUBLIC_URL && env.TELEGRAM_BOT_TOKEN) {
    const res = await tg('setWebhook', {
      url: env.PUBLIC_URL,
      secret_token: SECRET || undefined,
      allowed_updates: ['message', 'callback_query'],
    });
    console.log(res.ok ? `Вебхук: ${env.PUBLIC_URL}` : `Вебхук не установлен: ${res.description}`);
  }
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => server.close(() => { store.db.close(); process.exit(0); }));
}
