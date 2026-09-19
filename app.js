
(() => {
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

  const io = new IntersectionObserver(entries => entries.forEach(entry => {
    if (entry.isIntersecting) entry.target.classList.add('is-visible');
  }), {threshold: 0.12});
  document.querySelectorAll('.reveal').forEach(el => io.observe(el));

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
    requestStatus.textContent = '';
    if (dialog?.showModal) dialog.showModal();
  }

  document.querySelectorAll('[data-open-request]').forEach(btn => {
    btn.addEventListener('click', () => openRequest(btn.dataset.service || 'Подбор формата'));
  });

  document.querySelector('.request-close')?.addEventListener('click', () => dialog?.close());
  dialog?.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });

  document.getElementById('copy-request')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(buildText());
      requestStatus.textContent = 'Текст заявки скопирован.';
    } catch {
      requestStatus.textContent = 'Не удалось скопировать автоматически. Скопируйте текст вручную.';
    }
  });

  document.getElementById('share-request')?.addEventListener('click', async () => {
    const text = buildText();
    if (navigator.share) {
      try {
        await navigator.share({title: 'Заявка на услугу', text});
        requestStatus.textContent = 'Меню «Поделиться» открыто.';
      } catch (error) {
        if (error?.name !== 'AbortError') requestStatus.textContent = 'Не удалось открыть меню «Поделиться».';
      }
    } else {
      try {
        await navigator.clipboard.writeText(text);
        requestStatus.textContent = 'Меню «Поделиться» недоступно — текст скопирован.';
      } catch {
        requestStatus.textContent = 'Скопируйте текст вручную.';
      }
    }
  });

  document.querySelectorAll('.faq-item').forEach(item => {
    item.querySelector('.faq-question')?.addEventListener('click', () => {
      item.classList.toggle('is-open');
    });
  });
})();
