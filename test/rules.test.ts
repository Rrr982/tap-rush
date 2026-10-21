import { describe, expect, it } from 'vitest';
import {
  MAX_ROUND_SCORE,
  ROUND_DURATION_MS,
  maxSpawnableOrbs,
  orbLifetimeMs,
  roundProgress,
  spawnIntervalMs,
} from '../shared/rules';

describe('game rules', () => {
  it('spawns faster as the round progresses', () => {
    expect(spawnIntervalMs(0)).toBeGreaterThan(spawnIntervalMs(1));
    expect(orbLifetimeMs(0)).toBeGreaterThan(orbLifetimeMs(1));
  });

  it('clamps the round progress', () => {
    expect(roundProgress(-100)).toBe(0);
    expect(roundProgress(ROUND_DURATION_MS)).toBe(1);
    expect(roundProgress(ROUND_DURATION_MS * 2)).toBe(1);
  });

  it('allows the first orb immediately', () => {
    expect(maxSpawnableOrbs(0)).toBe(1);
    expect(maxSpawnableOrbs(799)).toBe(1);
    expect(maxSpawnableOrbs(800)).toBe(2);
  });

  it('grows the number of possible orbs with the elapsed time', () => {
    let previous = 0;
    for (let elapsed = 500; elapsed <= ROUND_DURATION_MS; elapsed += 500) {
      const count = maxSpawnableOrbs(elapsed);
      expect(count).toBeGreaterThanOrEqual(previous);
      previous = count;
    }
  });

  it('caps a full round at MAX_ROUND_SCORE', () => {
    expect(MAX_ROUND_SCORE).toBe(maxSpawnableOrbs(ROUND_DURATION_MS));
    expect(MAX_ROUND_SCORE).toBeGreaterThan(40);
  });

  it('never lets a short round claim more than a full round', () => {
    expect(maxSpawnableOrbs(5_000)).toBeLessThan(MAX_ROUND_SCORE);
  });
});
