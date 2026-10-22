// Site copy editor. Text replacements are plain strings; markup and link targets are untouched.
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
  let saved = {}, draft = {}, revision = 0, chosen = null, active = null;
  let panel, status, counter, saveButton, editor, field;

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
      keys.push(key);
    }
    return keys;
  }
  function apply(changes) {
    original.forEach((info, key) => {
      info.node.nodeValue = Object.prototype.hasOwnProperty.call(changes, key) ? changes[key] : info.base;
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
  function dirty() {
    return [...new Set([...Object.keys(saved), ...Object.keys(draft)])]
      .filter(key => saved[key] !== draft[key]).length;
  }
  function message(text, isError = false) {
    status.textContent = text;
    status.classList.toggle('sr-copy-error', isError);
  }
  function refresh() {
    const n = dirty();
    counter.textContent = n ? 'Неопубликованных правок: ' + n : 'Все изменения опубликованы';
    saveButton.disabled = !n;
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
  async function publish() {
    if (chosen) applyField();
    if (!dirty()) return;
    saveButton.disabled = true;
    message('Сохраняю на сервере…');
    try {
      const data = await api('/account/api/admin/landing', {page, revision, changes: draft});
      revision = data.revision;
      saved = {...data.changes};
      draft = {...saved};
      refresh();
      message('Опубликовано! Новые тексты видны всем посетителям сайта.');
    } catch (error) { message(error.message, true); refresh(); }
  }
  function makePanel() {
    const link = el('link'); link.rel = 'stylesheet'; link.href = '/landing-editor.css'; document.head.append(link);
    panel = el('section', 'sr-copy-panel'); panel.setAttribute('aria-label', 'Редактор текстов лендинга');
    const title = el('strong','sr-copy-title','✎ Редактирование текстов');
    const hint = el('p','sr-copy-muted','Нажмите на выделенный текст на странице. Ссылки, изображения и оформление не изменяются.');
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
    counter = el('p','sr-copy-muted','Все изменения опубликованы');
    const actions = el('div','sr-copy-actions');
    saveButton = el('button','sr-copy-primary','Опубликовать'); saveButton.type = 'button'; saveButton.addEventListener('click',publish);
    const cancel = el('button','','Отменить правки'); cancel.type = 'button';
    cancel.addEventListener('click',() => { draft = {...saved}; apply(draft); unselect(); refresh(); message('Неопубликованные правки отменены.'); });
    const exit = el('a','sr-copy-exit','Завершить'); exit.href = location.pathname;
    exit.addEventListener('click',event => { if (dirty() && !confirm('Завершить без публикации?')) event.preventDefault(); });
    actions.append(saveButton,cancel,exit);
    status = el('p','sr-copy-status'); status.setAttribute('role','status');
    panel.append(title,hint,choose,editor,counter,actions,status);
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
    try {
      const data = await api('/account/api/landing?page=' + encodeURIComponent(page));
      revision = data.revision;
      saved = data.changes || {};
      draft = {...saved};
      apply(saved);
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
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
