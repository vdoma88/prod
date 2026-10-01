// Телеметрия лендинга belayarod.ru: приём от brand/sr-pulse.js и сводка.
//
// Живёт в той же базе, что общий вход (отдельная таблица pulse), потому что
// это уже работающая служба за nginx на /account/ — новой службы и новых
// правил nginx не нужно. IP не хранится: он нужен только для ограничения
// частоты и остаётся в памяти процесса. Записи старше 30 дней удаляются.

const KEEP_DAYS = 30;
const KINDS = {
  view: { ttfb: 'n', dcl: 'n', load: 'n' },
  left: { state: 's' },
  error: { msg: 's', src: 's', line: 'n', col: 'n' },
  broken: { tag: 's', url: 's' },
  csp: { dir: 's', uri: 's', src: 's', line: 'n' },
  step: { name: 's', info: 's' },
};
const STEPS = new Set(['dialog', 'copy', 'telegram', 'drum']);
const ENV = { vw: 'n', vh: 'n', dpr: 'n', touch: 'b', standalone: 'b', storage: 's' };
const BOTS = /bot|crawl|spider|slurp|headless|lighthouse|preview|curl|wget|python|node-fetch|go-http/i;

const str = (v, n = 300) => String(v == null ? '' : v).slice(0, n);
const num = (v) => (Number.isFinite(v) ? Math.max(-1, Math.min(Math.round(v), 10 * 60e3)) : null);

function clean(src, shape) {
  const out = {};
  for (const [k, type] of Object.entries(shape)) {
    const v = src?.[k];
    if (type === 'n') out[k] = num(v);
    else if (type === 'b') out[k] = v === true;
    else out[k] = str(v);
  }
  return out;
}

// Устройство и браузер по строке браузера. iPad в Safari представляется
// компьютером Mac — его выдаёт сенсорный экран (env.touch от страницы).
export function device(ua, touch = false) {
  ua = String(ua || '');
  let m;
  if ((m = /\b(iPhone|iPad|iPod)\b.*? OS (\d+)[_.](\d+)/.exec(ua))) {
    return { platform: m[1] === 'iPad' ? 'iPad' : 'iPhone', os: `iOS ${m[2]}.${m[3]}`, browser: iosBrowser(ua) };
  }
  if (/Macintosh/.test(ua) && touch) {
    m = /Version\/(\d+)\.(\d+)/.exec(ua);
    return { platform: 'iPad', os: m ? `iOS ${m[1]}.${m[2]}` : 'iPadOS', browser: iosBrowser(ua) };
  }
  if ((m = /Android (\d+)/.exec(ua))) return { platform: 'Android', os: `Android ${m[1]}`, browser: otherBrowser(ua) };
  if (/Windows/.test(ua)) return { platform: 'компьютер', os: 'Windows', browser: otherBrowser(ua) };
  if (/Macintosh/.test(ua)) return { platform: 'компьютер', os: 'macOS', browser: otherBrowser(ua) };
  if (/Linux|CrOS/.test(ua)) return { platform: 'компьютер', os: 'Linux', browser: otherBrowser(ua) };
  return { platform: 'другое', os: 'другое', browser: otherBrowser(ua) };
}

function iosBrowser(ua) {
  if (/Instagram/.test(ua)) return 'Instagram';
  if (/FBAN|FBAV/.test(ua)) return 'Facebook';
  if (/VKClient|vkclient/.test(ua)) return 'VK';
  if (/YaBrowser/.test(ua)) return 'Яндекс';
  if (/CriOS/.test(ua)) return 'Chrome';
  if (/FxiOS/.test(ua)) return 'Firefox';
  if (/EdgiOS/.test(ua)) return 'Edge';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'встроенный';
}

function otherBrowser(ua) {
  if (/YaBrowser/.test(ua)) return 'Яндекс';
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\//.test(ua)) return 'Opera';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/SamsungBrowser/.test(ua)) return 'Samsung';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'другой';
}

