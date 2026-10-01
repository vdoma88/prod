# Деплой belayarod.ru (лендинг и общий бренд)

Лендинг — статические файлы. Node нужен только для сборки (`scripts/build.mjs`,
без npm-пакетов). Команды — от root на VPS.

## Первая установка

```bash
cd /var/www
git clone https://github.com/vdoma88/prod.git   # закрытый репозиторий — через deploy key, как у Таро
cd prod
node scripts/build.mjs && node scripts/check.mjs

install -m 644 infra/nginx/snippets/sila-roda-headers.conf /etc/nginx/snippets/
install -m 644 infra/nginx/belayarod.ru.conf /etc/nginx/sites-available/belayarod.ru
```

**Пока школа «Язык Пламени» живёт на belayarod.ru, конфиг лендинга не включать.**
Он заменяет её в корне домена. Порядок переезда — `infra/MIGRATION.md`.

Сертификаты поддоменов выпускают скрипты `infra/vps/` (каждый — для своего
приложения). Сертификат самого belayarod.ru уже есть у школы; если нужен
выпуск вручную — все имена сразу:

```bash
certbot certonly --nginx -d belayarod.ru -d www.belayarod.ru \
  -d plamya.belayarod.ru -d rod.belayarod.ru -d taro.belayarod.ru -d runes.belayarod.ru
```

## Обновление

```bash
cd /var/www/prod && bash infra/update.sh
```

Скрипт забирает изменения, проверяет исходники, собирает `dist/` (старая сборка
подменяется целиком) и перезагружает nginx, если конфиг валиден. Если проверки
не прошли, работающий сайт не меняется.

## Live-проверки после публикации

`infra/update.sh` удерживает `/var/lock/belayarod-deploy.lock`: одновременные
запуски ждут друг друга, публикация не отменяется посередине. После сборки и
reload общий `scripts/check-live.mjs` сверяет полный SHA в `version.json`.
Диагностика сохраняется в `/var/log/prod-live-version.json`.

После подтверждения версии скрипт вызывает `scripts/dispatch-live-audit.mjs`.
Он отправляет `workflow_dispatch` в `live-check.yml` с `expected_sha`.
Freshness проверяет эту сборку, затем через `needs` запускается Safari.
Safari сверяет тот же SHA перед установкой WebKit и после обхода страниц.
Смена версии во время обхода даёт `LIVE_VERSION_CHANGED`, а не зелёный отчёт.

GitHub сохраняет артефакты `belayarod-live-freshness` и
`belayarod-iphone-safari-audit` (включая `version-before.json` /
`version-after.json`) семь дней. В отчётах есть HTTP status, expected/live SHA,
время сборки и проверок. Сырые сообщения Safari лежат в `rawErrors`; существующий
CSP сайта не ослабляется. Текст заголовка главной больше не используется как
признак публикации — доступность страниц проверяет следующий браузерный аудит.

### Подключение callback на VPS без разрыва мониторинга

1. Сначала слить workflows и скрипты в `main` и обновить `/var/www/prod`.
   До настройки токена callback только предупреждает; freshness по push
   остаётся включённым. Safari уже запускается только после успешного freshness.
2. Создать fine-grained GitHub token только для `vdoma88/prod` с разрешением
   **Actions: read and write**. Поместить только значение токена в файл root:

   ```bash
   install -d -m 700 /etc/prod
   install -m 600 /dev/null /etc/prod/live-audit.token
   sudoedit /etc/prod/live-audit.token
   ```

   Не выполнять `install ... /dev/null` повторно поверх настроенного токена.
   Вместо файла можно передать `PROD_AUDIT_GITHUB_TOKEN` через защищённое
   окружение процесса deploy или задать другой `PROD_AUDIT_TOKEN_FILE`.
   Токен не должен находиться в репозитории.
3. После успешной публикации проверить callback вручную (повторно публиковать
   сайт не требуется):

   ```bash
   cd /var/www/prod
   EXPECTED_SHA="$(git rev-parse HEAD)" LIVE_ATTEMPTS=1 node scripts/check-live.mjs
   EXPECTED_SHA="$(git rev-parse HEAD)" node scripts/dispatch-live-audit.mjs
   ```

   Открыть Actions → **Live site freshness**, убедиться в событии
   `workflow_dispatch`, нужном SHA в названии и успешных jobs `verify-live` /
   `iphone-audit`. HTTP 204 callback означает только приём запроса GitHub,
   а не успешное прохождение аудита.
4. Только после успешного callback задать repository Actions variable
   `LIVE_AUDIT_MODE` = `post-deploy` (Settings → Secrets and variables → Actions
   → Variables). Проверка по push будет пропускаться, post-deploy и ручной
   запуск сохранятся. Для возврата резервного мониторинга удалить эту переменную.

Запуск аудита вручную: Actions → **Live site freshness** → Run workflow →
передать полный SHA уже опубликованной сборки в `expected_sha`.
Не запускать проверку нового SHA до завершения публикации.

Без токена callback не объявляется выполненным. Если токен настроен, но GitHub
не принял запрос, `infra/update.sh` завершается ошибкой с явным сообщением:
сайт уже опубликован, не стартовал только аудит. После исправления доступа
достаточно повторить `scripts/dispatch-live-audit.mjs` с SHA этой публикации.

`Live visual audit` остаётся отдельным обзорным сборщиком скриншотов;
подтверждение конкретного релиза дают freshness и зависимый Safari.

## Доступность сайтов

Служба входа (`accounts/uptime.mjs`) раз в 5 минут открывает лендинг, общий
вход и четыре курса по их публичным адресам — через nginx и настоящий TLS, как
ученица. Два сбоя подряд (≈10 минут) — «🔴 Сайт не отвечает» в Telegram через
бота лендинга; когда адрес снова отвечает — «🟢 Сайт снова работает» с
длительностью простоя. Раз в сутки проверяются сертификаты: меньше 14 дней до
окончания — «🔐 Сертификат скоро истечёт» (значит, certbot не продлил). В утренней
сводке — строка «Доступность». Список адресов меняется переменной
`UPTIME_TARGETS` в `/etc/sr-accounts.env` (`Имя=https://…,Имя2=https://…`,
`off` — выключить). Нужен тот же `ROD_NOTIFY_SECRET`, что для телеметрии.

### Проверка снаружи

Если ляжет весь сервер (VPS выключен, сеть, nginx), служба входа ничего не
пришлёт — она лежит вместе с ним. Это закрывает только проверка с другой
машины, например бесплатный внешний монитор с оповещением на почту или в
Telegram на адреса из списка выше. Тишина утренней сводки в 10:00 МСК — тоже
знак: сводка приходит каждый день, даже когда визитов не было.
