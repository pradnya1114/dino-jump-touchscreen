"use client";

import type { MouseEvent, ReactNode } from "react";
import Image from "next/image";
import { SyncBadge } from "@/components/SyncBadge";
import { navigate } from "@/lib/nav";

/** In-app link: changes screen without asking the server, so it works offline. */
function go(event: MouseEvent<HTMLAnchorElement>, href: string) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return;
  }
  event.preventDefault();
  navigate(href);
}

/** Company logo — pinned to the top-left corner of every page. */
export function BrandLogo({ size = 100 }: { size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-html-link-for-pages
    <a
      href="/"
      onClick={(e) => go(e, "/")}
      className="group flex items-center gap-3 rounded-2xl p-1 pr-4 transition-transform hover:scale-[1.03] active:scale-95"
      aria-label="Dino Jump home"
    >
      <span className="relative block overflow-hidden rounded-xl shadow-[0_0px_px_rgba(0,0,0,0.5)]">
        <Image
          src="/images/logo.png"
          alt="Mintlabs"
          width={6667}
          height={4292}
          style={{ width: size * (6667 / 4292), height: size }}
          priority
        />
      </span>
      <span className="hidden flex-col leading-none sm:flex">
        <span className="font-arcade text-xl tracking-wide text-[#ffd23f] title-glow">
          
        </span>
        <span className="mt-1 text-[11px] font-bold uppercase tracking-[0.35em] text-cyan-200/90">
          
        </span>
      </span>
    </a>
  );
}

/** Full-screen page wrapper with fixed background (never stretched/distorted). */
export function PageShell({
  bg,
  children,
  overlay = true,
}: {
  bg: string;
  children: ReactNode;
  overlay?: boolean;
}) {
  return (
    <div className="relative flex min-h-screen w-full flex-col overflow-hidden">
      {/* background layer */}
      <div
        aria-hidden
        className="kiosk-bg pointer-events-none absolute inset-0"
        style={{ backgroundImage: `url(${bg})` }}
      />
      {overlay && (
        <div aria-hidden className="kiosk-overlay pointer-events-none absolute inset-0" />
      )}
      {/* header with logo top-left and the saving / connection status top-right */}
      <header className="relative z-20 flex items-start justify-between gap-4 p-4 sm:p-5">
        <BrandLogo />
        <div className="flex items-center gap-2 pt-1">
          <SyncBadge />
        </div>
      </header>
      {/* page body */}
      <main className="relative z-10 flex w-full flex-1 flex-col">{children}</main>
      {/* footer strip */}
      
    </div>
  );
}
