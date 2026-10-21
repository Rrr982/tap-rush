/**
 * Tap Rush - game rules.
 *
 * This module is the single source of truth for the numbers that both the
 * client (the game) and the server (the score verifier) depend on.
 *
 * It is imported by relative path from the server and via the `@shared` alias
 * from the game. It must stay dependency-free and side-effect free so both
 * runtimes can consume it.
 */

/** Length of a single round. */
export const ROUND_DURATION_MS = 30_000;

/** Spawn interval at the start of a round, in ms. */
export const SPAWN_INTERVAL_START_MS = 800;
/** Spawn interval at the end of a round, in ms. */
export const SPAWN_INTERVAL_END_MS = 420;

/** How long an orb survives, at the start of a round, in ms. */
export const ORB_LIFETIME_START_MS = 2_200;
/** How long an orb survives, at the end of a round, in ms. */
export const ORB_LIFETIME_END_MS = 1_400;

/** Simultaneously visible orbs at the start of a round. */
export const MAX_CONCURRENT_START = 2;
/** Simultaneously visible orbs at the end of a round. */
export const MAX_CONCURRENT_END = 4;

/** Orb radius as a fraction of the play field width. */
export const ORB_RADIUS_START = 0.115;
export const ORB_RADIUS_END = 0.082;

/**
 * Minimum time that must pass between opening a round and submitting its
 * score. Blocks "open a session, instantly claim a huge score" attempts.
 */
export const MIN_ROUND_ELAPSED_MS = 2_000;

/** Maximum accepted rounds per player per rolling hour. */
export const MAX_ROUNDS_PER_HOUR = 60;

/** How long a signed player payload stays acceptable, in ms. */
export const MAX_SIGNATURE_AGE_MS = 10 * 60 * 1000;

/** Allowed clock skew when checking `issued_at`, in ms. */
export const MAX_CLOCK_SKEW_MS = 60 * 1000;

/** Minimum number of characters in a player-chosen display name. */
export const DISPLAY_NAME_MIN = 2;
/** Maximum number of characters in a player-chosen display name. */
export const DISPLAY_NAME_MAX = 16;

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** Round progress as a 0..1 fraction, clamped. */
export function roundProgress(elapsedMs: number): number {
  return clamp(elapsedMs / ROUND_DURATION_MS, 0, 1);
}

/** Delay between orb spawns at a given point in the round. */
export function spawnIntervalMs(progress: number): number {
  return lerp(SPAWN_INTERVAL_START_MS, SPAWN_INTERVAL_END_MS, progress);
}

/** How long an orb lives at a given point in the round. */
export function orbLifetimeMs(progress: number): number {
  return lerp(ORB_LIFETIME_START_MS, ORB_LIFETIME_END_MS, progress);
}

/** How many orbs may be on screen at once at a given point in the round. */
export function maxConcurrentOrbs(progress: number): number {
  return Math.round(lerp(MAX_CONCURRENT_START, MAX_CONCURRENT_END, progress));
}

/** Orb radius, as a fraction of the play field width. */
export function orbRadiusFraction(progress: number): number {
  return lerp(ORB_RADIUS_START, ORB_RADIUS_END, progress);
}

/**
 * Number of orbs that can possibly have been spawned within `elapsedMs`.
 *
 * The server uses this as the hard ceiling on an accepted score: an orb can
 * only be tapped after it exists, so a score above this number is impossible
 * in the real game and is treated as a tampered submission.
 *
 * The first orb appears immediately, so an elapsed time of zero still allows
 * one orb. The boundary is inclusive to stay exactly in step with the
 * engine, which spawns an orb whenever the next spawn time has been
 * reached.
 */
export function maxSpawnableOrbs(elapsedMs: number = ROUND_DURATION_MS): number {
  let count = 0;
  let t = 0;
  while (t <= elapsedMs) {
    count += 1;
    t += spawnIntervalMs(roundProgress(t));
  }
  return count;
}

/** Absolute ceiling on a score for a full 30 second round. */
export const MAX_ROUND_SCORE = maxSpawnableOrbs(ROUND_DURATION_MS);