// Разбор тела от pulse.js. Всё лишнее отбрасывается, длины и числа обрезаются.
export function parseBatch(body) {
  if (!body || body.v !== 1 || typeof body.id !== 'string' || !/^[0-9a-f]{16}$/.test(body.id)) return null;
  const path = str(body.path, 200);
  if (!path.startsWith('/')) return null;
  const events = [];
  for (const e of Array.isArray(body.ev) ? body.ev.slice(0, 40) : []) {
    const shape = KINDS[e?.k];
    if (!shape) continue;
    const data = clean(e, shape);
    if (e.k === 'step' && !STEPS.has(data.name)) continue;
    events.push({ kind: e.k, t: num(e.t), data });
  }
  if (!events.length) return null;
  return { id: body.id, path, env: body.env ? clean(body.env, ENV) : null, events };
}

// Сайт визита: путь лендинга начинается с «/», у курсов — с их поддомена.
export const siteOf = (path) => (String(path).startsWith('/') ? '' : String(path).split('/')[0]);

const pct = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

export function openPulse(db, { now = () => new Date() } = {}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pulse (
      at TEXT NOT NULL,
      visit TEXT NOT NULL,
      path TEXT NOT NULL,
      kind TEXT NOT NULL,
      t INTEGER,
      data TEXT NOT NULL,
      platform TEXT NOT NULL,
      os TEXT NOT NULL,
      browser TEXT NOT NULL,
      env TEXT
    );
    CREATE INDEX IF NOT EXISTS pulse_at ON pulse(at);
  `);
  const insert = db.prepare('INSERT INTO pulse (at, visit, path, kind, t, data, platform, os, browser, env) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const since = db.prepare('SELECT * FROM pulse WHERE at >= ? ORDER BY at');
  const drop = db.prepare('DELETE FROM pulse WHERE at < ?');
  const ago = (days) => new Date(now().getTime() - days * 864e5).toISOString();

  // Возвращает число записанных событий (0 — роботы и пустые пачки).
  function add(batch, ua) {
    if (!batch || BOTS.test(String(ua || ''))) return 0;
    const d = device(ua, batch.env?.touch);
    const at = now().toISOString();
    const env = batch.env ? JSON.stringify(batch.env) : null;
    for (const e of batch.events) insert.run(at, batch.id, batch.path, e.kind, e.t, JSON.stringify(e.data), d.platform, d.os, d.browser, env);
    return batch.events.length;
  }

  // Сводка за N дней: визиты и скорость по устройствам, версии iOS,
  // ошибки, сломанные файлы, CSP и шаги заявки.
  function summary(days = 7) {
    const rows = since.all(ago(days)).map(r => ({ ...r, data: JSON.parse(r.data), env: r.env ? JSON.parse(r.env) : null }));
    const visits = new Map();
    for (const r of rows) {
      const v = visits.get(r.visit) || { platform: r.platform, os: r.os, browser: r.browser, site: siteOf(r.path), view: null, left: false, env: null };
      if (r.kind === 'view') v.view = r.data;
      if (r.kind === 'left') v.left = true;
      if (r.env) v.env = r.env;
      visits.set(r.visit, v);
    }
    const byPlatform = {};
    for (const v of visits.values()) {
      if (!v.view && !v.left) continue;
      const p = byPlatform[v.platform] ||= { visits: 0, loaded: 0, leftEarly: 0, loads: [], standalone: 0, noStorage: 0 };
      p.visits++;
      if (v.view) { p.loaded++; if (v.view.load != null) p.loads.push(v.view.load); } else p.leftEarly++;
      if (v.env?.standalone) p.standalone++;
      if (v.env?.storage === 'blocked') p.noStorage++;
    }
    const platforms = Object.entries(byPlatform).map(([platform, p]) => ({
      platform, visits: p.visits, loaded: p.loaded, leftEarly: p.leftEarly,
      medianMs: pct(p.loads, 0.5), p90Ms: pct(p.loads, 0.9), standalone: p.standalone, noStorage: p.noStorage,
    })).sort((a, b) => b.visits - a.visits);

    const count = (list, keyOf, extra = () => ({})) => {
      const m = new Map();
      for (const r of list) {
        const key = keyOf(r);
        const g = m.get(key) || { key, count: 0, platforms: new Set(), last: '', ...extra(r) };
        g.count++; g.platforms.add(r.platform === 'iPhone' || r.platform === 'iPad' ? `${r.platform} ${r.os.replace('iOS ', '')} ${r.browser}` : `${r.platform} ${r.browser}`);
        if (r.at > g.last) g.last = r.at;
        m.set(key, g);
      }
      return [...m.values()].sort((a, b) => b.count - a.count).slice(0, 30).map(g => ({ ...g, platforms: [...g.platforms].slice(0, 6) }));
    };
    const of = (kind) => rows.filter(r => r.kind === kind);
    const iosVisits = [...visits.values()].filter(v => v.platform === 'iPhone' || v.platform === 'iPad');
    const ios = count(iosVisits.map(v => ({ ...v, at: '' })), v => `${v.os} · ${v.browser}`).map(({ key, count }) => ({ key, count }));

    const bySite = {};
    for (const v of visits.values()) if (v.view || v.left) bySite[v.site] = (bySite[v.site] || 0) + 1;
    const sites = Object.entries(bySite).map(([site, visits]) => ({ site, visits })).sort((a, b) => b.visits - a.visits);

    return {
      days,
      sites,
      platforms,
      ios,
      errors: count(of('error'), r => r.data.msg, r => ({ where: r.data.src ? `${r.data.src.replace(/^https?:\/\/[^/]+/, '')}:${r.data.line}` : '', path: r.path })),
      broken: count(of('broken'), r => r.data.url, r => ({ tag: r.data.tag, path: r.path })),
      csp: count(of('csp'), r => `${r.data.dir} ${r.data.uri}`),
      steps: count(of('step'), r => `${r.data.name}${r.data.info ? ': ' + r.data.info : ''}`),
      pages: count(of('view').concat(of('left')), r => r.path).map(({ key, count }) => ({ key, count })).slice(0, 15),
    };
  }

  // Сырые события после момента since — для оповещений (pulse-watch.mjs).
  const after = db.prepare(`SELECT at, path, kind, data, platform, os, browser FROM pulse WHERE at > ? AND kind IN ('error','broken','csp') ORDER BY at`);
  const rowsAfter = (iso) => after.all(iso).map(r => ({ ...r, data: JSON.parse(r.data) }));

  return { add, summary, rowsAfter, cleanup: () => drop.run(ago(KEEP_DAYS)) };
}

// Сводка текстом — для консоли сервера (node accounts/cli.mjs pulse 7).
export function summaryText(s) {
  const lines = [`Лендинг за ${s.days} дн.`, ''];
  const sec = (ms) => (ms == null ? '—' : (ms / 1000).toFixed(1) + ' с');
  lines.push('Устройства: визиты · загрузились · ушли до загрузки · медиана · 90% · с экрана «Домой» · без хранилища');
  for (const p of s.platforms) lines.push(`  ${p.platform}: ${p.visits} · ${p.loaded} · ${p.leftEarly} · ${sec(p.medianMs)} · ${sec(p.p90Ms)} · ${p.standalone} · ${p.noStorage}`);
  if (!s.platforms.length) lines.push('  пока пусто');
  const list = (title, items, fmt) => {
    lines.push('', title);
    if (!items.length) lines.push('  нет');
    for (const i of items) lines.push('  ' + fmt(i));
  };
  list('iPhone и iPad: версии и браузеры', s.ios, i => `${i.key}: ${i.count}`);
  list('Ошибки скриптов', s.errors, i => `${i.count}× ${i.key}${i.where ? ' (' + i.where + ')' : ''} — ${i.platforms.join(', ')}`);
  list('Не загрузились файлы', s.broken, i => `${i.count}× ${i.tag} ${i.key} — ${i.platforms.join(', ')}`);
  list('Нарушения CSP', s.csp, i => `${i.count}× ${i.key} — ${i.platforms.join(', ')}`);
  list('Шаги заявки и бубен', s.steps, i => `${i.count}× ${i.key} — ${i.platforms.join(', ')}`);
  return lines.join('\n');
}
