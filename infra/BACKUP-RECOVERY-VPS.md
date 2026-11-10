# Резервные копии запасного сервера

Новый сервер: 31.56.197.168. Исходный сервер на Beget недоступен.

## Что копируется

Копии — обычные архивы `.tar.gz` **без шифрования** (решение владельца,
ноябрь 2026: копии идут в личный Telegram, к данным нужен свободный
доступ). Открываются любым архиватором.

| Архив | Что внутри | Скрипт |
|---|---|---|
| `rod-…tar.gz` | база rodology (pg_dump -Fc) + все вложения учениц + материалы шагов | `backup-mirror.py` |
| `flame-…tar.gz` | **активная** база школы из .env.local + все фото | `backup-mirror.py` |
| `hub-…tar.gz` | общий кабинет (SQLite), медиатека редактора, база бота, сборка сайта | `backup-mirror.py` |
| `runes-…tar.gz` | база рун | `mirror-backup.sh` |
| `taro-…tar.gz` | база Таро | `mirror-backup.sh` |

**Секретов в архивах нет**: файлы .env, токены ботов, ключи и хеши паролей
PostgreSQL не копируются — иначе они лежали бы открытым текстом в Telegram.
При восстановлении их создают заново скрипты `infra/vps` и
`flame-app/deploy`. Рядом с каждым архивом — `.sha256`.

## Расписание

    bash /var/www/prod/infra/vps/install-mirror-backup-cron.sh

Род, школа, кабинет — в 8:00 и 23:00 по Москве; руны и Таро — в 8:15 и
23:15. Часы в cron — по поясу сервера (зеркало в UTC → 5 и 20). На сервере
хранятся последние 14 архивов каждого вида. Журналы:
`/var/log/sr-mirror-backups.log`, `/var/log/sr-mirror-courses.log`.

Внеочередной запуск:

    python3 /var/www/prod/infra/vps/backup-mirror.py --scope all
    bash /var/www/prod/infra/vps/mirror-backup.sh

## Telegram

    bash /var/www/prod/infra/vps/mirror-telegram-setup.sh

Токен бота и ID получателя — в `/etc/sr-mirror-backup.env` (только root).
Архив до 35 МБ приходит одним файлом; больше — частями
`….tar.gz.part001-of-003`. Склеить по порядку:

    cat rod-….tar.gz.part* > rod-….tar.gz                         (Linux, macOS)
    copy /b часть1+часть2+часть3 rod-….tar.gz                     (Windows)

Строка `Telegram delivered` в выводе подтверждает отправку.

## Восстановление

    tar -xzf rod-….tar.gz
    pg_restore -l snapshots/rodology.dump | head

Базы восстанавливать сначала в отдельные БД, не поверх работающих.
Исходных 20 вложений Рода на новом сервере нет — они остались на Beget;
копии фиксируют недостачу (`manifest.json`), но вернуть файлы можно только
со старого сервера.
