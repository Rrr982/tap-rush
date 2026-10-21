# Tap Rush - Neon Arcade

A portrait Facebook Instant Game: tap the orbs for 30 seconds, try to beat your
best score, and climb a leaderboard that lives on our own backend.

The interesting part of this project is not the game, it is the **trust
model**. Facebook's Network Enabled Zero Permissions (NEZP) platform removes
the native score and leaderboard APIs, so the leaderboard has to be built and
secured from scratch. Every score in this repo is authenticated by a
Facebook-signed payload and checked against a score that is physically
possible in the time the player spent.

```
apps/game   the Instant Game (TypeScript, Vite, Canvas 2D, zero runtime deps)
api         Vercel serverless functions
src         the backend domain logic
shared      rules and types used by both sides
db          Postgres schema
docs        setup, architecture and API reference
```

---

## Quick start

```bash
npm install
npm run dev        # Vite dev server for the game, on http://localhost:5173
npm test           # 46 unit tests
npm run typecheck  # tsc for the backend and the game
npm run lint       # eslint
```

The game runs standalone in a browser. Without the Facebook SDK it detects
that, tells the player, and keeps the round fully playable with a local best
score.

To run the API locally:

```bash
cp .env.example .env.local   # fill in FB_APP_ID and FB_APP_SECRET
npm run dev:api              # vercel dev
```

Without `DATABASE_URL` the API uses an in-memory store and prints a loud
warning. Scores do not persist, which is fine for local work.

---

## How a score is trusted

```
game                         our API                    Facebook
  |                             |                           |
  |-- nonce (128 bit random) -->|                           |
  |                             |                           |
  |--------- FBInstant.player.getSignedPlayerInfoAsync(nonce) -->|
  |                             |                           |
  | <------ signature + player id (HMAC signed by FB) ------|
  |                             |                           |
  |-- POST /api/session {nonce, signature} -->|             |
  |                             | verify HMAC with app secret
  |                             | bind nonce to a round    |
  | <--- sessionId ------------- |                           |
  |                             |                           |
  |  ... 30 seconds of tapping ...                          |
  |                             |                           |
  |--------- getSignedPlayerInfoAsync(same nonce) --------->|
  | <------ fresh signature ----- |                         |
  |                             |                           |
  |-- POST /api/score {sessionId, nonce, signature, score} ->|
  |                             | re-verify the signature  |
  |                             | check the round is open  |
  |                             | check the score is possible in the elapsed time
  |                             | settle the round (once)  |
  | <--- best score, rank, top 10                          |
```

Three rules keep the board honest:

1. **Identity comes from the signature, never from the request body.** The
   player id is read out of the signed payload, so a client cannot claim to
   be somebody else.
2. **One round, one score.** The round is settled with a single atomic
   update, so a submission cannot be replayed.
3. **A score has to be physically possible.** The game and the server share
   the same spawn schedule (`shared/rules.ts`). A score above the number of
   orbs that could have appeared in the elapsed time is rejected.

The client cannot skip the check by closing the game early, either: the round
has to have lasted at least two seconds.

See [docs/architecture.md](docs/architecture.md) for the full model.

---

## Scripts

| Script               | What it does                              |
| -------------------- | ----------------------------------------- |
| `npm run dev`        | Vite dev server for the game              |
| `npm run dev:api`    | `vercel dev`, runs the API locally        |
| `npm run build:game` | Builds the game into `apps/game/dist`     |
| `npm run bundle:fb`  | Zips the build into `dist/tap-rush.zip`   |
| `npm run db:migrate` | Applies `db/schema.sql` to `DATABASE_URL` |
| `npm run typecheck`  | Type checks the backend and the game      |
| `npm run lint`       | ESLint                                    |
| `npm run format`     | Prettier                                  |
| `npm test`           | Vitest                                    |

---

## Deploying the game to Facebook

The bundle that Facebook needs is `dist/tap-rush.zip`, built with:

```bash
VITE_API_BASE_URL=https://your-api.vercel.app npm run build:game
npm run bundle:fb
```

`VITE_API_BASE_URL` is baked into the bundle at build time, because Facebook
serves the game from their own CDN and a relative URL would not reach the
backend.

Upload the zip in the Facebook developer dashboard, in the Instant Games
settings. The full walkthrough, including the Zero Permissions switch and the
content security policy, is in
[docs/facebook-setup.md](docs/facebook-setup.md).

---

## Status

The game, the API, the database schema and the tests are done. Deployment is
deliberately left until the Facebook App ID and App Secret are available:

- [ ] Create the Vercel project and the Neon database
- [ ] Set `FB_APP_ID`, `FB_APP_SECRET` and `DATABASE_URL`
- [ ] Run the migration, rebuild the game with `VITE_API_BASE_URL`
- [ ] Upload the bundle and test with a Facebook tester account

Everything else - the code, the tests, the docs - is in the repository.

## Documentation

| Document                                         | What is in it                                 |
| ------------------------------------------------ | --------------------------------------------- |
| [docs/architecture.md](docs/architecture.md)     | Trust model, data flow, design of the modules |
| [docs/facebook-setup.md](docs/facebook-setup.md) | Dashboard walkthrough for the staged release  |
| [docs/deployment.md](docs/deployment.md)         | Vercel and Neon, environment variables        |
| [docs/api.md](docs/api.md)                       | Endpoint reference                            |
| [docs/decisions.md](docs/decisions.md)           | Trade-offs and what was left out              |
