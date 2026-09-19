# Sila Roda Landing

Многосервисный лендинг «Сила Рода» с отдельными страницами всех направлений.

## Что внутри
- `index.html` — главный лендинг
- `therapy.html` — трёхмесячная терапия «Связь с Родом»
- `mystery.html` — мистерия «Сила Рода»
- `game.html` — трансформационная игра
- `offerings.html` — шаманские подношения духам предков
- `candle-course.html` — курс свечной магии
- `tarot-course.html` — курс «Карты Таро»
- `massage.html` — огненный массаж
- `consultations.html` — онлайн и офлайн консультации
- `styles.css` — общие стили
- `app.js` — мобильное меню, FAQ и диалог заявки
- `tree.js` — three.js-анимация для первого экрана главной страницы
- `assets/` — изображения для наполнения страниц

## Запуск
Откройте `index.html` в браузере.

## Для публикации
Подключить реальный Telegram username, актуальные цены и контакты.


## Telegram
Для заявок используется только Telegram. В `app.js` есть одна настройка:

```js
const SITE_CONFIG = { telegramUsername: "" };
```

Укажите username Telegram без символа `@`. Пока поле пустое, кнопка открывает стандартное окно Telegram Share с уже подготовленным текстом заявки.

## SEO / публикация
Добавлены уникальные title/description, Open Graph и Twitter meta, JSON-LD, favicon, webmanifest, robots.txt и отдельная 404-страница. Canonical URL и sitemap стоит добавлять после выбора постоянного домена.
