// Published plain-text overrides for static belayarod.ru pages.
// Stored in the same durable SQLite database as account sessions; never as browser localStorage.
//
// Правка — { text, base }: новый текст и исходный текст фрагмента. Сайт
// применяет правку, только если на странице этот исходный текст и стоит
// (site/landing-editor.js): адрес фрагмента — его место в разметке, и после
// правки HTML в коде правка иначе встала бы в чужой абзац. Старые правки —
// просто строки (до октября 2026), они применяются как раньше.
//
// Каждая публикация сохраняет прежнюю версию в landing_text_history:
// администратор может вернуть любую из последних KEEP_HISTORY.
import { AccountError } from './store.mjs';

export const LANDING_PAGES = Object.freeze([
  'index.html', 'consultations.html', 'therapy.html', 'mystery.html',
  'tarot-course.html', 'runes.html', 'candle-course.html', 'game.html',
  'offerings.html', 'massage.html', 'courses.html',
]);
const MAX_FIELDS = 250;
const MAX_FIELD_LENGTH = 3000;
const MAX_JSON_BYTES = 110 * 1024;
const KEEP_HISTORY = 30;
// DOM text-node addresses, not HTML, selectors to evaluate, or script.
const VALID_KEY = /^[a-z0-9#.:()>~_-]{1,240}$/i;
const VISUAL_KEY = /^@(image|block|svg):[a-z0-9#.:()>~_-]{1,240}$/i;
const MEDIA_SRC = /^(?:\/account\/media\/[a-f0-9]{64}\.(?:jpg|png|webp)|\/?assets\/[a-z0-9_./-]+\.(?:jpg|jpeg|png|webp)(?:\?v=[a-z0-9._-]+)?)$/i;
const numberIn = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
function cleanVisual(key, value) {
  const match = VISUAL_KEY.exec(key);
  if (!match || !value || typeof value !== 'object' || Array.isArray(value)) return null;
  const type = match[1].toLowerCase();
  const required = ['type','base','hidden','zoom','x','y','order'];
  const imageOnly = ['src','alt','fit','focusX','focusY'];
  const keys = Object.keys(value).sort();
  const expected = (type === 'image' ? [...required,...imageOnly] : required).sort();
  if (JSON.stringify(keys) !== JSON.stringify(expected) || value.type !== type ||
      typeof value.base !== 'string' || value.base.length > 350 || typeof value.hidden !== 'boolean' ||
      !numberIn(value.zoom, 50, 180) || !numberIn(value.x, -80, 80) || !numberIn(value.y, -80, 80) ||
      !numberIn(value.order, -1, 1)) return null;
  if (type === 'image') {
    if (typeof value.src !== 'string' || !MEDIA_SRC.test(value.src) ||
        typeof value.alt !== 'string' || value.alt.length > 300 ||
        !['cover','contain','fill'].includes(value.fit) ||
        !numberIn(value.focusX,0,100) || !numberIn(value.focusY,0,100)) return null;
  }
  return Object.fromEntries(expected.map(k => [k, value[k]]));
}

const plainText = (v) => typeof v === 'string' && v.length <= MAX_FIELD_LENGTH && !v.includes('\u0000');

/** Значение правки: строка (старый формат) или { text, base } — и ничего больше. */
function cleanValue(value) {
  if (plainText(value)) return value;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const keys = Object.keys(value);
    if (keys.length === 2 && keys.includes('text') && keys.includes('base') && plainText(value.text) && plainText(value.base)) {
      return { text: value.text, base: value.base };
    }
  }
  return null;
}

export function openLanding(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS landing_texts (
      page TEXT PRIMARY KEY,
      revision INTEGER NOT NULL,
      changes TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT
    );
    CREATE TABLE IF NOT EXISTS landing_text_history (
      page TEXT NOT NULL,
      revision INTEGER NOT NULL,
      changes TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT,
      PRIMARY KEY (page, revision)
    );
  `);
  const select = db.prepare('SELECT revision, changes, updated_at, updated_by FROM landing_texts WHERE page = ?');
  const write = db.prepare(`
    INSERT INTO landing_texts (page, revision, changes, updated_at, updated_by)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(page) DO UPDATE SET
      revision = excluded.revision, changes = excluded.changes,
      updated_at = excluded.updated_at, updated_by = excluded.updated_by
  `);
  const archive = db.prepare(`
    INSERT OR REPLACE INTO landing_text_history (page, revision, changes, updated_at, updated_by)
    VALUES (?, ?, ?, ?, ?)
  `);
  const trim = db.prepare(`
    DELETE FROM landing_text_history WHERE page = ? AND revision NOT IN
      (SELECT revision FROM landing_text_history WHERE page = ? ORDER BY revision DESC LIMIT ?)
  `);
  const versions = db.prepare('SELECT revision, changes, updated_at, updated_by FROM landing_text_history WHERE page = ? ORDER BY revision DESC');
  const version = db.prepare('SELECT changes FROM landing_text_history WHERE page = ? AND revision = ?');

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
      const visual = key.startsWith('@');
      const clean = visual ? cleanVisual(key, value) : cleanValue(value);
      if ((!visual && (!VALID_KEY.test(key) || !/~[0-9]+$/.test(key))) || clean === null) {
        throw new AccountError(400, 'Некорректный фрагмент страницы.');
      }
      safe[key] = clean;
    }
    const json = JSON.stringify(safe);
    if (Buffer.byteLength(json, 'utf8') > MAX_JSON_BYTES) throw new AccountError(413, 'Слишком большой объём правок.');
    const row = select.get(page);
    const current = row ? row.revision : 0;
    if (current !== revision) {
      throw new AccountError(409, 'Эта страница уже изменена. Обновите её перед сохранением.');
    }
    const at = new Date().toISOString();
    // SQLite's synchronous connection serializes accesses in this process.
    db.exec('BEGIN');
    try {
      // Прежняя версия — в историю, чтобы её можно было вернуть
      if (row) archive.run(page, row.revision, row.changes, row.updated_at, row.updated_by);
      write.run(page, revision + 1, json, at, actor);
      trim.run(page, page, KEEP_HISTORY);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return { page, revision: revision + 1, changes: safe, updatedAt: at };
  }
  /** Текущая версия и прежние — без самих текстов, только сколько правок. */
  function history(page) {
    validPage(page);
    const row = select.get(page);
    const count = (json) => Object.keys(JSON.parse(json)).length;
    return {
      page,
      current: row ? { revision: row.revision, updatedAt: row.updated_at, updatedBy: row.updated_by, count: count(row.changes) } : null,
      versions: versions.all(page).map(v => ({ revision: v.revision, updatedAt: v.updated_at, updatedBy: v.updated_by, count: count(v.changes) })),
    };
  }
  /** Вернуть прежнюю версию: она публикуется как новая (история не теряется). */
  function restore(page, revision, to, actor) {
    validPage(page);
    if (!Number.isSafeInteger(to) || to < 0) throw new AccountError(400, 'Неверная версия для возврата.');
    const old = to === 0 ? { changes: '{}' } : version.get(page, to);
    if (!old) throw new AccountError(404, 'Такой версии нет в истории.');
    return save(page, revision, JSON.parse(old.changes), actor);
  }
  return { get, save, history, restore };
}
