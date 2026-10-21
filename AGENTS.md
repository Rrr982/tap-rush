# AGENTS.md

# Repository Guidelines for Coding Agents

This repository is **Tap Rush** - a portrait Facebook Instant Game with a trust-first leaderboard backend. Treat this as a monorepo with very clear boundaries between the game client and the backend. Follow these guidelines strictly when making changes.

## Project Structure

```
.
├── api/           # Vercel serverless functions (thin adapters)
├── apps/game/     # Facebook Instant Game (Vite + TypeScript + Canvas 2D)
├── db/            # Database schema
├── docs/          # Architecture, API, deployment, Facebook setup
├── scripts/       # Build/bundle/migrate utilities
├── shared/        # Shared types and game rules (used by both game and API)
├── src/           # Backend domain logic (trust, handlers, stores)
└── test/          # Unit tests
```

### Key Boundaries

- **`shared/` is the single source of truth** - `shared/rules.ts` contains game constants and math used by both client and server. `shared/contract.ts` defines API request/response types. Keep this dependency-free and side-effect free.
- **Game (`apps/game/`)** imports from shared via `@shared` alias (configured in Vite). It must remain platform-agnostic where possible - `engine.ts` knows nothing about DOM/canvas/Facebook.
- **Backend (`src/`)** imports from shared via relative paths (`../shared/rules`). `api/*.ts` are minimal adapters that wire handlers to Vercel's runtime.
- **Trust is critical** - Never trust client-supplied identity or scores. All authentication comes from Facebook-signed payloads verified server-side.

## Tech Stack

| Area | Technology |
|------|------------|
| Game | TypeScript, Vite 8, Canvas 2D, Web Audio API (synthesized SFX) |
| Backend | Node.js 22, Vercel Functions, TypeScript |
| Database | Neon Postgres (serverless) via `@neondatabase/serverless`, or in-memory for dev/test |
| Tests | Vitest 5 |
| Lint/Format | ESLint 10 (flat config), Prettier |
| Build | Vite for game, tsc for typechecking |

## Build, Test, and Development Commands

Run all commands from the repository root.

