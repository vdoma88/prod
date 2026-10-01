// Доступность сайтов «Сила Рода»: лендинг, общий вход и курсы на поддоменах.
//
// Служба входа раз в 5 минут (вместе с телеметрией, pulse-watch.mjs) открывает
// публичные адреса так же, как ученица, — через nginx и настоящий TLS — и пишет
// в Telegram через бота лендинга:
//   🔴 «не отвечает» — после двух неудач подряд (≈10 минут), чтобы разовый
//      сбой сети не будил;
//   🟢 «снова работает» — с длительностью простоя;
//   сертификат истекает меньше чем через 14 дней — раз в сутки.
// В утренней сводке — строка «Доступность» за сутки.
//
// Если ляжет весь сервер, отсюда никто не напишет: на этот случай нужна
// проверка снаружи: .github/workflows/uptime-outside.yml (infra/DEPLOY.md).
import tls from 'node:tls';

export const DEFAULT_TARGETS = [
  { name: 'лендинг', url: 'https://belayarod.ru/' },
  { name: 'общий вход', url: 'https://belayarod.ru/account/' },
  { name: 'Связь с Родом', url: 'https://rod.belayarod.ru/' },
  { name: 'Язык Пламени', url: 'https://plamya.belayarod.ru/' },
  { name: 'Таро', url: 'https://taro.belayarod.ru/' },
  { name: 'Руны', url: 'https://runes.belayarod.ru/' },
];
const FAILS_TO_ALERT = 2;
const CERT_WARN_DAYS = 14;
const KEEP_DAYS = 30;
const DAY = 864e5;

// UPTIME_TARGETS="Имя=https://…,Имя2=https://…" заменяет список целиком; «off» выключает.
export function parseTargets(value) {
  if (!value) return DEFAULT_TARGETS;
  if (value.trim() === 'off') return [];
  return value.split(',').map(s => s.trim()).filter(Boolean).map(s => {
    const i = s.indexOf('=');
    return i > 0 ? { name: s.slice(0, i).trim(), url: s.slice(i + 1).trim() } : { name: s, url: s };
  }).filter(t => /^https?:\/\//.test(t.url));
}

// Один заход: код ответа < 400 за 20 секунд. Перенаправления проходят до конца.
export async function probe(url, fetchImpl = fetch) {
  const started = Date.now();
  try {
    const res = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'sila-roda-uptime' } });
    await res.arrayBuffer().catch(() => {});
    return { ok: res.status < 400, status: res.status, ms: Date.now() - started };
  } catch (error) {
    return { ok: false, status: 0, ms: Date.now() - started, error: String(error?.cause?.code || error?.name || error?.message || error) };
  }
}

// Дата окончания сертификата хоста (по имени из SNI) или null.
export function certExpiry(host, port = 443) {
  return new Promise((resolve) => {
    const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: false, timeout: 15000 }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      resolve(cert?.valid_to ? new Date(cert.valid_to) : null);
    });
    socket.on('error', () => resolve(null));
    socket.on('timeout', () => { socket.destroy(); resolve(null); });
  });
}

const minutes = (ms) => {
  const m = Math.max(1, Math.round(ms / 60e3));
  return m < 60 ? `${m} мин` : `${Math.floor(m / 60)} ч ${m % 60} мин`;
};

