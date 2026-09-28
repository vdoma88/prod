// Клиент Telegram Bot API на fetch, без библиотек.
//
// Повторы — по опыту школы (flame-app/src/lib/telegram.ts): с российского
// VPS api.telegram.org доступен через раз, и соединение рвётся ещё до ответа.
// Повторяем сетевой обрыв и 5xx; 4xx окончательный (бот заблокирован,
// неверная разметка) — его возвращаем вызывающему как есть.
const CALL_TIMEOUT_MS = 10000;
const CALL_ATTEMPTS = 3;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export function escapeHtml(text) {
  return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * @returns {Promise<{ ok: boolean, status?: number, result?: any, description?: string }>}
 */
export function telegramClient(token, { fetchImpl = fetch, retryDelayMs = 1000 } = {}) {
  return async function call(method, payload) {
    if (!token) return { ok: false, description: 'TELEGRAM_BOT_TOKEN не задан' };
    let last = { ok: false, description: 'нет ответа' };
    for (let attempt = 1; attempt <= CALL_ATTEMPTS; attempt++) {
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), CALL_TIMEOUT_MS);
      try {
        const res = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: abort.signal,
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok) return { ok: true, status: res.status, result: body.result };
        last = { ok: false, status: res.status, description: body.description };
        if (res.status < 500) return last;
      } catch (error) {
        last = { ok: false, description: String(error?.message || error) };
      } finally {
        clearTimeout(timer);
      }
      if (attempt < CALL_ATTEMPTS) await wait(attempt * retryDelayMs);
    }
    console.error(`Telegram ${method}: не удалось после ${CALL_ATTEMPTS} попыток — ${last.description}`);
    return last;
  };
}