| Command | Purpose |
|---------|---------|
| `npm install` | Install dependencies (after changing package.json) |
| `npm run dev` | Start Vite dev server for the game (http://localhost:5173) |
| `npm run dev:api` | Start `vercel dev` for local API testing |
| `npm run build:game` | Build game to `apps/game/dist/` with `base: './'` for Facebook CDN |
| `npm run bundle:fb` | Zip `apps/game/dist/` to `dist/tap-rush.zip` (index.html at root) |
| `npm run db:migrate` | Apply `db/schema.sql` to `DATABASE_URL` |
| `npm run typecheck` | Type check both backend (`tsc -p tsconfig.json`) and game (`tsc -p apps/game/tsconfig.json`) |
| `npm run lint` | Run ESLint on all files |
| `npm run format` | Format all files with Prettier |
| `npm run format:check` | Check formatting without modifying files |
| `npm test` | Run all tests with Vitest |
| `npm run test:watch` | Run tests in watch mode |

## Coding Style & Connotations

### General

- **TypeScript strict mode** - `strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitOverride: true`, `verbatimModuleSyntax: true`. Follow the existing strictness.
- **ESM** - Project uses `"type": "module"`. Use `.js` extensions in relative imports only when required by the runtime, but prefer consistent patterns with existing code.
- **No comments unless necessary** - Follow the repo's style. Comments are used sparingly to explain complex logic (trust model, score plausibility). Don't add unnecessary comments.
- **Type imports** - Use `import type { ... }` when importing only types (enforced by ESLint rule `@typescript-eslint/consistent-type-imports`).
- **Explicit return types** not strictly required if inferred, but be consistent with existing code.

### Naming Conventions

- **Files**: kebab-case for modules (`store-memory.ts`, `api-entry.ts`), PascalCase not used for files
- **Classes**: PascalCase (`GameEngine`, `FbBridge`, `MemoryStore`, `PostgresStore`)
- **Functions/variables**: camelCase
- **Constants**: UPPER_SNAKE_CASE for true constants (`ROUND_DURATION_MS`, `MAX_ROUNDS_PER_HOUR`)
- **Interfaces/Types**: PascalCase (`PlayerRecord`, `SessionResponse`)

### Formatting

- **Prettier config**: `printWidth: 100`, `singleQuote: true`, `semi: true`, `trailingComma: "all"`, `arrowParens: "always"`
- Run `npm run format` before committing.

## Testing Guidelines

- **Test framework**: Vitest with `node` environment
- **Test location**: `test/` for backend/integration tests, `apps/game/src/*.test.ts` for game engine tests
- **Run all tests**: `npm test` - all 46 tests must pass
- **Coverage areas**: trust verification (signature edge cases), game rules/math, API endpoints with mocked stores, game engine state machine
- **Determinism**: Use injectable clocks (`now`), id factories (`newId`), and random functions for testability (see `GameEngine` constructor)
- **Test helpers**: Use `test/helpers.ts` for API tests - provides `sign()`, `makeRequest()`, `makeResponse()`, `testConfig()`

When adding features:
1. Add unit tests for pure functions (`shared/rules.ts`, `src/trust.ts`, `src/display-name.ts`)
2. Add integration tests for API handlers using `MemoryStore`
3. Add engine tests for game logic changes

## Trust & Security (CRITICAL)

This is the most important aspect of the codebase. Violations will break the security model.

### Identity & Authentication

- **Player ID comes from the signed payload ONLY** - Never trust `playerId` from request bodies. The server reads it from the Facebook-signed payload verified with `FB_APP_SECRET`.
- **Verify every score submission** - Use `verifySignedPlayerInfo()` for session and score endpoints. Re-verify on score submission with a fresh signature for the same nonce.
- **Nonce binding** - Every round has a unique nonce. The same nonce must be used for session creation and score submission. Reject mismatches.
- **Signature verification is defensive** - `src/trust.ts` accepts both HMAC input encodings (base64url segment and decoded JSON) and both segment orderings (signature.payload and payload.signature). Keep this defensive behavior.

### Score Validation

- **Shared rules are mandatory** - Use `maxSpawnableOrbs(elapsedMs)` from `shared/rules.ts` to validate scores. The game and server must use the same schedule.
- **Time bounds** - Enforce `MIN_ROUND_ELAPSED_MS` (2000ms). Reject rounds settled too quickly.
- **One-shot settlement** - Use `store.settleRound()` atomically. A round can only be scored once - enforce with 409 on replay.
- **Best score only increases** - Never allow worse scores to overwrite a player's best.
- **Rate limiting** - Enforce `MAX_ROUNDS_PER_HOUR` per player.

### Configuration & Secrets

- **Never commit secrets** - `FB_APP_SECRET`, `DATABASE_URL` must never be in git. Use `.env.example` as template.
- **CORS is strict** - Only allowlisted origins get `Access-Control-Allow-Origin`. Echo origin only if allowed.
- **App secret required for scoring** - If `FB_APP_SECRET` is missing, health reports it and score submissions return 503.
- **No logging of secrets** - Never log signatures, secrets, or sensitive tokens.

## Database & Storage

### Schema (`db/schema.sql`)

```sql
players (player_id PK, display_name, best_score, best_at, created_at, updated_at)
rounds  (id PK, player_id FK, nonce UNIQUE, started_at, settled_at, score)
```

- **Indexes**: `players_best_idx` on `(best_score DESC, best_at ASC)` for leaderboard, `rounds_player_started_idx` for rate limiting
- **Ties**: Break by `best_at ASC` (earliest to reach the score wins)
- **Migrations**: Use `npm run db:migrate` - schema uses `IF NOT EXISTS` for idempotency

### Store Interface

All stores implement `src/store.ts` interface:
- `ensurePlayer()`, `getPlayer()`, `setDisplayName()`
- `createRound()`, `getRound()`, `settleRound()` (returns false if already settled)
- `recordScore()` (only promotes if better), `topPlayers()`, `rankOf()`, `countRoundsSince()`
- `ping()`

**PostgresStore** (`src/store-postgres.ts`): Uses Neon serverless driver, atomic updates with `UPDATE ... WHERE ... RETURNING`
**MemoryStore** (`src/store-memory.ts`): For dev and tests, data lost on restart
**Store Factory** (`src/store-factory.ts`): Creates store based on config, warns loudly if using memory in production

## Game Development (`apps/game/`)

### Architecture

- **Engine is pure** - `src/engine.ts` is DOM/canvas/Facebook agnostic. Takes `now` timestamps, driven by wall clock. Testable without browser.
- **Rendering separated** - `src/render.ts` handles all canvas drawing. `src/ui.ts` handles DOM manipulation.
- **Platform abstraction** - `src/fb.ts` wraps Facebook SDK defensively. Game works offline if SDK missing.
- **No assets** - Orbs drawn with gradients, sounds synthesized with Web Audio, share image rendered to canvas.

### Game Design Constraints

- **Portrait 9:16** - Frame sized to `min(100vw, calc(100vh * 9/16))`, max 480px
- **30 second rounds** - `ROUND_DURATION_MS = 30000`
- **Spawn schedule** - Difficulty increases over time (intervals decrease, more concurrent orbs, smaller radius)
- **Scoring** - +1 per orb tap, empty tap breaks streak (no score loss)
- **Share** - Uses `FBInstant.shareAsync` with 1024x1024 JPEG data URI (generated in `share.ts`)

### Vite Configuration

- `base: './'` - Required for Facebook CDN (assets must be relative)
- `@shared` alias points to `../../shared`
- Build outputs to `dist/`, no sourcemaps

### Facebook Instant Games SDK v8.0 (NEZP)

Critical API usage:
- `initializeAsync()`, `startGameAsync()`
- `player.getSignedPlayerInfoAsync(requestPayload)` - returns signed info
- `shareAsync({ text, image })` - text required, exactly one of image/imageOverlayPath
- `performHapticFeedbackAsync(type)`
- `onPause()`, `onResume()`

Bundle must include `public/fbapp-config.json` with
`{"instant_games":{"platform_version":"RICH_GAMEPLAY","orientation":"PORTRAIT"}}`.

## API Endpoints

All endpoints in `src/handlers.ts`, wired in `api/*.ts` via `createHandler()`.

| Endpoint | Method | Purpose | Auth |
|----------|--------|---------|------|
| `/api/health` | GET | Health check, reports store driver and app ID | None (CORS) |
| `/api/session` | POST | Open a round, bind nonce to session | Facebook signature required |
| `/api/score` | POST | Submit and validate score for a round | Facebook signature required (fresh, same nonce) |
| `/api/leaderboard` | GET | Get top players, optionally with player's rank | None |
| `/api/profile` | POST | Update display name | Facebook signature required |

See `docs/api.md` for full request/response schemas.

## Error Handling

- **API errors** use standard envelope: `{ ok: false, error: string, message: string }`
- **Error codes**: `bad_request`, `unauthorized`, `forbidden`, `not_found`, `method_not_allowed`, `rate_limited`, `unavailable`, `internal`
- **Handlers** use structural `HttpRequest`/`HttpResponse` types for testability
- **CORS preflight** handled by `sendPreflight()` returning 204

## Common Tasks

### Adding a new API endpoint

1. Define types in `shared/contract.ts` if needed
2. Add handler function in `src/handlers.ts`
3. Create thin adapter in `api/newendpoint.ts` using `createHandler()`
4. Add tests in `test/api.test.ts`
5. Update `docs/api.md`

### Modifying game rules

1. Change constants/functions in `shared/rules.ts` - this affects both game and server
2. Update tests in `test/rules.test.ts`
3. Server will automatically enforce new rules (score plausibility uses `maxSpawnableOrbs`)
4. Game engine uses the same functions
5. Run `npm test` to verify

### Changing the database schema

1. Update `db/schema.sql`
2. Update store implementations if needed (`src/store-postgres.ts`, `src/store-memory.ts`)
3. Update `src/store.ts` interface if signature changes
4. Run migration with `npm run db:migrate`
5. Update tests

### Adding game features

1. Keep `engine.ts` pure - add methods, don't touch DOM
2. Update renderer in `render.ts` if visual changes needed
3. Wire in `main.ts` and update UI in `ui.ts`/`index.html`/`styles.css`
4. Add engine tests in `apps/game/src/engine.test.ts`
5. Test in browser with `npm run dev`

## Deployment Notes

- **Game deployed separately** - Built and uploaded to Facebook as zip, NOT to Vercel
- **API deployed to Vercel** - Root directory is repo root, functions in `api/`
- **Environment variables** - `FB_APP_SECRET`, `DATABASE_URL` required in production; `VITE_API_BASE_URL` baked in at build time
- **Bundle** - Must have `index.html` at root, `fbapp-config.json` included, `base: './'` in Vite
- **Staged only** - Game should remain in development mode with testers until FB App ID/Secret configured

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Could not reach the leaderboard" | Check `VITE_API_BASE_URL` baked into build, CORS allowlist, API health |
| Scores rejected | Check `FB_APP_SECRET` matches, nonce binding, time elapsed >= 2000ms, score within `maxSpawnableOrbs` |
| "Signature could not be verified" | Check app secret, both HMAC encodings accepted but must match; see trust.ts logs |
| Memory store in prod | `DATABASE_URL` missing or misconfigured |
| Game won't load in Facebook | Check `RICH_GAMEPLAY` bundle config, SDK version, Zero Permissions, and CSP |
| Type errors after changes | Run `npm run typecheck` - checks both backend and game |

## Git Workflow

- **User pushes** - Repo is local git, user handles pushing
- **Commit style** - Concise messages matching repo style
- **Git identity** - Configured as `Rrr982 <rowellgumahad1@gmail.com>`
- **Never commit secrets** - `.gitignore` excludes `.env*` except `.env.example`
- **Pre-commit checks** - Run `npm run typecheck && npm run lint && npm test` before committing

## Important Files Reference

| File | Purpose |
|------|---------|
| `shared/rules.ts` | Game rules single source of truth |
| `src/trust.ts` | Facebook signature verification (core security) |
| `src/handlers.ts` | All API endpoint logic |
| `apps/game/src/engine.ts` | Pure game state machine |
| `vercel.json` | Vercel deployment config |
| `apps/game/vite.config.ts` | Game build config (base './', @shared alias) |
| `package.json` | Workspace config and scripts |

When in doubt, look at existing patterns - this codebase is consistent and well-structured. Prioritize security and correctness, especially around trust verification and score validation.
