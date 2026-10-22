// Страховка показа страницы. Подключается до app.js и намеренно написана на
// старом синтаксисе (var, function): так её разберёт любой Safari.
// .reveal прячется только когда этот файл отработал (класс js), а если app.js
// за 4 секунды не сказал «я запустился» (app-ready) — блоки показываются
// как есть. Без этого сбой app.js (старый iOS, блокировщик, битый кэш) оставлял
// на странице пустой экран.
(function () {
  var root = document.documentElement;
  root.classList.add('js');
  setTimeout(function () {
    if (!root.classList.contains('app-ready')) root.classList.add('reveal-all');
  }, 4000);
  // Опубликованные тексты (site/landing-editor.js): запрос уходит сразу, а
  // подмена — на DOMContentLoaded, после app.js. Раньше всё ждало событие
  // load, то есть все картинки: посетитель видел, как старый текст через
  // секунду-другую меняется на новый. Панель редактора — только администратору.
  if (window.fetch) {
    var path = location.pathname === '/' ? 'index.html' : location.pathname.slice(1);
    if (/^[a-z-]+\.html$/.test(path)) {
      window.__srLanding = fetch('/account/api/landing?page=' + encodeURIComponent(path), { credentials: 'same-origin', cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
      // Ошибку разберёт сам редактор; здесь — только чтобы не было «unhandled rejection»
      window.__srLanding['catch'](function () {});
      var loader = document.createElement('script');
      loader.src = '/landing-editor.js';
      document.head.appendChild(loader);
    }
  }
})();
