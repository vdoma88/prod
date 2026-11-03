// Консоль общего входа (на сервере — от пользователя службы):
//   node accounts/cli.mjs create-admin почта "Имя"   — первый администратор + ссылка для пароля
//   node accounts/cli.mjs reset-link почта            — новая ссылка для пароля
//   node accounts/cli.mjs pulse [дней]                — телеметрия лендинга (по умолчанию 7 дней)
//   node accounts/cli.mjs import-rod < users.json     — учётки из «Связи с Родом» (зеркало, ноябрь 2026):
//       [{"email","name","role":"ADMIN"|"CLIENT"}]; заводит недостающих, открывает им курс rod.
//       Пароль не переносится — его при первом входе сверяет Род (ROD_PASSWORD_FALLBACK=1, app.mjs).
// Берёт ACCOUNTS_DB_PATH и PUBLIC_ORIGIN, что и служба.
import { openStore } from './store.mjs';
import { openPulse, summaryText } from './pulse.mjs';

const [cmd, email, name] = process.argv.slice(2);
const store = openStore(process.env.ACCOUNTS_DB_PATH || 'accounts.sqlite', { resetSecret: process.env.ACCOUNT_RESET_SECRET || '' });
const origin = String(process.env.PUBLIC_ORIGIN || 'http://127.0.0.1:4320').replace(/\/$/, '');
const link = (id) => { const reset = store.activeReset(id) || store.createReset(id, 'cli'); return `${origin}/account/#reset=${reset.token}`; };
try {
  if (cmd === 'create-admin' && email && name) {
    const u = store.userByEmail(email) || store.createUser({ email, name, role: 'admin' }, 'cli');
    if (u.role !== 'admin') store.updateUser(u.id, { role: 'admin' }, 'cli');
    console.log(`Администратор: ${u.email}\nСсылка для пароля (72 часа, один раз):\n  ${link(u.id)}`);
  } else if (cmd === 'reset-link' && email) {
    const u = store.userByEmail(email);
    if (!u) throw new Error('Нет такой почты.');
    console.log(`Ссылка для пароля (72 часа, один раз):\n  ${link(u.id)}`);
  } else if (cmd === 'import-rod') {
    const { readFileSync } = await import('node:fs');
    const list = JSON.parse(readFileSync(0, 'utf8') || '[]') || [];
    let created = 0, kept = 0, skipped = 0;
    for (const r of list) {
      const mail = String(r?.email || '').trim().toLowerCase();
      if (!mail || !mail.includes('@')) { skipped++; continue; }
      let u = store.userByEmail(mail);
      if (!u) {
        u = store.createUser({ email: mail, name: String(r.name || mail).slice(0, 120), role: r.role === 'ADMIN' ? 'admin' : 'student' }, 'cli');
        created++;
      } else kept++;
      store.updateUser(u.id, { courses: { rod: true } }, 'cli');
    }
    console.log(`Род → общий вход: заведено ${created}, уже были ${kept}, без почты пропущено ${skipped}.`);
  } else if (cmd === 'pulse') {
    console.log(summaryText(openPulse(store.db).summary(Math.min(30, Math.max(1, Number(email) || 7)))));
  } else {
    console.log('node accounts/cli.mjs create-admin почта "Имя"\nnode accounts/cli.mjs reset-link почта\nnode accounts/cli.mjs pulse [дней]\nnode accounts/cli.mjs import-rod < users.json');
    process.exitCode = 2;
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
