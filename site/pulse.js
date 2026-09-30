// Телеметрия лендинга: как сайт на самом деле работает у посетителей —
// прежде всего на iPhone, где ни одна проверка не заменяет живой Safari.
// Приём и сводка — accounts/pulse.mjs, смотреть в админке belayarod.ru/account/.
//
// Что уходит: страница, время загрузки, размер экрана, режим приложения,
// доступно ли хранилище (в приватном режиме Safari — нет), ошибки скриптов,
// нарушения CSP, не загрузившиеся файлы и шаги заявки (окно, Telegram,
// копирование, бубен). Чего нет: cookie, постоянного номера посетителя,
// текста заявки, адреса IP (сервер его не хранит). Номер визита случайный
// и живёт до ухода со страницы.
//
// Подключается обычным скриптом перед app.js: так он видит ошибки
// следующих скриптов. Сам не бросает исключений ни при каких условиях.
(() => {
  try {
    // Проверки в Playwright не засоряют сводку; ?pulse=1 — для теста самого скрипта.
    if (navigator.webdriver && !/[?&]pulse=1\b/.test(location.search)) return;
    // Метка проверки iPhone из GitHub (.github/workflows/iphone-safari-audit.yml).
    if (/[?&]iphoneAudit=/.test(location.search)) return;
    if (navigator.globalPrivacyControl === true) return;
  } catch { return; }

  const URL_ = '/account/pulse';
  const MAX_EVENTS = 40;
  const id = (() => {
    try {
      const b = new Uint8Array(8);
      crypto.getRandomValues(b);
      return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
    } catch { return (Math.random().toString(16).slice(2) + '0000000000000000').slice(0, 16); }
  })();
  const now = () => Math.round(performance.now());
  const cut = (s, n = 300) => String(s == null ? '' : s).slice(0, n);
  const queue = [];
  const seen = new Set();
  let sent = 0;
  let loaded = false;
  let envSent = false;

  function storage() {
    try {
      sessionStorage.setItem('__sr_pulse', '1');
      sessionStorage.removeItem('__sr_pulse');
      return 'ok';
    } catch { return 'blocked'; }
  }

  function env() {
    let standalone = false;
    try { standalone = navigator.standalone === true || !!matchMedia('(display-mode: standalone)').matches; } catch { /* нет */ }
    return {
      vw: innerWidth, vh: innerHeight, dpr: Math.round((devicePixelRatio || 1) * 100) / 100,
      touch: (navigator.maxTouchPoints || 0) > 1, standalone, storage: storage(),
    };
  }

  function push(k, data, key) {
    if (sent + queue.length >= MAX_EVENTS) return;
    if (key) { if (seen.has(key)) return; seen.add(key); }
    queue.push({ k, t: now(), ...data });
    if (loaded) schedule();
  }

  let timer = 0;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(flush, 2000);
  }

  function flush() {
    clearTimeout(timer);
    if (!queue.length) return;
    const body = { v: 1, id, path: cut(location.pathname, 200), ev: queue.splice(0) };
    if (!envSent) { body.env = env(); envSent = true; }
    sent += body.ev.length;
    const json = JSON.stringify(body);
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(URL_, new Blob([json], { type: 'text/plain' }))) return;
    } catch { /* ниже fetch */ }
    try {
      fetch(URL_, { method: 'POST', body: json, keepalive: true, credentials: 'omit', headers: { 'Content-Type': 'text/plain' } }).catch(() => {});
    } catch { /* нечем отправить — молчим */ }
  }

  // Ошибки скриптов и не загрузившиеся файлы (картинки, стили, скрипты).
  addEventListener('error', (e) => {
    try {
      const el = e.target;
      if (el && el !== window && el.tagName) {
        const url = el.currentSrc || el.src || el.href || '';
        push('broken', { tag: el.tagName.toLowerCase(), url: cut(url) }, 'b' + url);
      } else {
        const msg = cut(e.message || (e.error && e.error.message) || 'ошибка');
        push('error', { msg, src: cut(e.filename, 200), line: e.lineno || 0, col: e.colno || 0 }, 'e' + msg + e.lineno);
      }
    } catch { /* нет */ }
  }, true);

  addEventListener('unhandledrejection', (e) => {
    try {
      const r = e.reason;
      const msg = cut((r && r.message) || r || 'отклонённое обещание');
      push('error', { msg: 'promise: ' + msg, src: '', line: 0, col: 0 }, 'p' + msg);
    } catch { /* нет */ }
  });

  document.addEventListener('securitypolicyviolation', (e) => {
    try {
      push('csp', { dir: cut(e.violatedDirective, 80), uri: cut(e.blockedURI, 200), src: cut(e.sourceFile, 200), line: e.lineNumber || 0 }, 'c' + e.violatedDirective + e.blockedURI);
    } catch { /* нет */ }
  });

  // Шаги, которые важно видеть на живых телефонах: зовут app.js и drum.js.
  window.srPulse = (name, extra) => {
    try { push('step', { name: cut(name, 40), info: cut(extra || '', 80) }); } catch { /* нет */ }
  };

  addEventListener('load', () => {
    setTimeout(() => {
      try {
        const nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
        const ms = (v) => (v > 0 ? Math.round(v) : null);
        push('view', nav
          ? { ttfb: ms(nav.responseStart), dcl: ms(nav.domContentLoadedEventEnd), load: ms(nav.loadEventEnd) || now() }
          : { ttfb: null, dcl: null, load: now() });
        // Картинки, упавшие до того, как скрипт начал слушать ошибки.
        for (const img of document.images) {
          if (img.complete && img.naturalWidth === 0 && img.currentSrc) push('broken', { tag: 'img', url: cut(img.currentSrc) }, 'b' + img.currentSrc);
        }
      } catch { /* нет */ }
      loaded = true;
      flush();
    }, 0);
  });

  // Ушла, не дождавшись загрузки, — это и есть «белый экран» с её стороны.
  function leave() {
    if (!loaded && !seen.has('left')) {
      seen.add('left');
      queue.push({ k: 'left', t: now(), state: document.readyState });
    }
    flush();
  }
  addEventListener('pagehide', leave);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') leave(); });
})();
