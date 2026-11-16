"use client";

import { syncNow, useSyncState } from "@/lib/sync";

/**
 * Connection + saving status for the kiosk operator.
 * Tap it to copy any waiting records to the database right now.
 */
export function SyncBadge({ compact = false }: { compact?: boolean }) {
  const s = useSyncState();
  const offline = !s.online || s.serverReachable === false;
  const waiting = s.unsynced;

  let tone = "border-emerald-300/50 bg-emerald-400/15 text-emerald-200";
  let dot = "bg-emerald-400";
  let label = compact ? "Saved ✓" : "Online · all saved";
  let hint = "Every record is on this device and in the database.";

  if (s.storage === "memory") {
    tone = "border-red-300/60 bg-red-500/20 text-red-200";
    dot = "bg-red-400";
    label = compact ? "No storage" : "Storage blocked · online only";
    hint = "This browser blocks on-device storage, so records cannot be kept while offline.";
  } else if (offline) {
    tone = "border-amber-300/0 bg-amber-400/0 text-amber-0";
    dot = "bg-amber-0";
    label = compact
      ? `Offline${waiting > 0 ? ` · ${waiting}` : ""}`
      : waiting > 0
        ? ``
        : "Offline · saved on device";
    hint =
      "No connection to the database. Games are saved on this device and copied over when the connection is back.";
  } else if (s.serverReachable === null) {
    tone = "border-white/25 bg-black/40 text-white/75";
    dot = "bg-white/60";
    label = compact ? "…" : "Connecting…";
    hint = "Checking the connection to the database.";
  } else if (waiting > 0) {
    tone = "border-cyan-300/50 bg-cyan-400/15 text-cyan-200";
    dot = "bg-cyan-300";
    label = compact ? `Sync ${waiting}` : `Online · syncing ${waiting}`;
    hint = "Copying records to the database.";
  }

  // "Offline-ready" means the app AND its records can live on this device, so it
  // is not shown when the browser blocks on-device storage.
  const offlineChip =
    s.storage === "memory"
      ? null
      : s.offlineReady === "ready"
        ? "Offline-ready ✓"
        : s.offlineReady === "preparing"
          ? "Preparing offline…"
          : null;

  return (
    <button
      type="button"
      onClick={() => void syncNow()}
      title={`${hint} Tap to sync now.`}
      data-sync-badge
      data-offline-ready={s.offlineReady}
      className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] backdrop-blur transition hover:brightness-125 active:scale-95 ${tone}`}
    >
      <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${dot} ${s.syncing ? "animate-pulse" : ""}`} />
      <span className="whitespace-nowrap">{label}</span>
      {!compact && offlineChip && (
        <span className="hidden whitespace-nowrap rounded-full bg-black/45 px-2 py-0.5 text-[9px] tracking-[0.14em] text-white/75 md:inline">
          {offlineChip}
        </span>
      )}
    </button>
  );
}
