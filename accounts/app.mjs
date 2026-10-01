// HTTP-часть общего входа. Всё живёт под /account/ на belayarod.ru:
//
//   /account/                 страница входа, «Мои курсы», новая ссылка, админка
//   /account/api/…            JSON для этой страницы
//   /account/internal/…       для курсов на этом же сервере (nginx наружу не пускает)
//   /account/pulse            телеметрия лендинга от brand/sr-pulse.js (pulse.mjs)
//
// Сессия — cookie sr_session на домене .belayarod.ru: её видят все курсы
// на поддоменах и спрашивают у этого сервиса, кто вошёл (/internal/session).
import fs from 'node:fs';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { AccountError } from './store.mjs';
import { COURSES, SSO_COURSES, courseById, LESSON_STATUSES } from './courses.mjs';
import { openPulse, parseBatch } from './pulse.mjs';

const BASE = '/account';
const COOKIE = 'sr_session';
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const STATIC = {
  'index.html': 'text/html; charset=utf-8',
  'account.js': 'text/javascript; charset=utf-8',
  'account.css': 'text/css; charset=utf-8',
};
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

export function createApp({ store, pulse = openPulse(store.db), env = {}, fetchImpl = fetch }) {
  const origin = String(env.PUBLIC_ORIGIN || 'http://127.0.0.1:4320').replace(/\/$/, '');
  const secure = env.COOKIE_SECURE ? env.COOKIE_SECURE === '1' : origin.startsWith('https://');
  const cookieDomain = env.COOKIE_DOMAIN || '';
  const secret = env.SR_INTERNAL_SECRET || '';
  const trustProxy = env.TRUST_PROXY === '1';
  const internalBase = (c) => env[`COURSE_${c.id.toUpperCase()}_INTERNAL`] || c.internal;
  const publicUrl = (c) => env[`COURSE_${c.id.toUpperCase()}_URL`] || c.url;
  const attempts = new Map();
  const pulseHits = new Map();
  const hubHost = new URL(origin).hostname;
  const subdomainOf = (from) => {
    try {
      const u = new URL(from);
      return u.protocol === new URL(origin).protocol && u.hostname.endsWith('.' + hubHost) && /^[a-z0-9-]+$/.test(u.hostname.slice(0, -hubHost.length - 1)) ? u.hostname : '';
    } catch { return ''; }
  };
  let pulseWindow = Date.now();

  const sameSecret = (given) => {
    if (!secret) return false;
    const a = Buffer.from(String(given || '')), b = Buffer.from(secret);
    return a.length === b.length && timingSafeEqual(a, b);
  };

  function send(res, status, data, headers = {}) {
    const body = JSON.stringify(data);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(body);
  }

  function cookie(value, maxAge) {
    return [`${COOKIE}=${value}`, 'Path=/', `Max-Age=${maxAge}`, 'HttpOnly', 'SameSite=Lax',
      secure ? 'Secure' : '', cookieDomain ? `Domain=${cookieDomain}` : ''].filter(Boolean).join('; ');
  }

  const tokenOf = (req) => {
    for (const part of String(req.headers.cookie || '').split(';')) {
      const [k, ...v] = part.trim().split('=');
      if (k === COOKIE) return v.join('=');
    }
    return '';
  };

  async function readJson(req, limit = 64 * 1024) {
    let size = 0; const chunks = [];
    for await (const c of req) { size += c.length; if (size > limit) throw new AccountError(413, 'Слишком большой запрос.'); chunks.push(c); }
    if (!chunks.length) return {};
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) || {}; } catch { throw new AccountError(400, 'Неверный формат запроса.'); }
  }

  // Изменяющие запросы — только POST с JSON, заголовком X-SR и со своего сайта.
  function checkWrite(req) {
    if (req.method !== 'POST') throw new AccountError(405, 'Нужен POST.');
    if (req.headers['x-sr'] !== '1' || !/^application\/json\b/i.test(req.headers['content-type'] || '')) throw new AccountError(403, 'Запрос пришёл не со страницы входа.');
    const from = req.headers.origin;
    if (from && from !== origin) throw new AccountError(403, 'Запрос пришёл не со страницы входа.');
    if (req.headers['sec-fetch-site'] === 'cross-site') throw new AccountError(403, 'Запрос пришёл не со страницы входа.');
  }

  function clientIp(req) {
    return (trustProxy && String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || 'ip';
  }
  function limited(key) {
    const now = Date.now(), fresh = (attempts.get(key) || []).filter(t => now - t < 15 * 60e3);
    attempts.set(key, fresh);
    return fresh.length >= 8;
  }

  // Телеметрия: sendBeacon не умеет ставить заголовки, поэтому без X-SR.
  // Взамен — только со своего сайта, до 16 КБ и не больше 300 событий
  // с одного адреса за 10 минут. Ответ всегда пустой.
  async function acceptPulse(req, res) {
    const done = (status) => { res.writeHead(status, { 'Cache-Control': 'no-store' }); res.end(); };
    if (req.method !== 'POST') return done(405);
    // Свой сайт или курс на его поддомене (taro.belayarod.ru и т. п.).
    const from = req.headers.origin;
    const sub = from && from !== origin ? subdomainOf(from) : '';
    if ((from && from !== origin && !sub) || req.headers['sec-fetch-site'] === 'cross-site') return done(403);
    if (Date.now() - pulseWindow > 10 * 60e3) { pulseHits.clear(); pulseWindow = Date.now(); }
    const ip = clientIp(req);
    if ((pulseHits.get(ip) || 0) >= 300) return done(429);
    let body;
    try { body = await readJson(req, 16 * 1024); } catch { return done(400); }
    const batch = parseBatch(body);
    if (!batch) return done(400);
    if (sub) batch.path = sub + batch.path; // «taro.belayarod.ru/…»: сводка различает сайты
    pulseHits.set(ip, (pulseHits.get(ip) || 0) + pulse.add(batch, req.headers['user-agent']));
    return done(204);
  }

  const me = (req) => store.sessionUser(tokenOf(req));
  const need = (req) => { const u = me(req); if (!u) throw new AccountError(401, 'Войдите, пожалуйста.'); return u; };
  const needAdmin = (req) => { const u = need(req); if (u.role !== 'admin') throw new AccountError(403, 'Это может только администратор.'); return u; };
  // Курс со своим входом (sso: false) виден всем ссылкой: доступ туда выдаёт сам курс.
  const staffOf = (u) => u.role === 'admin' || u.role === 'curator';
  const withCourses = (u) => ({ user: u, courses: COURSES.map(c => ({ id: c.id, title: c.title, url: c.sso && c.staff && staffOf(u) ? new URL(c.staff, publicUrl(c)).href : publicUrl(c), ownLogin: !c.sso, enabled: !c.sso || u.role === 'admin' || u.courses.includes(c.id) })) });
  const resetLink = (token) => `${origin}${BASE}/#reset=${token}`;

  async function courseCall(c, pathAndQuery, body) {
    const res = await fetchImpl(internalBase(c) + pathAndQuery, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', 'X-SR-Secret': secret },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(8000),
    }).catch(() => null);
    // Курс ещё не подключён: адреса нет, или приложение отдаёт на него свою страницу.
    if (!res || res.status === 404 || !/json/.test(res.headers.get('content-type') || '')) return { connected: false };
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new AccountError(502, data.error || `Курс ответил ошибкой (${res.status}).`);
    return { connected: true, ...data };
  }

  async function api(req, res, p) {
    if (p === '/api/me' && req.method === 'GET') return send(res, 200, withCourses(need(req)));

    if (p === '/api/login') {
      checkWrite(req);
      const b = await readJson(req);
      const key = clientIp(req) + ':' + String(b.email || '').toLowerCase();
      if (limited(key)) throw new AccountError(429, 'Слишком много попыток. Подождите 15 минут.');
      const u = store.checkPassword(b.email, b.password);
      if (!u) { attempts.get(key).push(Date.now()); throw new AccountError(401, 'Неверная почта или пароль.'); }
      attempts.delete(key);
      const s = store.createSession(u.id);
      store.audit(u.id, 'login', u.id);
      return send(res, 200, withCourses(store.user(u.id)), { 'Set-Cookie': cookie(s.token, s.maxAge) });
    }
    if (p === '/api/logout') {
      checkWrite(req);
      store.dropSession(tokenOf(req));
      return send(res, 200, { ok: true }, { 'Set-Cookie': cookie('', 0) });
    }
    if (p === '/api/reset') {
      checkWrite(req);
      const b = await readJson(req);
      const u = store.useReset(b.token, b.password);
      const s = store.createSession(u.id);
      return send(res, 200, withCourses(store.user(u.id)), { 'Set-Cookie': cookie(s.token, s.maxAge) });
    }

    // ─── Админка ───
    if (p === '/api/admin/pulse' && req.method === 'GET') {
      needAdmin(req);
      const days = Math.min(30, Math.max(1, Number(new URL(req.url, 'http://x').searchParams.get('days')) || 7));
      return send(res, 200, pulse.summary(days));
    }
    if (p === '/api/admin/users' && req.method === 'GET') { needAdmin(req); return send(res, 200, { users: store.users(), courses: SSO_COURSES.map(({ id, title }) => ({ id, title })) }); }
    if (p === '/api/admin/users') {
      checkWrite(req);
      const admin = needAdmin(req);
      const b = await readJson(req);
      const u = store.createUser({ email: b.email, name: b.name, role: b.role }, admin.id);
      const withAccess = b.courses ? store.updateUser(u.id, { courses: b.courses }, admin.id) : u;
      return send(res, 201, { user: withAccess, link: resetLink(store.createReset(u.id, admin.id).token) });
    }
    let m = /^\/api\/admin\/users\/([0-9a-f-]{36})$/.exec(p);
    if (m) {
      checkWrite(req);
      const admin = needAdmin(req);
      const b = await readJson(req);
      return send(res, 200, { user: store.updateUser(m[1], { name: b.name, role: b.role, active: b.active, courses: b.courses }, admin.id) });
    }
    m = /^\/api\/admin\/users\/([0-9a-f-]{36})\/reset-link$/.exec(p);
    if (m) {
      checkWrite(req);
      const admin = needAdmin(req);
      return send(res, 200, { link: resetLink(store.createReset(m[1], admin.id).token) });
    }
    // Статусы уроков ученицы в курсе: админка спрашивает сам курс.
    m = /^\/api\/admin\/users\/([0-9a-f-]{36})\/lessons\/([a-z]+)$/.exec(p);
    if (m) {
      const admin = needAdmin(req);
      const u = store.user(m[1]);
      const c = courseById(m[2]);
      if (!u || !c) throw new AccountError(404, 'Не найдено.');
      if (req.method === 'GET') return send(res, 200, await courseCall(c, `/sr-internal/lessons?email=${encodeURIComponent(u.email)}`));
      checkWrite(req);
      if (!u.courses.includes(c.id)) throw new AccountError(409, 'Сначала откройте ученице этот курс.');
      const b = await readJson(req);
      if (!LESSON_STATUSES.includes(b.status)) throw new AccountError(400, 'Неизвестный статус урока.');
      const result = await courseCall(c, '/sr-internal/lessons', { email: u.email, name: u.name, lessonId: String(b.lessonId || ''), status: b.status });
      store.audit(admin.id, `lesson.${b.status}`, `${u.id}:${c.id}:${b.lessonId}`);
      return send(res, 200, result);
    }
    throw new AccountError(404, 'Нет такого адреса.');
  }

  // Курсы на этом же сервере: «кто вошёл по этой cookie».
  async function internal(req, res, p) {
    if (!secret) return send(res, 503, { error: 'SR_INTERNAL_SECRET не задан' });
    if (!LOOPBACK.has(req.socket.remoteAddress) || !sameSecret(req.headers['x-sr-secret'])) return send(res, 401, { error: 'нет доступа' });
    if (p === '/internal/session' && req.method === 'POST') {
      const b = await readJson(req, 4096);
      const u = store.sessionUser(String(b.token || ''));
      if (!u) return send(res, 401, { error: 'нет сессии' });
      const { user, courses } = withCourses(u);
      return send(res, 200, { user: { id: user.id, email: user.email, name: user.name, role: user.role }, courses: courses.filter(c => c.enabled && !c.ownLogin).map(c => c.id) });
    }
    return send(res, 404, { error: 'нет такого адреса' });
  }

  function serveStatic(req, res, p) {
    const name = p === '/' || p === '' ? 'index.html' : p.slice(1);
    if (!STATIC[name] || (req.method !== 'GET' && req.method !== 'HEAD')) return false;
    const body = fs.readFileSync(path.join(PUBLIC_DIR, name));
    res.writeHead(200, { 'Content-Type': STATIC[name], 'Cache-Control': 'no-cache', 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' });
    res.end(req.method === 'HEAD' ? undefined : body);
    return true;
  }

  return async function handle(req, res) {
    let p;
    try { p = new URL(req.url, 'http://x').pathname; } catch { res.writeHead(400); return res.end(); }
    if (p === BASE) { res.writeHead(301, { Location: BASE + '/' }); return res.end(); }
    if (!p.startsWith(BASE + '/')) { res.writeHead(404); return res.end(); }
    p = p.slice(BASE.length);
    try {
      if (p.startsWith('/internal/')) return await internal(req, res, p);
      if (p === '/pulse') return await acceptPulse(req, res);
      if (p.startsWith('/api/')) return await api(req, res, p);
      if (serveStatic(req, res, p)) return;
      res.writeHead(404); res.end();
    } catch (error) {
      if (error instanceof AccountError) return send(res, error.status, { error: error.message });
      console.error('[accounts]', error);
      send(res, 500, { error: 'Ошибка на сервере. Попробуйте ещё раз через минуту.' });
    }
  };
}
