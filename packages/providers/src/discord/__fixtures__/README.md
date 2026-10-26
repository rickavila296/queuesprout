# Discord fixtures

Response bodies in the shape Discord API v10 returns for `GET /webhooks/{id}/{token}` and
`POST /webhooks/{id}/{token}?wait=true`, plus its error bodies (`{ message, code }`, and
`retry_after` in seconds on a 429).

Every id and token here is fake. Never commit a real webhook URL: its token lets anyone post
to the channel.
