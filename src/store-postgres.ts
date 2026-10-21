import { neon } from '@neondatabase/serverless';
import { defaultDisplayName } from './trust';
import type { PlayerRecord, RecordScoreResult, RoundRecord, Store } from './store';

interface PlayerRow {
  player_id: string;
  display_name: string;
  best_score: number;
  best_at: number | null;
  created_at: number;
  updated_at: number;
}

interface RoundRow {
  id: string;
  player_id: string;
  nonce: string;
  started_at: number;
  settled_at: number | null;
  score: number | null;
}

function toPlayer(row: PlayerRow): PlayerRecord {
  return {
    playerId: row.player_id,
    displayName: row.display_name,
    bestScore: Number(row.best_score),
    bestAt: row.best_at === null ? null : Number(row.best_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function toRound(row: RoundRow): RoundRecord {
  return {
    id: row.id,
    playerId: row.player_id,
    nonce: row.nonce,
    startedAt: Number(row.started_at),
    settledAt: row.settled_at === null ? null : Number(row.settled_at),
    score: row.score === null ? null : Number(row.score),
  };
}

/**
 * Postgres backed store, using Neon's serverless driver.
 *
 * The driver speaks HTTP, so it works in serverless functions without
 * holding a TCP connection open, and it needs no connection pooling setup.
 */
export class PostgresStore implements Store {
  readonly driver = 'postgres' as const;

  private readonly sql: ReturnType<typeof neon>;

  constructor(connectionString: string) {
    if (!connectionString) {
      throw new Error('DATABASE_URL is required for the postgres store.');
    }
    this.sql = neon(connectionString);
  }

  async ensurePlayer(playerId: string): Promise<PlayerRecord> {
    const now = Date.now();
    await this.sql`
      INSERT INTO players (player_id, display_name, best_score, best_at, created_at, updated_at)
      VALUES (${playerId}, ${defaultDisplayName(playerId)}, 0, NULL, ${now}, ${now})
      ON CONFLICT (player_id) DO NOTHING
    `;
    const player = await this.getPlayer(playerId);
    if (!player) {
      throw new Error(`Failed to create player ${playerId}.`);
    }
    return player;
  }

  async getPlayer(playerId: string): Promise<PlayerRecord | null> {
    const rows = (await this.sql`
      SELECT player_id, display_name, best_score, best_at, created_at, updated_at
      FROM players
      WHERE player_id = ${playerId}
      LIMIT 1
    `) as unknown as PlayerRow[];
    return rows.length > 0 ? toPlayer(rows[0]!) : null;
  }

  async createRound(round: RoundRecord): Promise<void> {
    await this.sql`
      INSERT INTO rounds (id, player_id, nonce, started_at)
      VALUES (${round.id}, ${round.playerId}, ${round.nonce}, ${round.startedAt})
    `;
  }

  async getRound(id: string): Promise<RoundRecord | null> {
    const rows = (await this.sql`
      SELECT id, player_id, nonce, started_at, settled_at, score
      FROM rounds
      WHERE id = ${id}
      LIMIT 1
    `) as unknown as RoundRow[];
    return rows.length > 0 ? toRound(rows[0]!) : null;
  }

  async settleRound(id: string, score: number, at: number): Promise<boolean> {
    const rows = (await this.sql`
      UPDATE rounds
      SET settled_at = ${at}, score = ${score}
      WHERE id = ${id} AND settled_at IS NULL
      RETURNING id
    `) as unknown as { id: string }[];
    return rows.length > 0;
  }

  async recordScore(playerId: string, score: number, at: number): Promise<RecordScoreResult> {
    const promoted = (await this.sql`
      UPDATE players
      SET best_score = ${score}, best_at = ${at}, updated_at = ${at}
      WHERE player_id = ${playerId} AND best_score < ${score}
      RETURNING best_score
    `) as unknown as { best_score: number }[];

    if (promoted.length > 0) {
      return { bestScore: Number(promoted[0]!.best_score), isNewBest: true };
    }

    const rows = (await this.sql`
      SELECT best_score FROM players WHERE player_id = ${playerId} LIMIT 1
    `) as unknown as { best_score: number }[];
    return { bestScore: rows.length > 0 ? Number(rows[0]!.best_score) : 0, isNewBest: false };
  }

  async setDisplayName(playerId: string, displayName: string): Promise<PlayerRecord> {
    const rows = (await this.sql`
      UPDATE players
      SET display_name = ${displayName}, updated_at = ${Date.now()}
      WHERE player_id = ${playerId}
      RETURNING player_id, display_name, best_score, best_at, created_at, updated_at
    `) as unknown as PlayerRow[];
    if (rows.length === 0) {
      await this.ensurePlayer(playerId);
      return this.setDisplayName(playerId, displayName);
    }
    return toPlayer(rows[0]!);
  }

  async topPlayers(limit: number): Promise<PlayerRecord[]> {
    const rows = (await this.sql`
      SELECT player_id, display_name, best_score, best_at, created_at, updated_at
      FROM players
      WHERE best_score > 0
      ORDER BY best_score DESC, best_at ASC
      LIMIT ${limit}
    `) as unknown as PlayerRow[];
    return rows.map(toPlayer);
  }

  async rankOf(playerId: string): Promise<number | null> {
    const rows = (await this.sql`
      SELECT
        (SELECT best_score FROM players WHERE player_id = ${playerId}) AS my_score,
        (
          SELECT COUNT(*) FROM players
          WHERE best_score > (SELECT best_score FROM players WHERE player_id = ${playerId})
        )::int AS ahead
    `) as unknown as { my_score: number | null; ahead: number }[];
    const row = rows[0];
    if (!row || row.my_score === null || Number(row.my_score) <= 0) return null;
    return Number(row.ahead) + 1;
  }

  async countRoundsSince(playerId: string, since: number): Promise<number> {
    const rows = (await this.sql`
      SELECT COUNT(*)::int AS count FROM rounds
      WHERE player_id = ${playerId} AND started_at >= ${since}
    `) as unknown as { count: number }[];
    return rows.length > 0 ? Number(rows[0]!.count) : 0;
  }

  async ping(): Promise<void> {
    await this.sql`SELECT 1`;
  }
}
