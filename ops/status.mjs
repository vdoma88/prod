// Состояние сервера для пульта в Telegram (ops/README.md).
//
// collectStatus() опрашивает службы, сайты, свежесть резервных копий,
// очереди на проверку и диск с памятью — только чтение. packStatus()
// укладывает результат в состояние виджета: JSON не длиннее 1024 байт
// (столько Telegram хранит в chatData сообщения).
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Службы: имя на пульте → systemd-юнит. Не установленные пропускаются. */
export const SERVICES = [
  ['Школа', 'flame-school'],
  ['Род', 'rodology'],
  ['Кабинет', 'sr-accounts'],
  ['Руны', 'runes'],
  ['Таро', 'polkas'],
  ['Бот', 'rodbot'],
  ['nginx', 'nginx'],
  ['База', 'postgresql'],
];

/** Резервные копии: имя на пульте → префикс архива в /root/sr-backups. */
export const BACKUPS = [
  ['Род', 'rod-'],
  ['Школа', 'flame-'],
  ['Кабинет', 'hub-'],
  ['Руны', 'runes-'],
  ['Таро', 'taro-'],
];

/** Копия старше этого — уже тревога (копии идут в 8:00 и 23:00 МСК: промежуток до 15 ч). */
export const BACKUP_STALE_HOURS = 16;

const run = (cmd, args, opts = {}) => new Promise((resolve) => {
  execFile(cmd, args, { timeout: 15000, maxBuffer: 1 << 20, ...opts }, (error, stdout) => {
    resolve(error ? null : String(stdout).trim());
  });
});

