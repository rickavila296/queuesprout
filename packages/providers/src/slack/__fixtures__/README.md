# Slack fixtures

Response bodies in the shape the Slack Web API returns for `auth.test`,
`conversations.info`, `conversations.list` and `chat.postMessage`, plus its error bodies
(`{ ok: false, error }`, usually with HTTP 200; a 429 carries `Retry-After` instead).

Every id here is fake, and no fixture holds a token. Never commit a real bot token
(`xoxb-…`): it lets anyone post as the app.
