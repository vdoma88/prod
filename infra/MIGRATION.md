# План переезда на общий домен

Цель: `belayarod.ru` — лендинг, каждое приложение — на своём поддомене
(`infra/DOMAINS.md`). Порядок выбран так, чтобы рабочая школа «Язык Пламени»
переезжала последней, когда всё остальное уже проверено.

## Этап 1. Поддомены без риска

Три приложения пока нигде не работают у живых учеников, поэтому их можно
ставить сразу на новые адреса.

1. DNS: A-записи `plamya`, `rod`, `taro`, `runes` → IP сервера.
2. Память: swap или тариф 2 ГБ (`DOMAINS.md`, раздел «Память»).
3. Руны → `runes.belayarod.ru` по `runes-belaya/docs/DEPLOY_1_0.md`,
   `RUNE_PUBLIC_ORIGIN=https://runes.belayarod.ru`.
4. Таро → `taro.belayarod.ru` по `tarot/docs/deploy-beget.md`, **с `PORT=3100`**,
   `PUBLIC_ORIGIN=https://taro.belayarod.ru`.
5. terapy → `rod.belayarod.ru` по `terapy/deploy/DEPLOY_BEGET.md`.
6. В каждое приложение — общий бренд (`docs/integration.md`), отдельным PR в его репозиторий.

Проверка: все три адреса открываются по HTTPS, `pm2 ls` / `systemctl status`
показывают процессы, в меню «Курсы» каждого приложения — четыре курса.

## Этап 2. Переезд школы на plamya.belayarod.ru

Школа сейчас отвечает на `belayarod.ru`. После переезда там будет лендинг.

**Что изменится для учениц**

- Сессия привязана к адресу: после переезда каждая **один раз войдёт заново**.
- Иконка школы на экране телефона ведёт на `belayarod.ru/`. Лендинг распознаёт
  такой запуск и переводит в школу (`site/app.js`), но на iPhone школа откроется
  во встроенном окне Safari. Иконку лучше **добавить заново** с нового адреса.
- Старые ссылки на API, фото (`/uploads/…`) и `/console` перенаправляются
  с тем же путём (блок «Переезд школы» в `nginx/belayarod.ru.conf`).

**Текст для учениц заранее** (Telegram-бот или чат группы):

> С [дата] школа «Язык Пламени» открывается по новому адресу:
> https://plamya.belayarod.ru. Старый адрес тоже приведёт туда.
> После переезда один раз войдите заново с прежним логином и паролем.
> Если у вас иконка школы на экране телефона — удалите её и добавьте заново
> с нового адреса (Safari → «Поделиться» → «На экран „Домой“»).

**Шаги в день переезда** (в спокойное время, когда нет занятий):

```bash
# 0. Резервная копия школы
cd /var/www/flame-app && bash deploy/backup.sh

# 1. Школа начинает отвечать на новом имени. В её nginx-конфиге:
#    server_name belayarod.ru www.belayarod.ru;  →  server_name plamya.belayarod.ru;
#    сертификат — тот, что выпущен на все имена (infra/DEPLOY.md)
nano /etc/nginx/sites-available/<конфиг школы>

# 2. Лендинг занимает belayarod.ru
cd /var/www/prod && node scripts/build.mjs && node scripts/check.mjs
install -m 644 infra/nginx/snippets/sila-roda-headers.conf /etc/nginx/snippets/
install -m 644 infra/nginx/belayarod.ru.conf /etc/nginx/sites-available/belayarod.ru
ln -s /etc/nginx/sites-available/belayarod.ru /etc/nginx/sites-enabled/belayarod.ru
nginx -t && systemctl reload nginx

# 3. Вебхук Telegram — на новый адрес (секрет — тот же, что задан сейчас)
curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d "url=https://plamya.belayarod.ru/api/telegram/webhook" \
  -d "secret_token=$TELEGRAM_WEBHOOK_SECRET"
curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"
```

Скрипты школы `deploy/redirect-www.sh` и `deploy/reject-foreign-domains.sh`
ищут домен в `server_name`. После смены имени их нужно перезапустить
с `DOMAIN=plamya.belayarod.ru`, иначе `reject-foreign-domains` отбросит новый адрес.

**Проверка сразу после:**

- `https://belayarod.ru` — лендинг; `https://belayarod.ru/courses.html` — «Мои курсы»;
- `https://plamya.belayarod.ru` — вход в школу, вход работает, уроки открываются;
- `https://belayarod.ru/uploads/<любое фото>` → 308 на `plamya.belayarod.ru/uploads/…`;
- `getWebhookInfo` показывает новый URL без `last_error_message`;
- `pm2 logs flame-school` — без ошибок.

**Откат:** вернуть `server_name` школы, удалить ссылку
`/etc/nginx/sites-enabled/belayarod.ru`, `nginx -t && systemctl reload nginx`,
вернуть вебхук на `https://belayarod.ru/api/telegram/webhook`.

## Этап 3. Позже (вариант C)

Единый вход для всех курсов — отдельный проект. Пока на странице «Мои курсы»
прямо сказано, что у каждого курса свой вход.
