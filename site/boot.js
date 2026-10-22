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
  // Все страницы site/ загружают boot.js. После основных скриптов применяем
  // опубликованные тексты; панель редактора доступна только администратору.
  window.addEventListener('load', function () {
    var loader = document.createElement('script');
    loader.src = '/landing-editor.js';
    document.head.appendChild(loader);
  });
})();
