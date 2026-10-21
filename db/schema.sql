CREATE TABLE IF NOT EXISTS players (
  player_id    TEXT PRIMARY KEY,
  display_name TEXT        NOT NULL,
  best_score   INTEGER     NOT NULL DEFAULT 0,
  best_at      BIGINT,
  created_at   BIGINT      NOT NULL,
  updated_at   BIGINT      NOT NULL
);

CREATE TABLE IF NOT EXISTS rounds (
  id         TEXT PRIMARY KEY,
  player_id  TEXT        NOT NULL REFERENCES players (player_id) ON DELETE CASCADE,
  nonce      TEXT        NOT NULL UNIQUE,
  started_at BIGINT      NOT NULL,
  settled_at BIGINT,
  score      INTEGER
);

-- Leaderboard read path: best score first, earliest to reach it wins ties.
CREATE INDEX IF NOT EXISTS players_best_idx ON players (best_score DESC, best_at ASC);

-- Per player round history, used for rate limiting.
CREATE INDEX IF NOT EXISTS rounds_player_started_idx ON rounds (player_id, started_at DESC);
