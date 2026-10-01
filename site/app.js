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

  function openRequest(service, trigger) {
    lastFocus = trigger || document.activeElement;
    if (serviceSelect && service) {
      const exact = Array.from(serviceSelect.options).some(option => option.value === service);
      serviceSelect.value = exact ? service : 'Подбор подходящего формата';
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
      let copied = 'ok';
      try {
        await navigator.clipboard.writeText(text);
        if (requestStatus) requestStatus.textContent = 'Текст заявки скопирован. Открываю Telegram…';
      } catch {
        copied = 'fail';
        if (requestStatus) requestStatus.textContent = 'Открываю Telegram. При необходимости скопируйте текст заявки вручную.';
      }
      window.srPulse?.('telegram', 'copy-' + copied);
      window.location.assign(`https://t.me/${encodeURIComponent(username)}`);
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