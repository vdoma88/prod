# Встраивание общего бренда в приложения

Общий бренд — три файла из `brand/`: `sr-brand.js`, `sr-brand.css`, `tokens.css`.
Каждое приложение раздаёт их **со своего адреса** из папки `brand/`: так не нужно
менять его CSP, и приложение не зависит от доступности belayarod.ru.

Копирование — одной командой из этого репозитория:

```bash
node scripts/sync-brand.mjs ../<приложение>/<папка>/brand
```

`--check` ничего не копирует, только сверяет. Удобно для CI приложения.

## Что ставить и куда

| Элемент | Где уместен |
|---|---|
| `<sr-brand-bar product="…">` | Самый верх страницы в веб-интерфейсах. В приложениях «под телефон» — только в широком (настольном) виде, чтобы не отнимать высоту экрана |
| `<sr-courses product="…">` | Экран профиля ученицы и экран входа: «Другие курсы Екатерины» |
| `<sr-footer product="…">` | Низ публичных страниц, экранов входа и кабинетов |
| `tokens.css` | По желанию: общие цвета и шрифты семейства. Ничего не перекрашивает само |

Атрибуты: `product` — `rod`, `plamya`, `taro` или `runes`. Текущий курс отмечается
в меню «Курсы» и не повторяется в `<sr-courses>`. `tone` — `light`/`dark`,
смотря по фону. `safe-top` у шапки добавляет отступ под вырез экрана, если
шапка стоит первой в приложении с `viewport-fit=cover`.

Элементы на русском языке; английский интерфейс terapy пока видит их по-русски.

---

## runes-belaya — `runes.belayarod.ru`

- **Папка:** `src/brand/`. Сборка `scripts/build.mjs` копирует `src/` в `dist/` целиком,
  сервер отдаёт `dist/`.
- **`src/index.html`:** перед `</head>` добавить
  `<script src="./brand/sr-brand.js" defer></script>`, первым элементом `<body>`
  (перед ссылкой «К содержанию» или сразу после неё) —
  `<sr-brand-bar product="runes"></sr-brand-bar>`.
- **Подвал:** `<sr-footer product="runes"></sr-footer>` после `#app`.
- **CSP** (`default-src 'self'; style-src 'self'`) уже подходит.
- **Проверить:** `npm run check` сверяет ссылки `./…` в `dist/index.html` — новые
  файлы должны лежать в `src/brand/`. Боковая панель `.sidebar` прилипает к `top:0`
  с высотой `100vh`. С шапкой сверху страница становится на 44px длиннее, это нормально.

## tarot — `taro.belayarod.ru`

- **Папка:** `brand/` в корне репозитория.
- **`server/static.js`:** добавить `'brand'` в набор `PUBLIC`. Без этого сервер
  ответит 404 на `/brand/*`.
- **`index.html`:** `<script src="brand/sr-brand.js" defer></script>` в `<head>`,
  `<sr-brand-bar product="taro" tone="light"></sr-brand-bar>` перед `<header class="nav-bar">`.
- **`login.html`, `cabinet.html`:** шапка `tone="light"` перед `<header class="cab-top">`.
  На `login.html` под формой уместен `<sr-courses product="taro">`.
- **CSP кабинетов** (`CABINET_CSP`, только `'self'`) подходит.
- **Порт:** школа «Язык Пламени» уже занимает 3000. Таро запускать с `PORT=3100`
  в `server/deploy/polkas.service`, а `proxy_pass` в nginx поменять на `127.0.0.1:3100`.
- **Домен:** `polkas.example.ru` → `taro.belayarod.ru` в `server/deploy/nginx.conf`
  и `PUBLIC_ORIGIN=https://taro.belayarod.ru`.

## terapy — `rod.belayarod.ru`

- **Папка:** `client/public/brand/`. Vite кладёт `public/` в корень сборки,
  файлы будут по адресу `/brand/…`.
- **`client/index.html`:** `<script src="/brand/sr-brand.js" defer></script>` в `<head>`.
- **`ClientLayout.jsx` / `AdminLayout.jsx`:** шапка — только в широком виде
  (например, `hidden lg:block` на обёртке `<div>`), чтобы на телефоне остался
  нижний таб-бар без лишней высоты:
  ```jsx
  <div className="hidden lg:block"><sr-brand-bar product="rod" /></div>
  ```
  В React 18 атрибуты у custom elements передаются как есть, `product` дойдёт.
- **Профиль клиента:** `<sr-courses product="rod" />` внизу страницы профиля.
- **CSP** в `deploy/nginx.rodology.conf` (`script-src 'self'`, `style-src 'self' …`)
  подходит без изменений.
- **iPhone:** приложение растягивается под статус-бар (`black-translucent`). Если
  шапка станет первой на экране телефона, нужен `safe-top`, а у своей шапки
  приложения — убрать верхний `env(safe-area-inset-top)`.
- **Домен:** `server_name` в `deploy/nginx.rodology.conf` → `rod.belayarod.ru`,
  CORS/URL-переменные сервера — на новый адрес.

## flame-app — `plamya.belayarod.ru`

Рабочее приложение с живыми ученицами. Менять — отдельным PR, после того как
три других приложения уже на поддоменах. Переезд с belayarod.ru — `infra/MIGRATION.md`.

- **Папка:** `public/brand/`.
- **`src/app/layout.tsx`:** подключить скрипт через `next/script`:
  ```tsx
  import Script from "next/script";
  // …внутри <body>:
  <Script src="/brand/sr-brand.js" strategy="afterInteractive" />
  ```
- **Типы для TSX** — файл `src/types/sr-brand.d.ts`:
  ```ts
  import type { DetailedHTMLProps, HTMLAttributes } from "react";
  type SrProps = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
    product?: "rod" | "plamya" | "taro" | "runes";
    tone?: "light" | "dark";
    heading?: string;
    "safe-top"?: boolean;
  };
  declare module "react" {
    namespace JSX {
      interface IntrinsicElements {
        "sr-brand-bar": SrProps;
        "sr-courses": SrProps;
        "sr-footer": SrProps;
      }
    }
  }
  ```
- **Где показывать:**
  - шапку — только в настольном виде, над `TopBar`: класс `hidden desktop:block`
    на обёртке. Телефонный вид остаётся приложением с `BottomTabBar`;
  - `<sr-courses product="plamya" />` — в `ProfileScreen` и под формой в `AuthScreen`.
    Тон выбирать по теме: `tone={theme === "dark" ? "dark" : undefined}`.
  - Куратору и админу элементы не нужны: у них нет вкладки «Профиль».
- **CSP** у приложения не задан — ограничений нет.
- **Обновление:** обычный путь `deploy/update.sh`. Процесс PM2 по-прежнему `flame-school`.

---

## Как проверить в приложении

1. Шапка видна, «Курсы» открывает список из четырёх курсов, текущий отмечен
   «Вы здесь». Escape и щелчок мимо закрывают меню.
2. В консоли браузера нет сообщений `Refused to …` (CSP).
3. На ширине 320–390px нет горизонтальной прокрутки, меню помещается в экран.
4. Ссылки ведут на поддомены, «Мои курсы» — на `https://belayarod.ru/courses.html`.