/** Имя базы из адреса postgres://…/имя?… */
export function dbNameOf(url) {
  const m = /^postgres(?:ql)?:\/\/[^/]*\/([^?#]+)/.exec(String(url || '').trim().replace(/^["']|["']$/g, ''));
  return m && /^[A-Za-z0-9_]+$/.test(m[1]) ? m[1] : null;
}

/** Значение из файла KEY=VALUE (без выполнения файла). */
export function envValue(file, key, { readFile = fs.readFileSync } = {}) {
  try {
    for (const line of String(readFile(file, 'utf8')).split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m && m[1] === key) return m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch {}
  return null;
}

/** Самая свежая копия с префиксом: { hours, size } или null. */
export function latestBackup(dir, prefix, { now = Date.now(), readdir = fs.readdirSync, stat = fs.statSync } = {}) {
  let best = null;
  let names = [];
  try { names = readdir(dir); } catch { return null; }
  for (const name of names) {
    if (!name.startsWith(prefix) || !/\.tar\.gz(\.enc)?$/.test(name)) continue;
    try {
      const st = stat(path.join(dir, name));
      if (!best || st.mtimeMs > best.mtimeMs) best = { mtimeMs: st.mtimeMs, size: st.size };
    } catch {}
  }
  return best ? { hours: Math.max(0, Math.round((now - best.mtimeMs) / 36e5 * 10) / 10), size: best.size } : null;
}

/** Число из запроса к базе от имени postgres; null — базы или таблицы нет. */
async function pgCount(db, sql, runImpl) {
  if (!db) return null;
  const out = await runImpl('runuser', ['-u', 'postgres', '--', 'psql', '-XAtq', '-d', db, '-c', sql]);
  return out != null && /^\d+$/.test(out) ? Number(out) : null;
}

/**
 * Ученицы онлайн по служебному адресу курса на этом сервере (тот же, что
 * опрашивает общий вход): число и имена; null — курс не отвечает или секрет
 * ему не выдан (Род отдаёт список только при SR_INTERNAL_SECRET в своём .env).
 */
async function onlineOf(url, secret, fetchImpl) {
  if (!secret) return null;
  try {
    const res = await fetchImpl(url, { headers: { 'X-SR-Secret': secret }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const body = await res.json();
    if (!Array.isArray(body?.online)) return null;
    return body.online.map((x) => String(x?.name || '').trim().split(/\s+/)[0]).filter(Boolean);
  } catch {
    return null;
  }
}

async function httpCode(url, fetchImpl) {
  try {
    const res = await fetchImpl(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(8000) });
    return res.status;
  } catch {
    return 0;
  }
}

/**
 * Полный опрос. Всё внешнее можно подменить — так это проверяют тесты.
 * @returns {Promise<object>} подробное состояние (packStatus сжимает его для виджета)
 */
export async function collectStatus({
  runImpl = run, fetchImpl = fetch, now = Date.now(),
  backupDir = '/root/sr-backups', domain = 'belayarod.ru',
  flameEnv = '/var/www/flame-app/.env.local', readFile = fs.readFileSync,
  readdir = fs.readdirSync, stat = fs.statSync, loadavg = os.loadavg(), cpus = os.cpus().length,
  meminfo = null, disk = null, internalSecret = '',
} = {}) {
  const services = [];
  for (const [name, unit] of SERVICES) {
    const state = await runImpl('systemctl', ['is-active', unit]);
    const known = await runImpl('systemctl', ['cat', unit]);
    if (known == null && state !== 'active') continue; // не установлена
    services.push({ name, unit, ok: state === 'active' });
  }

  const sites = [];
  for (const [name, url] of [
    ['Лендинг', `https://${domain}/`],
    ['Школа', `https://plamya.${domain}/`],
    ['Род', `https://rod.${domain}/api/health`],
  ]) {
    const code = await httpCode(url, fetchImpl);
    sites.push({ name, code, ok: code >= 200 && code < 400 });
  }

  const backups = BACKUPS.map(([name, prefix]) => {
    const b = latestBackup(backupDir, prefix, { now, readdir, stat });
    return { name, hours: b ? b.hours : null, ok: !!b && b.hours <= BACKUP_STALE_HOURS };
  });

  const flameDb = dbNameOf(envValue(flameEnv, 'DATABASE_URL', { readFile })) || 'flame_db';
  const queues = {
    rod: await pgCount('rodology', `SELECT count(*) FROM "ClientStep" WHERE status = 'PENDING'`, runImpl),
    homework: await pgCount(flameDb, `SELECT count(*) FROM homework_submissions WHERE status = 'pending'`, runImpl),
    casting: await pgCount(flameDb, `SELECT count(*) FROM casting_requests WHERE status = 'new'`, runImpl),
  };

  const online = {
    plamya: await onlineOf('http://127.0.0.1:3000/sr-internal/online', internalSecret, fetchImpl),
    rod: await onlineOf('http://127.0.0.1:5000/sr-internal/online', internalSecret, fetchImpl),
  };

  const df = disk ?? await runImpl('df', ['-P', '/']);
  const diskPct = df ? Number((/(\d+)%\s+\/\s*$/m.exec(df) || [])[1]) || null : null;
  const mi = meminfo ?? (() => { try { return readFile('/proc/meminfo', 'utf8'); } catch { return ''; } })();
  const kb = (k) => Number((new RegExp(`^${k}:\\s+(\\d+)`, 'm').exec(mi) || [])[1]) || 0;
  const memPct = kb('MemTotal') ? Math.round((1 - kb('MemAvailable') / kb('MemTotal')) * 100) : null;

  return {
    at: now, domain, services, sites, backups, queues, online,
    disk: diskPct, mem: memPct, load: Math.round((loadavg[0] / Math.max(1, cpus)) * 100),
  };
}

/** Часы и минуты по Москве. */
export const mskTime = (ms) => new Date(ms + 3 * 36e5).toISOString().slice(11, 16);

/**
 * Состояние для виджета (chatData): короткие ключи, не длиннее 1024 байт.
 *   t — время опроса (МСК), d — домен для ссылок,
 *   s — [[имя, 1|0]] службы и сайты, b — [[имя, часов|null, 1|0]] копии,
 *   q — [Род на проверке, ДЗ школы, отливки] (null — не узнать),
 *   o — [онлайн в школе, в Роде] (null — курс не сказал),
 *   m — [диск %, память %, нагрузка %], a — сколько всего тревог.
 */
export function packStatus(st) {
  const s = [
    ...st.services.map((x) => [x.name, x.ok ? 1 : 0]),
    ...st.sites.map((x) => [`${x.name} · сайт`, x.ok ? 1 : 0]),
  ];
  const b = st.backups.map((x) => [x.name, x.hours, x.ok ? 1 : 0]);
  const m = [st.disk, st.mem, st.load];
  const alarms = s.filter((x) => !x[1]).length + b.filter((x) => !x[2]).length
    + (st.disk != null && st.disk >= 90 ? 1 : 0) + (st.mem != null && st.mem >= 95 ? 1 : 0);
  const packed = { t: mskTime(st.at), d: st.domain, s, b, q: [st.queues.rod, st.queues.homework, st.queues.casting], o: [st.online?.plamya?.length ?? null, st.online?.rod?.length ?? null], m, a: alarms };
  let text = JSON.stringify(packed);
  // На всякий случай: длинные имена укорачиваем, пока не влезет
  while (Buffer.byteLength(text) > 1024 && packed.s.some((x) => x[0].length > 4)) {
    packed.s = packed.s.map((x) => [x[0].slice(0, Math.max(4, x[0].length - 2)), x[1]]);
    text = JSON.stringify(packed);
  }
  return text;
}

/** Короткая сводка тревог текстом — для уведомления, когда что-то сломалось. */
export function alarmsOf(st) {
  const out = [];
  for (const x of st.services) if (!x.ok) out.push(`служба «${x.name}» не работает`);
  for (const x of st.sites) if (!x.ok) out.push(`сайт «${x.name}» отвечает ${x.code || 'ничем'}`);
  for (const x of st.backups) if (!x.ok) out.push(x.hours == null ? `нет копии «${x.name}»` : `копия «${x.name}» старая: ${Math.round(x.hours)} ч`);
  if (st.disk != null && st.disk >= 90) out.push(`диск занят на ${st.disk}%`);
  if (st.mem != null && st.mem >= 95) out.push(`память занята на ${st.mem}%`);
  return out;
}

/** Та же сводка обычным текстом — для команды /status и клиентов без виджетов. */
export function statusText(st) {
  const dot = (ok) => (ok ? '🟢' : '🔴');
  const alarms = alarmsOf(st);
  const q = st.queues;
  const n = (v) => (v == null ? '—' : String(v));
  const who = (list) => (list == null ? '—' : list.length ? `${list.length} (${list.slice(0, 5).join(', ')}${list.length > 5 ? '…' : ''})` : '0');
  return [
    `${alarms.length ? `🔴 Тревог: ${alarms.length}` : '🟢 Всё в порядке'} · ${mskTime(st.at)} МСК`,
    '',
    'Службы: ' + st.services.map((x) => `${dot(x.ok)} ${x.name}`).join('  '),
    'Сайты: ' + st.sites.map((x) => `${dot(x.ok)} ${x.name}`).join('  '),
    'Копии: ' + st.backups.map((x) => `${dot(x.ok)} ${x.name} ${x.hours == null ? 'нет' : `${Math.round(x.hours)} ч`}`).join('  '),
    `Ждут проверки: Род ${n(q.rod)} · ДЗ школы ${n(q.homework)} · отливки ${n(q.casting)}`,
    `Онлайн: школа ${who(st.online?.plamya)} · Род ${who(st.online?.rod)}`,
    `Диск ${n(st.disk)}% · память ${n(st.mem)}% · нагрузка ${n(st.load)}%`,
    ...(alarms.length ? ['', ...alarms.map((a) => `• ${a}`)] : []),
  ].join('\n');
}
