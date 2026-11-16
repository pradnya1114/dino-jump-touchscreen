"use client";

import { useSyncExternalStore } from "react";
import {
  getAllRecords,
  getMeta,
  notifyChange,
  onDataChange,
  putRecords,
  setMeta,
  storageBackend,
  type KioskRecord,
  type StorageBackend,
} from "./local-store";

// ---------------------------------------------------------------------------
// Sync engine: device  <->  database.
//
// The device is always written first. Whenever the database can be reached:
//   1. a reset made on another kiosk is applied here,
//   2. the database's live records are pulled down (so the leaderboard and the
//      Excel export are complete even offline),
//   3. records the database is missing are uploaded (also if it lost them —
//      the kiosk doubles as a backup),
//   4. a reset made while offline is applied to the database.
// Every step is safe to repeat, so a dropped connection never corrupts anything.
// ---------------------------------------------------------------------------

export interface SyncState {
  /** The browser reports a network connection. */
  online: boolean;
  /** Result of the last attempt to reach the database (null = not tried yet). */
  serverReachable: boolean | null;
  syncing: boolean;
  /** Records that so far exist only on this device. */
  unsynced: number;
  /** All records on this device (live + archived). */
  total: number;
  lastSyncAt: string | null;
  lastError: string | null;
  storage: StorageBackend | "unknown";
  /** Whether a complete copy of the kiosk is stored on the device. */
  offlineReady: "unknown" | "unsupported" | "preparing" | "ready" | "error";
}

export type SyncResult = { ok: true } | { ok: false; reason: "offline" | "unreachable" };

const INITIAL: SyncState = {
  online: true,
  serverReachable: null,
  syncing: false,
  unsynced: 0,
  total: 0,
  lastSyncAt: null,
  lastError: null,
  storage: "unknown",
  offlineReady: "unknown",
};

let state: SyncState = INITIAL;
const listeners = new Set<() => void>();

