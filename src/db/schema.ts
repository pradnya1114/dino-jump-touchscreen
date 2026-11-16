import {
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Main table: every completed game is stored permanently as its own row.
// A player that plays multiple times gets one row per game.
// gameId is unique to prevent duplicate submissions (idempotency key).
// ---------------------------------------------------------------------------
export const gameRecords = pgTable("game_records", {
  id: serial("id").primaryKey(),
  gameId: varchar("game_id", { length: 64 }).notNull().unique(),
  playerName: varchar("player_name", { length: 80 }).notNull(),
  score: integer("score").notNull().default(0),
  jumps: integer("jumps").notNull().default(0),
  obstaclesDodged: integer("obstacles_dodged").notNull().default(0),
  durationMs: integer("duration_ms").notNull().default(0),
  topSpeed: integer("top_speed").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type GameRecord = typeof gameRecords.$inferSelect;
export type NewGameRecord = typeof gameRecords.$inferInsert;

// ---------------------------------------------------------------------------
// Secure backup table: before a leaderboard reset, every row from
// game_records is copied here so history is never truly lost.
// ---------------------------------------------------------------------------
export const gameRecordsArchive = pgTable("game_records_archive", {
  id: serial("id").primaryKey(),
  originalId: integer("original_id").notNull(),
  gameId: varchar("game_id", { length: 64 }).notNull(),
  playerName: varchar("player_name", { length: 80 }).notNull(),
  score: integer("score").notNull().default(0),
  jumps: integer("jumps").notNull().default(0),
  obstaclesDodged: integer("obstacles_dodged").notNull().default(0),
  durationMs: integer("duration_ms").notNull().default(0),
  topSpeed: integer("top_speed").notNull().default(0),
  playedAt: timestamp("played_at", { withTimezone: true }).notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  archiveBatch: text("archive_batch").notNull().default("manual"),
});

export type GameRecordArchive = typeof gameRecordsArchive.$inferSelect;
