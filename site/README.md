# Лендинг belayarod.ru

Статический сайт «Сила Рода». Перенесён из `vdoma88/landos` и дальше развивается здесь.

## Источник и дальнейшая разработка

Базовый лендинг синхронизирован с `vdoma88/landos@7bd06b90367b9a33a5188463d4c9ee72f2c87aa8`.
Продакшен-версия расширена страницами «Мои курсы» и «Руны», прямым Telegram,
canonical/OG-адресами `belayarod.ru` и совместимостью с общей инфраструктурой.
Поэтому `site/` — источник истины; копировать `landos` поверх этой папки целиком нельзя.

## Страницы
- `index.html` — главная
- `courses.html` — «Мои курсы»: вход во все учебные кабинеты
- `therapy.html` — «Связь с Родом» (кабинет: rod.belayarod.ru)
- `candle-course.html` — свечные практики (школа: plamya.belayarod.ru)
- `tarot-course.html` — Карты Таро (taro.belayarod.ru)
- `runes.html` — Руны (runes.belayarod.ru)
- `mystery.html`, `game.html`, `offerings.html`, `massage.html`, `consultations.html` — направления без кабинета
- `404.html`
- `styles.css`, `app.js` (меню, FAQ, окно заявки), `tree.js` (three.js-анимация на главной)
- `pulse.js` — телеметрия: как сайт открывается у посетителей (приём и сводка — `accounts/pulse.mjs`, смотреть в админке belayarod.ru/account/). Стоит на каждой странице раньше `app.js`
- `touch-icon.png` — иконка для экрана «Домой» на iPhone (180×180). Не `apple-touch-icon.png`: этот адрес nginx отправляет в школу
- `assets/` — изображения

`robots.txt` и `sitemap.xml` создаёт сборка (`scripts/build.mjs`).

## Заявки — только Telegram
В `app.js`:

```js
const SITE_CONFIG = { telegramUsername: "", schoolUrl: "https://plamya.belayarod.ru/" };
```

`telegramUsername` — username без `@`. Пока поле пустое, кнопка открывает
Telegram Share с готовым текстом заявки. Список направлений в окне заявки
должен быть одинаковым на всех страницах — это проверяет `npm run check`.

`schoolUrl` нужен для иконки школы, которую ученицы добавили на телефон до
переезда: она открывает корень belayarod.ru, и `app.js` переводит такой запуск
в школу (подробно — `infra/MIGRATION.md`).

## CSP
Сайт работает под строгим CSP (`infra/nginx/snippets/sila-roda-headers.conf`):
никаких `style="…"`, `onclick="…"` и inline-скриптов. Исключение — JSON-LD
(`type="application/ld+json"`), браузер его не исполняет.