function setState(patch: Partial<SyncState>) {
  const keys = Object.keys(patch) as (keyof SyncState)[];
  if (keys.every((k) => state[k] === patch[k])) return;
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSyncState(): SyncState {
  return state;
}

export function useSyncState(): SyncState {
  return useSyncExternalStore(subscribe, getSyncState, () => INITIAL);
}

// ---------------------------------------------------------------- server calls

interface ServerRecord {
  gameId: string;
  playerName: string;
  score: number;
  jumps: number;
  obstaclesDodged: number;
  durationMs: number;
  topSpeed: number;
  createdAt: string;
}
interface StatusResponse {
  signature: string;
  lastResetCutoff: string | null;
}
interface PullResponse {
  count: number;
  records: ServerRecord[];
}
interface PushResponse {
  accepted?: string[];
  archived?: string[];
}

const JSON_HEADERS = { "Content-Type": "application/json" };

async function api<T>(path: string, init: RequestInit | undefined, timeoutMs: number): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(path, { ...init, signal: ctrl.signal, cache: "no-store" });
    const data = (await res.json().catch(() => null)) as
      | (T & { ok?: boolean; error?: string })
      | null;
    if (!res.ok || !data || data.ok === false) {
      throw new Error(data?.error ?? `The server answered ${res.status}`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function describe(err: unknown): string {
  if (err instanceof DOMException && err.name === "AbortError") {
    return "The database did not answer in time";
  }
  if (err instanceof TypeError) return "The database cannot be reached";
  return err instanceof Error ? err.message : "The database cannot be reached";
}

function iso(v: unknown): string | null {
  if (typeof v !== "string" || !v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

// ------------------------------------------------------------------ sync steps

let lastSignature: string | null = null;

/** A reset made on another kiosk clears the same games here (they stay as backup). */
async function applyRemoteReset(serverCutoff: string | null): Promise<boolean> {
  if (!serverCutoff) return false;
  const localCutoff = await getMeta<string>("resetCutoff");
  if (localCutoff && serverCutoff <= localCutoff) return false;
  const now = new Date().toISOString();
  const affected = (await getAllRecords())
    .filter((r) => !r.archived && r.playedAt <= serverCutoff)
    .map((r) => ({ ...r, archived: true, archivedAt: now }));
  await putRecords(affected, { silent: true });
  await setMeta("resetCutoff", serverCutoff);
  return affected.length > 0;
}

/** Bring the database's live records onto the device and spot anything it is missing. */
async function pullAndMerge(timeoutMs: number): Promise<boolean> {
  const pulled = await api<PullResponse>("/api/scores?view=all&limit=10000", undefined, timeoutMs);
  const serverRecords = Array.isArray(pulled.records) ? pulled.records : [];
  const pendingReset = await getMeta<string>("pendingReset");
  const local = new Map((await getAllRecords()).map((r) => [r.gameId, r]));
  const updates: KioskRecord[] = [];
  const onServer = new Set<string>();

  for (const s of serverRecords) {
    if (!s || typeof s.gameId !== "string" || !s.gameId) continue;
    onServer.add(s.gameId);
    const mine = local.get(s.gameId);
    if (!mine) {
      const playedAt = iso(s.createdAt) ?? new Date().toISOString();
      // a reset made here while offline also covers older games from other kiosks
      const covered = Boolean(pendingReset && playedAt <= pendingReset);
      updates.push({
        gameId: s.gameId,
        playerName: String(s.playerName ?? "Player"),
        score: Number(s.score) || 0,
        jumps: Number(s.jumps) || 0,
        obstaclesDodged: Number(s.obstaclesDodged) || 0,
        durationMs: Number(s.durationMs) || 0,
        topSpeed: Number(s.topSpeed) || 0,
        playedAt,
        synced: true,
        archived: covered,
        archivedAt: covered ? pendingReset : null,
      });
    } else if (!mine.synced) {
      updates.push({ ...mine, synced: true });
    }
  }

  // The database no longer has a game this device believes it stored there →
  // upload it again. (If the database archived it, the upload says so.)
  const complete = (Number(pulled.count) || 0) <= serverRecords.length;
  if (complete) {
    for (const r of local.values()) {
      if (r.synced && !r.archived && !onServer.has(r.gameId)) {
        updates.push({ ...r, synced: false });
      }
    }
  }

  await putRecords(updates, { silent: true });
  return updates.length > 0;
}

/** Upload every record the database does not have yet. */
async function pushPending(timeoutMs: number): Promise<boolean> {
  const pending = (await getAllRecords()).filter((r) => !r.synced);
  if (pending.length === 0) return false;
  const resetCutoff = await getMeta<string>("resetCutoff");
  const now = new Date().toISOString();
  for (let i = 0; i < pending.length; i += 200) {
    const chunk = pending.slice(i, i + 200);
    const res = await api<PushResponse>(
      "/api/scores/sync",
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          resetCutoff,
          records: chunk.map((r) => ({
            gameId: r.gameId,
            playerName: r.playerName,
            score: r.score,
            jumps: r.jumps,
            obstaclesDodged: r.obstaclesDodged,
            durationMs: r.durationMs,
            topSpeed: r.topSpeed,
            playedAt: r.playedAt,
            archived: r.archived,
          })),
        }),
      },
      timeoutMs,
    );
    const accepted = new Set(res.accepted ?? []);
    const archivedOnServer = new Set(res.archived ?? []);
    const done = chunk
      .filter((r) => accepted.has(r.gameId))
      .map((r) =>
        archivedOnServer.has(r.gameId) && !r.archived
          ? { ...r, synced: true, archived: true, archivedAt: now }
          : { ...r, synced: true },
      );
    await putRecords(done, { silent: true });
  }
  return true;
}

/** A reset made on this device while offline is now applied to the database. */
async function pushPendingReset(timeoutMs: number): Promise<boolean> {
  const pendingReset = await getMeta<string>("pendingReset");
  if (!pendingReset) return false;
  const ids = (await getAllRecords()).filter((r) => r.archived && r.synced).map((r) => r.gameId);
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 2000) chunks.push(ids.slice(i, i + 2000));
  if (chunks.length === 0) chunks.push([]);
  for (const gameIds of chunks) {
    await api(
      "/api/scores/reset",
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ confirm: "RESET", before: pendingReset, gameIds }),
      },
      timeoutMs,
    );
  }
  await setMeta("pendingReset", null);
  return true;
}

export async function refreshCounts(): Promise<void> {
  const all = await getAllRecords();
  setState({ total: all.length, unsynced: all.filter((r) => !r.synced).length });
}

async function runSync(timeoutMs: number): Promise<SyncResult> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    setState({ online: false, serverReachable: false, syncing: false });
    return { ok: false, reason: "offline" };
  }
  setState({ online: true, syncing: true });
  let changed = false;
  try {
    const status = await api<StatusResponse>("/api/scores/sync", undefined, timeoutMs);
    if (await applyRemoteReset(iso(status.lastResetCutoff))) changed = true;
    if (status.signature !== lastSignature) {
      if (await pullAndMerge(timeoutMs)) changed = true;
    }
    const pushed = await pushPending(timeoutMs);
    const reset = await pushPendingReset(timeoutMs);
    if (pushed || reset) changed = true;
    // Remember what the database looked like: while nothing changes, the next
    // check is one tiny request instead of a full download.
    lastSignature = pushed || reset ? null : status.signature;
    setState({ serverReachable: true, lastSyncAt: new Date().toISOString(), lastError: null });
    return { ok: true };
  } catch (err) {
    setState({ serverReachable: false, lastError: describe(err) });
    return { ok: false, reason: "unreachable" };
  } finally {
    await refreshCounts().catch(() => {});
    setState({ syncing: false });
    if (changed) notifyChange();
  }
}

