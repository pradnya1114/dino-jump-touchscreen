import { like, sql } from "drizzle-orm";
import { db } from "@/db";
import { gameRecordsArchive } from "@/db/schema";

// Shared by the score API routes.

export function cleanName(v: unknown): string {
  return typeof v === "string" ? v.trim().slice(0, 80) : "";
}

export function toInt(v: unknown, max = 9_999_999): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(max, Math.floor(n)));
}

const EARLIEST = Date.UTC(2020, 0, 1);
const TWO_DAYS = 2 * 24 * 60 * 60 * 1000;

/**
 * The time a kiosk says something happened (a game ending, a reset). Games
 * saved offline are uploaded later, so this — not the upload time — is what
 * gets stored. Missing or impossible values become "now".
 */
export function parseKioskTime(v: unknown): Date {
  const now = Date.now();
  if (typeof v !== "string" && typeof v !== "number") return new Date(now);
  const t = new Date(v).getTime();
  if (!Number.isFinite(t) || t < EARLIEST || t > now + TWO_DAYS) return new Date(now);
  return new Date(t);
}

/** Every reset writes its archive rows under "reset-<time of the reset>". */
export const RESET_BATCH_PREFIX = "reset-";

export function resetBatch(cutoff: Date): string {
  return `${RESET_BATCH_PREFIX}${cutoff.toISOString()}`;
}

/** Time of the most recent leaderboard reset (ISO), or null if there never was one. */
export async function getLastResetCutoff(): Promise<string | null> {
  const [row] = await db
    .select({ batch: sql<string | null>`max(${gameRecordsArchive.archiveBatch})` })
    .from(gameRecordsArchive)
    .where(like(gameRecordsArchive.archiveBatch, `${RESET_BATCH_PREFIX}%`));
  const raw = row?.batch ? row.batch.slice(RESET_BATCH_PREFIX.length) : null;
  if (!raw) return null;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
