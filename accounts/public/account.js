// Общий вход «Сила Рода»: вход, «Мои курсы», пароль по ссылке и админка.
// Без innerHTML и inline-кода — страницы собираются через h() (строгий CSP).
'use strict';

const ROLE_TITLES = { student: 'Ученица', curator: 'Куратор', admin: 'Администратор' };
const STATUS_TITLES = { locked: 'Закрыт', open: 'Открыт', done: 'Принят' };
const app = document.getElementById('app');
const logoutBtn = document.getElementById('logout');

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children.flat(Infinity)) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
}
const show = (...nodes) => app.replaceChildren(...nodes);

async function call(path, body) {
  const res = await fetch('api/' + path, body === undefined
    ? { credentials: 'same-origin' }
    : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-SR': '1' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || 'Не получилось. Попробуйте ещё раз.'); e.status = res.status; throw e; }
  return data;
}

// Форма с одной кнопкой: ошибки показываются под ней, кнопка блокируется на время запроса.
function form(fields, label, submit) {
  const err = h('p', { class: 'error', role: 'alert', hidden: true });
  const btn = h('button', { class: 'btn', type: 'submit' }, label);
  const f = h('form', { onsubmit: async (e) => {
    e.preventDefault();
    err.hidden = true; btn.disabled = true;
    try { await submit(new FormData(f)); } catch (x) { err.textContent = x.message; err.hidden = false; } finally { btn.disabled = false; }
  } }, fields, btn, err);
  return f;
}
const field = (label, attrs) => { const id = 'f-' + attrs.name; return [h('label', { for: id }, label), h('input', { id, ...attrs })]; };

// ─── Вход и пароль ───

function loginView() {
  logoutBtn.hidden = true;
  show(h('section', { class: 'card narrow' },
    h('h1', null, 'Вход'),
    h('p', { class: 'muted' }, 'Один вход для всех курсов Екатерины Белой.'),
    form([
      field('Почта', { name: 'email', type: 'email', autocomplete: 'username', required: true }),
      field('Пароль', { name: 'password', type: 'password', autocomplete: 'current-password', required: true }),
    ], 'Войти', async (d) => { home(await call('login', { email: d.get('email'), password: d.get('password') })); }),
    h('p', { class: 'muted small' }, 'Забыли пароль или ещё не задали его? Напишите куратору — он пришлёт ссылку.')));
}

function resetView(token) {
  logoutBtn.hidden = true;
  show(h('section', { class: 'card narrow' },
    h('h1', null, 'Новый пароль'),
    h('p', { class: 'muted' }, 'Не короче 10 знаков. Ссылка действует один раз.'),
    form([
      field('Пароль', { name: 'password', type: 'password', autocomplete: 'new-password', minlength: 10, required: true }),
      field('Ещё раз', { name: 'again', type: 'password', autocomplete: 'new-password', minlength: 10, required: true }),
    ], 'Сохранить и войти', async (d) => {
      if (d.get('password') !== d.get('again')) throw new Error('Пароли не совпадают.');
      const me = await call('reset', { token, password: d.get('password') });
      history.replaceState(null, '', location.pathname);
      home(me);
    })));
}

// ─── Мои курсы ───

function home(me) {
  logoutBtn.hidden = false;
  const cards = me.courses.map(c => c.enabled
    ? h('a', { class: 'course', href: c.url }, h('strong', null, c.title), h('span', { class: 'muted small' }, 'Открыть курс →'))
    : h('div', { class: 'course off' }, h('strong', null, c.title), h('span', { class: 'muted small' }, 'Пока закрыт')));
  const parts = [
    h('h1', null, `Здравствуйте, ${me.user.name}`),
    h('section', null, h('h2', null, 'Мои курсы'), h('div', { class: 'courses' }, cards)),
  ];
  if (me.user.role === 'admin') {
    const box = h('section', { class: 'pad' });
    parts.push(h('div', { class: 'pad' }), box);
    adminView(box, me.user);
  }
  show(...parts);
}

// ─── Админка ───

async function adminView(box, admin) {
  box.replaceChildren(h('h2', null, 'Учётные записи'), h('p', { class: 'muted' }, 'Загружаю…'));
  let data;
  try { data = await call('admin/users'); } catch (e) { box.replaceChildren(h('p', { class: 'error' }, e.message)); return; }
  const { users, courses } = data;
  const title = (id) => courses.find(c => c.id === id)?.title || id;
  const detail = h('div');
  const rows = users.map(u => h('tr', null,
    h('td', null, h('button', { class: 'rowbtn', type: 'button', onclick: () => userView(detail, u, courses, admin, () => adminView(box, admin)) }, u.name),
      u.active ? null : h('span', { class: 'muted small' }, ' · выключена')),
    h('td', { class: 'hide-sm' }, u.email),
    h('td', null, ROLE_TITLES[u.role]),
    h('td', { class: 'hide-sm small' }, u.role === 'admin' ? 'все' : (u.courses.map(title).join(', ') || '—'))));

  const courseChecks = h('div', { class: 'checks' }, courses.map(c => h('label', null, h('input', { type: 'checkbox', name: 'c-' + c.id }), c.title)));
  box.replaceChildren(
    h('h2', null, 'Учётные записи'),
    h('div', { class: 'card' }, h('table', null,
      h('thead', null, h('tr', null, h('th', null, 'Имя'), h('th', { class: 'hide-sm' }, 'Почта'), h('th', null, 'Роль'), h('th', { class: 'hide-sm' }, 'Курсы'))),
      h('tbody', null, rows))),
    detail,
    h('div', { class: 'card' }, h('h3', null, 'Новая учётная запись'),
      form([
        h('div', { class: 'grid2' },
          h('div', null, field('Имя', { name: 'name', required: true, maxlength: 120 })),
          h('div', null, field('Почта', { name: 'email', type: 'email', required: true }))),
        h('label', { for: 'f-role' }, 'Роль'),
        h('select', { id: 'f-role', name: 'role' }, Object.entries(ROLE_TITLES).map(([v, t]) => h('option', { value: v }, t))),
        h('label', null, 'Открыть курсы'), courseChecks,
      ], 'Создать', async (d) => {
        const r = await call('admin/users', {
          name: d.get('name'), email: d.get('email'), role: d.get('role'),
          courses: Object.fromEntries(courses.map(c => [c.id, d.get('c-' + c.id) === 'on'])),
        });
        await adminView(box, admin);
        box.append(linkNote(`Создано: ${r.user.name}. Отправьте ей ссылку, чтобы задать пароль:`, r.link));
      })));
}

function linkNote(text, link) {
  const copy = h('button', { class: 'btn ghost', type: 'button', onclick: async () => {
    try { await navigator.clipboard.writeText(link); copy.textContent = 'Скопировано'; } catch { /* выделить вручную */ }
  } }, 'Скопировать ссылку');
  return h('div', { class: 'ok' }, h('div', null, text), h('code', null, link), h('div', null, copy),
    h('div', { class: 'small muted' }, 'Ссылка действует 72 часа и один раз.'));
}

function userView(box, u, courses, admin, reload) {
  const note = h('div');
  const checks = h('div', { class: 'checks' }, courses.map(c =>
    h('label', null, h('input', { type: 'checkbox', name: 'c-' + c.id, checked: u.courses.includes(c.id) }), c.title)));
  const lessons = h('div');
  const tabs = h('div', { class: 'tabs', role: 'group', 'aria-label': 'Уроки по курсам' });
  const pick = (c) => {
    for (const b of tabs.children) b.setAttribute('aria-pressed', String(b.dataset.id === c.id));
    lessonsView(lessons, u, c);
  };
  tabs.append(...courses.filter(c => u.courses.includes(c.id)).map(c =>
    h('button', { type: 'button', 'data-id': c.id, 'aria-pressed': 'false', onclick: () => pick(c) }, c.title)));

  box.replaceChildren(h('div', { class: 'card' },
    h('h3', null, u.name), h('p', { class: 'muted small' }, u.email, u.hasPassword ? '' : ' · пароль ещё не задан'),
    form([
      h('div', { class: 'grid2' },
        h('div', null, field('Имя', { name: 'name', value: u.name, required: true, maxlength: 120 })),
        h('div', null, h('label', { for: 'f-urole' }, 'Роль'),
          h('select', { id: 'f-urole', name: 'role' }, Object.entries(ROLE_TITLES).map(([v, t]) => h('option', { value: v, selected: v === u.role }, t))))),
      h('label', null, 'Курсы'), checks,
      h('div', { class: 'checks' }, h('label', null, h('input', { type: 'checkbox', name: 'active', checked: u.active }), 'Вход разрешён')),
    ], 'Сохранить', async (d) => {
      await call('admin/users/' + u.id, {
        name: d.get('name'), role: d.get('role'), active: d.get('active') === 'on',
        courses: Object.fromEntries(courses.map(c => [c.id, d.get('c-' + c.id) === 'on'])),
      });
      await reload();
    }),
    h('button', { class: 'btn ghost', type: 'button', onclick: async () => {
      try { const r = await call(`admin/users/${u.id}/reset-link`, {}); note.replaceChildren(linkNote('Новая ссылка для пароля:', r.link)); }
      catch (e) { note.replaceChildren(h('p', { class: 'error' }, e.message)); }
    } }, 'Ссылка для пароля'),
    note,
    u.courses.length ? [h('h3', { class: 'mt' }, 'Уроки'), tabs, lessons] : h('p', { class: 'muted small' }, 'Откройте курс, чтобы управлять уроками.')));
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Уроки курса: курс сам отдаёт список и статусы, здесь их только меняем.
async function lessonsView(box, u, c) {
  box.replaceChildren(h('p', { class: 'muted' }, 'Загружаю…'));
  let data;
  try { data = await call(`admin/users/${u.id}/lessons/${c.id}`); } catch (e) { box.replaceChildren(h('p', { class: 'error' }, e.message)); return; }
  if (!data.connected) {
    box.replaceChildren(h('p', { class: 'muted' }, `«${c.title}» ещё не подключён к общему входу — уроки пока открываются в самом курсе.`));
    return;
  }
  const err = h('p', { class: 'error', hidden: true });
  const save = async (l, status) => {
    await call(`admin/users/${u.id}/lessons/${c.id}`, { lessonId: l.id, status });
    l.status = status;
    l.group$?.refresh();
  };
  const row = (l) => {
    const sel = h('select', { 'aria-label': `Статус: ${l.title}`, class: 'status-' + l.status, onchange: async () => {
      err.hidden = true; sel.disabled = true;
      try { await save(l, sel.value); } catch (e) { err.textContent = e.message; err.hidden = false; sel.value = l.status; }
      finally { sel.disabled = false; sel.className = 'status-' + l.status; }
    } }, Object.entries(STATUS_TITLES).map(([v, t]) => h('option', { value: v, selected: v === l.status }, t)));
    l.select = sel;
    return h('div', { class: 'lesson' }, h('span', null, l.title), sel);
  };
  // Уроки по группам (модулям), если курс их отдаёт: у группы — «открыть» и «закрыть» разом.
  const lessons = data.lessons || [];
  const groups = [];
  for (const l of lessons) {
    const last = groups[groups.length - 1];
    if (last && last.name === (l.group || '')) last.items.push(l); else groups.push({ name: l.group || '', items: [l] });
  }
  const bulk = (g, status, label) => h('button', { type: 'button', class: 'rowbtn', onclick: async (e) => {
    err.hidden = true; e.target.disabled = true;
    try {
      for (const l of g.items) if (l.status !== status && !(status === 'open' && l.status === 'done')) {
        await save(l, status); l.select.value = status; l.select.className = 'status-' + status;
      }
    } catch (x) { err.textContent = x.message; err.hidden = false; }
    finally { e.target.disabled = false; }
  } }, label);
  const counter = (g) => {
    const el = h('span', { class: 'muted small' });
    g.refresh = () => { el.textContent = `${g.items.filter(l => l.status !== 'locked').length} из ${g.items.length} открыто`; };
    for (const l of g.items) l.group$ = g;
    g.refresh();
    return el;
  };
  const body = groups.map(g => g.name
    ? h('details', { class: 'group', open: groups.length <= 3 },
        h('summary', null, h('strong', null, g.name), ' ', counter(g)),
        h('div', { class: 'checks' }, bulk(g, 'open', 'Открыть все'), bulk(g, 'locked', 'Закрыть все')),
        g.items.map(row))
    : h('div', null, g.items.map(row)));
  box.replaceChildren(err, lessons.length ? h('div', null, body) : h('p', { class: 'muted' }, 'В курсе нет уроков.'));
}

// ─── Старт ───

logoutBtn.addEventListener('click', async () => { try { await call('logout', {}); } finally { loginView(); } });

(async () => {
  const token = new URLSearchParams(location.hash.slice(1)).get('reset');
  if (token) return resetView(token);
  try { home(await call('me')); } catch (e) { if (e.status === 401) loginView(); else show(h('p', { class: 'error' }, e.message)); }
})();
