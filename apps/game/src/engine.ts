/**
 * The game engine.
 *
 * It knows nothing about the DOM, the canvas or Facebook. It is a pure state
 * machine driven by a wall clock, which keeps the spawn schedule exactly
 * reproducible and lets the server re-derive the maximum possible score from
 * the same rules (see `shared/rules.ts`).
 */

import {
  ROUND_DURATION_MS,
  maxConcurrentOrbs,
  orbLifetimeMs,
  orbRadiusFraction,
  roundProgress,
  spawnIntervalMs,
} from '@shared/rules';

export interface Orb {
  id: number;
  /** Centre in field pixels. */
  x: number;
  y: number;
  /** Radius in field pixels. */
  radius: number;
  hue: number;
  spawnedAt: number;
  expiresAt: number;
}

export interface Pop {
  x: number;
  y: number;
  radius: number;
  bornAt: number;
  hue: number;
  hit: boolean;
}

export interface RoundResult {
  score: number;
  bestStreak: number;
  taps: number;
  elapsedMs: number;
}

export interface EngineHooks {
  onOrbHit?: (orb: Orb, streak: number, score: number) => void;
  onMiss?: (streak: number) => void;
  onFinish?: (result: RoundResult) => void;
}

/** Neon palette used for the orbs, in degrees. */
const HUES = [188, 320, 84, 42, 262, 12];

const POP_LIFETIME_MS = 420;
const MIN_GAP_PX = 10;

export class GameEngine {
  private orbs: Orb[] = [];
  private pops: Pop[] = [];
  private score = 0;
  private streak = 0;
  private bestStreak = 0;
  private taps = 0;
  private nextSpawnAt = 0;
  private nextId = 1;
  private nextHue = 0;

  private fieldWidth = 0;
  private fieldHeight = 0;

  private startedAt = 0;
  private pausedAt: number | null = null;
  private pausedTotalMs = 0;
  private elapsedMs = 0;
  private running = false;
  private finished = false;

  private readonly hooks: EngineHooks;
  private readonly random: () => number;

  constructor(hooks: EngineHooks = {}, random: () => number = Math.random) {
    this.hooks = hooks;
    this.random = random;
  }

  /** Tell the engine how big the play field is, in CSS pixels. */
  resize(width: number, height: number): void {
    this.fieldWidth = Math.max(1, width);
    this.fieldHeight = Math.max(1, height);
  }

  /** Begin a round. `now` is a wall clock timestamp in ms. */
  start(now: number): void {
    this.orbs = [];
    this.pops = [];
    this.score = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.taps = 0;
    this.nextSpawnAt = 0;
    this.nextId = 1;
    this.nextHue = 0;
    this.startedAt = now;
    this.pausedAt = null;
    this.pausedTotalMs = 0;
    this.elapsedMs = 0;
    this.running = true;
    this.finished = false;
  }

  pause(now: number): void {
    if (!this.running || this.pausedAt !== null) return;
    this.pausedAt = now;
  }

  resume(now: number): void {
    if (this.pausedAt === null) return;
    this.pausedTotalMs += now - this.pausedAt;
    this.pausedAt = null;
  }

  /** Advance the round. Safe to call every animation frame. */
  update(now: number): void {
    if (!this.running || this.finished) return;
    if (this.pausedAt !== null) return;

    this.elapsedMs = Math.max(0, now - this.startedAt - this.pausedTotalMs);

    this.orbs = this.orbs.filter((orb) => orb.expiresAt > this.elapsedMs);
    this.pops = this.pops.filter((pop) => this.elapsedMs - pop.bornAt < POP_LIFETIME_MS);

    while (this.nextSpawnAt <= this.elapsedMs) {
      const progress = roundProgress(this.nextSpawnAt);
      if (this.orbs.length < maxConcurrentOrbs(progress)) {
        this.spawnOrb(this.nextSpawnAt, progress);
      }
      this.nextSpawnAt += spawnIntervalMs(progress);
    }

    if (this.elapsedMs >= ROUND_DURATION_MS) {
      this.elapsedMs = ROUND_DURATION_MS;
      this.running = false;
      this.finished = true;
      this.hooks.onFinish?.({
        score: this.score,
        bestStreak: this.bestStreak,
        taps: this.taps,
        elapsedMs: this.elapsedMs,
      });
    }
  }

  /**
   * Handle a tap at field coordinates.
   *
   * Returns true when an orb was hit. A tap that hits nothing breaks the
   * streak but never removes a point.
   */
  tap(x: number, y: number): boolean {
    if (!this.running || this.finished) return false;

    for (let i = this.orbs.length - 1; i >= 0; i -= 1) {
      const orb = this.orbs[i];
      if (!orb) continue;
      const dx = x - orb.x;
      const dy = y - orb.y;
      if (dx * dx + dy * dy <= orb.radius * orb.radius) {
        this.orbs.splice(i, 1);
        this.score += 1;
        this.streak += 1;
        this.taps += 1;
        if (this.streak > this.bestStreak) this.bestStreak = this.streak;
        this.pops.push({
          x: orb.x,
          y: orb.y,
          radius: orb.radius,
          bornAt: this.elapsedMs,
          hue: orb.hue,
          hit: true,
        });
        this.hooks.onOrbHit?.(orb, this.streak, this.score);
        return true;
      }
    }

    this.taps += 1;
    this.streak = 0;
    this.pops.push({
      x,
      y,
      radius: 18,
      bornAt: this.elapsedMs,
      hue: 0,
      hit: false,
    });
    this.hooks.onMiss?.(0);
    return false;
  }

  private spawnOrb(at: number, progress: number): void {
    const radius = Math.max(8, orbRadiusFraction(progress) * this.fieldWidth);
    const margin = radius * 1.15;
    const maxX = Math.max(margin, this.fieldWidth - margin);
    const maxY = Math.max(margin, this.fieldHeight - margin);

    let x = 0;
    let y = 0;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      x = margin + this.random() * (maxX - margin);
      y = margin + this.random() * (maxY - margin);
      const clear = this.orbs.every((other) => {
        const dx = other.x - x;
        const dy = other.y - y;
        const reach = other.radius + radius + MIN_GAP_PX;
        return dx * dx + dy * dy > reach * reach;
      });
      if (clear) break;
    }

    const hue = HUES[this.nextHue % HUES.length] ?? 188;
    this.nextHue += 1;

    this.orbs.push({
      id: this.nextId,
      x,
      y,
      radius,
      hue,
      spawnedAt: at,
      expiresAt: at + orbLifetimeMs(progress),
    });
    this.nextId += 1;
  }

  get currentScore(): number {
    return this.score;
  }

  get currentStreak(): number {
    return this.streak;
  }

  get activeOrbs(): readonly Orb[] {
    return this.orbs;
  }

  get activePops(): readonly Pop[] {
    return this.pops;
  }

  get elapsed(): number {
    return this.elapsedMs;
  }

  get isFinished(): boolean {
    return this.finished;
  }
}
