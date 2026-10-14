# Скрипты для VPS: руны, Таро и terapy на поддоменах

Раскладывают три приложения на общий сервер рядом со школой «Язык Пламени»
и выпускают сертификаты. Школу не трогают: она остаётся на `belayarod.ru`,
пока не переедет по отдельному плану (`infra/MIGRATION.md`, скрипт из flame-app).

| Шаг | Скрипт | Что делает | Можно повторять |
|---|---|---|---|
| `preflight` | `00-preflight.sh` | Проверяет память, диск, программы, порты, DNS. **Ничего не меняет** | да |
| `swap` | `01-swap.sh` | Swap 2 ГБ, `vm.swappiness=10`; отключает лишние службы (fwupd, ModemManager, udisks2) | да |
| `packages` | `02-packages.sh` | Недостающие nginx, certbot, PostgreSQL, Node.js 22 | да |
| `runes` | `10-runes.sh` | Руны → `runes.belayarod.ru`, порт 4173, служба `runes` | да — это и обновление |
| `taro` | `11-taro.sh` | Таро → `taro.belayarod.ru`, **порт 3100**, служба `polkas` | да — это и обновление |
| `rod` | `12-rod.sh` | terapy → `rod.belayarod.ru`, порт 5000, служба `rodology` (из PM2 переносит сама) | да — это и обновление |
| `plamya-cert` | `13-plamya-cert.sh` | Сертификат для `plamya.belayarod.ru` заранее; адрес пока ведёт на школу | да |
| — | `14-bot.sh` | Telegram-бот лендинга → `belayarod.ru/tg/rod-bot`, порт 4310, служба `rodbot` (`bot/README.md`). Запуск: `sudo bash /var/www/prod/infra/vps/14-bot.sh` | да — это и обновление |
| `systemd` | `16-systemd.sh` | Школа из PM2 → служба systemd `flame-school` (порт 3000); при неудаче возвращает в PM2. Запуск: `sudo bash /var/www/flame-app/deploy/sila-roda.sh systemd` | да |
| — | `15-accounts.sh` | Общий вход для курсов → `belayarod.ru/account/`, порт 4320, служба `sr-accounts` (`accounts/README.md`). Первый администратор: `sudo ADMIN_EMAIL=почта ADMIN_NAME="Имя" bash /var/www/prod/infra/vps/15-accounts.sh` | да — это и обновление |

Все скрипты запускаются от root и останавливаются при первой ошибке с объяснением.

## 0. Как запускать

Сервер уже умеет забирать код школы (flame-app). В её репозитории есть вход —
`deploy/sila-roda.sh`: он забирает этот репозиторий в `/var/www/prod` тем же
доступом к GitHub (если его не хватит — попросит добавить deploy key) и
запускает шаг:

```bash
cd /var/www/flame-app && bash deploy/update.sh      # обновление школы — приносит и sila-roda.sh
sudo bash /var/www/flame-app/deploy/sila-roda.sh            # = preflight
sudo bash /var/www/flame-app/deploy/sila-roda.sh swap
sudo bash /var/www/flame-app/deploy/sila-roda.sh packages
sudo bash /var/www/flame-app/deploy/sila-roda.sh runes      # и так далее
```

`update.sh` пересобирает и перезапускает школу — как при любом её обновлении,
в спокойное время. Файл `sila-roda.sh` приходит вместе с первым обновлением
школы после слияния PR в flame-app.

Скрипты приложений клонируют руны, Таро и terapy так же: сначала пробуют доступ
школы, и только если его не хватает — deploy key.

## 1. DNS

В панели Beget → DNS домена `belayarod.ru` добавить A-записи на IP сервера:

| Имя | Тип | Значение |
|---|---|---|
| `rod` | A | IP VPS |
| `taro` | A | IP VPS |
| `runes` | A | IP VPS |
| `plamya` | A | IP VPS |

IP сервера печатает шаг `preflight`. Сейчас `belayarod.ru` указывает на
`31.129.107.127` — поддомены должны вести туда же. Записи расходятся от 5 минут
до нескольких часов. Скрипты приложений сами проверяют DNS и без записи
не запускаются: иначе certbot не выпустит сертификат.

## 2. Память

С октября 2026 у VPS 2 ГБ ОЗУ (было 1 ГБ). На нём работают шесть приложений
на Node.js — школа (Next.js), terapy, руны, Таро, бот, общий вход — все
службы systemd — плюс PostgreSQL и nginx. Замер 14.10.2026: занято ~0,8 ГБ,
доступно ~1,1 ГБ. Больше всех ест школа (~190 МБ), затем terapy (~120 МБ);
бот, вход, руны и Таро — по 15–65 МБ каждый.

