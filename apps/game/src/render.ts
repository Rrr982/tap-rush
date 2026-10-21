/**
 * Canvas rendering for the play field.
 *
 * Everything is drawn with plain 2D canvas calls: no images, no sprite sheets,
 * so the bundle stays tiny and the game loads instantly.
 */

import { ROUND_DURATION_MS } from '@shared/rules';
import type { Orb, Pop } from './engine';

export interface RenderState {
  orbs: readonly Orb[];
  pops: readonly Pop[];
  elapsedMs: number;
  width: number;
  height: number;
}

export function renderFrame(ctx: CanvasRenderingContext2D, state: RenderState): void {
  const { width, height } = state;
  drawBackground(ctx, width, height);
  drawPops(ctx, state.pops, state.elapsedMs);
  drawOrbs(ctx, state.orbs, state.elapsedMs);
}

function drawBackground(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, '#100a24');
  gradient.addColorStop(1, '#07040f');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = 'rgba(255,255,255,0.045)';
  const step = 46;
  for (let y = step; y < height; y += step) {
    for (let x = step; x < width; x += step) {
      ctx.beginPath();
      ctx.arc(x, y, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawOrbs(ctx: CanvasRenderingContext2D, orbs: readonly Orb[], elapsedMs: number): void {
  for (const orb of orbs) {
    const age = elapsedMs - orb.spawnedAt;
    // Pop in over the first 120ms.
    const grow = Math.min(1, age / 120);
    const scale = grow < 1 ? 0.6 + 0.4 * grow : 1;
    const radius = orb.radius * scale;

    const glow = ctx.createRadialGradient(orb.x, orb.y, radius * 0.2, orb.x, orb.y, radius * 1.9);
    glow.addColorStop(0, `hsla(${orb.hue}, 100%, 62%, 0.55)`);
    glow.addColorStop(1, `hsla(${orb.hue}, 100%, 50%, 0)`);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(orb.x, orb.y, radius * 1.9, 0, Math.PI * 2);
    ctx.fill();

    const core = ctx.createRadialGradient(
      orb.x - radius * 0.3,
      orb.y - radius * 0.35,
      radius * 0.1,
      orb.x,
      orb.y,
      radius,
    );
    core.addColorStop(0, 'rgba(255,255,255,0.95)');
    core.addColorStop(0.35, `hsla(${orb.hue}, 100%, 68%, 0.95)`);
    core.addColorStop(1, `hsla(${orb.hue}, 95%, 45%, 0.85)`);
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(orb.x, orb.y, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = `hsla(${orb.hue}, 100%, 82%, 0.85)`;
    ctx.lineWidth = Math.max(1.5, radius * 0.08);
    ctx.stroke();
  }
}

function drawPops(ctx: CanvasRenderingContext2D, pops: readonly Pop[], elapsedMs: number): void {
  for (const pop of pops) {
    const age = elapsedMs - pop.bornAt;
    const progress = Math.min(1, age / 420);

    if (pop.hit) {
      ctx.strokeStyle = `hsla(${pop.hue}, 100%, 70%, ${(1 - progress) * 0.9})`;
      ctx.lineWidth = Math.max(2, pop.radius * 0.16 * (1 - progress));
      ctx.beginPath();
      ctx.arc(pop.x, pop.y, pop.radius * (1 + progress * 0.9), 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.strokeStyle = `rgba(255,255,255,${(1 - progress) * 0.28})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(pop.x, pop.y, pop.radius * (1 + progress * 0.6), 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

/** Remaining seconds, rounded up, for the HUD timer. */
export function secondsLeft(elapsedMs: number): number {
  return Math.max(0, Math.ceil((ROUND_DURATION_MS - elapsedMs) / 1000));
}
