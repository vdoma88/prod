/*! Сила Рода · общий бренд v1.1.0 · https://github.com/vdoma88/prod/tree/main/brand */
// Общие элементы для всех проектов Екатерины Белой: лендинга belayarod.ru
// и четырёх учебных приложений. Подключается одним тегом:
//
//   <script src="/brand/sr-brand.js" defer></script>
//
// и даёт три элемента:
//
//   <sr-brand-bar product="runes"></sr-brand-bar>   тонкая шапка «Екатерина Белая · Курсы»
//   <sr-courses product="runes"></sr-courses>       карточки других курсов (профиль, вход)
//   <sr-footer product="runes"></sr-footer>         общий подвал
//
// Всё рисуется внутри Shadow DOM: стили приложений (Tailwind, свои CSS)
// не задевают шапку, а её стили — приложение. Стили лежат отдельным файлом
// sr-brand.css рядом со скриптом и подключаются <link>: так элементы
// работают при строгом CSP (style-src 'self') без 'unsafe-inline'.
// По той же причине цвета из данных ставятся через CSSOM, а не атрибутом style.
//
// Список курсов — PROJECTS ниже. Это единственное место, где он записан:
// лендинг, проверки (scripts/check.mjs) и документация сверяются с ним.
(() => {
  'use strict';

  const VERSION = '1.1.0';
  if (!window.customElements || window.customElements.get('sr-brand-bar')) return;

  const script = document.currentScript;
  const BASE = new URL('.', (script && script.src) || new URL('/brand/', location.href));
  // data-hub нужен только для staging и локальной разработки лендинга.
  const HUB = ((script && script.dataset.hub) || 'https://belayarod.ru').replace(/\/+$/, '');

  const PROJECTS = [
    {
      id: 'rod',
      title: 'Связь с Родом',
      note: 'Родовая карта пути · сопровождение по шагам',
      url: 'https://rod.belayarod.ru/',
      about: '/therapy.html',
      accent: '#9a6a3a',
    },
    {
      id: 'plamya',
      title: 'Язык Пламени',
      note: 'Школа свечной магии и восковых отливок',
      url: 'https://plamya.belayarod.ru/',
      about: '/candle-course.html',
      accent: '#c04828',
    },
    {
      id: 'taro',
      title: 'Карты Таро',
      note: 'Колода, расклады, книга «Карта как зеркало»',
      url: 'https://taro.belayarod.ru/',
      about: '/tarot-course.html',
      accent: '#76603d',
    },
    {
      id: 'runes',
      title: 'Руны',
      note: 'Старший и Младший футарк',
      url: 'https://runes.belayarod.ru/',
      about: '/runes.html',
      accent: '#744153',
    },
  ];

  const MARK_PATH =
    'M32 47V24M32 30c-7-8-13-5-14-1 4 2 9 4 14 9M32 29c8-8 14-5 15-1-5 2-10 5-15 10' +
    'M32 40c-5 4-8 8-9 12M32 40c6 4 9 8 10 12';
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === false || value == null) continue;
      if (key === 'text') el.textContent = value;
      else el.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children) if (child) el.append(child);
    return el;
  }

  function mark() {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 64 64');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'mark');
    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('cx', '32');
    circle.setAttribute('cy', '32');
    circle.setAttribute('r', '26');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', MARK_PATH);
    svg.append(circle, path);
    return svg;
  }

  function hubUrl(path) {
    return HUB + path;
  }

  // Каждый элемент рисует себя один раз: при первом подключении к документу.
  // Повторная вставка того же узла (React перемещает узлы) ничего не ломает.
  class BrandElement extends HTMLElement {
    connectedCallback() {
      if (this.shadowRoot) return;
      const root = this.attachShadow({ mode: 'open' });
      const sheet = h('link', { rel: 'stylesheet', href: new URL('sr-brand.css', BASE).href });
      const body = h('div', { class: 'root', part: 'root' });
      // Пока стили не загрузились, содержимое не показываем — иначе мелькнёт
      // неоформленный список ссылок. Место под шапку при этом уже занято.
      body.style.visibility = 'hidden';
      const reveal = () => { body.style.visibility = ''; };
      sheet.addEventListener('load', reveal);
      sheet.addEventListener('error', reveal);
      root.append(sheet, body);
      this.render(body);
    }

    get product() {
      return (this.getAttribute('product') || '').trim();
    }

    // React 19 передаёт атрибуты custom element свойствами, если свойство
    // есть у элемента: без сеттера <sr-courses product="…"> упал бы с TypeError.
    // Элемент рисуется один раз, поэтому значение пишется только в атрибут.
    set product(value) {
      this.setAttribute('product', String(value ?? ''));
    }
  }

  class BrandBar extends BrandElement {
    render(body) {
      this.style.display = 'block';
      this.style.minHeight = '44px';
      body.classList.add('bar');
      if (this.getAttribute('tone') === 'light') body.classList.add('light');
      if (this.hasAttribute('safe-top')) body.classList.add('safe-top');

      const home = h('a', { class: 'home', href: hubUrl('/'), title: 'Все направления Екатерины Белой' },
        mark(),
        h('span', { class: 'name', text: 'Екатерина Белая' }),
        h('span', { class: 'sub', text: 'Сила Рода' }));

      const menuId = 'sr-menu';
      const toggle = h('button', { class: 'toggle', type: 'button', 'aria-expanded': 'false', 'aria-controls': menuId },
        h('span', { text: 'Курсы' }), h('span', { class: 'chev', 'aria-hidden': 'true' }));
      const mine = h('a', { class: 'mine', href: hubUrl('/courses.html'), text: 'Мои курсы' });

      const list = h('ul', { class: 'menu-list' });
      for (const project of PROJECTS) {
        const current = project.id === this.product;
        const dot = h('i', { class: 'dot', 'aria-hidden': 'true' });
        dot.style.setProperty('--dot', project.accent);
        list.append(h('li', null, h('a', {
          class: current ? 'item current' : 'item',
          href: project.url,
          'aria-current': current ? 'page' : false,
        }, dot, h('span', null, h('b', { text: project.title }), h('small', { text: current ? 'Вы здесь' : project.note })))));
      }
      const menu = h('div', { class: 'menu', id: menuId, hidden: true },
        list,
        h('a', { class: 'all', href: hubUrl('/#services'), text: 'Все направления Екатерины →' }));

      body.append(h('nav', { class: 'inner', 'aria-label': 'Курсы Екатерины Белой' },
        home, h('div', { class: 'actions' }, toggle, mine), menu));

      const setOpen = (open, restoreFocus) => {
        menu.hidden = !open;
        toggle.setAttribute('aria-expanded', String(open));
        if (!open && restoreFocus) toggle.focus();
      };
      toggle.addEventListener('click', () => setOpen(menu.hidden));
      body.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !menu.hidden) {
          event.stopPropagation();
          setOpen(false, true);
        }
      });
      // Щелчок или переход фокуса за пределы шапки закрывает меню.
      // composedPath видит и узлы внутри Shadow DOM.
      document.addEventListener('pointerdown', event => {
        if (!menu.hidden && !event.composedPath().includes(this)) setOpen(false);
      });
      this.addEventListener('focusout', event => {
        if (!menu.hidden && event.relatedTarget && !this.contains(event.relatedTarget) &&
            !this.shadowRoot.contains(event.relatedTarget)) setOpen(false);
      });
    }
  }

  class Courses extends BrandElement {
    render(body) {
      this.style.display = 'block';
      body.classList.add('courses');
      if (this.getAttribute('tone') === 'dark') body.classList.add('dark');
      const heading = this.getAttribute('heading') || 'Другие курсы Екатерины';
      const others = PROJECTS.filter(project => project.id !== this.product);
      const grid = h('ul', { class: 'course-grid' });
      for (const project of others) {
        const card = h('li', { class: 'course' },
          h('b', { text: project.title }),
          h('small', { text: project.note }),
          h('span', { class: 'links' },
            h('a', { class: 'open', href: project.url, text: 'Войти' }),
            h('a', { class: 'about', href: hubUrl(project.about), text: 'О курсе' })));
        card.style.setProperty('--dot', project.accent);
        grid.append(card);
      }
      body.append(h('section', { 'aria-label': heading },
        h('p', { class: 'heading', text: heading }), grid,
        h('a', { class: 'all', href: hubUrl('/courses.html'), text: 'Все мои курсы →' })));
    }
  }

  class Footer extends BrandElement {
    render(body) {
      this.style.display = 'block';
      body.classList.add('footer');
      if (this.getAttribute('tone') === 'dark') body.classList.add('dark');
      const links = h('nav', { class: 'footer-links', 'aria-label': 'Сила Рода' },
        h('a', { href: hubUrl('/'), text: 'Все направления' }),
        h('a', { href: hubUrl('/courses.html'), text: 'Мои курсы' }));
      body.append(h('div', { class: 'footer-inner' },
        h('span', null, mark(), h('span', { text: `© ${new Date().getFullYear()} Екатерина Белая · Сила Рода` })),
        links));
    }
  }

  customElements.define('sr-brand-bar', BrandBar);
  customElements.define('sr-courses', Courses);
  customElements.define('sr-footer', Footer);

  // Данные — для страницы «Мои курсы» и проверок; менять их отсюда нельзя.
  window.SR_BRAND = Object.freeze({
    version: VERSION,
    hub: HUB,
    projects: Object.freeze(PROJECTS.map(project => Object.freeze({ ...project }))),
  });
})();
