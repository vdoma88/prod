// Проверка доступности снаружи (.github/workflows/uptime-outside.yml).
//
// Служба входа на сервере сама следит за сайтами (accounts/uptime.mjs), но если
// ляжет весь сервер, она ляжет вместе с ним и ничего не пришлёт. Этот скрипт
// запускает GitHub раз в 3 часа с другой машины: те же адреса, повтор через
// минуту для тех, что не ответили. Не ответил и со второго раза — прогон
// красный, GitHub пишет на почту.
//
//   node scripts/uptime-outside.mjs
import { DEFAULT_TARGETS, probe } from '../accounts/uptime.mjs';

const RETRY_MS = Number(process.env.RETRY_MS ?? 60000);

const describe = (r) => (r.status ? `код ${r.status}` : `нет ответа${r.error ? ` (${r.error})` : ''}`);

let failed = DEFAULT_TARGETS;
for (const attempt of [1, 2]) {
  const results = await Promise.all(failed.map(async t => ({ t, r: await probe(t.url) })));
  for (const { t, r } of results) {
    console.log(`${r.ok ? '✓' : '✗'} ${t.name} — ${t.url} — ${r.ok ? `${r.status}, ${r.ms} мс` : describe(r)}${attempt === 2 ? ' (повтор)' : ''}`);
  }
  failed = results.filter(x => !x.r.ok).map(x => x.t);
  if (!failed.length || attempt === 2) break;
  console.log(`Повтор через ${RETRY_MS / 1000} с: ${failed.map(t => t.name).join(', ')}`);
  await new Promise(r => setTimeout(r, RETRY_MS));
}

if (failed.length) {
  console.log(`\n::error::Не отвечают: ${failed.map(t => `${t.name} (${t.url})`).join(', ')}`);
  process.exit(1);
}
console.log('\nВсе сайты отвечают.');
