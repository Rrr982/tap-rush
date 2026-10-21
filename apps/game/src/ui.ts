/**
 * Small DOM helpers. Everything is looked up by id so the markup and the code
 * stay in sync.
 */

import type { LeaderboardEntry } from '@shared/contract';

export type ScreenName = 'menu' | 'game' | 'over';

export function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

export function setScreen(name: ScreenName): void {
  el('app').dataset['screen'] = name;
}

let toastTimer: number | undefined;

export function showToast(message: string, durationMs = 2400): void {
  const toast = el('toast');
  toast.textContent = message;
  toast.hidden = false;
  if (toastTimer !== undefined) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, durationMs);
}

export function renderBoard(entries: LeaderboardEntry[], meId: string | null): void {
  const list = el<HTMLOListElement>('board-list');
  list.replaceChildren();

  if (entries.length === 0) {
    const empty = document.createElement('li');
    empty.textContent = 'No scores yet. Be the first.';
    list.append(empty);
    return;
  }

  for (const entry of entries) {
    const item = document.createElement('li');
    if (meId && entry.playerId === meId) item.classList.add('me');

    const rank = document.createElement('span');
    rank.className = 'rank';
    rank.textContent = String(entry.rank);

    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = entry.displayName;

    const points = document.createElement('span');
    points.className = 'pts';
    points.textContent = String(entry.score);

    item.append(rank, who, points);
    list.append(item);
  }
}
