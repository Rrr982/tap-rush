import { describe, expect, it } from 'vitest';
import { ROUND_DURATION_MS, maxSpawnableOrbs } from '@shared/rules';
import { GameEngine } from './engine';

/** Deterministic random, so the orb positions are predictable. */
function fakeRandom(): () => number {
  let value = 0.25;
  return () => {
    value = (value + 0.37) % 1;
    return value;
  };
}

describe('GameEngine', () => {
  it('spawns orbs as the round progresses', () => {
    const engine = new GameEngine({}, fakeRandom());
    engine.resize(400, 700);
    engine.start(0);
    engine.update(1000);
    expect(engine.activeOrbs.length).toBeGreaterThan(0);
  });

  it('never spawns more orbs than the shared rules allow', () => {
    const engine = new GameEngine({}, fakeRandom());
    engine.resize(400, 700);
    engine.start(0);

    let spawned = 0;
    for (let elapsed = 100; elapsed <= ROUND_DURATION_MS; elapsed += 100) {
      engine.update(elapsed);
      spawned = Math.max(spawned, engine.activeOrbs.length);
      expect(engine.activeOrbs.length).toBeLessThanOrEqual(maxSpawnableOrbs(elapsed));
    }
    expect(spawned).toBeGreaterThan(0);
  });

  it('scores a point when an orb is tapped', () => {
    const engine = new GameEngine({}, fakeRandom());
    engine.resize(400, 700);
    engine.start(0);
    engine.update(1000);

    const orb = engine.activeOrbs[0];
    expect(orb).toBeDefined();
    const hit = engine.tap(orb!.x, orb!.y);
    expect(hit).toBe(true);
    expect(engine.currentScore).toBe(1);
    expect(engine.currentStreak).toBe(1);
  });

  it('breaks the streak on an empty tap but keeps the score', () => {
    const engine = new GameEngine({}, fakeRandom());
    engine.resize(400, 700);
    engine.start(0);
    engine.update(1000);

    const orb = engine.activeOrbs[0]!;
    engine.tap(orb.x, orb.y);
    expect(engine.currentStreak).toBe(1);

    const hit = engine.tap(5, 5);
    expect(hit).toBe(false);
    expect(engine.currentScore).toBe(1);
    expect(engine.currentStreak).toBe(0);
  });

  it('ignores taps after the round has finished', () => {
    const engine = new GameEngine({}, fakeRandom());
    engine.resize(400, 700);
    engine.start(0);
    engine.update(ROUND_DURATION_MS);
    expect(engine.isFinished).toBe(true);
    expect(engine.tap(100, 100)).toBe(false);
  });

  it('finishes after the round duration', () => {
    let finished: number | null = null;
    const engine = new GameEngine(
      { onFinish: (result) => (finished = result.score) },
      fakeRandom(),
    );
    engine.resize(400, 700);
    engine.start(0);
    engine.update(ROUND_DURATION_MS - 100);
    expect(engine.isFinished).toBe(false);
    engine.update(ROUND_DURATION_MS);
    expect(engine.isFinished).toBe(true);
    expect(finished).toBe(0);
  });

  it('does not count time while paused', () => {
    const engine = new GameEngine({}, fakeRandom());
    engine.resize(400, 700);
    engine.start(0);
    engine.update(1000);
    engine.pause(1000);
    engine.update(20_000);
    expect(engine.elapsed).toBe(1000);
    engine.resume(20_000);
    engine.update(21_000);
    expect(engine.elapsed).toBe(2000);
  });
});
