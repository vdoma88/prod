// Compact home: progressive catalog, existing Telegram request dialog.
(()=>{
const services=[
  {
    "id": "consult",
    "name": "Консультация",
    "category": "Личная встреча",
    "tags": [
      "personal"
    ],
    "meta": [
      "Онлайн / офлайн",
      "Один на один"
    ],
    "short": "Обсудить ситуацию и возможные следующие шаги.",
    "description": "Для первого знакомства или конкретного вопроса. Можно ограничиться одной встречей и затем решить, нужно ли продолжение.",
    "heading": "На встрече",
    "points": [
      "Определим тему разговора и её контекст.",
      "Рассмотрим возможные направления работы.",
      "Обсудим дальнейшие шаги."
    ],
    "url": "consultations.html",
    "service": "Индивидуальные консультации",
    "photo": "assets/archaic/consult-cozy-560.jpg",
    "alt": "Комната для консультации с креслами и растениями"
  },
  {
    "id": "rod",
    "name": "Связь с Родом",
    "category": "Личное сопровождение",
    "tags": [
      "personal"
    ],
    "meta": [
      "3 месяца",
      "Онлайн / офлайн"
    ],
    "short": "Последовательная работа с родовой темой.",
    "description": "Индивидуальная программа с встречами и практиками между ними. Ритм работы согласуется лично.",
    "heading": "Как устроена программа",
    "points": [
      "Стартовая встреча и уточнение запроса.",
      "Личные встречи на протяжении трёх месяцев.",
      "Наблюдения и практики между встречами.",
      "Подведение итогов и обсуждение дальнейших шагов."
    ],
    "url": "therapy.html",
    "service": "Связь с Родом",
    "photo": "assets/archaic/therapy-560.webp",
    "alt": "Родовая символика на ткани"
  },
  {
    "id": "mystery",
    "name": "Мистерия «Сила Рода»",
    "category": "Камерная группа",
    "tags": [
      "group"
    ],
    "meta": [
      "120 минут",
      "До 15 участниц"
    ],
    "short": "Женская встреча с ритуальными практиками.",
    "description": "Групповой формат с использованием огня, соли, воска и ритма.",
    "heading": "Что уточнить перед участием",
    "points": [
      "Ближайшую дату и место.",
      "Как подготовиться к встрече.",
      "Стоимость и условия участия."
    ],
    "url": "mystery.html",
    "service": "Мистерия «Сила Рода»",
    "photo": "assets/archaic/mystery-560.webp",
    "alt": "Свечи и предметы для камерной практики"
  },
  {
    "id": "tarot",
    "name": "Карта как зеркало",
    "category": "Обучение",
    "tags": [
      "study"
    ],
    "meta": [
      "Авторская программа"
    ],
    "short": "Таро и метафорические ассоциативные карты. 48 уроков: 24 + 24.",
    "description": "Два равных направления: система Таро и работа с личными ассоциациями МАК. Шесть этапов, практические задания и две итоговые работы.",
    "heading": "Перед началом",
    "points": [
      "Обсудите свой опыт и цель обучения.",
      "Уточните программу, расписание и стоимость."
    ],
    "url": "tarot-course.html",
    "service": "Карта как зеркало",
    "photo": "assets/archaic/quiet-cards-640.webp",
    "alt": "Композиция с картами Таро"
  },
  {
    "id": "runes",
    "name": "Руны",
    "category": "Обучение",
    "tags": [
      "study"
    ],
    "meta": [
      "Онлайн",
      "С куратором"
    ],
    "short": "Изучать знаки и переходить к практике.",
    "description": "Курс по Старшему и Младшему футарку.",
    "heading": "Перед началом",
    "points": [
      "Уточните содержание и продолжительность курса.",
      "Обсудите порядок обратной связи и стоимость."
    ],
    "url": "runes.html",
    "service": "Руны",
    "photo": "assets/archaic/runes-560.webp",
    "alt": "Руны"
  },
  {
    "id": "candles",
    "name": "Свечные практики",
    "category": "Обучение",
    "tags": [
      "study"
    ],
    "meta": [
      "Авторская программа"
    ],
    "short": "Познакомиться с воском и работой со свечами.",
    "description": "Направление «Язык Пламени»: материалы, техника и практика.",
    "heading": "Перед началом",
    "points": [
      "Уточните необходимые материалы.",
      "Обсудите программу и правила безопасности."
    ],
    "url": "candle-course.html",
    "service": "Свечные практики",
    "photo": "assets/archaic/candles-560.webp",
    "alt": "Свечи и натуральный воск"
  },
  {
    "id": "game",
    "name": "Игра «Сила Рода»",
    "category": "Игровая практика",
    "tags": [
      "personal",
      "group"
    ],
    "meta": [
      "Индивидуально / в группе"
    ],
    "short": "Исследовать свой запрос через игровой формат.",
    "description": "Участие возможно лично или в группе.",
    "heading": "Перед встречей",
    "points": [
      "Выберите удобный формат участия.",
      "Уточните длительность, место и стоимость."
    ],
    "url": "game.html",
    "service": "Игра «Сила Рода»",
    "photo": "assets/archaic/game-560.webp",
    "alt": "Предметы для игры Сила Рода"
  },
  {
    "id": "ancestors",
    "name": "Подношения предкам",
    "category": "Ритуальная практика",
    "tags": [
      "personal"
    ],
    "meta": [
      "По согласованию"
    ],
    "short": "Практика памяти и благодарности.",
    "description": "Условия ритуала обсуждаются лично.",
    "heading": "Перед участием",
    "points": [
      "Обсудите смысл и содержание практики.",
      "Уточните подготовку и условия проведения."
    ],
    "url": "offerings.html",
    "service": "Подношения духам предков",
    "photo": "assets/archaic/offerings-560.webp",
    "alt": "Ритуальная композиция"
  },
  {
    "id": "massage",
    "name": "Огненный массаж",
    "category": "Телесная практика",
    "tags": [
      "personal"
    ],
    "meta": [
      "Офлайн",
      "Индивидуально"
    ],
    "short": "Телесный формат с предварительным обсуждением условий.",
    "description": "Перед записью необходимо обсудить противопоказания и безопасность.",
    "heading": "Перед записью",
    "points": [
      "Обсудите ограничения и допустимость участия.",
      "Уточните место, длительность и стоимость."
    ],
    "url": "massage.html",
    "service": "Огненный массаж",
    "photo": "assets/archaic/massage-560.webp",
    "alt": "Изображение телесной практики с исходного сайта"
  }
];
const root=document.getElementById('bc-detail');
if(!root)return;
const q=s=>root.querySelector(s);
const cards=[...root.querySelectorAll('[data-compact-service]')];
let filter='all',expanded=false,lastCard=null;
function applyFilter(){
 const matches=services.filter(s=>filter==='all'||s.tags.includes(filter));
 const shown=filter==='all'&&!expanded?matches.slice(0,6):matches;
 cards.forEach(c=>{c.hidden=!shown.some(s=>s.id===c.dataset.compactService);});
 q('#bc-count').textContent=shown.length!==matches.length?`${shown.length} из ${matches.length} направлений`:`${matches.length} ${matches.length>=2&&matches.length<=4?'направления':'направлений'}`;
 q('#bc-more').hidden=filter!=='all';q('#bc-more').textContent=expanded?'Свернуть дополнительные ↑':'Ещё 3 направления ↓';
 root.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.filter===filter)));
}
function openService(s,card){
 lastCard=card;q('#bc-list').hidden=true;q('#bc-service-detail').hidden=false;
 q('#bc-detail-category').textContent=s.category;q('#bc-detail-name').textContent=s.name;q('#bc-detail-description').textContent=s.description;q('#bc-detail-list-heading').textContent=s.heading;
 q('#bc-detail-meta').replaceChildren(...s.meta.map(t=>{const e=document.createElement('span');e.textContent=t;return e;}));
 q('#bc-detail-points').replaceChildren(...s.points.map(t=>{const e=document.createElement('li');e.textContent=t;return e;}));
 const image=q('#bc-detail-image');image.src=s.photo;image.alt=s.alt;image.hidden=false;
 q('#bc-inquire').dataset.service=s.service;q('#bc-full-page').href=s.url;q('#bc-count').textContent='Выбранный формат';
 q('#services').scrollIntoView({block:'start'});q('#bc-back').focus({preventScroll:true});window.srPulse?.('catalog',s.id);
}
root.querySelector('.bc-filters').hidden=false;
root.querySelectorAll('[data-filter]').forEach(b=>b.addEventListener('click',()=>{filter=b.dataset.filter;applyFilter();window.srPulse?.('catalog',filter);}));
q('#bc-more').addEventListener('click',()=>{expanded=!expanded;applyFilter();});
cards.forEach(card=>card.addEventListener('click',event=>{if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey||event.button!==0)return;const service=services.find(s=>s.id===card.dataset.compactService);if(!service)return;event.preventDefault();openService(service,card);}));
q('#bc-back').addEventListener('click',()=>{q('#bc-service-detail').hidden=true;q('#bc-list').hidden=false;applyFilter();lastCard?.focus({preventScroll:true});});
// Keep old section links from service pages and bookmarks useful.
root.querySelectorAll('a[href="#services"]').forEach(a=>a.addEventListener('click',()=>{q('#bc-service-detail').hidden=true;q('#bc-list').hidden=false;applyFilter();}));
applyFilter();

})();

