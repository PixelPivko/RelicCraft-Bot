# RelicCraft Discord Bot

Бот для RelicCraft: верификация по кнопке и модерация для роли `1524825124019241011`.

## Возможности

- `/verify-panel` создает сообщение с кнопкой верификации.
- Кнопка верификации выдает роль из `VERIFIED_ROLE_ID`.
- `/kick` кикает участника.
- `/timeout` выдает Discord-таймаут.
- `/mute` выдает мут-роль на срок или навсегда.
- `/unmute` снимает мут-роль и таймаут.
- `/blacklist` выдает ЧСП-роль.
- `/unblacklist` снимает ЧСП-роль.
- При наказании бот пишет пользователю в личные сообщения с причиной, администратором, сроком и кнопкой обжалования.

## Установка

1. Установи Node.js 18 или новее.
2. В папке бота выполни:

```bash
npm install
```

3. Скопируй `.env.example` в `.env` и заполни значения.
4. Включи в Discord Developer Portal у бота:
   - `SERVER MEMBERS INTENT`
   - `MESSAGE CONTENT INTENT` не обязателен, но можно включить
5. Пригласи бота на сервер с правами:
   - Manage Roles
   - Kick Members
   - Moderate Members
   - Send Messages
   - Use Slash Commands

Важно: роль бота должна быть выше ролей `MUTE_ROLE_ID`, `BLACKLIST_ROLE_ID` и `VERIFIED_ROLE_ID`.

## Запуск

```bash
npm start
```

После запуска бот сам зарегистрирует slash-команды на сервере из `GUILD_ID`.

## Формат времени

В командах `/mute` и `/timeout` можно указывать:

- `10m` - 10 минут
- `2h` - 2 часа
- `7d` - 7 дней
- `permanent` - навсегда, только для `/mute`

Примеры:

```text
/mute user:@Игрок duration:30m reason:Оскорбления
/timeout user:@Игрок duration:1h reason:Флуд
/blacklist user:@Игрок reason:Обход наказания
```
