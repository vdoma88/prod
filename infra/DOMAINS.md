# Адреса и процессы

Все проекты живут на одном VPS Beget под одним доменом. Nginx принимает запросы
и по имени хоста отдаёт их нужному приложению.

| Адрес | Проект | Репозиторий | Процесс | Порт | Nginx-конфиг |
|---|---|---|---|---|---|
| `belayarod.ru` | Лендинг «Сила Рода» + `/brand/` | `vdoma88/prod` | — (статика) | — | `infra/nginx/belayarod.ru.conf` |
| `plamya.belayarod.ru` | Школа «Язык Пламени» | `vdoma88/flame-app` | PM2 `flame-school` | 3000 | свой, из flame-app (сменить `server_name`) |
| `rod.belayarod.ru` | «Связь с Родом» / Родовая карта пути | `vdoma88/terapy` | PM2 | 5000 | `deploy/nginx.rodology.conf` |
| `taro.belayarod.ru` | Карты Таро | `vdoma88/tarot` | systemd `polkas` | **3100** | `server/deploy/nginx.conf` |
| `runes.belayarod.ru` | Руны | `vdoma88/runes-belaya` | systemd `runes` | 4173 | `deploy/nginx.example.conf` |
| `belayarod.ru/tg/rod-bot` | Telegram-бот лендинга (вебхук) | `vdoma88/prod`, `bot/` | systemd `rodbot` | 4310 | `infra/nginx/belayarod.ru.conf` |

У Таро по умолчанию порт 3000, как у школы. На общем сервере Таро обязательно
запускать с `PORT=3100`, иначе один из процессов не стартует (`EADDRINUSE`).

Список курсов для шапки и страницы «Мои курсы» записан в одном месте —
`PROJECTS` в `brand/sr-brand.js`. Если меняется адрес, править там и здесь.
`npm run check` сверит страницы лендинга.

## DNS

В панели Beget → DNS для `belayarod.ru` нужны A-записи на IP сервера:
`@`, `www`, `plamya`, `rod`, `taro`, `runes`. Проверка — `infra/vps/00-preflight.sh`.

## Почта

Почта `info@belayarod.ru` живёт у Beget, на VPS ничего не ставится. MX, SPF, DKIM
и DMARC, настройки программ и проверка — в `infra/MAIL.md`.

## Память

На сервере 1 ГБ, и уже школа упирается в этот предел. Swap ставит
`infra/vps/01-swap.sh`, тариф меняется в панели Beget. Вместе здесь будут четыре
Node-процесса, PostgreSQL (школа и terapy) и сборка Next.js. Минимум:

- перейти на тариф с **2 ГБ** (лучше 4 ГБ);
- до этого — включить swap 2 ГБ: `fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile`,
  строку `/swapfile none swap sw 0 0` добавить в `/etc/fstab`;
- собирать Next.js (`npm run build` школы) при остановленных Таро и рунах,
  если памяти не хватает.
