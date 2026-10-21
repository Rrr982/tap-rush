/**
 * Storage interface for the leaderboard.
 *
 * Two implementations exist: Postgres (production) and an in-memory store
 * (local development and tests). Both are expected to behave identically -
 * in particular `settleRound` must be atomic, so a round can only ever be
 * scored once.
 */

export interface PlayerRecord {
  playerId: string;
  displayName: string;
  bestScore: number;
  /** When the current best score was reached, in ms. Used for tie breaks. */
  bestAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface RoundRecord {
  id: string;
  playerId: string;
  nonce: string;
  startedAt: number;
  settledAt: number | null;
  score: number | null;
}

export interface RecordScoreResult {
  bestScore: number;
  isNewBest: boolean;
}

export interface Store {
  readonly driver: 'postgres' | 'memory';

  /** Create the player if it does not exist yet, then return it. */
  ensurePlayer(playerId: string): Promise<PlayerRecord>;
  getPlayer(playerId: string): Promise<PlayerRecord | null>;
  createRound(round: RoundRecord): Promise<void>;
  getRound(id: string): Promise<RoundRecord | null>;
  /** Settle a round. Returns false when the round was already settled. */
  settleRound(id: string, score: number, at: number): Promise<boolean>;
  /** Apply a score to a player's best. Best scores only ever go up. */
  recordScore(playerId: string, score: number, at: number): Promise<RecordScoreResult>;
  setDisplayName(playerId: string, displayName: string): Promise<PlayerRecord>;
  /** Top players by best score, best score first, earliest achievement wins ties. */
  topPlayers(limit: number): Promise<PlayerRecord[]>;
  /** 1-based rank of a player, or null when they have no score yet. */
  rankOf(playerId: string): Promise<number | null>;
  /** Number of rounds a player opened since a timestamp. */
  countRoundsSince(playerId: string, since: number): Promise<number>;
  /** Cheap liveness check. */
  ping(): Promise<void>;
}
