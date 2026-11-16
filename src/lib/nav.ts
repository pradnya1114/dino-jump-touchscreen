"use client";

import { useMemo, useSyncExternalStore } from "react";
import { clearPlayerName } from "@/lib/game-storage";

// ---------------------------------------------------------------------------
// Kiosk navigation.
//
// Moving between the screens never asks the server for anything: the address
// bar is updated with the History API and <KioskApp> swaps the screen. That is
// what lets the whole player journey run with no connection at all (and keeps
// full-screen mode and the joystick connection alive between screens).
// ---------------------------------------------------------------------------

const NAV_EVENT = "dinojump:navigate";

export function normalizePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname || "/";
}

/** Go to another screen (same site) without loading anything from the server. */
export function navigate(url: string, options?: { replace?: boolean }) {
  if (typeof window === "undefined") return;
  const target = new URL(url, window.location.href);
  if (target.origin !== window.location.origin) {
    window.location.assign(target.href);
    return;
  }
  if (target.pathname === "/") clearPlayerName();
  const next = target.pathname + target.search + target.hash;
  if (options?.replace) window.history.replaceState(null, "", next);
  else window.history.pushState(null, "", next);
  window.scrollTo(0, 0);
  window.dispatchEvent(new Event(NAV_EVENT));
}

function subscribe(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  window.addEventListener(NAV_EVENT, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(NAV_EVENT, onChange);
  };
}

/** Current path. `initialPath` is the path this page was rendered for. */
export function usePath(initialPath: string): string {
  return useSyncExternalStore(
    subscribe,
    () => normalizePath(window.location.pathname),
    () => initialPath,
  );
}

export interface Query {
  get: (key: string) => string | null;
}

/** Query-string reader. `get` always reads the live address, so it is right even on the first render. */
export function useQuery(): Query {
  const search = useSyncExternalStore(
    subscribe,
    () => window.location.search,
    () => "",
  );
  return useMemo<Query>(() => {
    void search; // a new object whenever the query string changes, so effects re-run
    return {
      get: (key: string) =>
        typeof window === "undefined"
          ? null
          : new URLSearchParams(window.location.search).get(key),
    };
  }, [search]);
}

export interface Nav {
  push: (url: string) => void;
  replace: (url: string) => void;
}

const nav: Nav = {
  push: (url) => navigate(url),
  replace: (url) => navigate(url, { replace: true }),
};

/** Same shape as the router the screens used before, so their code reads the same. */
export function useNav(): Nav {
  return nav;
}
