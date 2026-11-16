// Small helpers for kiosk session state (name, best score, pending result).
// Permanent records always live in Postgres — localStorage is only a cache.

export const LS_KEYS = {
  playerName: "dinojump.playerName",
  bestScore: "dinojump.bestScore",
  lastResult: "dinojump.lastResult",
  muted: "dinojump.muted",
} as const;

export interface LastResult {
  gameId: string;
  playerName: string;
  score: number;
  jumps: number;
  obstaclesDodged: number;
  durationMs: number;
  topSpeed: number;
  isNewBest: boolean;
  playedAt: string;
}

export function getPlayerName(): string {
  if (typeof window === "undefined") return "";
  return (localStorage.getItem(LS_KEYS.playerName) ?? "").trim();
}

export function setPlayerName(name: string) {
  try {
    localStorage.setItem(LS_KEYS.playerName, name.trim());
  } catch {
    /* kiosk private mode — ignore */
  }
}

export function clearPlayerName() {
  try {
    localStorage.removeItem(LS_KEYS.playerName);
  } catch {
    /* kiosk private mode — ignore */
  }
}

export function getBestScore(): number {
  if (typeof window === "undefined") return 0;
  const v = Number(localStorage.getItem(LS_KEYS.bestScore) ?? "0");
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

export function setBestScore(score: number) {
  try {
    localStorage.setItem(LS_KEYS.bestScore, String(Math.floor(score)));
  } catch {
    /* ignore */
  }
}

export function saveLastResult(r: LastResult) {
  try {
    localStorage.setItem(LS_KEYS.lastResult, JSON.stringify(r));
  } catch {
    /* ignore */
  }
}

export function getLastResult(): LastResult | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LS_KEYS.lastResult);
    if (!raw) return null;
    return JSON.parse(raw) as LastResult;
  } catch {
    return null;
  }
}

export function newGameId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `g-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function formatScore(n: number): string {
  return Math.floor(Math.max(0, n)).toString().padStart(5, "0");
}
