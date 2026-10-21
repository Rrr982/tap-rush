/**
 * Tap Rush - entry point.
 *
 * Wires the Facebook SDK, the leaderboard API and the game engine together
 * and owns the screen flow: menu -> round -> game over -> leaderboard.
 */

import { ROUND_DURATION_MS } from '@shared/rules';
import { ApiError, LeaderboardApi } from './api';
import { Sfx } from './audio';
import { GameEngine } from './engine';
import type { RoundResult } from './engine';
import { FbBridge } from './fb';
import { renderFrame, secondsLeft } from './render';
import { buildShareImage } from './share';
import { el, renderBoard, setScreen, showToast } from './ui';

const BEST_KEY = 'taprush.best';
const NAME_KEY = 'taprush.name';

const fb = new FbBridge();
const api = new LeaderboardApi();
const sfx = new Sfx();

const state = {
  playerId: null as string | null,
  displayName: '',
  sessionId: null as string | null,
  nonce: '',
  best: readBest(),
  lastScore: 0,
  lastWasRecord: false,
};

const canvas = el<HTMLCanvasElement>('canvas');
const ctx = canvas.getContext('2d');

const engine = new GameEngine({
  onOrbHit: (_orb, streak) => {
    sfx.hit(streak);
    fb.haptic(streak % 5 === 0 ? 'medium' : 'light');
  },
  onMiss: () => {
    sfx.miss();
  },
  onFinish: (result) => {
    void endRound(result);
  },
});

/* ------------------------------------------------------------------ utils */

