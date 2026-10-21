(() => {
  document.documentElement.classList.add('app-ready');
  const SITE_CONFIG = { telegramUsername: "BelayaKatrin", schoolUrl: "https://plamya.belayarod.ru/" };

  // CSP-safe fallback for hero images. Inline onerror handlers are blocked by the site's CSP,
  // so fallbacks are wired from this external script instead.
  document.querySelectorAll('img[data-fallback-src]').forEach(img => {
    img.addEventListener('error', () => {
      const fallback = img.dataset.fallbackSrc;
      if (!fallback || img.dataset.fallbackUsed === '1') return;
      img.dataset.fallbackUsed = '1';
      img.src = fallback;
    }, { once: true });
  });

  // До объединения по адресу belayarod.ru жила школа «Язык Пламени», и у
  // учениц на экране телефона осталась её иконка: она открывает корень сайта
  // в режиме приложения. Теперь в корне лендинг, поэтому такой запуск
  // переводим в школу. Своя иконка лендинга стартует с ?app=hub
  // (site.webmanifest) — это запоминаем на сессию, чтобы переходы внутри
  // установленного лендинга не уводили в школу.
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
  if (standalone) {
    let hubApp = new URLSearchParams(location.search).get('app') === 'hub';
    try {
      if (hubApp) sessionStorage.setItem('sr_hub_app', '1');
      else hubApp = sessionStorage.getItem('sr_hub_app') === '1';
    } catch { /* без sessionStorage просто не запоминаем */ }
    if (!hubApp && /^\/(index\.html)?$/.test(location.pathname)) {
      location.replace(SITE_CONFIG.schoolUrl);
      return;
    }
  }

  const menuBtn = document.querySelector('.menu-btn');
  const mobileNav = document.querySelector('.mobile-nav');
  const dialog = document.getElementById('request-dialog');
  const serviceSelect = document.getElementById('request-service');
  const messageField = document.getElementById('request-message');
  const requestStatus = document.getElementById('request-status');
  const selectedService = document.getElementById('selected-service-name');
  let lastFocus = null;

  function closeMenu() {
    if (!mobileNav) return;
    mobileNav.hidden = true;
    menuBtn?.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('menu-open');
  }

  menuBtn?.addEventListener('click', () => {
    const open = menuBtn.getAttribute('aria-expanded') === 'true';
    menuBtn.setAttribute('aria-expanded', String(!open));
    if (mobileNav) mobileNav.hidden = open;
    document.body.classList.toggle('menu-open', !open);
  });

  mobileNav?.querySelectorAll('a').forEach(a => a.addEventListener('click', closeMenu));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeMenu();
  });

  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (!reducedMotion && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        io.unobserve(entry.target);
      }
    }), { threshold: 0.10, rootMargin: '0px 0px -20px 0px' });
    document.querySelectorAll('.reveal').forEach(el => io.observe(el));
  } else {
    document.querySelectorAll('.reveal').forEach(el => el.classList.add('is-visible'));
  }

  function buildText() {
    const service = serviceSelect?.value || 'Подбор формата';
    const base = `Здравствуйте, Екатерина!
Меня интересует: ${service}.
Пожалуйста, пришлите подробности и условия участия.`;
    const extra = messageField?.value?.trim();
    return extra ? `${base}\n\n${extra}` : base;
  }

  function showDialog() {
    if (!dialog) return false;
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
      return true;
    }
    dialog.setAttribute('open', '');
    dialog.setAttribute('data-fallback-open', '');
    return true;
  }

  function closeDialog() {
    if (!dialog) return;
    if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    else {
      dialog.removeAttribute('open');
      dialog.removeAttribute('data-fallback-open');
    }
    lastFocus?.focus?.();
  }

  // message — текст из подбора: подставляется, если человек ещё ничего не
  // написал сам (или в поле лежит прошлый текст подбора).
  let quizMessage = '';
  function openRequest(service, trigger, message) {
    lastFocus = trigger || document.activeElement;
    if (serviceSelect && service) {
      const exact = Array.from(serviceSelect.options).some(option => option.value === service);
      serviceSelect.value = exact ? service : 'Подбор подходящего формата';
    }
    if (messageField && message && (!messageField.value.trim() || messageField.value === quizMessage)) {
      messageField.value = message;
      quizMessage = message;
    }
    if (selectedService) selectedService.textContent = service || 'Подбор формата';
    if (requestStatus) requestStatus.textContent = '';
    if (showDialog()) {
      window.srPulse?.('dialog', dialog.open ? 'open' : 'closed');
      requestAnimationFrame(() => messageField?.focus({ preventScroll: true }));
    }
  }

  document.querySelectorAll('[data-open-request]').forEach(btn => {
    btn.addEventListener('click', () => openRequest(btn.dataset.service || 'Подбор формата', btn));
  });

  // Каталог на главной: фильтр по группам. Без JS видны все карточки.
  const tabs = document.querySelector('[data-catalog-tabs]');
  if (tabs) {
    const cards = document.querySelectorAll('#catalog-grid [data-group]');
    const buttons = tabs.querySelectorAll('[data-filter]');
    tabs.hidden = false;
    buttons.forEach(button => button.addEventListener('click', () => {
      const filter = button.dataset.filter;
      buttons.forEach(b => b.setAttribute('aria-pressed', String(b === button)));
      cards.forEach(card => { card.hidden = filter !== 'all' && card.dataset.group !== filter; });
      window.srPulse?.('catalog', filter);
    }));
  }

  // Подбор формата: шаг 1 в разметке, шаг 2 и итог собираются здесь из
  // данных ниже. Названия совпадают с пунктами списка в окне заявки.
  const SERVICES = {
    consult: { name: 'Индивидуальные консультации', title: 'Индивидуальная консультация', url: 'consultations.html', meta: 'Онлайн или вживую · 1:1 · одна встреча', text: 'Спокойно разложить запрос по полочкам и понять следующий шаг. Можно ограничиться одной встречей.' },
    rod: { name: 'Связь с Родом', title: 'Связь с Родом', url: 'therapy.html', meta: '3 месяца · 1:1 · онлайн или вживую', text: 'Личное сопровождение: увидеть повторяющийся сценарий, понять, что его держит, и собрать свою опору.' },
    game: { name: 'Игра «Сила Рода»', title: 'Игра «Сила Рода»', url: 'game.html', meta: 'Вживую · индивидуально или в группе', text: 'Посмотреть на ситуацию через символы и вопросы и уйти с конкретным следующим шагом.' },
    mystery: { name: 'Мистерия «Сила Рода»', title: 'Мистерия «Сила Рода»', url: 'mystery.html', meta: 'Вживую · до 15 участниц · 120 минут', text: 'Камерный женский круг с огнём, солью, воском и бубном — пауза, тишина и собранность.' },
    offerings: { name: 'Подношения духам предков', title: 'Подношения духам предков', url: 'offerings.html', meta: 'Индивидуально · ритуал', text: 'Светлый ритуал благодарности и памяти рода. Сначала обсуждаем намерение и границы.' },
    massage: { name: 'Огненный массаж', title: 'Огненный массаж', url: 'massage.html', meta: 'Вживую · только индивидуально', text: 'Тепло, расслабление и контакт с телом — после обсуждения самочувствия и противопоказаний.' },
    candles: { name: 'Свечные практики', title: 'Свечные практики · Язык Пламени', url: 'candle-course.html', meta: 'Онлайн-курс', text: 'Воск, фитиль, форма, безопасность и осмысленная работа с живым огнём.' },
    tarot: { name: 'Карта как зеркало', title: 'Карта как зеркало', url: 'tarot-course.html', meta: 'Онлайн-курс', text: 'Таро и метафорические ассоциативные карты: 48 уроков, два равных направления практики.' },
    runes: { name: 'Руны', title: 'Руны', url: 'runes.html', meta: 'Онлайн-курс с куратором', text: 'Старший и Младший футарк — от истории знаков к собственной практике.' },
  };
  const QUIZ = {
    rod: { label: 'хожу по кругу в сценариях семьи', question: 'Как вам комфортнее начать?', options: [
      { label: 'Глубоко и лично, один на один', hint: 'Последовательная работа на три месяца', pick: ['rod', 'consult'] },
      { label: 'Сначала одна встреча', hint: 'Понять, нужна ли большая работа', pick: ['consult', 'rod'] },
      { label: 'Через живой опыт и образы', hint: 'Игра или круг вместо разговора', pick: ['game', 'mystery'] },
    ] },
    support: { label: 'нужна опора в сложный период', question: 'Какой формат ближе?', options: [
      { label: 'Разговор один на один', hint: 'Спокойно, без спешки', pick: ['consult', 'rod'] },
      { label: 'Женский круг', hint: 'Побыть среди своих', pick: ['mystery', 'game'] },
      { label: 'Ритуал памяти и благодарности роду', hint: 'Опереться на предков', pick: ['offerings', 'consult'] },
    ] },
    study: { label: 'хочу освоить инструмент для себя', question: 'Какой инструмент ближе?', options: [
      { label: 'Карта как зеркало', hint: 'Таро и МАК · 48 уроков', pick: ['tarot', 'runes'] },
      { label: 'Руны', hint: 'Древние знаки, футарк', pick: ['runes', 'tarot'] },
      { label: 'Свечи и воск', hint: 'Работа с живым огнём', pick: ['candles', 'mystery'] },
    ] },
    body: { label: 'нужна перезагрузка через тело и огонь', question: 'Как вам комфортнее?', options: [
      { label: 'Индивидуально', hint: 'Только вы и Екатерина', pick: ['massage', 'consult'] },
      { label: 'В женском круге', hint: 'Огонь, соль, воск, бубен', pick: ['mystery', 'game'] },
    ] },
  };

  const quiz = document.querySelector('[data-quiz]');
  if (quiz) {
    const steps = quiz.querySelectorAll('[data-quiz-step]');
    const dots = quiz.querySelectorAll('.quiz-progress li');
    const el = (tag, className, text) => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text) node.textContent = text;
      return node;
    };
    const choice = (label, hint, onClick) => {
      const button = el('button', 'quiz-option');
      button.type = 'button';
      button.append(el('b', '', label), el('span', '', hint));
      button.addEventListener('click', onClick);
      return button;
    };
    const back = (label, onClick) => {
      const button = el('button', 'quiz-back', label);
      button.type = 'button';
      button.addEventListener('click', onClick);
      return button;
    };
    const show = (index, focus = true) => {
      steps.forEach((step, i) => { step.hidden = i !== index; });
      dots.forEach((dot, i) => dot.classList.toggle('is-on', i <= index));
      if (focus) steps[index].querySelector('.quiz-question')?.focus({ preventScroll: false });
    };

    function renderResult(branch, option) {
      const [mainId, altId] = option.pick;
      const main = SERVICES[mainId];
      const alt = altId && SERVICES[altId];
      const step = steps[2];
      step.replaceChildren();
      step.append(el('p', 'quiz-count', 'ШАГ 3 ИЗ 3 · ВАШ СТАРТ'));
      const title = el('h3', 'quiz-question', main.title);
      title.tabIndex = -1;
      step.append(title, el('p', 'quiz-meta', main.meta), el('p', 'quiz-text', main.text));
      const actions = el('div', 'quiz-actions');
      const write = el('button', 'primary-btn', 'НАПИСАТЬ ЕКАТЕРИНЕ →');
      write.type = 'button';
      const message = `Подбор на сайте: ${branch.label}; ${option.label.toLowerCase()}.`;
      write.addEventListener('click', () => {
        window.srPulse?.('quiz', 'write-' + mainId);
        openRequest(main.name, write, message);
      });
      const more = el('a', 'ap-text-action', 'Подробнее о формате ↗');
      more.href = main.url;
      actions.append(write, more);
      step.append(actions);
      if (alt) {
        const also = el('p', 'quiz-also', 'Ещё может подойти: ');
        const link = el('a', '', alt.title);
        link.href = alt.url;
        also.append(link);
        step.append(also);
      }
      step.append(back('← Пройти заново', () => show(0)));
      show(2);
      window.srPulse?.('quiz', 'result-' + mainId);
    }

    function renderSecond(branchId) {
      const branch = QUIZ[branchId];
      const step = steps[1];
      step.replaceChildren();
      step.append(el('p', 'quiz-count', 'ШАГ 2 ИЗ 3'));
      const title = el('h3', 'quiz-question', branch.question);
      title.tabIndex = -1;
      const options = el('div', 'quiz-options');
      branch.options.forEach(option => options.append(choice(option.label, option.hint, () => renderResult(branch, option))));
      step.append(title, options, back('← Назад', () => show(0)));
      show(1);
    }

    quiz.querySelectorAll('[data-quiz-answer]').forEach(button => {
      button.addEventListener('click', () => {
        window.srPulse?.('quiz', button.dataset.quizAnswer);
        renderSecond(button.dataset.quizAnswer);
      });
    });
  }

  document.querySelector('.request-close')?.addEventListener('click', closeDialog);
  dialog?.addEventListener('click', event => {
    if (event.target === dialog) closeDialog();
  });
  dialog?.addEventListener('cancel', event => {
    event.preventDefault();
    closeDialog();
  });

  document.getElementById('copy-request')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(buildText());
      window.srPulse?.('copy', 'ok');
      if (requestStatus) requestStatus.textContent = 'Текст заявки скопирован.';
    } catch {
      window.srPulse?.('copy', 'fail');
      if (requestStatus) requestStatus.textContent = 'Не удалось скопировать автоматически. Выделите текст вручную.';
    }
  });

  document.getElementById('share-request')?.addEventListener('click', async () => {
    const text = buildText();
    const username = SITE_CONFIG.telegramUsername.trim().replace(/^@/, '');
    const pageUrl = window.location.href;

    if (username) {
      // ?text= кладёт заявку прямо в строку сообщения: человеку остаётся
      // нажать «Отправить». Копия в буфере — запас для старых версий
      // Telegram, которые этот параметр не знают.
      let copied = 'ok';
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        copied = 'fail';
      }
      if (requestStatus) requestStatus.textContent = 'Открываю Telegram — текст уже в строке сообщения, останется нажать «Отправить».';
      window.srPulse?.('telegram', 'text-copy-' + copied);
      window.location.assign(`https://t.me/${encodeURIComponent(username)}?text=${encodeURIComponent(text)}`);
      return;
    }

    const share = `https://t.me/share/url?url=${encodeURIComponent(pageUrl)}&text=${encodeURIComponent(text)}`;
    const opened = window.open(share, '_blank', 'noopener,noreferrer');
    if (!opened) window.location.assign(share);
    if (requestStatus) requestStatus.textContent = 'Telegram открыт с подготовленным текстом заявки.';
  });

  document.querySelectorAll('.faq-item').forEach((item, index) => {
    const button = item.querySelector('.faq-question');
    const answer = item.querySelector('.faq-answer');
    if (!button || !answer) return;

    const answerId = answer.id || `faq-answer-${index + 1}`;
    answer.id = answerId;
    button.setAttribute('aria-controls', answerId);
    button.setAttribute('aria-expanded', 'false');

    button.addEventListener('click', () => {
      const open = item.classList.toggle('is-open');
      button.setAttribute('aria-expanded', String(open));
      const marker = button.querySelector('span');
      if (marker) marker.textContent = open ? '−' : '+';
    });
  });
})();
