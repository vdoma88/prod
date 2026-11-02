# Полные резервные копии аварийного VPS

Новый VPS: 31.56.197.168. Исходный Beget VPS недоступен.

## Внеочередной запуск (после git pull)

    cd /var/www/prod
    python3 infra/vps/backup-mirror.py --scope all
    python3 infra/vps/backup-mirror.py --scope legacy

all создаёт три **раздельных зашифрованных** архива в /root/sr-backups:
- rod — pg_dump -Fc базы rodology + весь существующий server/storage/uploads + материалы шагов + конфигурация.
- flame — данные из **активной** базы, указанной в .env.local (на зеркале flame_recovery_20261101, не пустая flame_db), + весь public/uploads + конфигурация.
- hub — корректная SQLite-копия общего кабинета (включая WAL), медиатека редактора лендинга, dist, SQLite бота при наличии, роли PostgreSQL, nginx/systemd и секреты конфигурации.

legacy — отдельная зашифрованная копия исходных архивов восстановления (/root/mirror, /root/flame-backups и server/backups при наличии). Ежедневно legacy не дублируется.

Шифрование: OpenSSL AES-256-CBC, PBKDF2, 250000 итераций, рядом SHA-256 зашифрованного архива. Шифр не AEAD: перед расшифровкой сверяйте SHA-256 с доверенным значением, отдельно сохранённым с архивом. GitHub не получает ни архивов, ни паролей.

**Критично:** при первом запуске создаётся /etc/sr-backup.key. Сохраните его ВНЕ VPS, иначе после аварии серверные архивы не расшифровать. Не пересылайте ключ или архивы в чат.

## Ночная автоматизация

    bash /var/www/prod/infra/vps/install-mirror-backup-cron.sh
    cat /etc/cron.d/sr-mirror-backups

Полные копии Rod + Flame + hub каждый день в 03:35 по времени **сервера**. Лог /var/log/sr-mirror-backups.log. Последние 14 архивов каждого сервиса хранятся локально. Старые неполные cron не удаляются автоматически; установщик о них предупредит.

## Отправка в Telegram

Отправляются **только зашифрованные файлы** (частями по 35 МиБ). Пара токен и чат берётся из /etc/sr-mirror-backup.env (TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID), либо из /etc/rodbot.env (BACKUP_CHAT_IDS или ADMIN_CHAT_IDS), либо из .env.local свечной школы (BACKUP_TELEGRAM_CHAT_ID). Секреты не отображаются в логе.

Если Telegram-бот/чат не настроен или загрузка не прошла, локальная копия будет сохранена, но скрипт вернёт код 2, и будет предупреждение OFFSITE STATUS. Только строка Telegram delivered подтверждает отправку. Тестовый запуск только локально:

    python3 /var/www/prod/infra/vps/backup-mirror.py --scope all --no-telegram

Нужно обязательно вывести зашифрованные архивы **за пределы VPS**, иначе повторная потеря сервера уничтожит и новые копии.

## Контроль

    ls -lh /root/sr-backups/*.enc
    tail -n 40 /var/log/sr-mirror-backups.log

Чтобы сохранить ключ на личном ПК через PowerShell:

    scp root@31.56.197.168:/etc/sr-backup.key .\sr-backup.key

Для восстановления: объединить части Telegram по порядку, проверить SHA-256, расшифровать:

    openssl enc -d -aes-256-cbc -pbkdf2 -iter 250000 -in FILE.tar.gz.enc -out restore.tar.gz -pass file:sr-backup.key
    tar -tzf restore.tar.gz | head

Базы восстанавливать сначала в отдельные БД, НЕ поверх работающих. Исходных 20 вложений Rod в новом VPS нет; скрипт фиксирует эту недостачу, но не воссоздаёт отсутствующие медиа. В terapy/main каталог storage/uploads исключён из Git; там есть лишь .gitkeep.
