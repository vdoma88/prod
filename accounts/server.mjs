// Общий вход «Сила Рода»: node accounts/server.mjs (Node ≥ 22.13, без npm install).
// Настройки — accounts/README.md; на сервере — /etc/sr-accounts.env и служба
// systemd «sr-accounts» (infra/vps/15-accounts.sh).
import { createServer } from 'node:http';
import { openStore } from './store.mjs';
import { createApp } from './app.mjs';

const env = process.env;
const store = openStore(env.ACCOUNTS_DB_PATH || 'accounts.sqlite');
const handle = createApp({ store, env });
const server = createServer((req, res) => { handle(req, res); });
server.headersTimeout = 15000;
server.requestTimeout = 30000;
const port = Number(env.PORT || 4320), host = env.HOST || '127.0.0.1';
setInterval(() => store.cleanup(), 3600e3).unref();
server.listen(port, host, () => console.log(`Общий вход: http://${host}:${port}/account/`));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => { store.db.close(); process.exit(0); }));
