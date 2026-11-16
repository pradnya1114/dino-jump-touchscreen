// ---------------------------------------------------------------------------
// Pixel-art T-Rex sprite — recreated cell-for-cell from the supplied artwork
// (dark grey body, white eye, white "sticker" outline).
//
// Every frame is a 44 x 47 grid:
//   "#" = body (dark grey)   "o" = white (outline + eye)   "." = transparent
//
// The same data drives the gameplay canvas (DinoGame) and the animated SVG
// dinosaur on the Welcome / Rules pages, so the character always matches.
// To restyle the dino, edit the rows below or the two colours.
// ---------------------------------------------------------------------------

export const DINO_W = 44;
export const DINO_H = 47;
/** The feet end at this row — in the game this row boundary sits on the ground line. */
export const DINO_FEET_ROW = 45;
export const DINO_COLOR = "#535353";
export const DINO_OUTLINE_COLOR = "#ffffff";

export type DinoFrameName = "stand" | "blink" | "run1" | "run2" | "dead";

/** Rectangle in sprite cells: [x, y, width, height]. */
export type DinoRect = readonly [x: number, y: number, w: number, h: number];

export interface DinoFrame {
  /** White backing silhouette (outline + eye) — draw this first. */
  white: readonly DinoRect[];
  /** Dark body — draw this on top. */
  body: readonly DinoRect[];
}

// Standing pose (also used while jumping).
const STAND: readonly string[] = [
  "......................oooooooooooooooooooo..",
  "......................oooooooooooooooooooo..",
  "....................oooo################oo..",
  "....................oooo################oo..",
  "....................oo####################oo",
  "....................oo####oo##############oo",
  "....................oo####oo##############oo",
  "....................oo####################oo",
  "....................oo####################oo",
  "....................oo####################oo",
  "....................oo####################oo",
  "....................oo####################oo",
  "....................oo####################oo",
  "....................oo##########oooooooooooo",
  "....................oo##########oooooooooooo",
  "..oooo............oooo################oo....",
  "..oooo............oooo################oo....",
  "oo##oo.........ooooo##########oooooooooo....",
  "oo##oo.........ooooo##########oooooooooo....",
  "oo##oo......ooooo#############oooooo........",
  "oo##oo......ooooo#############oooooo........",
  "oo####oooooooo####################oo........",
  "oo####oooooooo####################oo........",
  "oo######oooo##################oo##oo........",
  "oo######oooo##################oo##oo........",
  "oo############################oooooo........",
  "oo############################oooooo........",
  "oo############################oo............",
  "oo############################oo............",
  "..oo##########################oo............",
  "..oo########################oo..............",
  "....oo######################oo..............",
  "....oo######################oo..............",
  "......oo##################oooo..............",
  "......oo##################oooo..............",
  "........oo##############oooo................",
  "........oo##############oooo................",
  "........oooo######oo####oooo................",
  "........oooo######oo####oooo................",
  "..........oo####oo..oo##oo..................",
  "..........oo####oo..oo##oo..................",
  "..........oo##oo....oo##oo..................",
  "..........oo##oo....oo##oo..................",
  "..........oo####oo..oo####oo................",
  "..........oo####oo..oo####oo................",
  "..........oooooooo..oooooooo................",
  "..........oooooooo..oooooooo................",
];

const EYE_ROW = 5;
const MOUTH_ROW = 13;
const LEGS_ROW = 37;

// Eye closed (blink while waiting to start).
const EYE_CLOSED: readonly string[] = [
  "....................oo####################oo",
  "....................oo####################oo",
];

// Wide "ouch" eye for the crashed pose.
const EYE_CRASHED: readonly string[] = [
  "....................oo####oooo############oo",
  "....................oo####o##o############oo",
  "....................oo####o##o############oo",
  "....................oo####oooo############oo",
];

// Crashed pose: mouth shut.
const MOUTH_SHUT: readonly string[] = [
  "....................oo####################oo",
  "....................oo####################oo",
];

