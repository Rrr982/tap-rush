import { DISPLAY_NAME_MAX, DISPLAY_NAME_MIN } from '../shared/rules';

/**
 * Normalise a player-chosen display name.
 *
 * Returns `null` when the input cannot be used. The name is stored as-is
 * apart from whitespace and control character cleanup, and it is rendered as
 * text only, never as markup.
 */
export function sanitiseDisplayName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;

  // Strip control characters, keep letters, numbers and common punctuation.
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return null;

  const truncated = [...cleaned].slice(0, DISPLAY_NAME_MAX).join('').trim();
  if ([...truncated].length < DISPLAY_NAME_MIN) return null;

  return truncated;
}
