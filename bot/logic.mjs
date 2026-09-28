// Логика бота без сети и таймеров: получает обновление Telegram и
// зависимости (хранилище, клиент API, часы) — поэтому проверяется тестами.
import * as M from './messages.mjs';
import { escapeHtml } from './telegram.mjs';

const HOUR = 60 * 60 * 1000;
const MSK_OFFSET = 3 * HOUR; // Москва без перехода на летнее время
const QUIET_FROM = 21; // с 21:00
const QUIET_TO = 10;   // до 10:00

/** Время отправки с учётом тишины ночью: 21:00–10:00 МСК сдвигается на 10:00. */
export function daytime(date) {
  const msk = new Date(date.getTime() + MSK_OFFSET);
  const hour = msk.getUTCHours();
  if (hour >= QUIET_TO && hour < QUIET_FROM) return date;
  if (hour >= QUIET_FROM) msk.setUTCDate(msk.getUTCDate() + 1);
  msk.setUTCHours(QUIET_TO, 0, 0, 0);
  return new Date(msk.getTime() - MSK_OFFSET);
}

const route = id => M.ROUTES.find(r => r.id === id);
const routesKeyboard = () => ({
  inline_keyboard: M.ROUTES.map(r => [{ text: r.button, callback_data: `r:${r.id}` }]),
});
const routeKeyboard = r => ({
  inline_keyboard: [
    [{ text: M.SIGNUP_BUTTON, callback_data: `s:${r.id}` }],
    [{ text: M.MORE_BUTTON, url: M.SITE + r.page }],
    [{ text: M.PICK_AGAIN_BUTTON, callback_data: 'menu' }],
  ],
});
const displayName = from => [from?.first_name, from?.last_name].filter(Boolean).join(' ').trim() || 'Без имени';

