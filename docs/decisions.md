# Decisions and trade-offs

The reasoning behind the choices, including the ones that were left on the
table. Written for somebody reading the code in six months.

## The backend is the leaderboard

Facebook removed the native score APIs in the Zero Permissions platform
version. There was no choice: either the game ships without a leaderboard, or
we build one. Building one also means owning the rules, which is where most
of the work went.

**Alternative considered:** keep the game on the old platform version. It was
switched off on 30 September 2026, so the game would simply not load.

## Scores are verified, not trusted

The obvious implementation is "the client sends a score, the server stores
it". That makes the leaderboard a scoreboard for whoever is willing to send a
big number.

The version here derives the maximum possible score from the same spawn
schedule the client uses and rejects anything above it. It was tempting to
keep the rules in one place and duplicate them, but a duplicated schedule
drifts, and then the server either rejects honest players or accepts
impossible ones. `shared/rules.ts` exists to make that impossible.

**Alternative considered:** the server replays the whole round from the
submitted tap list. That would be much stronger, but it means shipping the
tap stream, storing it, and replaying every round. For a 30 second reflex
game that is a lot of cost for a small gain, and it still does not stop a
player who scripts perfect taps.

**What is still possible:** an attacker with a real account and a patched
client could play perfectly. The rules remove the cheap attacks, not the
determined ones. See "What this does not stop" in
[architecture.md](architecture.md).

## Identity comes from the signature, never from the body

The player id is read out of the signed payload. The `playerId` field in a
request body is only ever used as a fallback, and even then it has to appear
inside the signed payload to be accepted.

**Alternative considered:** trusting the client to send its own player id.
That would mean anybody could post scores as anybody else.

## Both sides share the rules module

`shared/rules.ts` is imported by relative path from the backend and through
the `@shared` alias from the game. It has no dependencies and no side effects
so both runtimes can consume it.

The cost is that the bundler and the backend have to agree on how to resolve
it. The game uses a Vite alias, the tests use a Vitest alias, and the
backend uses a relative import. Three places to keep in sync, all of them
one line.

**Alternative considered:** a workspace package for the shared code. It is
cleaner in theory, but the Vercel function tracer then has to follow a
symlink or a workspace path outside the function root, which is exactly the
kind of thing that breaks a deployment at the worst moment. The repository
root is the project root, so a relative import always stays inside the
traced tree.

## Vercel and Neon

Vercel gives the API a public HTTPS URL with no server to manage, which
matters because the game needs a reachable backend to submit scores. Neon is
a hosted Postgres that works over HTTP, so it needs no connection pool and no
open socket in a serverless function.

**Alternative considered:** a single Vercel function with SQLite. Not
possible on the serverless runtime, and the file would not persist.

**Alternative considered:** a relational database on a VPS. More control, more
to operate, and it is not what this project is for.

## The in-memory store is not a toy

There are two implementations of the same interface. The in-memory one is
used by `vercel dev` without a database and by every test. It is a real
implementation with the same semantics, including the atomic one-shot round
settlement, not a stub.

The tests therefore run against the same logic that runs in production, which
is why `settleRound` returns a boolean in both implementations.

## The game ships no assets

No images, no audio files. The orbs are drawn with canvas gradients, the
share image is rendered onto a 1024x1024 canvas at runtime, and the sound
effects are synthesised with the Web Audio API.

The whole bundle is about 19 KB of JavaScript, 7 KB of CSS and 11 KB as a
zip. It loads instantly on a phone, there is nothing to license, and there
are no assets to keep in sync with the theme.

**Cost:** the Web Audio sounds are simple, and the share image is a canvas
drawing rather than a designed poster.

## The game is playable without Facebook

If the SDK is missing, the game says so and keeps the local best score. That
makes development pleasant and it means a broken SDK cannot take the game
down.

It also means the leaderboard is genuinely optional at runtime, which is the
right shape for a staged release.

## Zero runtime dependencies in the game

The bundle imports nothing. Canvas, Web Audio and `fetch` are all platform
APIs. The Facebook SDK is loaded from Meta's CDN with a script tag in
`index.html`, because the upload validator requires the bundle to reference
one of the supported SDKs that way.

The only dependencies in the repository are on the backend side
(`@neondatabase/serverless`) and in the toolchain.

## What was left out

| Left out                 | Why                                                                    |
| ------------------------ | ---------------------------------------------------------------------- |
| Overlay views            | A lot of work for a 30 second game that does not need them             |
| Ads and analytics        | Out of scope for a staged release, and they complicate the trust story |
| Multiple game modes      | One mode, done well, is easier to judge                                |
| Internationalisation     | English only for now                                                   |
| Player accounts          | The Facebook player id is the account                                  |
| Server side round replay | Expensive, and the rules above cover the realistic attacks             |
| Rate limiting by IP      | The per player round limit is the limit that matters                   |
| A real deletion endpoint | No personal data is stored beyond a nickname and a score               |

## Known gaps

- **The exact key for the player id in Meta's payload is not documented.**
  The implementation tries a list of known keys and falls back to scanning
  the payload for the claimed id. It has to be confirmed against a real
  signature.
- **The exact string the HMAC covers is ambiguous.** Both the base64url
  segment and the decoded JSON are accepted, which is safe but untidy. A live
  signature should be used to pin it down and then the other branch removed.
- **A settled round that fails to record its score is lost.** The round is
  settled first, because that is the atomic guard against replay. If the
  database then refuses the update, the round is consumed and the score is
  lost. The window is small and the alternative, recording first, opens the
  door to concurrent submissions of different scores.
- **The leaderboard is not cached.** Every read hits the database. At the
  scale of a staged release that is a feature.
