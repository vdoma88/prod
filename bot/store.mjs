// Хранилище бота: встроенный SQLite Node (node:sqlite, Node ≥ 22.13) —
// как у Таро и рун, без внешних пакетов.
//
// people  — кто написал боту: чат, имя, откуда пришёл, что выбрал, статус.
// queue   — запланированные сообщения серии; отправленное помечается, а не
//           удаляется, чтобы в журнале было видно, что и когда ушло.
// admins  — чаты Екатерины (и кого она добавит), куда приходят заявки.
// relays  — уведомление у админа → чат человека: ответ на уведомление бот
//           пересылает человеку, даже если у того нет имени пользователя.
import { DatabaseSync } from 'node:sqlite';

export function openStore(path) {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS people (
      chat_id    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL DEFAULT '',
      username   TEXT,
      source     TEXT,
      route      TEXT,
      status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'lead', 'stopped')),
      started_at TEXT NOT NULL,
      lead_at    TEXT
    );
    CREATE TABLE IF NOT EXISTS queue (
      chat_id INTEGER NOT NULL,
      step    TEXT NOT NULL,
      send_at TEXT NOT NULL,
      sent_at TEXT,
      error   TEXT,
      PRIMARY KEY (chat_id, step)
    );
    CREATE TABLE IF NOT EXISTS admins (
      chat_id  INTEGER PRIMARY KEY,
      added_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS relays (
      admin_chat_id    INTEGER NOT NULL,
      admin_message_id INTEGER NOT NULL,
      chat_id          INTEGER NOT NULL,
      PRIMARY KEY (admin_chat_id, admin_message_id)
    );
  `);

  const q = (sql) => db.prepare(sql);
  const s = {
    upsertPerson: q(`INSERT INTO people (chat_id, name, username, source, started_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(chat_id) DO UPDATE SET name = excluded.name, username = excluded.username,
        status = CASE WHEN people.status = 'stopped' THEN 'active' ELSE people.status END`),
    person: q('SELECT * FROM people WHERE chat_id = ?'),
    setRoute: q('UPDATE people SET route = ? WHERE chat_id = ?'),
    setStatus: q('UPDATE people SET status = ? WHERE chat_id = ?'),
    setLead: q(`UPDATE people SET status = 'lead', lead_at = ? WHERE chat_id = ?`),
    schedule: q('INSERT OR IGNORE INTO queue (chat_id, step, send_at) VALUES (?, ?, ?)'),
    due: q(`SELECT queue.chat_id, queue.step FROM queue JOIN people USING (chat_id)
      WHERE queue.sent_at IS NULL AND queue.send_at <= ? AND people.status = 'active'
      ORDER BY queue.send_at LIMIT ?`),
    markSent: q('UPDATE queue SET sent_at = ?, error = ? WHERE chat_id = ? AND step = ?'),
    dropQueue: q('DELETE FROM queue WHERE chat_id = ? AND sent_at IS NULL'),
    addAdmin: q('INSERT OR IGNORE INTO admins (chat_id, added_at) VALUES (?, ?)'),
    admins: q('SELECT chat_id FROM admins'),
    isAdmin: q('SELECT 1 FROM admins WHERE chat_id = ?'),
    addRelay: q('INSERT OR REPLACE INTO relays (admin_chat_id, admin_message_id, chat_id) VALUES (?, ?, ?)'),
    relay: q('SELECT chat_id FROM relays WHERE admin_chat_id = ? AND admin_message_id = ?'),
    stats: q(`SELECT status, COUNT(*) AS n FROM people GROUP BY status`),
  };

  return {
    db,
    upsertPerson: ({ chatId, name, username, source, now }) =>
      s.upsertPerson.run(chatId, name, username ?? null, source ?? null, now),
    person: (chatId) => s.person.get(chatId),
    setRoute: (chatId, route) => s.setRoute.run(route, chatId),
    stop: (chatId) => { s.setStatus.run('stopped', chatId); s.dropQueue.run(chatId); },
    markLead: (chatId, now) => { s.setLead.run(now, chatId); s.dropQueue.run(chatId); },
    schedule: (chatId, step, sendAt) => s.schedule.run(chatId, step, sendAt),
    due: (now, limit = 30) => s.due.all(now, limit),
    markSent: (chatId, step, now, error = null) => s.markSent.run(now, error, chatId, step),
    addAdmin: (chatId, now) => s.addAdmin.run(chatId, now),
    admins: () => s.admins.all().map(r => r.chat_id),
    isAdmin: (chatId) => Boolean(s.isAdmin.get(chatId)),
    addRelay: (adminChatId, messageId, chatId) => s.addRelay.run(adminChatId, messageId, chatId),
    relayTarget: (adminChatId, messageId) => s.relay.get(adminChatId, messageId)?.chat_id ?? null,
    stats: () => Object.fromEntries(s.stats.all().map(r => [r.status, r.n])),
  };
}
