# Slack fixtures

Response bodies in the shape the Slack Web API returns for `auth.test`,
`conversations.info`, `conversations.list`, `chat.postMessage`, `files.getUploadURLExternal`
and `files.completeUploadExternal`, plus its error bodies (`error-invalid-blocks.json` is what a
message gets when it shows a file Slack has not finished processing)
(`{ ok: false, error }`, usually with HTTP 200; a 429 carries `Retry-After` instead).

Every id here is fake, and no fixture holds a token. Never commit a real bot token
(`xoxb-…`): it lets anyone post as the app.
