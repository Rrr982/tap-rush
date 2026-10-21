/**
 * Builds the share image.
 *
 * Facebook wants a square image for the share dialog, so the score is
 * rendered onto a 1024x1024 canvas that is handed over as a JPEG data URL.
 * No image assets are needed.
 */

const SIZE = 1024;

export interface ShareImageOptions {
  score: number;
  best: number;
  isNewBest: boolean;
}

export function buildShareImage(options: ShareImageOptions): string | null {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const background = ctx.createLinearGradient(0, 0, SIZE, SIZE);
  background.addColorStop(0, '#160d33');
  background.addColorStop(1, '#07040f');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, SIZE, SIZE);

  ctx.strokeStyle = 'rgba(56,245,255,0.16)';
  ctx.lineWidth = 4;
  for (let i = 0; i < 7; i += 1) {
    ctx.beginPath();
    ctx.arc(820, 180, 90 + i * 70, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = '#38f5ff';
  ctx.font = '800 74px Segoe UI, Roboto, Helvetica, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('TAP RUSH', SIZE / 2, 250);

  ctx.fillStyle = '#9a90c2';
  ctx.font = '600 34px Segoe UI, Roboto, Helvetica, Arial, sans-serif';
  ctx.fillText('NEON ARCADE', SIZE / 2, 310);

  ctx.fillStyle = '#f4f0ff';
  ctx.font = '800 300px Segoe UI, Roboto, Helvetica, Arial, sans-serif';
  ctx.fillText(String(options.score), SIZE / 2, 600);

  ctx.fillStyle = '#9a90c2';
  ctx.font = '600 40px Segoe UI, Roboto, Helvetica, Arial, sans-serif';
  ctx.fillText('TAPS IN 30 SECONDS', SIZE / 2, 680);

  ctx.fillStyle = '#b6ff3e';
  ctx.font = '700 44px Segoe UI, Roboto, Helvetica, Arial, sans-serif';
  ctx.fillText(`BEST  ${options.best}`, SIZE / 2, 780);

  if (options.isNewBest) {
    ctx.fillStyle = '#ffc93e';
    ctx.font = '800 48px Segoe UI, Roboto, Helvetica, Arial, sans-serif';
    ctx.fillText('NEW RECORD', SIZE / 2, 880);
  }

  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.font = '600 28px Segoe UI, Roboto, Helvetica, Arial, sans-serif';
  ctx.fillText('Can you beat it?', SIZE / 2, 940);

  try {
    return canvas.toDataURL('image/jpeg', 0.9);
  } catch {
    return null;
  }
}
