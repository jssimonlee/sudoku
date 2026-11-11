-- Sudoku TOP 10 leaderboard tables for the shared D1 database (mydb).
-- Every table and index starts with "sudoku_" so it never clashes with other projects.
--
-- Apply:  wrangler d1 execute mydb --remote --file=schema.sql
-- Local:  wrangler d1 execute mydb --local  --file=schema.sql

-- One row per leaderboard entry. Each board keeps at most 10 rows
-- (the Worker trims everything below 10th right after an insert).
--   board: normal-<difficulty> | combo-time-<difficulty> | combo-score-<difficulty>
--          difficulty = easy | medium | hard | expert
CREATE TABLE IF NOT EXISTS sudoku_scores (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    board      TEXT    NOT NULL,
    initials   TEXT    NOT NULL,          -- 3 chars, A-Z 0-9
    time_sec   INTEGER NOT NULL,
    mistakes   INTEGER NOT NULL DEFAULT 0,
    score      INTEGER,                   -- combo score (combo boards only)
    created_at INTEGER NOT NULL           -- unix seconds
);

CREATE INDEX IF NOT EXISTS sudoku_scores_board_idx ON sudoku_scores (board);

-- Submit attempts per hashed IP, for rate limiting. The raw IP is never stored.
-- Rows older than a day are deleted on each submit.
CREATE TABLE IF NOT EXISTS sudoku_rate_limits (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ip_hash    TEXT    NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS sudoku_rate_limits_ip_idx ON sudoku_rate_limits (ip_hash, created_at);
