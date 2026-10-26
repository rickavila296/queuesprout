# Bluesky fixtures

Response bodies in the shape the AT Protocol XRPC endpoints return
(`com.atproto.server.createSession`, `refreshSession`, `repo.createRecord`, `repo.getRecord`,
`identity.resolveHandle`, `app.bsky.actor.getProfile`) and their error bodies.

Every identifier, JWT and CID here is fake: the JWTs carry only `exp`/`iat`/`sub` claims and a
placeholder signature. Replace them with redacted recordings from a test account when one is
available; never commit a real token.
