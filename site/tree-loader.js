(() => {
  const stage = document.querySelector('.tree-stage');
  if (!stage) return;

  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const compact = window.matchMedia?.('(max-width: 900px)').matches;
  const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  if (reduced || compact || iOS) {
    stage.classList.add('is-disabled');
    return;
  }

  const three = document.createElement('script');
  three.src = 'https://cdn.jsdelivr.net/npm/three@0.161.0/build/three.min.js';
  three.async = true;
  three.addEventListener('load', () => {
    const tree = document.createElement('script');
    tree.src = 'tree.js';
    tree.async = true;
    document.head.appendChild(tree);
  });
  three.addEventListener('error', () => stage.classList.add('is-disabled'));
  document.head.appendChild(three);
})();
