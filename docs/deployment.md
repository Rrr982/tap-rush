# Deployment

The backend is a set of Vercel serverless functions and a Neon Postgres
database. The game is a static bundle that is uploaded to Facebook, not served
by Vercel.

```
Vercel project  =  the repository root
Database        =  Neon Postgres
Game            =  built locally, uploaded as a zip to Facebook
```

## 1. The database

1. Create a Neon project.
2. Copy the pooled connection string. It looks like
   `postgresql://user:password@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require`.
   The **pooled** endpoint is the right one for serverless functions.
3. Apply the schema:

   ```bash
   DATABASE_URL="postgresql://..." npm run db:migrate
   ```

   The migration is idempotent: `db/schema.sql` uses `CREATE TABLE IF NOT
EXISTS` and `CREATE INDEX IF NOT EXISTS`, so running it twice is safe.

## 2. The Vercel project

1. Create a project and import the repository. The **root directory** must be
   the repository root, because the API functions live in `api/` next to
   `src/` and `shared/`.
2. `vercel.json` already declares everything else:

   ```json
   {
     "framework": null,
     "functions": { "api/*.ts": { "runtime": "nodejs22.x" } }
   }
   ```

   The game is deployed separately to Facebook, so the Vercel project does not
   build or serve its static output. This avoids requiring a `dist` directory
   during the API deployment.

3. Check **Project Settings -> General** before the first deploy:

   | Setting                                         | Value     | Why                                                           |
   | ----------------------------------------------- | --------- | ------------------------------------------------------------- |
   | Root Directory                                  | _(empty)_ | The repository root, so `api/` and `shared/` are visible      |
   | Build Command                                   | _(empty)_ | Vercel builds the API functions; the game is built separately |
   | Output Directory                                | _(empty)_ | No static output directory is needed for the API              |
   | Include source files outside the Root Directory | on        | Not needed when the root directory is the repository root     |

   A root directory of `apps/game` excludes the API functions, so `/api/*`
   answers 404. If Build Command or Output Directory overrides are enabled in
   Project Settings, clear them; otherwise Vercel may continue looking for a
   static `dist` directory that this API deployment does not produce.

4. Add the environment variables (see below).
5. Deploy. The API is now at `https://<project>.vercel.app`.

### Environment variables

| Variable               | Where                              | Required             | Notes                                        |
| ---------------------- | ---------------------------------- | -------------------- | -------------------------------------------- |
| `FB_APP_ID`            | Production                         | no                   | Only reported by `/api/health`               |
| `FB_APP_SECRET`        | Production                         | **yes**              | Without it every score is refused with `503` |
| `DATABASE_URL`         | Production                         | **yes**              | Neon pooled connection string                |
| `CORS_ORIGINS`         | Production                         | no                   | Extra origins, comma separated               |
| `MAX_SIGNATURE_AGE_MS` | Production                         | no                   | Defaults to 600000 (10 minutes)              |
| `DB_DRIVER`            | Local                              | no                   | `postgres` or `memory`                       |
| `VITE_API_BASE_URL`    | Build time, not a runtime variable | **yes** for the game | The public URL of the API                    |

`FB_APP_SECRET` and `DATABASE_URL` are secrets. Mark them as sensitive in the
Vercel dashboard so they are masked in the logs.

`VITE_API_BASE_URL` is a build time variable, not a runtime one. It is baked
into the JavaScript bundle, so it has to be set when the game is built:

```bash
VITE_API_BASE_URL=https://<project>.vercel.app npm run build:game
```

## 3. The game

The game is not deployed to Vercel. It is built and uploaded to Facebook:

```bash
VITE_API_BASE_URL=https://<project>.vercel.app npm run build:game
npm run bundle:fb
```

The build reads `.env.local` from the repository root, so `VITE_API_BASE_URL`
can live there instead of being passed on the command line. Check that the
built bundle actually contains the URL before uploading it:

```bash
grep -o "https://[a-z0-9.-]*vercel.app" apps/game/dist/assets/*.js
```

`dist/tap-rush.zip` is the file to upload. See
[facebook-setup.md](facebook-setup.md) for the dashboard walkthrough.

## 4. Verifying a deployment

```bash
curl https://<project>.vercel.app/api/health
```

```json
{
  "ok": true,
  "store": "postgres",
  "appId": "1234567890",
  "time": 1760000000000
}
```

`"store": "memory"` means `DATABASE_URL` did not reach the deployment and the
scores are being thrown away. `"ok": false` means the database could not be
reached.

A full round trip, from outside Facebook, can be tested with any valid
signature:

```bash
curl -X POST https://<project>.vercel.app/api/session \
  -H 'Content-Type: application/json' \
  -d '{"nonce":"abcdef0123456789abcdef0123456789","signature":"<signed>"}'
```

## 5. Local development against the real database

```bash
cp .env.example .env.local
# fill in DATABASE_URL, FB_APP_ID and FB_APP_SECRET
npm run db:migrate
npm run dev:api
```

`scripts/migrate.mjs` loads `.env.local` or `.env` automatically, so
`npm run db:migrate` picks up the same values.

For the game to talk to the local API, build it with the local URL:

```bash
VITE_API_BASE_URL=http://localhost:3000 npm run dev
```

## 6. Keeping the database safe

- The Neon project should have automatic branching or a backup schedule if the
  leaderboard matters.
- Nothing in the API can delete a player, so a `DELETE FROM players` is the
  only way to honour a deletion request today. That is enough for a staged
  release and is called out in [decisions.md](decisions.md).
- The API never exposes the app secret, and the app secret is never sent to
  the client.
