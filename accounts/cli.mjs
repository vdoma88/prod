// Консоль общего входа (на сервере — от пользователя службы):
//   node accounts/cli.mjs create-admin почта "Имя"   — первый администратор + ссылка для пароля
//   node accounts/cli.mjs reset-link почта            — новая ссылка для пароля
//   node accounts/cli.mjs pulse [дней]                — телеметрия лендинга (по умолчанию 7 дней)
// Берёт ACCOUNTS_DB_PATH и PUBLIC_ORIGIN, что и служба.
import { openStore } from './store.mjs';
import { openPulse, summaryText } from './pulse.mjs';

const [cmd, email, name] = process.argv.slice(2);
const store = openStore(process.env.ACCOUNTS_DB_PATH || 'accounts.sqlite');
const origin = String(process.env.PUBLIC_ORIGIN || 'http://127.0.0.1:4320').replace(/\/$/, '');
const link = (id) => `${origin}/account/#reset=${store.createReset(id, 'cli').token}`;
try {
  if (cmd === 'create-admin' && email && name) {
    const u = store.userByEmail(email) || store.createUser({ email, name, role: 'admin' }, 'cli');
    if (u.role !== 'admin') store.updateUser(u.id, { role: 'admin' }, 'cli');
    console.log(`Администратор: ${u.email}\nСсылка для пароля (72 часа, один раз):\n  ${link(u.id)}`);
  } else if (cmd === 'reset-link' && email) {
    const u = store.userByEmail(email);
    if (!u) throw new Error('Нет такой почты.');
    console.log(`Ссылка для пароля (72 часа, один раз):\n  ${link(u.id)}`);
  } else if (cmd === 'pulse') {
    console.log(summaryText(openPulse(store.db).summary(Math.min(30, Math.max(1, Number(email) || 7)))));
  } else {
    console.log('node accounts/cli.mjs create-admin почта "Имя"\nnode accounts/cli.mjs reset-link почта\nnode accounts/cli.mjs pulse [дней]');
    process.exitCode = 2;
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