function readBest(): number {
  try {
    const raw = window.localStorage.getItem(BEST_KEY);
    const value = Number(raw ?? '0');
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

function writeBest(value: number): void {
  try {
    window.localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // Private mode, storage is unavailable. Not fatal.
  }
}

function readLocalName(): string {
  try {
    return window.localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

function writeLocalName(value: string): void {
  try {
    window.localStorage.setItem(NAME_KEY, value);
  } catch {
    // Not fatal.
  }
}

function randomNonce(): string {
  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/* ----------------------------------------------------------------- canvas */

function resizeCanvas(): void {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));

  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  engine.resize(width, height);
}

function updateHud(elapsedMs: number): void {
  el('hud-score').textContent = String(engine.currentScore);
  const streak = engine.currentStreak;
  el('hud-streak').textContent = streak > 1 ? `${streak}x COMBO` : ' ';

  const left = secondsLeft(elapsedMs);
  const timer = el('hud-timer');
  timer.textContent = String(left);
  timer.classList.toggle('warn', left <= 10 && left > 5);
  timer.classList.toggle('danger', left <= 5);

  const fill = el('timebar-fill');
  const remaining = Math.max(0, 1 - elapsedMs / ROUND_DURATION_MS);
  fill.style.width = `${(remaining * 100).toFixed(2)}%`;
}

function gameLoop(): void {
  const now = Date.now();
  engine.update(now);

  if (ctx) {
    renderFrame(ctx, {
      orbs: engine.activeOrbs,
      pops: engine.activePops,
      elapsedMs: engine.elapsed,
      width: canvas.clientWidth || canvas.width,
      height: canvas.clientHeight || canvas.height,
    });
  }
  updateHud(engine.elapsed);

  if (!engine.isFinished) {
    window.requestAnimationFrame(gameLoop);
  }
}

/* ------------------------------------------------------------------- flow */

async function startRound(): Promise<void> {
  sfx.unlock();
  state.nonce = randomNonce();
  state.sessionId = null;
  state.lastWasRecord = false;

  el<HTMLButtonElement>('btn-play').disabled = true;
  const signed = await fb.signedPlayerInfo(state.nonce);
  if (signed) {
    try {
      const session = await api.openSession(state.nonce, signed.signature);
      state.sessionId = session.sessionId;
      state.playerId = session.playerId;
      state.displayName = session.displayName;
      if (session.bestScore > state.best) {
        state.best = session.bestScore;
        writeBest(state.best);
      }
      const input = el<HTMLInputElement>('input-name');
      if (!input.value) input.value = session.displayName;
      refreshMenu();
    } catch (error) {
      reportError(error, 'Could not reach the leaderboard.');
    }
  }
  el<HTMLButtonElement>('btn-play').disabled = false;

  setScreen('game');
  resizeCanvas();
  engine.start(Date.now());
  window.requestAnimationFrame(gameLoop);
}

async function endRound(result: RoundResult): Promise<void> {
  state.lastScore = result.score;
  const previousBest = state.best;
  const isLocalRecord = result.score > previousBest;
  if (isLocalRecord) {
    state.best = result.score;
    writeBest(state.best);
  }

  el('over-score').textContent = String(result.score);
  el('over-badge').hidden = !isLocalRecord;
  el('over-sub').textContent = isLocalRecord
    ? `New personal best. Best streak ${result.bestStreak}.`
    : `Best ${state.best}. Streak ${result.bestStreak}.`;
  setScreen('over');

  if (!state.sessionId) return;

  const signed = await fb.signedPlayerInfo(state.nonce);
  if (!signed) return;

  try {
    const response = await api.submitScore({
      sessionId: state.sessionId,
      nonce: state.nonce,
      signature: signed.signature,
      score: result.score,
    });

    if (response.bestScore > state.best) {
      state.best = response.bestScore;
      writeBest(state.best);
    }
    if (response.isNewBest) {
      state.lastWasRecord = true;
      el('over-badge').hidden = false;
      el('over-sub').textContent = `New global best. Rank ${response.rank ?? '-'}.`;
    }
    if (response.rank) {
      el('menu-rank').textContent = `#${response.rank}`;
    }
    if (response.leaderboard.length > 0) {
      renderBoard(response.leaderboard, state.playerId);
    }
    refreshMenu();
  } catch (error) {
    reportError(error, 'Your score was not saved.');
  }
}

function refreshMenu(): void {
  el('menu-best').textContent = String(state.best);
  const nameInput = el<HTMLInputElement>('input-name');
  if (!nameInput.value && state.displayName) nameInput.value = state.displayName;
}

async function openLeaderboard(): Promise<void> {
  const sheet = el('sheet-leaderboard');
  const status = el('board-status');
  sheet.hidden = false;
  status.textContent = 'Loading...';

  try {
    const response = await api.leaderboard(state.playerId ?? undefined);
    renderBoard(response.entries, state.playerId);
    if (response.me) {
      status.textContent = `You are #${response.me.rank ?? '-'} with ${response.me.score}.`;
    } else {
      status.textContent = 'Play a round to join the board.';
    }
  } catch (error) {
    renderBoard([], null);
    status.textContent =
      error instanceof ApiError && error.code === 'network'
        ? 'You are offline. Your best score is still saved on this device.'
        : 'The leaderboard is unavailable right now.';
  }
}

async function saveName(): Promise<void> {
  const input = el<HTMLInputElement>('input-name');
  const value = input.value.trim();
  if (value.length < 2) {
    showToast('Pick a name with at least 2 characters.');
    return;
  }
  writeLocalName(value);
  state.displayName = value;

  if (!fb.available) {
    showToast('Saved on this device.');
    return;
  }

  const nonce = randomNonce();
  const signed = await fb.signedPlayerInfo(nonce);
  if (!signed) {
    showToast('Could not verify your name right now.');
    return;
  }
  try {
    const response = await api.setDisplayName(nonce, signed.signature, value);
    state.displayName = response.displayName;
    input.value = response.displayName;
    showToast('Name updated.');
  } catch (error) {
    reportError(error, 'Could not save your name.');
  }
}

async function shareResult(): Promise<void> {
  const isRecord = state.lastWasRecord;
  const text = `I scored ${state.lastScore} in Tap Rush!${
    isRecord ? ' New personal best!' : ''
  } Can you beat me?`;

  const image = buildShareImage({ score: state.lastScore, best: state.best, isNewBest: isRecord });

  if (fb.available && image) {
    const shared = await fb.share({ text, image });
    if (shared) {
      showToast('Thanks for sharing!');
    } else {
      showToast('Sharing is not available right now.');
    }
    return;
  }

  const nav = navigator as Navigator & {
    share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
  };
  if (nav.share) {
    try {
      await nav.share({ title: 'Tap Rush', text });
      return;
    } catch {
      // The player dismissed the share sheet.
      return;
    }
  }

  try {
    await navigator.clipboard.writeText(text);
    showToast('Score copied to the clipboard.');
  } catch {
    showToast(text);
  }
}

function reportError(error: unknown, fallback: string): void {
  if (error instanceof ApiError) {
    showToast(error.message || fallback);
    return;
  }
  console.warn('[tap-rush]', error);
  showToast(fallback);
}

/* ------------------------------------------------------------------ wiring */

function wire(): void {
  el('btn-play').addEventListener('click', () => {
    void startRound();
  });

  el('btn-again').addEventListener('click', () => {
    void startRound();
  });

  el('btn-leaderboard').addEventListener('click', () => {
    void openLeaderboard();
  });

  el('btn-over-leaderboard').addEventListener('click', () => {
    void openLeaderboard();
  });

  el('btn-close-sheet').addEventListener('click', () => {
    el('sheet-leaderboard').hidden = true;
  });

  el('btn-save-name').addEventListener('click', () => {
    void saveName();
  });

  el('btn-share').addEventListener('click', () => {
    void shareResult();
  });

  canvas.addEventListener('pointerdown', (event) => {
    const rect = canvas.getBoundingClientRect();
    engine.tap(event.clientX - rect.left, event.clientY - rect.top);
  });

  window.addEventListener('resize', () => {
    resizeCanvas();
  });

  window.addEventListener('orientationchange', () => {
    resizeCanvas();
  });

  fb.onPause(() => {
    engine.pause(Date.now());
  });

  fb.onResume(() => {
    engine.resume(Date.now());
  });
}

async function boot(): Promise<void> {
  wire();
  resizeCanvas();

  const localName = readLocalName();
  if (localName) el<HTMLInputElement>('input-name').value = localName;
  refreshMenu();

  const ready = await fb.init();
  if (!ready) {
    el('menu-hint').textContent =
      'Facebook SDK not detected - playing offline, scores stay on this device.';
    el('menu-rank').textContent = '-';
  } else {
    el('menu-hint').textContent = 'Tap the orbs as fast as you can. 30 seconds.';
    try {
      const health = await api.health();
      if (!health.ok) {
        el('menu-hint').textContent = 'The leaderboard is having trouble. You can still play.';
      }
    } catch {
      el('menu-hint').textContent = 'Offline - playing a local round.';
    }
  }
}

void boot();