1. **Swap и лишние службы** — `sudo bash /var/www/flame-app/deploy/sila-roda.sh swap`.
   Swap нужен и при 2 ГБ: сборки Next.js и Vite дают пики памяти. Тот же шаг
   отключает службы образа Ubuntu, которые VPS не нужны (fwupd, ModemManager,
   udisks2, ~50 МБ).
2. **Без PM2.** Школа и terapy — службы systemd `flame-school` и `rodology`
   (юниты в `infra/vps/systemd/`), как остальные приложения. Школа запускается
   напрямую через Next (раньше — `pm2 start npm -- start`: npm висел отдельным
   процессом на 40–75 МБ), а без приложений в PM2 не нужен и его демон (~80 МБ).
   Перенос со старой установки: школа — шаг `systemd` (`16-systemd.sh`),
   terapy — `12-rod.sh`; при неудаче оба возвращают процесс в PM2.
3. **Бот и общий вход — отдельные процессы намеренно.** Слияние сэкономило бы
   ~30 МБ, но у них разные системные пользователи, каталоги данных и секреты
   (токен Telegram и пароли всех курсов), и падение бота не должно ронять вход.
4. Если памяти снова станет мало — тариф 4 ГБ (панель Beget → VPS → изменить
   конфигурацию).

## 3. Программы

```bash
sudo bash /var/www/flame-app/deploy/sila-roda.sh packages
```

Если Node старше 22.13, скрипт спросит разрешение обновить его и перезапустить
приложения. Школа при этом будет недоступна несколько секунд. Лучше делать это вечером.

## 4. Приложения и сертификаты

```bash
sudo bash /var/www/flame-app/deploy/sila-roda.sh runes
sudo bash /var/www/flame-app/deploy/sila-roda.sh taro
sudo bash /var/www/flame-app/deploy/sila-roda.sh rod
sudo bash /var/www/flame-app/deploy/sila-roda.sh plamya-cert
```

Каждый скрипт приложения делает следующее:
1. Проверяет Node, DNS и то, что порт свободен.
2. Клонирует закрытый репозиторий: тем же доступом, что у школы, а если его
   не хватает — через **deploy key**. Тогда скрипт печатает ключ и ждёт, пока
   его добавят: GitHub → репозиторий → Settings → Deploy keys → Add deploy key,
   без права записи. У каждого репозитория свой ключ
   (`/root/.ssh/deploy-<репозиторий>`), ключи школы не трогаются.
3. Запускает службу и проверяет, что она отвечает.
4. Ставит сайт nginx и выпускает сертификат Let's Encrypt
   (`certbot --nginx --redirect --hsts`). Продление — штатный таймер certbot.
5. Проверяет, что сайт открывается по HTTPS.

Почта для Let's Encrypt, если certbot на сервере ещё не зарегистрирован:
`sudo CERTBOT_EMAIL=почта bash /var/www/flame-app/deploy/sila-roda.sh runes`.

После первого запуска каждый скрипт печатает, как создать первого администратора.
Пароль первого специалиста terapy сохраняется в `/root/rodology-admin.txt`:
его нужно сменить при первом входе, а файл потом удалить.

## Обновление приложения

Тот же скрипт:
- **руны** — копия базы → `git pull` → сборка и проверки → перезапуск;
- **Таро** — копия базы → `git pull` → перезапуск;
- **terapy** — `git pull` → `prisma db push` без `--accept-data-loss` → сборка клиента → перезапуск.

Сайт nginx повторно не перезаписывается: в нём уже настройки HTTPS от certbot.
Чтобы поставить свежий конфиг из репозитория, запустите с `FORCE_NGINX=1`:
старый файл сохранится рядом как `.bak-…`, certbot подключит сертификат заново.

## Отличия от инструкций в репозиториях приложений

Инструкции приложений написаны для отдельного сервера. На общем сервере
скрипты **не делают**:
- `rm /etc/nginx/sites-enabled/default` — этот сайт может принадлежать школе;
- `ufw enable` — брандмауэр настраивается один раз для всего сервера, иначе можно закрыть SSH;
- `prisma db push --accept-data-loss` при обновлении terapy;
- `apt upgrade` — обновлять пакеты школы без плана нельзя.

## Если что-то не так

| Симптом | Что смотреть |
|---|---|
| Скрипт остановился на DNS | `getent hosts rod.belayarod.ru` — запись ещё не разошлась |
| Порт занят | `ss -ltnp 'sport = :3100'` — кто его держит |
| 502 на сайте | `journalctl -u runes -n 50`, `journalctl -u polkas -n 50`, `journalctl -u rodology -n 50` |
| certbot не выпускает | DNS указывает не сюда; `nginx -t`; лимит Let's Encrypt — 5 попыток в час на имя |
| Школа перестала открываться | `systemctl status flame-school`, `journalctl -u flame-school -n 50` |
