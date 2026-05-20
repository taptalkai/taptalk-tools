CREATE TABLE IF NOT EXISTS tictactoe_games (
  game_id TEXT PRIMARY KEY,
  board_json TEXT NOT NULL,
  current_player TEXT NOT NULL,
  status TEXT NOT NULL,
  winner TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tictactoe_games_updated_at ON tictactoe_games(updated_at);
CREATE INDEX IF NOT EXISTS idx_tictactoe_games_status ON tictactoe_games(status);
