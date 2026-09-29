// Хранилище общего входа: учётки, сессии, ссылки для пароля, доступ к курсам.
// node:sqlite, как у бота, Таро и рун — без npm install.
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { COURSES } from './courses.mjs';

export const ROLES = ['student', 'curator', 'admin'];
export const MIN_PASSWORD = 10;
const SESSION_DAYS = 30;
const RESET_HOURS = 72;

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
export const normEmail = (v) => String(v || '').trim().toLowerCase();
const validEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 254;

export class AccountError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function digest(password, salt) {
  return scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
}

export function openStore(path, { now = () => new Date() } = {}) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('student','curator','admin')),
      salt TEXT,
      hash TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS resets (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS course_access (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      course TEXT NOT NULL,
      granted_at TEXT NOT NULL,
      PRIMARY KEY (user_id, course)
    );
    CREATE TABLE IF NOT EXISTS audit (
      at TEXT NOT NULL, actor TEXT, event TEXT NOT NULL, target TEXT
    );
  `);
  const q = (sql) => db.prepare(sql);
  const s = {
    byEmail: q('SELECT * FROM users WHERE email = ?'),
    byId: q('SELECT * FROM users WHERE id = ?'),
    all: q('SELECT * FROM users ORDER BY name COLLATE NOCASE'),
    insert: q('INSERT INTO users (id, email, name, role, active, created_at) VALUES (?, ?, ?, ?, 1, ?)'),
    setPassword: q('UPDATE users SET salt = ?, hash = ? WHERE id = ?'),
    setFields: q('UPDATE users SET name = ?, role = ?, active = ? WHERE id = ?'),
    courses: q('SELECT course FROM course_access WHERE user_id = ?'),
    grant: q('INSERT OR IGNORE INTO course_access (user_id, course, granted_at) VALUES (?, ?, ?)'),
    revoke: q('DELETE FROM course_access WHERE user_id = ? AND course = ?'),
    addSession: q('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'),
    session: q('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?'),
    dropSession: q('DELETE FROM sessions WHERE token_hash = ?'),
    dropSessionsOf: q('DELETE FROM sessions WHERE user_id = ?'),
    dropExpired: q('DELETE FROM sessions WHERE expires_at < ?'),
    addReset: q('INSERT INTO resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)'),
    reset: q('SELECT user_id, expires_at FROM resets WHERE token_hash = ?'),
    dropResetsOf: q('DELETE FROM resets WHERE user_id = ?'),
    audit: q('INSERT INTO audit (at, actor, event, target) VALUES (?, ?, ?, ?)'),
    admins: q("SELECT count(*) AS n FROM users WHERE role = 'admin' AND active = 1"),
  };
  const iso = (d = now()) => d.toISOString();
  const later = (ms) => new Date(now().getTime() + ms).toISOString();

  function publicUser(u) {
    if (!u) return null;
    return {
      id: u.id, email: u.email, name: u.name, role: u.role, active: !!u.active,
      hasPassword: !!u.hash, courses: s.courses.all(u.id).map(r => r.course),
    };
  }

  function createUser({ email, name, role = 'student' }, actor = null) {
    email = normEmail(email);
    name = String(name || '').trim();
    if (!validEmail(email)) throw new AccountError(400, 'Проверьте почту.');
    if (!name || name.length > 120) throw new AccountError(400, 'Укажите имя (до 120 знаков).');
    if (!ROLES.includes(role)) throw new AccountError(400, 'Неизвестная роль.');
    if (s.byEmail.get(email)) throw new AccountError(409, 'Такая почта уже есть.');
    const id = randomUUID();
    s.insert.run(id, email, name, role, iso());
    s.audit.run(iso(), actor, 'user.create', id);
    return publicUser(s.byId.get(id));
  }

  function updateUser(id, patch, actor = null) {
    const u = s.byId.get(id);
    if (!u) throw new AccountError(404, 'Учётная запись не найдена.');
    const name = patch.name === undefined ? u.name : String(patch.name).trim();
    const role = patch.role === undefined ? u.role : patch.role;
    const active = patch.active === undefined ? u.active : (patch.active ? 1 : 0);
    if (!name || name.length > 120) throw new AccountError(400, 'Укажите имя (до 120 знаков).');
    if (!ROLES.includes(role)) throw new AccountError(400, 'Неизвестная роль.');
    // Последнего администратора не разжаловать и не выключить — иначе в админку не войти.
    if (u.role === 'admin' && u.active && (role !== 'admin' || !active) && s.admins.get().n <= 1) {
      throw new AccountError(409, 'Это единственный администратор.');
    }
    s.setFields.run(name, role, active, id);
    if (!active) s.dropSessionsOf.run(id);
    if (patch.courses && typeof patch.courses === 'object') {
      for (const c of COURSES) {
        if (patch.courses[c.id] === true) s.grant.run(id, c.id, iso());
        if (patch.courses[c.id] === false) s.revoke.run(id, c.id);
      }
    }
    s.audit.run(iso(), actor, 'user.update', id);
    return publicUser(s.byId.get(id));
  }

  function setPassword(id, password) {
    if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
      throw new AccountError(400, `Пароль — не короче ${MIN_PASSWORD} знаков.`);
    }
    if (password.length > 200) throw new AccountError(400, 'Пароль слишком длинный.');
    const salt = randomBytes(16).toString('hex');
    s.setPassword.run(salt, digest(password, salt), id);
    s.dropSessionsOf.run(id);
  }

  function checkPassword(email, password) {
    const u = s.byEmail.get(normEmail(email));
    // Сравниваем даже для несуществующей почты — время ответа не выдаёт, есть ли она.
    const salt = u?.salt || 'x'.repeat(32);
    const expected = Buffer.from(u?.hash || '0'.repeat(128), 'hex');
    const given = Buffer.from(digest(String(password || ''), salt), 'hex');
    const ok = expected.length === given.length && timingSafeEqual(expected, given);
    return ok && u?.active && u.hash ? u : null;
  }

  function createSession(userId) {
    const token = randomBytes(32).toString('base64url');
    s.addSession.run(sha256(token), userId, later(SESSION_DAYS * 864e5));
    return { token, maxAge: SESSION_DAYS * 86400 };
  }

  function sessionUser(token) {
    if (!token || typeof token !== 'string' || token.length > 100) return null;
    const row = s.session.get(sha256(token));
    if (!row) return null;
    if (row.expires_at < iso()) { s.dropSession.run(sha256(token)); return null; }
    const u = s.byId.get(row.user_id);
    return u && u.active ? publicUser(u) : null;
  }

  function dropSession(token) { if (token) s.dropSession.run(sha256(token)); }

  function createReset(userId, actor = null) {
    if (!s.byId.get(userId)) throw new AccountError(404, 'Учётная запись не найдена.');
    const token = randomBytes(32).toString('base64url');
    s.dropResetsOf.run(userId);
    s.addReset.run(sha256(token), userId, later(RESET_HOURS * 3600e3));
    s.audit.run(iso(), actor, 'reset.issue', userId);
    return { token, hours: RESET_HOURS };
  }

  function useReset(token, password) {
    const row = typeof token === 'string' && token.length <= 100 ? s.reset.get(sha256(token)) : null;
    if (!row || row.expires_at < iso()) throw new AccountError(400, 'Ссылка устарела или уже использована. Попросите новую.');
    const u = s.byId.get(row.user_id);
    if (!u || !u.active) throw new AccountError(400, 'Учётная запись выключена.');
    setPassword(u.id, password);
    s.dropResetsOf.run(u.id);
    s.audit.run(iso(), u.id, 'reset.use', u.id);
    return publicUser(u);
  }

  return {
    db,
    createUser, updateUser, setPassword, checkPassword,
    createSession, sessionUser, dropSession, createReset, useReset,
    user: (id) => publicUser(s.byId.get(id)),
    userByEmail: (email) => publicUser(s.byEmail.get(normEmail(email))),
    users: () => s.all.all().map(publicUser),
    audit: (actor, event, target) => s.audit.run(iso(), actor, event, target),
    cleanup: () => s.dropExpired.run(iso()),
  };
}
