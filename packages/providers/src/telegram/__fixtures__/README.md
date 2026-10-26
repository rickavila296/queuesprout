# Telegram fixtures

Response bodies in the shape the Telegram Bot API returns for `getMe`, `getChat`,
`getChatMember`, `sendMessage`, `sendPhoto` and `sendMediaGroup` (an array, one message per photo), plus its error bodies (`{ ok: false, error_code,
description, parameters }`, with `retry_after` in seconds on a 429).

Every id here is fake, and no fixture holds a token. Never commit a real bot token: it lets
anyone post as the bot.
