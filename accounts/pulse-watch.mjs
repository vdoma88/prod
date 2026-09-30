// Телеметрия лендинга — в Telegram через бота лендинга (bot/, «Уведомления
// из курсов»): сводка за сутки в 10:00 МСК и сразу — о новой поломке
// (ошибка скрипта, не загрузившийся файл, нарушение CSP), которой не было
// раньше. Одна и та же поломка приходит один раз, пока не пропадёт на 30 дней.
//
// Бот сам знает, кому писать, и держит токен; здесь только внутренний адрес
// и секрет (ROD_NOTIFY_URL, ROD_NOTIFY_SECRET). Без секрета оповещения выключены.

const HOUR = 3600e3;
const MSK = 3 * HOUR;
const DIGEST_HOUR = 10;
const MAX_IN_ALERT = 5;
const FORGET_DAYS = 30;

const sec = (ms) => (ms == null ? '—' : (ms / 1000).toFixed(1).replace('.', ',') + ' с');
const quote = (s, n = 90) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const who = (r) => (r.platform === 'iPhone' || r.platform === 'iPad') ? `${r.platform} ${r.os} ${r.browser}` : `${r.platform} ${r.browser}`;

const SITE_NAMES = { '': 'лендинг', rod: 'Связь с Родом', plamya: 'Язык Пламени', taro: 'Таро', runes: 'Руны' };
const siteName = (host) => (host ? SITE_NAMES[host.split('.')[0]] ?? host : SITE_NAMES['']);

// Строки сводки за сутки из pulse.summary(1).
export function digestLines(s) {
  if (!s.platforms.length) return ['Визитов не было — или телеметрия не доходит. Проверьте: откройте belayarod.ru с телефона.'];
  const total = s.platforms.reduce((n, p) => n + p.visits, 0);
  const lines = [`Визитов: ${total} · ${s.platforms.map(p => `${p.platform} ${p.visits}`).join(', ')}`];
  if ((s.sites || []).some(x => x.site)) lines.push(`По сайтам: ${s.sites.map(x => `${siteName(x.site)} ${x.visits}`).join(', ')}`);
  for (const p of s.platforms) {
    if (p.platform !== 'iPhone' && p.platform !== 'iPad') continue;
    const extra = [p.leftEarly ? `ушли до загрузки: ${p.leftEarly}` : '', p.noStorage ? `без хранилища: ${p.noStorage}` : ''].filter(Boolean).join('; ');
    lines.push(`${p.platform}: загрузка ${sec(p.medianMs)}, у 90% — до ${sec(p.p90Ms)}${extra ? '; ' + extra : ''}`);
  }
  const others = s.platforms.filter(p => p.platform !== 'iPhone' && p.platform !== 'iPad' && p.leftEarly);
  if (others.length) lines.push(`Ушли до загрузки: ${others.map(p => `${p.platform} ${p.leftEarly}`).join(', ')}`);
  const group = (title, items, fmt) => lines.push(items.length ? `${title}: ${items.length} · ${fmt(items[0])}${items.length > 1 ? ' и др.' : ''}` : `${title}: нет`);
  group('Ошибки скриптов', s.errors, i => `«${quote(i.key, 70)}» ×${i.count}`);
  group('Не загрузились файлы', s.broken, i => `${i.key.replace(/^https:\/\/belayarod\.ru/, '')} ×${i.count}`);
  group('Нарушения CSP', s.csp, i => `${quote(i.key, 70)} ×${i.count}`);
  const steps = {};
  for (const i of s.steps) {
    const [name, info = ''] = i.key.split(': ');
    const st = steps[name] ||= { all: 0, bad: 0 };
    st.all += i.count;
    if ((name === 'telegram' && info === 'copy-fail') || (name === 'copy' && info === 'fail') || (name === 'drum' && !info.startsWith('running'))) st.bad += i.count;
  }
  const step = (name, title, bad) => steps[name] ? `${title} ${steps[name].all}${steps[name].bad ? ` (${bad} ${steps[name].bad})` : ''}` : '';
  const flow = [step('dialog', 'окно заявки', ''), step('telegram', 'Telegram', 'текст не скопировался'), step('copy', 'копирование', 'не удалось'), step('drum', 'бубен', 'не заиграл')].filter(Boolean);
  lines.push(flow.length ? `Заявка и бубен: ${flow.join(', ')}` : 'Заявку и бубен никто не открывал');
  return lines;
}

