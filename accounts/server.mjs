// Общий вход «Сила Рода»: node accounts/server.mjs (Node ≥ 22.13, без npm install).
// Настройки — accounts/README.md; на сервере — /etc/sr-accounts.env и служба
// systemd «sr-accounts» (infra/vps/15-accounts.sh).
import { createServer } from 'node:http';
import { openStore } from './store.mjs';
import { createApp } from './app.mjs';
import { openPulse } from './pulse.mjs';
import { openWatch, botSender } from './pulse-watch.mjs';

const env = process.env;
const store = openStore(env.ACCOUNTS_DB_PATH || 'accounts.sqlite');
const pulse = openPulse(store.db);
const handle = createApp({ store, pulse, env });
const server = createServer((req, res) => { handle(req, res); });
server.headersTimeout = 15000;
server.requestTimeout = 30000;
const port = Number(env.PORT || 4320), host = env.HOST || '127.0.0.1';
setInterval(() => { store.cleanup(); pulse.cleanup(); }, 3600e3).unref();
// Телеметрия в Telegram через бота лендинга (pulse-watch.mjs): без секрета выключено.
if (env.ROD_NOTIFY_SECRET) {
  const watch = openWatch({
    db: store.db, pulse, origin: String(env.PUBLIC_ORIGIN || 'https://belayarod.ru').replace(/\/$/, ''),
    send: botSender({ url: env.ROD_NOTIFY_URL || 'http://127.0.0.1:4310/tg/rod-bot/notify', secret: env.ROD_NOTIFY_SECRET }),
  });
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    try { await watch.tick(); } catch (error) { console.error('[pulse] оповещения:', error); } finally { busy = false; }
  };
  setTimeout(run, 60e3).unref();
  setInterval(run, 5 * 60e3).unref();
} else console.log('Телеметрия в Telegram выключена: нет ROD_NOTIFY_SECRET');
server.listen(port, host, () => console.log(`Общий вход: http://${host}:${port}/account/`));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => { store.db.close(); process.exit(0); }));
