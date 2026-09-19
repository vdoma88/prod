(() => {
  // Укажите Telegram username без @, когда он будет готов.
  // Если поле пустое, кнопка откроет стандартный Telegram share с готовым текстом заявки.
  const SITE_CONFIG = { telegramUsername: "" };

  const menuBtn = document.querySelector('.menu-btn');
  const mobileNav = document.querySelector('.mobile-nav');

  menuBtn?.addEventListener('click', () => {
    const open = menuBtn.getAttribute('aria-expanded') === 'true';
    menuBtn.setAttribute('aria-expanded', String(!open));
    mobileNav.hidden = open;
    document.body.classList.toggle('menu-open', !open);
  });

  mobileNav?.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
    mobileNav.hidden = true;
    menuBtn?.setAttribute('aria-expanded','false');
    document.body.classList.remove('menu-open');
  }));

  const io = 'IntersectionObserver' in window
    ? new IntersectionObserver(entries => entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      }), {threshold: 0.12})
    : null;

  document.querySelectorAll('.reveal').forEach(el => {
    if (io) io.observe(el);
    else el.classList.add('is-visible');
  });

  const dialog = document.getElementById('request-dialog');
  const serviceSelect = document.getElementById('request-service');
  const messageField = document.getElementById('request-message');
  const requestStatus = document.getElementById('request-status');
  const selectedService = document.getElementById('selected-service-name');

  function buildText() {
    const service = serviceSelect?.value || 'Подбор формата';
    const base = `Здравствуйте, Екатерина!\nМеня интересует: ${service}.\nПожалуйста, пришлите подробности и условия участия.`;
    const extra = messageField?.value?.trim();
    return extra ? `${base}\n\n${extra}` : base;
  }

  function openRequest(service) {
    if (serviceSelect && service) serviceSelect.value = service;
    if (selectedService) selectedService.textContent = service || 'Подбор формата';
    if (requestStatus) requestStatus.textContent = '';
    if (dialog?.showModal) dialog.showModal();
  }

  document.querySelectorAll('[data-open-request]').forEach(btn => {
    btn.addEventListener('click', () => openRequest(btn.dataset.service || 'Подбор формата'));
  });

  document.querySelector('.request-close')?.addEventListener('click', () => dialog?.close());
  dialog?.addEventListener('click', e => {
    if (e.target === dialog) dialog.close();
  });

  document.getElementById('copy-request')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(buildText());
      requestStatus.textContent = 'Текст заявки скопирован.';
    } catch {
      requestStatus.textContent = 'Не удалось скопировать автоматически. Выделите текст вручную.';
    }
  });

  document.getElementById('share-request')?.addEventListener('click', async () => {
    const text = buildText();
    const username = SITE_CONFIG.telegramUsername.trim().replace(/^@/, '');
    const pageUrl = window.location.href;

    if (username) {
      try {
        await navigator.clipboard.writeText(text);
        requestStatus.textContent = 'Текст заявки скопирован. Открываю Telegram…';
      } catch {
        requestStatus.textContent = 'Открываю Telegram. Если нужно, скопируйте текст заявки вручную.';
      }
      window.open(`https://t.me/${encodeURIComponent(username)}`, '_blank', 'noopener,noreferrer');
      return;
    }

    const share = `https://t.me/share/url?url=${encodeURIComponent(pageUrl)}&text=${encodeURIComponent(text)}`;
    window.open(share, '_blank', 'noopener,noreferrer');
    requestStatus.textContent = 'Telegram открыт с подготовленным текстом заявки.';
  });

  document.querySelectorAll('.faq-item').forEach(item => {
    const button = item.querySelector('.faq-question');
    const answer = item.querySelector('.faq-answer');
    if (!button || !answer) return;

    const answerId = answer.id || `faq-${Math.random().toString(36).slice(2,9)}`;
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