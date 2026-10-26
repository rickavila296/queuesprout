# Mastodon fixtures

Response bodies in the shape Mastodon 4.x returns for `POST /api/v1/apps`, `POST /oauth/token`,
`GET /api/v1/accounts/verify_credentials` and `POST /api/v1/statuses`, plus its error bodies
(`{ "error": ... }`, and `error_description` from the OAuth endpoints).

Every id, client id, secret and token here is fake, and the server is `https://masto.test`.
Replace them with redacted recordings from a test account when one is available; never commit
a real token or client secret.
