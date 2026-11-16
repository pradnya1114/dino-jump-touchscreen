"use client";

// ---------------------------------------------------------------------------
// On-device record store (IndexedDB).
//
// Every finished game is written here FIRST, so nothing is lost when the kiosk
// has no connection. The sync engine (src/lib/sync.ts) copies records to the
// database whenever it can be reached and pulls the database's records down,
// so the leaderboard and the Excel export work fully offline.
//
// If the browser refuses on-device storage (some embedded / private modes) the
// store falls back to memory: the app still works, but only while online.
// ---------------------------------------------------------------------------

export interface KioskRecord {
  /** Unique id of one finished game — also what stops a game being stored twice. */
  gameId: string;
  playerName: string;
  score: number;
  jumps: number;
  obstaclesDodged: number;
  durationMs: number;
  topSpeed: number;
  /** When the game ended (ISO time, this device's clock). */
  playedAt: string;
  /** true once the database holds a copy of this record. */
  synced: boolean;
  /** true = cleared from the leaderboard by a reset; kept as a backup. */
  archived: boolean;
  archivedAt: string | null;
}

export type NewGame = Pick<
  KioskRecord,
  | "gameId"
  | "playerName"
  | "score"
  | "jumps"
  | "obstaclesDodged"
  | "durationMs"
  | "topSpeed"
  | "playedAt"
>;

export type StorageBackend = "device" | "memory";

const DB_NAME = "dinojump-kiosk";
const DB_VERSION = 1;
const RECORDS = "records";
const META = "meta";
const CHANGE_EVENT = "dinojump:data";

let backend: StorageBackend = "device";
let dbPromise: Promise<IDBDatabase | null> | null = null;
const memoryRecords = new Map<string, KioskRecord>();
const memoryMeta = new Map<string, unknown>();
let channel: BroadcastChannel | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    const fail = () => {
      backend = "memory";
      resolve(null);
    };
    try {
      if (typeof indexedDB === "undefined") {
        fail();
        return;
      }
      const open = indexedDB.open(DB_NAME, DB_VERSION);
      open.onupgradeneeded = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains(RECORDS)) {
          db.createObjectStore(RECORDS, { keyPath: "gameId" });
        }
        if (!db.objectStoreNames.contains(META)) {
          db.createObjectStore(META, { keyPath: "key" });
        }
      };
      open.onsuccess = () => {
        backend = "device";
        resolve(open.result);
      };
      open.onerror = fail;
      open.onblocked = fail;
    } catch {
      fail();
    }
  });
  return dbPromise;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Reading from device storage failed"));
  });
}

function finished(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Writing to device storage failed"));
    tx.onabort = () => reject(tx.error ?? new Error("Writing to device storage was aborted"));
  });
}

/** "device" = IndexedDB (survives restarts), "memory" = storage blocked by the browser. */
export async function storageBackend(): Promise<StorageBackend> {
  await openDb();
  return backend;
}

export async function getAllRecords(): Promise<KioskRecord[]> {
  const db = await openDb();
  if (!db) return Array.from(memoryRecords.values()).map((r) => ({ ...r }));
  const all = await request(db.transaction(RECORDS, "readonly").objectStore(RECORDS).getAll());
  return all as KioskRecord[];
}

export async function getRecord(gameId: string): Promise<KioskRecord | null> {
  const db = await openDb();
  if (!db) {
    const found = memoryRecords.get(gameId);
    return found ? { ...found } : null;
  }
  const found = await request(db.transaction(RECORDS, "readonly").objectStore(RECORDS).get(gameId));
  return (found as KioskRecord | undefined) ?? null;
}

export async function putRecords(
  list: KioskRecord[],
  options?: { silent?: boolean },
): Promise<void> {
  if (list.length === 0) return;
  const db = await openDb();
  if (!db) {
    for (const r of list) memoryRecords.set(r.gameId, { ...r });
  } else {
    const tx = db.transaction(RECORDS, "readwrite");
    const store = tx.objectStore(RECORDS);
    for (const r of list) store.put(r);
    await finished(tx);
  }
  if (!options?.silent) notifyChange();
}

export async function getMeta<T>(key: string): Promise<T | null> {
  const db = await openDb();
  if (!db) return (memoryMeta.get(key) as T | undefined) ?? null;
  const row = await request(db.transaction(META, "readonly").objectStore(META).get(key));
  return row ? ((row as { key: string; value: T }).value ?? null) : null;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  if (!db) {
    memoryMeta.set(key, value);
    return;
  }
  const tx = db.transaction(META, "readwrite");
  tx.objectStore(META).put({ key, value });
  await finished(tx);
}

function int(v: unknown, max: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(max, Math.floor(n))) : 0;
}

/** Save one finished game on this device. Saving the same game again changes nothing. */
export async function saveGame(game: NewGame): Promise<KioskRecord> {
  const existing = await getRecord(game.gameId);
  if (existing) return existing;
  const record: KioskRecord = {
    gameId: game.gameId,
    playerName: game.playerName.trim().slice(0, 80) || "Player",
    score: int(game.score, 9_999_999),
    jumps: int(game.jumps, 100_000),
    obstaclesDodged: int(game.obstaclesDodged, 100_000),
    durationMs: int(game.durationMs, 3_600_000),
    topSpeed: int(game.topSpeed, 100_000),
    playedAt: game.playedAt,
    synced: false,
    archived: false,
    archivedAt: null,
  };
  await putRecords([record]);
  return record;
}

/**
 * Reset the leaderboard on this device: every live record becomes an archived
 * backup (nothing is deleted). The database gets the same reset on the next
 * sync — immediately if it can be reached.
 */
export async function resetLeaderboardOnDevice(): Promise<{ cleared: number; cutoff: string }> {
  const cutoff = new Date().toISOString();
  const live = (await getAllRecords()).filter((r) => !r.archived);
  const archived = live.map((r) => ({ ...r, archived: true, archivedAt: cutoff }));
  await putRecords(archived, { silent: true });
  await setMeta("resetCutoff", cutoff);
  await setMeta("pendingReset", cutoff);
  notifyChange();
  return { cleared: live.length, cutoff };
}

/** Live records, best score first (ties: newest first) — same order as the database uses. */
export function sortLeaderboard(records: KioskRecord[]): KioskRecord[] {
  return records
    .filter((r) => !r.archived)
    .sort(
      (a, b) =>
        b.score - a.score || (a.playedAt < b.playedAt ? 1 : a.playedAt > b.playedAt ? -1 : 0),
    );
}

function getChannel(): BroadcastChannel | null {
  if (channel) return channel;
  try {
    if (typeof BroadcastChannel !== "undefined") channel = new BroadcastChannel(CHANGE_EVENT);
  } catch {
    channel = null;
  }
  return channel;
}

/** Tell every open screen (and other tabs) that the records changed. */
export function notifyChange(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CHANGE_EVENT));
  try {
    getChannel()?.postMessage("changed");
  } catch {
    /* other tabs just refresh a little later */
  }
}

export function onDataChange(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(CHANGE_EVENT, listener);
  const ch = getChannel();
  const onMessage = () => listener();
  ch?.addEventListener("message", onMessage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    ch?.removeEventListener("message", onMessage);
  };
}