export function createBot({ store, tg, now = () => new Date(), adminCode = '' }) {
  const send = (chatId, text, replyMarkup) =>
    tg('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) });

  async function notifyAdmins(chatId, text) {
    const admins = store.admins();
    if (!admins.length) console.error('Заявка без получателя: ни один админ не привязан (см. bot/README.md)');
    for (const admin of admins) {
      const res = await send(admin, text);
      if (res.ok && res.result?.message_id) store.addRelay(admin, res.result.message_id, chatId);
    }
  }

  async function start(msg, payload) {
    const chatId = msg.chat.id;
    if (adminCode && payload === `admin-${adminCode}`) {
      store.addAdmin(chatId, now().toISOString());
      return send(chatId, 'Готово: заявки и сообщения из бота будут приходить в этот чат. Ответьте на уведомление — бот передаст ответ человеку.');
    }
    const before = store.person(chatId);
    store.upsertPerson({ chatId, name: displayName(msg.from), username: msg.from?.username, source: payload || 'bot', now: now().toISOString() });
    // Серию планируем один раз — при первом знакомстве. Кто уже оставил
    // заявку, серию не получает; вернувшемуся после /stop она не повторяется.
    if (!before) {
      for (const step of M.FUNNEL) {
        store.schedule(chatId, step.id, daytime(new Date(now().getTime() + step.afterHours * HOUR)).toISOString());
      }
    }
    return send(chatId, M.WELCOME, routesKeyboard());
  }

  async function signup(chatId, from, routeId, note = '') {
    const r = route(routeId) || route('unsure');
    const person = store.person(chatId);
    store.markLead(chatId, now().toISOString());
    await notifyAdmins(chatId, M.leadNotice({
      name: escapeHtml(person?.name || displayName(from)),
      username: from?.username,
      service: escapeHtml(r.service),
      note: note && escapeHtml(note),
    }));
  }

  async function onMessage(msg) {
    const chatId = msg.chat.id;
    const text = (msg.text || '').trim();
    if (msg.chat.type !== 'private') return null;

    if (text.startsWith('/start')) return start(msg, text.slice('/start'.length).trim());
    if (text === '/stop') {
      store.stop(chatId);
      return send(chatId, M.STOPPED);
    }

    if (store.isAdmin(chatId)) {
      if (text === '/stats') {
        const s = store.stats();
        return send(chatId, `Всего: ${(s.active || 0) + (s.lead || 0) + (s.stopped || 0)}\nВ серии: ${s.active || 0}\nОставили заявку: ${s.lead || 0}\nОтписались: ${s.stopped || 0}`);
      }
      const replyTo = msg.reply_to_message?.message_id;
      const target = replyTo && store.relayTarget(chatId, replyTo);
      if (target && text) {
        const res = await send(target, escapeHtml(text));
        return send(chatId, res.ok ? 'Передано.' : `Не удалось передать: ${escapeHtml(res.description || 'ошибка Telegram')}`);
      }
      return send(chatId, 'Чтобы ответить человеку, ответьте (reply) на уведомление о его заявке. /stats — сводка.');
    }

    if (!text) return null;
    // Свободный текст — это уже разговор: передаём Екатерине и серию останавливаем.
    if (!store.person(chatId)) store.upsertPerson({ chatId, name: displayName(msg.from), username: msg.from?.username, source: 'message', now: now().toISOString() });
    await signup(chatId, msg.from, store.person(chatId)?.route, text.slice(0, 1000));
    return send(chatId, M.FREE_TEXT_THANKS);
  }

  async function onCallback(cb) {
    const chatId = cb.message?.chat?.id;
    const data = cb.data || '';
    await tg('answerCallbackQuery', { callback_query_id: cb.id });
    if (!chatId) return null;
    if (!store.person(chatId)) store.upsertPerson({ chatId, name: displayName(cb.from), username: cb.from?.username, source: 'button', now: now().toISOString() });

    if (data === 'menu') return send(chatId, M.WELCOME, routesKeyboard());
    const [kind, id] = data.split(':');
    const r = route(id);
    if (kind === 'r' && r) {
      store.setRoute(chatId, r.id);
      return send(chatId, r.text, routeKeyboard(r));
    }
    if (kind === 's') {
      await signup(chatId, cb.from, id);
      return send(chatId, cb.from?.username ? M.SIGNUP_DONE : M.SIGNUP_NO_USERNAME);
    }
    return null;
  }

  /**
   * Сданное домашнее задание из курса → всем привязанным админам.
   * Возвращает { ok, sent } или { ok: false, error } — для ответа курсу.
   * Ночью (как и серия, 21:00–10:00 МСК) приходит без звука.
   */
  async function notifyHomework(event) {
    const course = M.COURSES[event?.course];
    const student = String(event?.student || '').trim().slice(0, 200);
    if (!course) return { ok: false, error: 'unknown course' };
    if (!student) return { ok: false, error: 'student required' };
    const item = String(event?.item || '').trim().slice(0, 300);
    const url = typeof event?.url === 'string' && /^https:\/\/[a-z0-9.-]+\.belayarod\.ru\//i.test(event.url) ? event.url : null;
    const admins = store.admins();
    if (!admins.length) console.error('ДЗ без получателя: ни один админ не привязан (см. bot/README.md)');
    const at = now();
    const silent = daytime(at).getTime() !== at.getTime();
    let sent = 0;
    for (const admin of admins) {
      const res = await tg('sendMessage', {
        chat_id: admin,
        text: M.homeworkNotice({ course, student: escapeHtml(student), item: item && escapeHtml(item) }),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        disable_notification: silent,
        ...(url ? { reply_markup: { inline_keyboard: [[{ text: M.REVIEW_BUTTON, url }]] } } : {}),
      });
      if (res.ok) sent++;
    }
    return { ok: true, sent };
  }

  /** Одно обновление из вебхука. */
  async function handleUpdate(update) {
    if (update.message) return onMessage(update.message);
    if (update.callback_query) return onCallback(update.callback_query);
    return null;
  }

  function funnelMarkup(step, person) {
    if (step.buttons === 'routes') return routesKeyboard();
    if (step.buttons === 'site') return { inline_keyboard: [[{ text: M.MORE_BUTTON, url: M.SITE + '/' }]] };
    if (step.buttons === 'signup') {
      const r = route(person?.route) || route('unsure');
      return { inline_keyboard: [[{ text: M.SIGNUP_BUTTON, callback_data: `s:${r.id}` }], [{ text: M.PICK_AGAIN_BUTTON, callback_data: 'menu' }]] };
    }
    return undefined;
  }

  /** Отправить сообщения серии, время которых пришло. Вызывается раз в минуту. */
  async function tick() {
    const at = now().toISOString();
    let sent = 0;
    for (const item of store.due(at)) {
      const step = M.FUNNEL.find(s => s.id === item.step);
      if (!step) { store.markSent(item.chat_id, item.step, at, 'шаг удалён из messages.mjs'); continue; }
      const res = await send(item.chat_id, step.text, funnelMarkup(step, store.person(item.chat_id)));
      if (res.ok) { store.markSent(item.chat_id, item.step, at); sent++; continue; }
      if (res.status === 403) {
        // Человек заблокировал бота — дальше не пишем.
        store.markSent(item.chat_id, item.step, at, res.description || 'blocked');
        store.stop(item.chat_id);
      } else if (res.status && res.status < 500) {
        store.markSent(item.chat_id, item.step, at, res.description || `HTTP ${res.status}`);
      }
      // Сетевой сбой или 5xx: оставляем в очереди, попробуем через минуту.
    }
    return sent;
  }

  return { handleUpdate, tick, notifyHomework };
}
