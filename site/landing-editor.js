// Site copy editor. Text replacements are plain strings; markup and link targets are untouched.
//
// Правка хранится как { text, base }: новый текст и исходный текст фрагмента
// (accounts/landing.mjs). Адрес фрагмента — его место в разметке, поэтому
// правка применяется, только если на этом месте стоит тот же исходный текст.
// Если HTML страницы поменяли в коде и фрагмент переехал — правка находит его
// по исходному тексту; если текста больше нет — не применяется вовсе, а в
// панели редактора видна как «устаревшая». Старые правки (просто строки)
// применяются по адресу, как раньше, и при следующей публикации получают base.
//
// Данные запрашивает boot.js сразу при разборе страницы (window.__srLanding),
// а подмена идёт на DOMContentLoaded — без ожидания картинок: посетитель не
// видит, как старый текст сменяется новым.
(() => {
  'use strict';
  const page = location.pathname === '/' ? 'index.html' : location.pathname.slice(1);
  const pages = [
    ['index.html','Главная'],['consultations.html','Консультации'],
    ['therapy.html','Связь с Родом'],['mystery.html','Мистерия'],
    ['tarot-course.html','Карта как зеркало'],['runes.html','Руны'],
    ['candle-course.html','Свечные практики'],['game.html','Игра'],
    ['offerings.html','Подношения предкам'],['massage.html','Огненный массаж'],
    ['courses.html','Мои курсы'],
  ];
  if (!pages.some(p => p[0] === page)) return;
  const editing = new URLSearchParams(location.search).get('edit') === '1';
  const original = new Map();
  const byBase = new Map();
  let visual = null;
  // saved/draft — тексты по адресу на этой странице; stale — правки, которым
  // нет места на странице (хранятся как есть, пока их не убрали)
  let saved = {}, draft = {}, stale = {}, dropStale = false, revision = 0, chosen = null, active = null;
  let panel, status, counter, saveButton, editor, field, staleBox, historyBox;

  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const pad = (n) => String(n).padStart(2, '0');
  const dmy = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${pad(d.getFullYear() % 100)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }
  function keyFor(node) {
    let element = node.parentElement, parts = [];
    while (element && element !== document.body) {
      if (element.id && /^[a-z][a-z0-9_-]*$/i.test(element.id)) {
        parts.unshift('#' + element.id);
        break;
      }
      let ordinal = 1;
      for (let prev = element.previousElementSibling; prev; prev = prev.previousElementSibling)
        if (prev.localName === element.localName) ordinal++;
      parts.unshift(element.localName + ':nth-of-type(' + ordinal + ')');
      element = element.parentElement;
    }
    if (!parts.length) parts.push('body');
    let n = 0;
    for (let prev = node.previousSibling; prev; prev = prev.previousSibling)
      if (prev.nodeType === Node.TEXT_NODE) n++;
    return parts.join('>') + '~' + n;
  }
  // Register the original DOM text nodes before introducing editor decoration.
  function collect() {
    const keys = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent || !node.nodeValue.trim() || !parent.closest('header,main,footer')) continue;
      if (parent.closest('svg,script,style,noscript,template,dialog,select,option,textarea,[contenteditable],[aria-live],[aria-hidden="true"],#bc-service-detail,.bc-arrow,[data-sr-noedit]')) continue;
      if (!/[\p{L}\p{N}]/u.test(node.nodeValue)) continue;
      const key = keyFor(node), raw = node.nodeValue;
      if (original.has(key)) continue;
      original.set(key, {node, base: raw, prefix: (raw.match(/^\s*/) || [''])[0], suffix: (raw.match(/\s*$/) || [''])[0]});
      const b = norm(raw);
      byBase.set(b, [...(byBase.get(b) || []), key]);
      keys.push(key);
    }
    return keys;
  }
  /** Разложить правки сервера: какие встают на страницу (по адресу или по исходному тексту), какие устарели. */
  function resolve(changes) {
    const placed = {}, lost = {};
    for (const [key, value] of Object.entries(changes || {})) {
      if (key.startsWith('@')) continue; // image/block overrides handled by landing-visual.js
      const legacy = typeof value === 'string';
      const text = legacy ? value : value && value.text;
      if (typeof text !== 'string') continue;
      if (legacy) { if (original.has(key) && !(key in placed)) placed[key] = text; else lost[key] = value; continue; }
      const info = original.get(key);
      if (info && norm(info.base) === norm(value.base) && !(key in placed)) { placed[key] = text; continue; }
      // Фрагмент переехал: тот же исходный текст в одном месте страницы
      const candidates = (byBase.get(norm(value.base)) || []).filter(k => !(k in placed) && !(k in changes));
      if (candidates.length === 1) placed[candidates[0]] = text;
      else lost[key] = value;
    }
    return { placed, lost };
  }
  function apply(texts) {
    original.forEach((info, key) => {
      info.node.nodeValue = Object.prototype.hasOwnProperty.call(texts, key) ? texts[key] : info.base;
    });
  }
  async function api(url, body) {
    const options = body === undefined
      ? {credentials: 'same-origin', cache: 'no-store'}
      : {method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json', 'X-SR': '1'}, body: JSON.stringify(body)};
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || 'Нет связи с сервером');
      error.status = response.status;
      throw error;
    }
    return data;
  }
  function load(data) {
    revision = data.revision || 0;
    const { placed, lost } = resolve(data.changes);
    saved = placed; draft = {...placed}; stale = lost; dropStale = false;
    apply(saved);
    visual?.load(data.changes);
  }
  const staleCount = () => Object.keys(stale).length;
  function dirty() {
    const changed = [...new Set([...Object.keys(saved), ...Object.keys(draft)])]
      .filter(key => saved[key] !== draft[key]).length;
    return changed + (dropStale ? staleCount() : 0) + (visual?.diff() || 0);
  }
  function message(text, isError = false) {
    status.textContent = text;
    status.classList.toggle('sr-copy-error', isError);
  }
  function refresh() {
    const n = dirty();
    counter.textContent = n ? 'Неопубликованных правок: ' + n : 'Все изменения опубликованы';
    saveButton.disabled = !n;
    renderStale();
  }
  function renderStale() {
    staleBox.replaceChildren();
    const lost = Object.entries(stale);
    if (!lost.length || dropStale) { staleBox.hidden = true; return; }
    staleBox.hidden = false;
    staleBox.append(el('p', 'sr-copy-warn', `⚠ Правок не на своём месте: ${lost.length}. Текст страницы поменяли в коде, и этих фрагментов больше нет — на сайте они не показываются.`));
    const list = el('ul', 'sr-copy-stale');
    for (const [, value] of lost.slice(0, 8)) {
      const text = typeof value === 'string' ? value : value.text;
      list.append(el('li', '', '«' + norm(text).slice(0, 90) + '»'));
    }
    const drop = el('button', '', 'Убрать устаревшие правки'); drop.type = 'button';
    drop.addEventListener('click', () => { dropStale = true; refresh(); message('Устаревшие правки уберутся при публикации.'); });
    staleBox.append(list, drop);
  }
  function unselect() {
    active?.classList.remove('sr-copy-active');
    active = null; chosen = null; editor.hidden = true;
  }
  function select(key, span) {
    if (!original.has(key)) return;
    active?.classList.remove('sr-copy-active');
    active = span; active.classList.add('sr-copy-active'); chosen = key;
    field.value = original.get(key).node.nodeValue.trim();
    editor.hidden = false;
    message('Измените текст, нажмите «Применить», затем «Опубликовать».');
    field.focus();
  }
  function applyField() {
    if (!chosen) return;
    const item = original.get(chosen);
    const value = item.prefix + field.value.trim() + item.suffix;
    item.node.nodeValue = value;
    if (value === item.base) delete draft[chosen];
    else draft[chosen] = value;
    refresh(); unselect();
    message('Предпросмотр обновлён. Опубликуйте правки, чтобы их увидели посетители.');
  }
  /** Что уходит на сервер: правки страницы с исходным текстом + устаревшие, если их не убрали. */
  function payload() {
    const out = dropStale ? {} : {...stale};
    for (const [key, text] of Object.entries(draft)) out[key] = {text, base: original.get(key).base};
    return {...out, ...(visual?.payload() || {})};
  }
  async function publish() {
    if (chosen) applyField();
    if (!dirty()) return;
    saveButton.disabled = true;
    message('Сохраняю на сервере…');
    try {
      load(await api('/account/api/admin/landing', {page, revision, changes: payload()}));
      refresh();
      message('Опубликовано! Новые тексты видны всем посетителям сайта.');
    } catch (error) { message(error.message, true); refresh(); }
  }
  async function showHistory() {
    historyBox.hidden = !historyBox.hidden;
    if (historyBox.hidden) return;
    historyBox.replaceChildren(el('p', 'sr-copy-muted', 'Загружаю историю…'));
    try {
      const h = await api('/account/api/admin/landing/history?page=' + encodeURIComponent(page));
      historyBox.replaceChildren();
      const row = (v, current) => {
        const li = el('li');
        li.append(el('span', '', `Версия ${v.revision} · ${dmy(v.updatedAt)}${v.updatedBy ? ' · ' + v.updatedBy : ''} · правок: ${v.count}`));
        if (current) li.append(el('b', '', ' — сейчас на сайте'));
        else {
          const back = el('button', '', 'Вернуть'); back.type = 'button';
          back.addEventListener('click', () => restore(v.revision));
          li.append(back);
        }
        return li;
      };
      const list = el('ul', 'sr-copy-history');
      if (h.current) list.append(row(h.current, true));
      h.versions.forEach(v => list.append(row(v, false)));
      const original0 = el('li'); original0.append(el('span', '', 'Исходные тексты и изображения из кода (без правок)'));
      if (h.current) { const b = el('button', '', 'Вернуть'); b.type = 'button'; b.addEventListener('click', () => restore(0)); original0.append(b); }
      list.append(original0);
      historyBox.append(list);
    } catch (error) { historyBox.replaceChildren(el('p', 'sr-copy-error', error.message)); }
  }
  async function restore(to) {
    if (dirty() && !confirm('Неопубликованные правки пропадут. Вернуть версию?')) return;
    if (!confirm(to ? `Вернуть версию ${to}? Она станет новой версией на сайте.` : 'Убрать все правки и вернуть исходные тексты из кода?')) return;
    try {
      load(await api('/account/api/admin/landing/restore', {page, revision, to}));
      unselect(); refresh(); historyBox.hidden = true;
      message(to ? `Версия ${to} снова на сайте.` : 'На сайте снова исходные тексты.');
    } catch (error) { message(error.message, true); }
  }
  function makePanel() {
    const link = el('link'); link.rel = 'stylesheet'; link.href = '/landing-editor.css'; document.head.append(link);
    panel = el('section', 'sr-copy-panel'); panel.setAttribute('aria-label', 'Редактор текстов лендинга');
    const title = el('strong','sr-copy-title','✎ Редактор сайта');
    const hint = el('p','sr-copy-muted','Нажимайте на тексты или изображения. Управление фотографиями и блоками — ниже.');
    const choose = el('select','sr-copy-pages');
    choose.setAttribute('aria-label','Страница лендинга');
    pages.forEach(([path, name]) => { const option = el('option','',name); option.value = path; choose.append(option); });
    choose.value = page;
    choose.addEventListener('change', () => {
      if (dirty() && !confirm('Есть неопубликованные правки. Перейти без сохранения?')) { choose.value = page; return; }
      location.assign('/' + (choose.value === 'index.html' ? '' : choose.value) + '?edit=1');
    });
    editor = el('div','sr-copy-editor'); editor.hidden = true;
    const label = el('label','','Выбранный текст');
    field = el('textarea'); field.rows = 4; field.maxLength = 3000; label.append(field);
    const applyButton = el('button','sr-copy-primary','Применить'); applyButton.type = 'button'; applyButton.addEventListener('click',applyField);
    const revertButton = el('button','','Исходный текст'); revertButton.type = 'button';
    revertButton.addEventListener('click', () => { if (chosen) { field.value = original.get(chosen).base.trim(); applyField(); } });
    const closeButton = el('button','','Закрыть'); closeButton.type = 'button'; closeButton.addEventListener('click',unselect);
    editor.append(label,applyButton,revertButton,closeButton);
    staleBox = el('div','sr-copy-stale-box'); staleBox.hidden = true;
    counter = el('p','sr-copy-muted','Все изменения опубликованы');
    const actions = el('div','sr-copy-actions');
    saveButton = el('button','sr-copy-primary','Опубликовать'); saveButton.type = 'button'; saveButton.addEventListener('click',publish);
    const cancel = el('button','','Отменить правки'); cancel.type = 'button';
    cancel.addEventListener('click',() => { draft = {...saved}; dropStale = false; apply(draft); visual?.cancel(); unselect(); refresh(); message('Неопубликованные правки отменены.'); });
    const historyButton = el('button','','История версий'); historyButton.type = 'button'; historyButton.addEventListener('click', showHistory);
    const exit = el('a','sr-copy-exit','Завершить'); exit.href = location.pathname;
    exit.addEventListener('click',event => { if (dirty() && !confirm('Завершить без публикации?')) event.preventDefault(); });
    actions.append(saveButton,cancel,historyButton,exit);
    historyBox = el('div','sr-copy-history-box'); historyBox.hidden = true;
    status = el('p','sr-copy-status'); status.setAttribute('role','status');
    panel.append(title,hint,choose,editor,staleBox,counter,actions,historyBox,status);
    document.body.append(panel);
    document.addEventListener('click', event => {
      const span = event.target.closest?.('[data-sr-copy-key]');
      if (!span || panel.contains(span)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      select(span.dataset.srCopyKey,span);
    },true);
    window.addEventListener('beforeunload',event => {
      if (!dirty()) return;
      event.preventDefault(); event.returnValue = '';
    });
    refresh();
  }
  function decorate(keys) {
    for (const key of keys) {
      const item = original.get(key);
      if (!item?.node.parentNode) continue;
      const span = el('span','sr-copy-target');
      span.dataset.srCopyKey = key;
      item.node.before(span);
      span.append(item.node);
      span.title = 'Редактировать фрагмент';
    }
    document.documentElement.classList.add('sr-copy-editing');
  }
  async function start() {
    const keys = collect();
    visual = window.SRLandingVisual?.create() || null;
    try {
      // Запрос уже отправлен из boot.js; если нет — свой
      const early = window.__srLanding;
      load(early ? await early : await api('/account/api/landing?page=' + encodeURIComponent(page)));
    } catch (error) {
      console.warn('[landing editor] Published copy unavailable:', error.message);
      return; // Preserve original landing text if the account server is offline.
    }
    if (!editing) return;
    try {
      const me = await api('/account/api/me');
      if (me.user?.role !== 'admin') return;
    } catch { return; } // Never show editing controls to unauthenticated visitors.
    decorate(keys); makePanel();
    visual?.enable({panel,api,changed:refresh,message});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