// Run cycle A: front leg lifted.
const LEGS_RUN_1: readonly string[] = [
  "........oooo######oooo#####oooo.............",
  "........oooo######oooo#####oooo.............",
  "..........oo####oo..ooooooooo...............",
  "..........oo####oo..ooooooooo...............",
  "..........oo##oo............................",
  "..........oo##oo............................",
  "..........oo####oo..........................",
  "..........oo####oo..........................",
  "..........oooooooo..........................",
  "..........oooooooo..........................",
];

// Run cycle B: back leg lifted.
const LEGS_RUN_2: readonly string[] = [
  "........oooo####oooo####oooo................",
  "........oooo####oooo####oooo................",
  "..........oooo####oooo##oo..................",
  "..........oooo####oooo##oo..................",
  "............oooooo..oo##oo..................",
  "............oooooo..oo##oo..................",
  "....................oo####oo................",
  "....................oo####oo................",
  "....................oooooooo................",
  "....................oooooooo................",
];

/** Returns a copy of `base` with `rows` written over it starting at `fromRow`. */
function patch(
  base: readonly string[],
  fromRow: number,
  rows: readonly string[],
): string[] {
  return base.map((row, i) =>
    i >= fromRow && i < fromRow + rows.length ? (rows[i - fromRow] ?? row) : row,
  );
}

type MutableRect = [number, number, number, number];

/** Turns the cells matching `match` into as few rectangles as possible. */
function toRects(
  rows: readonly string[],
  match: (cell: string) => boolean,
): DinoRect[] {
  const rects: MutableRect[] = [];
  let open = new Map<string, MutableRect>();
  rows.forEach((row, y) => {
    const next = new Map<string, MutableRect>();
    let x = 0;
    while (x < row.length) {
      if (!match(row.charAt(x))) {
        x += 1;
        continue;
      }
      let end = x;
      while (end < row.length && match(row.charAt(end))) end += 1;
      const key = `${x}:${end - x}`;
      const above = open.get(key);
      if (above) {
        above[3] += 1; // identical run in the row above → grow that rectangle
        next.set(key, above);
      } else {
        const rect: MutableRect = [x, y, end - x, 1];
        rects.push(rect);
        next.set(key, rect);
      }
      x = end;
    }
    open = next;
  });
  return rects;
}

function buildFrame(rows: readonly string[]): DinoFrame {
  return {
    // The white layer is a solid silhouette under the body, so the outline
    // and body can never show a hairline gap between them.
    white: toRects(rows, (c) => c === "o" || c === "#"),
    body: toRects(rows, (c) => c === "#"),
  };
}

export const DINO_FRAMES: Record<DinoFrameName, DinoFrame> = {
  stand: buildFrame(STAND),
  blink: buildFrame(patch(STAND, EYE_ROW, EYE_CLOSED)),
  run1: buildFrame(patch(STAND, LEGS_ROW, LEGS_RUN_1)),
  run2: buildFrame(patch(STAND, LEGS_ROW, LEGS_RUN_2)),
  dead: buildFrame(patch(patch(STAND, EYE_ROW, EYE_CRASHED), MOUTH_ROW, MOUTH_SHUT)),
};

/**
 * Collision boxes in sprite cells. They hug the dark body (never the white
 * outline) and leave the snout tip, tail tip and toes out, so near misses
 * always go the player's way.
 */
export const DINO_HITBOXES: readonly DinoRect[] = [
  [23, 4, 18, 9], // head
  [23, 13, 9, 3], // throat (the open mouth and jaw tip are left out)
  [20, 17, 10, 4], // neck
  [14, 21, 18, 2], // chest + arm
  [12, 23, 18, 7], // torso
  [4, 25, 8, 4], // tail base
  [8, 30, 18, 5], // belly
  [11, 35, 13, 7], // legs
];

/** Left-most collision cell — an obstacle fully behind this has been dodged. */
export const DINO_HIT_MIN_X = Math.min(...DINO_HITBOXES.map((b) => b[0]));

/** SVG path data for a list of sprite rectangles (1 unit = 1 sprite cell). */
export function rectsToPath(rects: readonly DinoRect[]): string {
  return rects.map(([x, y, w, h]) => `M${x} ${y}h${w}v${h}h${-w}z`).join("");
}
