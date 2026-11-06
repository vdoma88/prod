// Пульт «Силы Рода» в Telegram: бот присылает администраторам виджет с
// состоянием сервера и держит его свежим (ops/README.md).
//
//   node ops/bot.mjs        — служба sr-ops (ops/deploy/sr-ops.service)
//
// Настройки — /etc/sr-ops.env (infra/vps/install-ops-widget.sh):
//   OPS_BOT_TOKEN     токен бота пульта
//   OPS_BOT_API       https://api.telegram.org/beta, пока виджеты в бете (Bot API 10.4)
//   OPS_BOT_TEST_ENV  1 — тестовая среда Telegram
//   OPS_ADMIN_IDS     Telegram ID администраторов через запятую: только им пульт
//   OPS_DOMAIN        домен для ссылок и проверки сайтов (belayarod.ru)
//   OPS_INTERVAL_MIN  как часто обновлять пульт, минут (5)
//   OPS_STATE         файл состояния (/var/lib/sr-ops/state.json)
//
// Команды (только администраторам, в личном чате с ботом):
//   /pult    — пульт-виджет; если Telegram виджет не принял — та же сводка текстом
//   /status  — сводка текстом (работает в любом Telegram, виджеты не нужны)
// Тревоги и «снова в порядке» приходят текстом всегда.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectStatus, packStatus, alarmsOf, statusText } from './status.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Клиент Bot API: базовый адрес и тестовая среда задаются настройками. */
export function botApi({ token, base = 'https://api.telegram.org', test = false, fetchImpl = fetch }) {
  const root = `${base.replace(/\/+$/, '')}/bot${token}${test ? '/test' : ''}`;
  return async function api(method, params = {}, { timeoutMs = 40000 } = {}) {
    let body;
    try {
      const res = await fetchImpl(`${root}/${method}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params), signal: AbortSignal.timeout(timeoutMs),
      });
      body = await res.json();
    } catch (e) {
      throw new Error(`${method}: ${String(e?.message || e).split(token).join('<token>')}`);
    }
    if (body?.ok) return body.result;
    throw new Error(`${method}: ${body?.description || 'нет ответа'}`);
  };
}

const notModified = (e) => /not modified/i.test(String(e?.message));
const gone = (e) => /not found|can't be edited|chat not found|blocked/i.test(String(e?.message));

/**
 * Логика бота без сети и таймеров — её проверяют тесты.
 * state: { dashboards: { [chatId]: messageId }, alarms: string[] }
 */
export function createOpsBot({ api, collect, html, admins, state, save = () => {}, log = () => {} }) {
  state.dashboards ??= {};
  state.alarms ??= [];
  const isAdmin = (id) => admins.includes(Number(id));

  async function snapshot() {
    const st = await collect();
    return { st, packed: packStatus(st) };
  }

  async function sendDashboard(chatId) {
    const { packed } = await snapshot();
    const sent = await api('sendWidget', { chat_id: chatId, html, allow_queries: true, chat_data: packed });
    state.dashboards[String(chatId)] = sent.message_id;
    save();
    log(`пульт отправлен в ${chatId}`);
  }

  async function editDashboard(chatId, messageId, packed) {
    try {
      await api('editMessageWidgetData', { chat_id: Number(chatId), message_id: messageId, chat_data: packed });
    } catch (e) {
      if (notModified(e)) return;
      if (gone(e)) { delete state.dashboards[chatId]; save(); log(`пульт в ${chatId} больше не обновляется: ${e.message}`); return; }
      throw e;
    }
  }

  async function onUpdate(u) {
    if (u.message) {
      const m = u.message;
      const cmd = String(m.text || '').split(/[\s@]/)[0];
      if (m.chat?.type !== 'private' || !['/start', '/pult', '/status'].includes(cmd)) return;
      if (!isAdmin(m.from?.id)) {
        await api('sendMessage', { chat_id: m.chat.id, text: 'Это служебный бот «Силы Рода».' });
        return;
      }
      if (cmd === '/status') {
        const { st } = await snapshot();
        await api('sendMessage', { chat_id: m.chat.id, text: statusText(st) });
        return;
      }
      try {
        await sendDashboard(m.chat.id);
      } catch (e) {
        // Виджеты ещё в бете: обычный Bot API может их не знать
        log(`виджет не отправлен: ${e.message}`);
        const { st } = await snapshot();
        await api('sendMessage', { chat_id: m.chat.id, text: `Пульт-виджет пока недоступен (${String(e.message).slice(0, 120)}). Сводка текстом:\n\n${statusText(st)}` });
      }
      return;
    }
    const q = u.widget_query;
    if (!q) return;
    if (!isAdmin(q.from?.id) || q.data !== 'refresh') {
      await api('answerWidgetQuery', { widget_query_id: q.id });
      return;
    }
    const { packed } = await snapshot();
    // Сначала ответ (виджет нарисует его сразу), затем состояние сообщения
    await api('answerWidgetQuery', { widget_query_id: q.id, data: packed });
    if (q.chat?.id != null && q.message_id != null) await editDashboard(String(q.chat.id), q.message_id, packed);
  }

  /** Плановое обновление: все пульты и тревоги, если появились новые. */
  async function tick() {
    const { st, packed } = await snapshot();
    for (const [chatId, messageId] of Object.entries(state.dashboards)) {
      await editDashboard(chatId, messageId, packed).catch((e) => log(`пульт ${chatId}: ${e.message}`));
    }
    const now = alarmsOf(st);
    const fresh = now.filter((a) => !state.alarms.includes(a));
    const fixed = state.alarms.filter((a) => !now.includes(a));
    state.alarms = now;
    save();
    if (fresh.length || fixed.length) {
      const text = [
        ...(fresh.length ? ['⚠️ Тревога на сервере:', ...fresh.map((a) => `• ${a}`)] : []),
        ...(fixed.length ? [(fresh.length ? '\n' : '') + '✅ Снова в порядке:', ...fixed.map((a) => `• ${a}`)] : []),
      ].join('\n');
      for (const id of admins) await api('sendMessage', { chat_id: id, text }).catch((e) => log(`тревога ${id}: ${e.message}`));
    }
    return { packed, alarms: now };
  }

  return { onUpdate, tick, sendDashboard };
}

// ─── Служба ───

async function main() {
  const env = process.env;
  const token = env.OPS_BOT_TOKEN || '';
  const admins = String(env.OPS_ADMIN_IDS || '').split(',').map((s) => Number(s.trim())).filter(Boolean);
  if (!token || !admins.length) { console.error('Нужны OPS_BOT_TOKEN и OPS_ADMIN_IDS (/etc/sr-ops.env)'); process.exit(2); }
  const api = botApi({ token, base: env.OPS_BOT_API || 'https://api.telegram.org', test: env.OPS_BOT_TEST_ENV === '1' });
  const stateFile = env.OPS_STATE || '/var/lib/sr-ops/state.json';
  let state = {};
  try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch {}
  const save = () => { fs.mkdirSync(path.dirname(stateFile), { recursive: true, mode: 0o700 }); fs.writeFileSync(stateFile, JSON.stringify(state), { mode: 0o600 }); };
  const html = fs.readFileSync(path.join(HERE, 'widget.html'), 'utf8');
  const domain = env.OPS_DOMAIN || 'belayarod.ru';
  const log = (s) => console.log(s);
  // Секрет служебных адресов курсов — тот же, что у общего входа (кто онлайн)
  const internalSecret = (() => {
    try { return (/^SR_INTERNAL_SECRET=(.*)$/m.exec(fs.readFileSync('/etc/sr-accounts.env', 'utf8')) || [])[1]?.trim() || ''; } catch { return ''; }
  })();
  const bot = createOpsBot({ api, collect: () => collectStatus({ domain, internalSecret }), html, admins, state, save, log });

  const me = await api('getMe');
  console.log(`Пульт: @${me.username}, администраторов ${admins.length}, домен ${domain}`);
  const every = Math.max(1, Number(env.OPS_INTERVAL_MIN) || 5) * 60000;
  const loop = () => bot.tick().catch((e) => log(`обновление: ${e.message}`));
  loop();
  setInterval(loop, every);

  let offset = state.offset || 0;
  let webhookWarned = false;
  for (;;) {
    let updates = [];
    try {
      updates = await api('getUpdates', { offset, timeout: 30, allowed_updates: ['message', 'widget_query'] }, { timeoutMs: 45000 });
    } catch (e) {
      // У бота настроен вебхук — Telegram шлёт команды туда, а не сюда
      if (/webhook/i.test(e.message)) {
        if (!webhookWarned) log(`Команды не доходят: у бота настроен вебхук (${e.message}). Тревоги и обновление пульта работают; для /pult и /status нужен отдельный бот или снятый вебхук.`);
        webhookWarned = true;
        await new Promise((r) => setTimeout(r, 60000));
        continue;
      }
      log(e.message);
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }
    webhookWarned = false;
    for (const u of updates) {
      offset = u.update_id + 1;
      await bot.onUpdate(u).catch((e) => log(`обновление ${u.update_id}: ${e.message}`));
    }
    if (updates.length) { state.offset = offset; save(); }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
