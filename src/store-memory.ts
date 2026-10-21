import { defaultDisplayName } from './trust';
import type { PlayerRecord, RecordScoreResult, RoundRecord, Store } from './store';

/**
 * In-memory store.
 *
 * Used by `vercel dev` when no database is configured, and by the test
 * suite. Data is lost when the process exits, which is exactly what we want
 * for development and acceptable for tests.
 */
export class MemoryStore implements Store {
  readonly driver = 'memory' as const;

  private readonly players = new Map<string, PlayerRecord>();
  private readonly rounds = new Map<string, RoundRecord>();

  async ensurePlayer(playerId: string): Promise<PlayerRecord> {
    const existing = this.players.get(playerId);
    if (existing) return existing;
    const now = Date.now();
    const player: PlayerRecord = {
      playerId,
      displayName: defaultDisplayName(playerId),
      bestScore: 0,
      bestAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.players.set(playerId, player);
    return player;
  }

  async getPlayer(playerId: string): Promise<PlayerRecord | null> {
    return this.players.get(playerId) ?? null;
  }

  async createRound(round: RoundRecord): Promise<void> {
    this.rounds.set(round.id, { ...round });
  }

  async getRound(id: string): Promise<RoundRecord | null> {
    return this.rounds.get(id) ?? null;
  }

  async settleRound(id: string, score: number, at: number): Promise<boolean> {
    const round = this.rounds.get(id);
    if (!round || round.settledAt !== null) return false;
    this.rounds.set(id, { ...round, settledAt: at, score });
    return true;
  }

  async recordScore(playerId: string, score: number, at: number): Promise<RecordScoreResult> {
    const player = await this.ensurePlayer(playerId);
    if (score > player.bestScore) {
      const updated: PlayerRecord = {
        ...player,
        bestScore: score,
        bestAt: at,
        updatedAt: at,
      };
      this.players.set(playerId, updated);
      return { bestScore: score, isNewBest: true };
    }
    return { bestScore: player.bestScore, isNewBest: false };
  }

  async setDisplayName(playerId: string, displayName: string): Promise<PlayerRecord> {
    const player = await this.ensurePlayer(playerId);
    const updated: PlayerRecord = { ...player, displayName, updatedAt: Date.now() };
    this.players.set(playerId, updated);
    return updated;
  }

  async topPlayers(limit: number): Promise<PlayerRecord[]> {
    return [...this.players.values()]
      .filter((player) => player.bestScore > 0)
      .sort((a, b) => {
        if (b.bestScore !== a.bestScore) return b.bestScore - a.bestScore;
        return (a.bestAt ?? a.updatedAt) - (b.bestAt ?? b.updatedAt);
      })
      .slice(0, limit);
  }

  async rankOf(playerId: string): Promise<number | null> {
    const player = this.players.get(playerId);
    if (!player || player.bestScore <= 0) return null;
    let ahead = 0;
    for (const other of this.players.values()) {
      if (other.bestScore > player.bestScore) ahead += 1;
    }
    return ahead + 1;
  }

  async countRoundsSince(playerId: string, since: number): Promise<number> {
    let count = 0;
    for (const round of this.rounds.values()) {
      if (round.playerId === playerId && round.startedAt >= since) count += 1;
    }
    return count;
  }

  async ping(): Promise<void> {
    // Always healthy.
  }
}
