// Published plain-text overrides for static belayarod.ru pages.
// Stored in the same durable SQLite database as account sessions; never as browser localStorage.
import { AccountError } from './store.mjs';

export const LANDING_PAGES = Object.freeze([
  'index.html', 'consultations.html', 'therapy.html', 'mystery.html',
  'tarot-course.html', 'runes.html', 'candle-course.html', 'game.html',
  'offerings.html', 'massage.html', 'courses.html',
]);
const MAX_FIELDS = 250;
const MAX_FIELD_LENGTH = 3000;
const MAX_JSON_BYTES = 55 * 1024;
// DOM text-node addresses, not HTML, selectors to evaluate, or script.
const VALID_KEY = /^[a-z0-9#.:()>~_-]{1,240}$/i;

export function openLanding(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS landing_texts (
      page TEXT PRIMARY KEY,
      revision INTEGER NOT NULL,
      changes TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT
    )
  `);
  const select = db.prepare('SELECT revision, changes, updated_at FROM landing_texts WHERE page = ?');
  const write = db.prepare(`
    INSERT INTO landing_texts (page, revision, changes, updated_at, updated_by)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(page) DO UPDATE SET
      revision = excluded.revision, changes = excluded.changes,
      updated_at = excluded.updated_at, updated_by = excluded.updated_by
  `);

  function validPage(page) {
    if (typeof page !== 'string' || !LANDING_PAGES.includes(page)) {
      throw new AccountError(400, 'Неизвестная страница лендинга.');
    }
    return page;
  }
  function get(page) {
    validPage(page);
    const row = select.get(page);
    return row
      ? { page, revision: row.revision, changes: JSON.parse(row.changes), updatedAt: row.updated_at }
      : { page, revision: 0, changes: {}, updatedAt: null };
  }
  function save(page, revision, changes, actor) {
    validPage(page);
    if (!Number.isSafeInteger(revision) || revision < 0) throw new AccountError(400, 'Неверная версия правок.');
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
      throw new AccountError(400, 'Передайте объект с текстовыми правками.');
    }
    const pairs = Object.entries(changes);
    if (pairs.length > MAX_FIELDS) throw new AccountError(413, 'Слишком много текстовых полей.');
    const safe = Object.create(null);
    for (const [key, value] of pairs) {
      if (!VALID_KEY.test(key) || typeof value !== 'string' || value.length > MAX_FIELD_LENGTH || value.includes('\u0000')) {
        throw new AccountError(400, 'Некорректное текстовое поле.');
      }
      safe[key] = value;
    }
    const json = JSON.stringify(safe);
    if (Buffer.byteLength(json, 'utf8') > MAX_JSON_BYTES) throw new AccountError(413, 'Слишком большой объём правок.');
    const previous = get(page);
    if (previous.revision !== revision) {
      throw new AccountError(409, 'Эта страница уже изменена. Обновите её перед сохранением.');
    }
    const at = new Date().toISOString();
    // SQLite's synchronous connection serializes accesses in this process.
    write.run(page, revision + 1, json, at, actor);
    return { page, revision: revision + 1, changes: safe, updatedAt: at };
  }
  return { get, save };
}
