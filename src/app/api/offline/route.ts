import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// GET /api/offline — the list of everything the kiosk needs to run without a
// connection. The service worker (public/sw.js) downloads all of it to the
// device. `version` changes whenever the app is rebuilt or a file in /public
// is replaced (for example your own backgrounds or logo), which makes every
// kiosk refresh its offline copy.

const ROUTES = ["/", "/rules", "/play", "/results", "/hardware"];

// Only used if the server cannot list its own files (some serverless hosts).
const FALLBACK_PUBLIC = [
  "/images/logo.png",
  "/images/bg-welcome.jpg",
  "/images/bg-rules.jpg",
  "/images/bg-game.jpg",
  "/images/bg-results.jpg",
  "/arduino/dino_joystick.ino",
  "/fonts/bungee-latin.woff2",
  "/fonts/bungee-latin-ext.woff2",
  "/fonts/press-start-2p-latin.woff2",
  "/fonts/press-start-2p-latin-ext.woff2",
  "/fonts/space-grotesk-latin.woff2",
  "/fonts/space-grotesk-latin-ext.woff2",
];

interface Manifest {
  ok: true;
  version: string;
  routes: string[];
  files: string[];
}

function walk(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(path.join(dir, entry.name), rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

let cached: { at: number; manifest: Manifest } | null = null;

function buildManifest(): Manifest {
  const root = process.cwd();
  const signature = crypto.createHash("sha1");

  let buildId = "unknown";
  try {
    buildId = fs
      .readFileSync(path.join(/* turbopackIgnore: true */ root, ".next", "BUILD_ID"), "utf8")
      .trim();
  } catch {
    /* fall through with "unknown" */
  }

  const files: string[] = [];
  try {
    const staticDir = path.join(/* turbopackIgnore: true */ root, ".next", "static");
    for (const file of walk(staticDir)) {
      if (file.endsWith(".map")) continue;
      files.push(`/_next/static/${file}`);
    }
  } catch {
    /* the worker finds the build files by reading the pages instead */
  }

  try {
    const publicDir = path.join(/* turbopackIgnore: true */ root, "public");
    for (const file of walk(publicDir).sort()) {
      if (file === "sw.js") continue;
      const stat = fs.statSync(path.join(publicDir, file));
      signature.update(`${file}:${stat.size}:${Math.round(stat.mtimeMs)};`);
      files.push(`/${file}`);
    }
  } catch {
    files.push(...FALLBACK_PUBLIC);
  }

  return {
    ok: true,
    version: `${buildId}-${signature.digest("hex").slice(0, 10)}`,
    routes: ROUTES,
    files,
  };
}

export async function GET() {
  try {
    if (!cached || Date.now() - cached.at > 15_000) {
      cached = { at: Date.now(), manifest: buildManifest() };
    }
    return NextResponse.json(cached.manifest, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("GET /api/offline failed:", err);
    return NextResponse.json(
      { ok: false, error: "Could not build the offline file list." },
      { status: 500 },
    );
  }
}