// Ключ поломки и признак «наша»: чужие скрипты (расширения браузера,
// «Script error.» без подробностей) и чужие файлы не оповещают.
export function problemKey(r, origin) {
  const d = r.data;
  // Наши адреса — сам сайт и курсы на его поддоменах; адрес лендинга короче: «/app.js».
  const host = new URL(origin).hostname.replace(/\./g, '\\.');
  const ours = (u) => new RegExp(`^https?://([a-z0-9-]+\\.)*${host}/`).test(String(u || ''));
  const path = (u) => String(u || '').replace(origin, '').replace(/^https?:\/\//, '');
  if (r.kind === 'broken') return ours(d.url) ? { key: 'b ' + path(d.url), text: `Не загрузился файл ${path(d.url)}` } : null;
  if (r.kind === 'csp') return { key: `c ${d.dir} ${d.uri}`, text: `Нарушение CSP: ${d.dir} ${quote(d.uri, 80)}` };
  if (!d.msg || /^Script error\.?$/i.test(d.msg)) return null;
  if (d.src && !ours(d.src)) return null;
  const where = d.src ? ` (${path(d.src)}:${d.line})` : '';
  return { key: `e ${d.msg}|${path(d.src)}:${d.line}`, text: `Ошибка «${quote(d.msg)}»${where}` };
}

export function openWatch({ db, pulse, send, origin = 'https://belayarod.ru', now = () => new Date() }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pulse_seen (key TEXT PRIMARY KEY, last_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS pulse_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  const getMeta = db.prepare('SELECT value FROM pulse_meta WHERE key = ?');
  const setMeta = db.prepare('INSERT INTO pulse_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const seen = db.prepare('SELECT 1 FROM pulse_seen WHERE key = ?');
  const touch = db.prepare('INSERT INTO pulse_seen (key, last_at) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET last_at = excluded.last_at');
  const forget = db.prepare('DELETE FROM pulse_seen WHERE last_at < ?');
  const meta = (k) => getMeta.get(k)?.value;
  const account = `${origin}/account/`;

  // Новые поломки после прошлой проверки. При первом запуске всё, что было
  // за последние дни, считается уже известным — чтобы не прислать пачку старого.
  async function alerts() {
    const at = now().toISOString();
    let since = meta('alerts_since');
    if (!since) {
      for (const r of pulse.rowsAfter(new Date(now().getTime() - 7 * 24 * HOUR).toISOString())) {
        const p = problemKey(r, origin);
        if (p) touch.run(p.key, r.at);
      }
      setMeta.run('alerts_since', at);
      return 0;
    }
    forget.run(new Date(now().getTime() - FORGET_DAYS * 24 * HOUR).toISOString());
    const rows = pulse.rowsAfter(since);
    const fresh = new Map();
    for (const r of rows) {
      const p = problemKey(r, origin);
      if (!p) continue;
      if (!seen.get(p.key) && !fresh.has(p.key)) fresh.set(p.key, { ...p, who: new Set(), path: r.path });
      fresh.get(p.key)?.who.add(who(r));
    }
    const last = rows.length ? rows[rows.length - 1].at : since;
    if (!fresh.size) {
      for (const r of rows) { const p = problemKey(r, origin); if (p) touch.run(p.key, r.at); }
      setMeta.run('alerts_since', last);
      return 0;
    }
    const list = [...fresh.values()];
    const lines = list.slice(0, MAX_IN_ALERT).flatMap(p => [p.text, `   ${[...p.who].slice(0, 3).join(', ')} · ${p.path}`]);
    if (list.length > MAX_IN_ALERT) lines.push(`…и ещё ${list.length - MAX_IN_ALERT}`);
    if (!(await send({ site: 'alert', lines, url: account }))) return 0; // бот недоступен — повторим в следующий раз
    for (const r of rows) { const p = problemKey(r, origin); if (p) touch.run(p.key, r.at); }
    setMeta.run('alerts_since', last);
    return list.length;
  }

  // Сводка за сутки — один раз в день, после 10:00 МСК.
  async function digest() {
    const msk = new Date(now().getTime() + MSK);
    if (msk.getUTCHours() < DIGEST_HOUR) return false;
    const day = msk.toISOString().slice(0, 10);
    if (meta('digest_day') === day) return false;
    if (!(await send({ site: 'digest', lines: digestLines(pulse.summary(1)), url: account }))) return false;
    setMeta.run('digest_day', day);
    return true;
  }

  return { alerts, digest, tick: async () => ({ alerts: await alerts(), digest: await digest() }) };
}

// Отправка в бота лендинга (POST /tg/rod-bot/notify). true — бот принял.
export function botSender({ url, secret, fetchImpl = fetch }) {
  return async (event) => {
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Notify-Secret': secret },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(40000),
      });
      if (!res.ok) console.error(`[pulse] бот ответил ${res.status}`);
      return res.ok;
    } catch (error) {
      console.error('[pulse] бот недоступен:', error.message);
      return false;
    }
  };
}
