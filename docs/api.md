# API reference

Base URL: `https://<your-deployment>.vercel.app`

All requests and responses are JSON. Every response has an `ok` field. Errors
use the same envelope:

```json
{ "ok": false, "error": "bad_request", "message": "That score is not possible in a round." }
```

| `error`              | Status | Meaning                                                             |
| -------------------- | ------ | ------------------------------------------------------------------- |
| `bad_request`        | 400    | The request was malformed or the score was impossible               |
| `unauthorized`       | 401    | The signature could not be verified                                 |
| `forbidden`          | 403    | The round belongs to a different player                             |
| `not_found`          | 404    | Unknown round                                                       |
| `method_not_allowed` | 405    | Wrong HTTP method                                                   |
| `rate_limited`       | 429    | Too many rounds in the last hour                                    |
| `unavailable`        | 503    | The server is missing configuration, or the database is unreachable |
| `internal`           | 500    | Unexpected failure                                                  |

A settled round that is scored again returns `409` with the error code
`bad_request`.

## CORS

The game runs in a Facebook iframe, so every endpoint answers preflight
requests and echoes the origin back when it is on the allowlist. The default
allowlist is `apps.facebook.com`, `www.facebook.com`, `web.facebook.com`,
`m.facebook.com` and `messenger.com`, extended by the `CORS_ORIGINS`
environment variable.

```
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

---

## `POST /api/session`

Opens a round. The round is what a later score is attached to.

**Request**

```json
{
  "nonce": "abcdef0123456789abcdef0123456789",
  "signature": "<base64url signature>.<base64url payload>"
}
```

| Field       | Type   | Notes                                            |
| ----------- | ------ | ------------------------------------------------ |
| `nonce`     | string | 16 to 128 characters of `A-Z a-z 0-9 _ -`        |
| `signature` | string | The value from `getSignedPlayerInfoAsync(nonce)` |

**Response `201`**

```json
{
  "ok": true,
  "sessionId": "5c1a0f22-0e0a-4a1a-9f7e-9d2b8f1c0a11",
  "playerId": "1234567890",
  "displayName": "RUSH 4F2A",
  "bestScore": 41
}
```

`displayName` is either the name the player chose or an anonymous default
derived from the player id, because Zero Permissions means Facebook never
shares a name.

**Errors**: `400`, `401`, `429` (more than 60 rounds in the last hour).

---

## `POST /api/score`

Settles a round. A round can only be settled once.

**Request**

```json
{
  "sessionId": "5c1a0f22-0e0a-4a1a-9f7e-9d2b8f1c0a11",
  "nonce": "abcdef0123456789abcdef0123456789",
  "signature": "<a fresh signature for the same nonce>",
  "score": 27
}
```

The signature has to be requested again, with the same nonce, so the request
cannot be replayed later. The server checks that:

- the signature is genuine and was issued for this nonce
- the round exists, belongs to this player and uses this nonce
- the round has not been settled yet
- the round is at least two seconds old
- the score is not above `maxSpawnableOrbs(elapsed)`

**Response `200`**

```json
{
  "ok": true,
  "accepted": true,
  "score": 27,
  "bestScore": 41,
  "isNewBest": false,
  "rank": 7,
  "leaderboard": [{ "rank": 1, "playerId": "…", "displayName": "NEON FOX", "score": 63 }],
  "player": { "rank": 7, "score": 41, "displayName": "RUSH 4F2A" }
}
```

**Errors**: `400`, `401`, `403`, `404`, `409`.

---

## `GET /api/leaderboard`

The public top ten.

**Query parameters**

| Name       | Type   | Notes                                       |
| ---------- | ------ | ------------------------------------------- |
| `limit`    | number | 1 to 50, defaults to 10                     |
| `playerId` | string | Optional. Adds a `me` block for that player |

**Response `200`**

```json
{
  "ok": true,
  "entries": [
    { "rank": 1, "playerId": "…", "displayName": "NEON FOX", "score": 63 },
    { "rank": 2, "playerId": "…", "displayName": "RUSH 4F2A", "score": 41 }
  ],
  "me": { "rank": 2, "score": 41, "displayName": "RUSH 4F2A" }
}
```

Ties are broken in favour of the player who reached the score first. `me` is
`null` when the player has no score yet.

---

## `POST /api/profile`

Changes the display name. The name is cleaned up server side: control
characters are removed, whitespace is collapsed and the result has to be
between 2 and 16 characters.

**Request**

```json
{
  "nonce": "abcdef0123456789abcdef0123456789",
  "signature": "<signed>",
  "displayName": "NEON FOX"
}
```

**Response `200`**

```json
{ "ok": true, "displayName": "NEON FOX" }
```

**Errors**: `400`, `401`.

---

## `GET /api/health`

```json
{
  "ok": true,
  "store": "postgres",
  "appId": "1234567890",
  "time": 1760000000000
}
```

`"store"` is `postgres` or `memory`. A `memory` store in production means
`DATABASE_URL` is missing and scores are not being saved. The endpoint returns
`503` with an `error` field when the database cannot be reached.
