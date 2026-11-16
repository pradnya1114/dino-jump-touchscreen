"use client";

import {
  DINO_COLOR,
  DINO_FRAMES,
  DINO_H,
  DINO_OUTLINE_COLOR,
  DINO_W,
  rectsToPath,
} from "@/lib/dino-sprite";

// SVG path data is built once — the sprite frames never change.
const FRAME_PATHS = {
  stand: {
    white: rectsToPath(DINO_FRAMES.stand.white),
    body: rectsToPath(DINO_FRAMES.stand.body),
  },
  run1: {
    white: rectsToPath(DINO_FRAMES.run1.white),
    body: rectsToPath(DINO_FRAMES.run1.body),
  },
  run2: {
    white: rectsToPath(DINO_FRAMES.run2.white),
    body: rectsToPath(DINO_FRAMES.run2.body),
  },
};

function Frame({
  frame,
  className,
}: {
  frame: keyof typeof FRAME_PATHS;
  className: string;
}) {
  const paths = FRAME_PATHS[frame];
  return (
    <g className={className}>
      <path d={paths.white} fill={DINO_OUTLINE_COLOR} />
      <path d={paths.body} fill={DINO_COLOR} />
    </g>
  );
}

/**
 * The pixel T-Rex (same sprite as in the game), running in place with a hop
 * every few seconds. `size` is the approximate height in px — it is snapped to
 * a whole number of pixels per sprite cell so the pixel art stays sharp.
 */
export function AnimatedDino({ size = 220 }: { size?: number }) {
  const cell = Math.max(2, Math.round(size / DINO_H));
  const width = DINO_W * cell;
  const height = DINO_H * cell;
  // head-room above the dino so the hop never covers the content above it
  const hopRoom = Math.round(height * 0.3);

  return (
    <div
      className="relative select-none"
      style={{ width, height: height + hopRoom, paddingTop: hopRoom }}
      aria-hidden
    >
      {/* ground shadow (stays on the ground while the dino hops) */}
      <span
        className="pixel-dino-shadow absolute block rounded-[50%] bg-black/50"
        style={{
          left: width * 0.19,
          bottom: cell * 0.5,
          width: width * 0.46,
          height: cell * 2.6,
        }}
      />
      <svg
        className="pixel-dino-hop relative block"
        width={width}
        height={height}
        viewBox={`0 0 ${DINO_W} ${DINO_H}`}
        shapeRendering="crispEdges"
      >
        {/* on the ground: the two run frames alternate */}
        <g className="pixel-dino-ground">
          <Frame frame="run1" className="pixel-dino-step-a" />
          <Frame frame="run2" className="pixel-dino-step-b" />
        </g>
        {/* in the air: both legs down, exactly like in the game */}
        <Frame frame="stand" className="pixel-dino-air" />
      </svg>
      {/* dust kicked up behind the feet */}
      <div
        className="absolute flex items-end"
        style={{ left: cell, bottom: cell * 2, gap: cell }}
      >
        <span
          className="animate-blink-soft block rounded-full bg-white/30"
          style={{ width: cell * 3.5, height: cell * 1.4, animationDelay: "0.3s" }}
        />
        <span
          className="animate-blink-soft block rounded-full bg-white/45"
          style={{ width: cell * 5, height: cell * 1.8 }}
        />
      </div>
    </div>
  );
}

/** Small cactus cluster decoration */
export function CactusDeco({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 140" className={className} aria-hidden>
      <ellipse cx="60" cy="130" rx="48" ry="8" fill="rgba(0,0,0,0.3)" />
      <rect x="48" y="26" width="24" height="100" rx="12" fill="#2f9e5f" stroke="#123f26" strokeWidth="4" />
      <rect x="18" y="58" width="18" height="44" rx="9" fill="#2f9e5f" stroke="#123f26" strokeWidth="4" />
      <rect x="28" y="82" width="26" height="14" rx="7" fill="#2f9e5f" />
      <rect x="84" y="46" width="18" height="52" rx="9" fill="#37b86c" stroke="#123f26" strokeWidth="4" />
      <rect x="68" y="76" width="26" height="14" rx="7" fill="#37b86c" />
      <g stroke="#c9f5dc" strokeWidth="3" strokeLinecap="round">
        <line x1="56" y1="48" x2="56" y2="58" />
        <line x1="64" y1="66" x2="64" y2="76" />
        <line x1="56" y1="90" x2="56" y2="100" />
      </g>
    </svg>
  );
}
