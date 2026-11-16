import { NextRequest, NextResponse } from "next/server";
import { inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  RESET_BATCH_PREFIX,
  cleanName,
  getLastResetCutoff,
  parseKioskTime,
  toInt,
} from "@/db/helpers";
import { gameRecords, gameRecordsArchive } from "@/db/schema";

export const dynamic = "force-dynamic";

// GET /api/scores/sync — a tiny "has anything changed?" answer. Kiosks call it
// often and only download the full record list when the signature changes.
export async function GET() {
  try {
    const [row] = await db
      .select({
        count: sql<number>`count(*)::int`,
        maxId: sql<number | null>`max(${gameRecords.id})`,
      })
      .from(gameRecords);
    const lastResetCutoff = await getLastResetCutoff();
    const count = row?.count ?? 0;
    return NextResponse.json({
      ok: true,
      count,
      signature: `${count}:${row?.maxId ?? 0}:${lastResetCutoff ?? "-"}`,
      lastResetCutoff,
    });
  } catch (err) {
    console.error("GET /api/scores/sync failed:", err);
    return NextResponse.json({ ok: false, error: "Database unavailable." }, { status: 500 });
  }
}

interface Incoming {
  gameId: string;
  playerName: string;
  score: number;
  jumps: number;
  obstaclesDodged: number;
  durationMs: number;
  topSpeed: number;
  createdAt: Date;
}

// POST /api/scores/sync  { records: [...], resetCutoff? }
// Kiosks upload the games they saved while offline. Safe to repeat: a game that
// is already stored is left alone, and a game that was cleared by a reset is
// never put back on the leaderboard (it is reported in `archived` instead).
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const list = Array.isArray(body.records) ? body.records.slice(0, 500) : [];

    const cutoffTime = typeof body.resetCutoff === "string" ? new Date(body.resetCutoff).getTime() : NaN;
    const batch = Number.isFinite(cutoffTime)
      ? `${RESET_BATCH_PREFIX}${new Date(cutoffTime).toISOString()}`
      : "device-archive";

    const live: Incoming[] = [];
    const archived: Incoming[] = [];
    const seen = new Set<string>();
    for (const raw of list) {
      if (!raw || typeof raw !== "object") continue;
      const r = raw as Record<string, unknown>;
      const gameId = typeof r.gameId === "string" ? r.gameId.trim().slice(0, 64) : "";
      if (!gameId || seen.has(gameId)) continue;
      seen.add(gameId);
      const row: Incoming = {
        gameId,
        playerName: cleanName(r.playerName) || "Player",
        score: toInt(r.score),
        jumps: toInt(r.jumps, 100000),
        obstaclesDodged: toInt(r.obstaclesDodged, 100000),
        durationMs: toInt(r.durationMs, 3_600_000),
        topSpeed: toInt(r.topSpeed, 100000),
        createdAt: parseKioskTime(r.playedAt),
      };
      (r.archived === true ? archived : live).push(row);
    }

    const ids = [...seen];
    const alreadyArchived = new Set<string>();

    await db.transaction(async (tx) => {
      if (ids.length === 0) return;
      const inArchive = await tx
        .select({ gameId: gameRecordsArchive.gameId })
        .from(gameRecordsArchive)
        .where(inArray(gameRecordsArchive.gameId, ids));
      for (const row of inArchive) alreadyArchived.add(row.gameId);

      // live games: store unless already stored or already cleared by a reset
      const liveRows = live.filter((r) => !alreadyArchived.has(r.gameId));
      if (liveRows.length > 0) {
        await tx.insert(gameRecords).values(liveRows).onConflictDoNothing({ target: gameRecords.gameId });
      }

      // games the kiosk already cleared (reset while offline): straight to the archive
      const candidates = archived.filter((r) => !alreadyArchived.has(r.gameId));
      if (candidates.length > 0) {
        const stillLive = await tx
          .select({ gameId: gameRecords.gameId })
          .from(gameRecords)
          .where(
            inArray(
              gameRecords.gameId,
              candidates.map((r) => r.gameId),
            ),
          );
        const liveIds = new Set(stillLive.map((r) => r.gameId));
        // (ones that are still live here are moved by the kiosk's reset request)
        const fresh = candidates.filter((r) => !liveIds.has(r.gameId));
        if (fresh.length > 0) {
          await tx.insert(gameRecordsArchive).values(
            fresh.map((r) => ({
              originalId: 0,
              gameId: r.gameId,
              playerName: r.playerName,
              score: r.score,
              jumps: r.jumps,
              obstaclesDodged: r.obstaclesDodged,
              durationMs: r.durationMs,
              topSpeed: r.topSpeed,
              playedAt: r.createdAt,
              archiveBatch: batch,
            })),
          );
        }
      }
    });

    return NextResponse.json({
      ok: true,
      accepted: ids,
      archived: live.filter((r) => alreadyArchived.has(r.gameId)).map((r) => r.gameId),
    });
  } catch (err) {
    console.error("POST /api/scores/sync failed:", err);
    return NextResponse.json(
      { ok: false, error: "Could not store the uploaded games." },
      { status: 500 },
    );
  }
}