export function openUptime({ db, send, targets = DEFAULT_TARGETS, now = () => new Date(), fetchImpl = fetch, certImpl = certExpiry, origin = 'https://belayarod.ru' }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS uptime_log (at TEXT NOT NULL, target TEXT NOT NULL, ok INTEGER NOT NULL, status INTEGER, ms INTEGER, error TEXT);
    CREATE INDEX IF NOT EXISTS uptime_log_at ON uptime_log(at);
    CREATE TABLE IF NOT EXISTS uptime_state (target TEXT PRIMARY KEY, fails INTEGER NOT NULL, down_since TEXT, alerted INTEGER NOT NULL DEFAULT 0, cert_day TEXT);
  `);
  const log = db.prepare('INSERT INTO uptime_log (at, target, ok, status, ms, error) VALUES (?, ?, ?, ?, ?, ?)');
  const getState = db.prepare('SELECT * FROM uptime_state WHERE target = ?');
  const putState = db.prepare(`INSERT INTO uptime_state (target, fails, down_since, alerted, cert_day) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(target) DO UPDATE SET fails = excluded.fails, down_since = excluded.down_since, alerted = excluded.alerted, cert_day = excluded.cert_day`);
  const since = db.prepare('SELECT target, ok, at FROM uptime_log WHERE at >= ? ORDER BY at');
  const drop = db.prepare('DELETE FROM uptime_log WHERE at < ?');
  const account = `${origin}/account/`;

  async function checkOne(t) {
    const at = now();
    const r = await probe(t.url, fetchImpl);
    log.run(at.toISOString(), t.name, r.ok ? 1 : 0, r.status, r.ms, r.error || null);
    const s = getState.get(t.name) || { fails: 0, down_since: null, alerted: 0, cert_day: null };
    const what = r.status ? `код ${r.status}` : `нет ответа${r.error ? ` (${r.error})` : ''}`;
    if (!r.ok) {
      const fails = s.fails + 1;
      const downSince = s.down_since || at.toISOString();
      let alerted = s.alerted;
      if (!alerted && fails >= FAILS_TO_ALERT) {
        alerted = (await send({ site: 'down', lines: [`${t.name} — ${t.url.replace(/^https:\/\//, '')}`, `${what}, не отвечает ${minutes(at - new Date(downSince))}`], url: account })) ? 1 : 0;
      }
      putState.run(t.name, fails, downSince, alerted, s.cert_day);
      return;
    }
    if (s.alerted && s.down_since) {
      // Не дошло — повторим на следующем заходе: состояние «лежал» остаётся.
      if (!(await send({ site: 'up', lines: [`${t.name} — ${t.url.replace(/^https:\/\//, '')}`, `простой ${minutes(at - new Date(s.down_since))}`], url: account }))) return;
    }
    putState.run(t.name, 0, null, 0, s.cert_day);
  }

  // Сертификаты — раз в сутки на хост; предупреждение, если меньше 14 дней.
  async function checkCerts() {
    const day = now().toISOString().slice(0, 10);
    const hosts = [...new Set(targets.filter(t => t.url.startsWith('https://')).map(t => new URL(t.url).hostname))];
    for (const host of hosts) {
      const key = 'cert:' + host;
      const s = getState.get(key);
      if (s?.cert_day === day) continue;
      const until = await certImpl(host);
      if (until) {
        const days = Math.floor((until - now()) / DAY);
        if (days < CERT_WARN_DAYS) {
          const sent = await send({ site: 'cert', lines: [`Сертификат ${host}`, days < 0 ? 'истёк — браузеры не откроют сайт' : `истекает через ${days} дн. (${until.toISOString().slice(0, 10)}) — проверьте certbot`], url: account });
          if (!sent) continue;
        }
      }
      putState.run(key, 0, null, 0, day);
    }
  }

  async function tick() {
    for (const t of targets) await checkOne(t);
    await checkCerts();
    drop.run(new Date(now().getTime() - KEEP_DAYS * DAY).toISOString());
  }

  // Строка для утренней сводки: сбои за сутки по сайтам.
  function digestLines() {
    if (!targets.length) return [];
    const rows = since.all(new Date(now().getTime() - DAY).toISOString());
    if (!rows.length) return ['Доступность: проверок не было'];
    const bad = {};
    for (const r of rows) if (!r.ok) bad[r.target] = (bad[r.target] || 0) + 1;
    const names = Object.keys(bad);
    if (!names.length) return [`Доступность: все сайты (${targets.length}) отвечали весь день`];
    return [`Доступность: сбои — ${names.map(n => `${n} ${bad[n]}× (≈${bad[n] * 5} мин)`).join(', ')}`];
  }

  return { tick, digestLines };
}
