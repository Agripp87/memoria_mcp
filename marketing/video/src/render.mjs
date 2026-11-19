#!/usr/bin/env node
/**
 * Renders demo.html to marketing/video/: demo.mp4 (1920x1080, 30 fps),
 * demo.gif (960 wide, for the README) and demo-poster.png.
 *
 *   node marketing/video/src/render.mjs
 *
 * The page is stepped with window.seek(t) and screenshotted one frame at a
 * time, so the result is identical on every run and does not depend on how
 * fast the machine is. Needs Playwright with Chromium, ffmpeg on PATH, and
 * the Inter and JetBrains Mono fonts installed.
 */
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const FPS = 30;
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, "..");
const mp4 = path.join(out, "demo.mp4");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(path.join(here, "demo.html")).href);
await page.evaluate(() => document.fonts.ready);
await page.waitForFunction(() => document.getElementById("shot").complete);
const duration = await page.evaluate(() => window.DURATION);
const frames = Math.round(duration * FPS);

const ffmpeg = spawn(
  "ffmpeg",
  ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-i", "-",
   "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p",
   "-movflags", "+faststart", mp4],
  { stdio: ["pipe", "inherit", "inherit"] },
);

for (let i = 0; i < frames; i++) {
  await page.evaluate((t) => window.seek(t), i / FPS);
  const png = await page.screenshot({ type: "png" });
  if (!ffmpeg.stdin.write(png)) await once(ffmpeg.stdin, "drain");
  if (i % 150 === 0) console.log(`frame ${i}/${frames}`);
}
ffmpeg.stdin.end();
await once(ffmpeg, "close");
console.log(`wrote ${mp4}`);

// Poster: the end card.
await page.evaluate((t) => window.seek(t), duration - 1);
await page.screenshot({ path: path.join(out, "demo-poster.png") });
await browser.close();

// GIF for the README: smaller, slower frame rate, one shared palette.
const gif = path.join(out, "demo.gif");
const r = spawnSync(
  "ffmpeg",
  ["-y", "-loglevel", "error", "-i", mp4, "-vf",
   "fps=10,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle",
   gif],
  { stdio: "inherit" },
);
if (r.status !== 0) process.exit(r.status ?? 1);
console.log(`wrote ${gif}`);