let inFlight: Promise<SyncResult> | null = null;
let runAgain = false;

/** Copy to / from the database now. Calls made while one is running are folded into it. */
export function syncNow(timeoutMs = 6000): Promise<SyncResult> {
  if (typeof window === "undefined") return Promise.resolve({ ok: false, reason: "offline" });
  if (inFlight) {
    runAgain = true;
    return inFlight;
  }
  inFlight = (async () => {
    let result = await runSync(timeoutMs);
    while (runAgain) {
      runAgain = false;
      result = await runSync(timeoutMs);
    }
    return result;
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

// ------------------------------------------------------- offline copy of the app

interface WorkerReply {
  ok?: boolean;
  ready?: boolean;
  version?: string | null;
}

function askWorker(worker: ServiceWorker, message: unknown, timeoutMs: number) {
  return new Promise<WorkerReply | null>((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), timeoutMs);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      resolve(event.data as WorkerReply);
    };
    try {
      worker.postMessage(message, [channel.port2]);
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

let preparing: Promise<void> | null = null;

/**
 * Make sure a complete, up-to-date copy of the kiosk (pages, scripts, fonts,
 * images) is stored on the device by the service worker in /public/sw.js.
 */
export function prepareOffline(): Promise<void> {
  if (preparing) return preparing;
  preparing = (async () => {
    if (
      typeof navigator === "undefined" ||
      !("serviceWorker" in navigator) ||
      process.env.NODE_ENV !== "production"
    ) {
      setState({ offlineReady: "unsupported" });
      return;
    }
    try {
      if (!navigator.serviceWorker.controller && state.offlineReady !== "ready") {
        setState({ offlineReady: "preparing" });
      }
      let registered = true;
      await navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .catch(() => {
          registered = false;
        });
      if (!registered && !(await navigator.serviceWorker.getRegistration())) {
        setState({ offlineReady: "error" });
        return;
      }
      // "ready" resolves once a worker is installed — and it only installs after
      // it has stored the whole kiosk.
      const reg = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 120_000)),
      ]);
      const worker = reg?.active;
      if (!worker) {
        setState({ offlineReady: "error" });
        return;
      }
      const reply = await askWorker(
        worker,
        { type: navigator.onLine === false ? "offline-status" : "refresh-offline-copy" },
        120_000,
      );
      setState({ offlineReady: reply && reply.ready === false ? "error" : "ready" });
    } catch {
      setState({ offlineReady: "error" });
    }
  })().finally(() => {
    preparing = null;
  });
  return preparing;
}

// -------------------------------------------------------------------- runtime

let runtimeUsers = 0;
let stopRuntime: (() => void) | null = null;

/** Starts background syncing + offline preparation. Call once from the app shell. */
export function startKioskRuntime(): () => void {
  if (typeof window === "undefined") return () => {};
  runtimeUsers += 1;
  if (runtimeUsers === 1) {
    const onOnline = () => {
      setState({ online: true });
      void syncNow();
      void prepareOffline();
    };
    const onOffline = () => setState({ online: false, serverReachable: false });
    const onVisible = () => {
      if (document.visibilityState === "visible") void syncNow();
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisible);
    const offData = onDataChange(() => {
      void refreshCounts().catch(() => {});
    });
    const syncTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") void syncNow();
    }, 30_000);
    const offlineTimer = window.setInterval(() => {
      void prepareOffline();
    }, 15 * 60_000);

    setState({ online: navigator.onLine !== false });
    void (async () => {
      setState({ storage: await storageBackend() });
      try {
        // ask the browser not to evict the kiosk's records when disk space is low
        await navigator.storage?.persist?.();
      } catch {
        /* optional */
      }
      await refreshCounts().catch(() => {});
      void syncNow();
    })();
    void prepareOffline();

    stopRuntime = () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisible);
      offData();
      window.clearInterval(syncTimer);
      window.clearInterval(offlineTimer);
    };
  }
  return () => {
    runtimeUsers -= 1;
    if (runtimeUsers === 0 && stopRuntime) {
      stopRuntime();
      stopRuntime = null;
    }
  };
}
