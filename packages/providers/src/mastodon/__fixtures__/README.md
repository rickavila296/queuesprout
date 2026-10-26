# Mastodon fixtures

Response bodies in the shape Mastodon 4.x returns for `POST /api/v1/apps`, `POST /oauth/token`,
`GET /api/v1/accounts/verify_credentials`, `POST /api/v1/statuses` and the media attachment from
`POST /api/v2/media` / `GET /api/v1/media/:id` (`media-processing.json` is one the server has not
processed yet: 202 or 206 with a null `url`), plus its error bodies
(`{ "error": ... }`, and `error_description` from the OAuth endpoints).

Every id, client id, secret and token here is fake, and the server is `https://masto.test`.
Replace them with redacted recordings from a test account when one is available; never commit
a real token or client secret.
