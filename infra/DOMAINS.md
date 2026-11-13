# Адреса и процессы

Все проекты живут на одном VPS под одним доменом. Nginx принимает запросы
и по имени хоста отдаёт их нужному приложению.

С ноября 2026 сервер — HostVDS, `31.56.197.168` (2 ядра, 4 ГБ, Ubuntu 24.04):
прежний VPS Beget (`31.129.107.127`) утрачен при атаке на Beget 2 ноября.
Домен, DNS и почта пока у Beget. Как не зависеть от одной компании —
`infra/FAILOVER.md`; копии — `infra/BACKUP-RECOVERY-VPS.md`; пульт — `ops/README.md`.

| Адрес | Проект | Репозиторий | Процесс | Порт | Nginx-конфиг |
|---|---|---|---|---|---|
| `belayarod.ru` | Лендинг «Сила Рода» + `/brand/` | `vdoma88/prod` | — (статика) | — | `infra/nginx/belayarod.ru.conf` |
| `plamya.belayarod.ru` | Школа «Язык Пламени» | `vdoma88/flame-app` | служба `flame-school` | 3000 | свой, из flame-app (сменить `server_name`) |
| `rod.belayarod.ru` | «Связь с Родом» / Родовая карта пути | `vdoma88/terapy` | служба `rodology` | 5000 | `deploy/nginx.rodology.conf` |
| `taro.belayarod.ru` | Карты Таро | `vdoma88/tarot` | systemd `polkas` | **3100** | `server/deploy/nginx.conf` |
| `runes.belayarod.ru` | Руны | `vdoma88/runes-belaya` | systemd `runes` | 4173 | `deploy/nginx.example.conf` |
| `belayarod.ru/tg/rod-bot` | Telegram-бот лендинга (вебхук) | `vdoma88/prod`, `bot/` | systemd `rodbot` | 4310 | `infra/nginx/belayarod.ru.conf` |

У Таро по умолчанию порт 3000, как у школы. На общем сервере Таро обязательно
запускать с `PORT=3100`, иначе один из процессов не стартует (`EADDRINUSE`).

Список курсов для шапки и страницы «Мои курсы» записан в одном месте —
`PROJECTS` в `brand/sr-brand.js`. Если меняется адрес, править там и здесь.
`npm run check` сверит страницы лендинга.

## DNS

В панели Beget → DNS для `belayarod.ru` нужны A-записи на IP сервера
(`31.56.197.168`): `@`, `www`, `plamya`, `rod`, `taro`, `runes`; MX и TXT почты не
трогать. Проверка — `infra/vps/00-preflight.sh`; переключение сервера на домен —
`infra/vps/switch-to-domain.sh`.

## Почта

Почта `info@belayarod.ru` живёт у Beget, на VPS ничего не ставится. MX, SPF, DKIM
и DMARC, настройки программ и проверка — в `infra/MAIL.md`.

## Память

На сервере 4 ГБ и swap 2 ГБ (`infra/vps/01-swap.sh`; на старом VPS Beget был
1 ГБ, и школа упиралась в этот предел). Здесь работают четыре Node-процесса,
PostgreSQL (школа и terapy) и сборка Next.js. Если снова станет мало:

- перейти на тариф с **2 ГБ** (лучше 4 ГБ);
- до этого — включить swap 2 ГБ: `fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile`,
  строку `/swapfile none swap sw 0 0` добавить в `/etc/fstab`;
- собирать Next.js (`npm run build` школы) при остановленных Таро и рунах,
  если памяти не хватает.
