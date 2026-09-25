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

Сертификат на все имена сразу:

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
