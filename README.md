# Сила Рода · belayarod.ru

Общий проект всех направлений Екатерины Белой: лендинг на `belayarod.ru`, общий
бренд (шапка, подвал, карточки курсов, цвета) и инфраструктура, которая сводит
четыре учебных приложения под один домен.

| Адрес | Что | Репозиторий |
|---|---|---|
| belayarod.ru | Лендинг, «Мои курсы», `/brand/` | этот |
| plamya.belayarod.ru | Школа «Язык Пламени» | vdoma88/flame-app |
| rod.belayarod.ru | «Связь с Родом» · Родовая карта пути | vdoma88/terapy |
| taro.belayarod.ru | Карты Таро | vdoma88/tarot |
| runes.belayarod.ru | Руны | vdoma88/runes-belaya |

Приложения остаются отдельными: свой код, база, вход и деплой. Общими стали
адрес, внешний вид и навигация между ними.

## Что где

```text
site/     лендинг — статический HTML/CSS/JS (история перенесена из vdoma88/landos)
brand/    общий бренд: sr-brand.js (+ .css) — элементы <sr-brand-bar>, <sr-courses>,
          <sr-footer>; tokens.css — цвета и шрифты семейства; preview.html — витрина
infra/    nginx, адреса и порты, деплой, план переезда школы; vps/ — скрипты для сервера
docs/     встраивание бренда в каждое приложение
scripts/  build, check, serve, sync-brand — Node без npm-пакетов
tests/    браузерная проверка (Playwright)
```

## Команды

Нужен Node 20+. Ставить npm-пакеты не нужно.

```bash
npm run build        # site/ + brand/ → dist/
npm run check        # ссылки, курсы, окно заявки, CSP-совместимость, версии
npm run serve        # dist/ на http://127.0.0.1:4300 с CSP как на сервере
npm run test:e2e     # Chromium: все страницы × компьютер/телефон, работа шапки
npm run sync-brand -- ../runes-belaya/src/brand   # раздать бренд приложению
```

`test:e2e` использует Playwright, установленный глобально (`npm i -g playwright`).
Если его нет, проверка пропускается с сообщением.

## Список курсов

Один источник — `PROJECTS` в `brand/sr-brand.js`: название, подпись, адрес,
страница на лендинге, цвет. Из него рисуются шапка и карточки во всех
приложениях. `npm run check` следит, чтобы лендинг ему соответствовал
(страница курса, ссылка «войти», карточка на «Моих курсах», цвет в `tokens.css`).

## Документы

- [docs/integration.md](docs/integration.md) — как встроить бренд в каждое приложение
- [infra/DOMAINS.md](infra/DOMAINS.md) — адреса, порты, DNS, память сервера
- [infra/DEPLOY.md](infra/DEPLOY.md) — установка и обновление belayarod.ru
- [infra/MIGRATION.md](infra/MIGRATION.md) — порядок переезда, включая школу
- [infra/vps/README.md](infra/vps/README.md) — скрипты для VPS: руны, Таро, terapy на поддоменах, сертификаты, swap
- [brand/README.md](brand/README.md) — элементы бренда и правила их изменения
- [site/README.md](site/README.md) — страницы лендинга и заявки через Telegram
