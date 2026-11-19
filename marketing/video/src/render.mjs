#!/usr/bin/env node
/**
 * Renders demo.html to marketing/video/.
 *
 *   node marketing/video/src/render.mjs            # both cuts
 *   node marketing/video/src/render.mjs full       # demo.mp4 (84 s), demo-poster.png
 *   node marketing/video/src/render.mjs short      # demo-30s.mp4, demo-30s.gif
 *
 * Each video is 1920x1080 at 30 fps with the narration from src/audio/ mixed
 * in at the cue times demo.html declares (window.AUDIO). The GIF is silent.
 *
 * The page is stepped with window.seek(t) and screenshotted one frame at a
 * time, so the result is identical on every run and does not depend on how
 * fast the machine is. Needs Playwright with Chromium, ffmpeg on PATH, and
 * the Inter and JetBrains Mono fonts installed.
 */
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const FPS = 30;
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, "..");
const NAMES = { full: "demo", short: "demo-30s" };

const wanted = process.argv[2] ? [process.argv[2]] : ["full", "short"];
for (const cut of wanted) {
  if (!NAMES[cut]) {
    console.error(`unknown cut "${cut}": use full or short`);
    process.exit(1);
  }
}

function ffmpeg(args) {
  const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const browser = await chromium.launch();
for (const cut of wanted) {
  const name = NAMES[cut];
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await page.goto(`${pathToFileURL(path.join(here, "demo.html")).href}?cut=${cut}`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  const { duration, cues } = await page.evaluate(() => ({ duration: window.DURATION, cues: window.AUDIO }));
  const frames = Math.round(duration * FPS);

  // 1. Picture, to a temporary silent file.
  const silent = path.join(os.tmpdir(), `memoria-${name}-silent.mp4`);
  const enc = spawn(
    "ffmpeg",
    ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-i", "-",
     "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", silent],
    { stdio: ["pipe", "inherit", "inherit"] },
  );
  for (let i = 0; i < frames; i++) {
    await page.evaluate((t) => window.seek(t), i / FPS);
    const png = await page.screenshot({ type: "png" });
    if (!enc.stdin.write(png)) await once(enc.stdin, "drain");
    if (i % 300 === 0) console.log(`${name}: frame ${i}/${frames}`);
  }
  enc.stdin.end();
  await once(enc, "close");

  // 2. Narration: each clip delayed to its cue, summed without level changes,
  //    then padded or trimmed to the picture's length.
  const mp4 = path.join(out, `${name}.mp4`);
  const inputs = cues.flatMap(([, clip]) => ["-i", path.join(here, "audio", `${clip}.mp3`)]);
  const delays = cues.map(([at], i) => `[${i + 1}:a]adelay=${Math.round(at * 1000)}:all=1[a${i}]`);
  const mix = `${cues.map((_, i) => `[a${i}]`).join("")}amix=inputs=${cues.length}:normalize=0,apad,atrim=0:${duration}[a]`;
  ffmpeg(["-i", silent, ...inputs, "-filter_complex", [...delays, mix].join(";"),
          "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
          "-ar", "48000", "-ac", "2", "-movflags", "+faststart", "-t", String(duration), mp4]);
  fs.rmSync(silent, { force: true });
  console.log(`wrote ${mp4}`);

  if (cut === "full") {
    // Poster: the end card.
    await page.evaluate((t) => window.seek(t), duration - 1);
    await page.screenshot({ path: path.join(out, "demo-poster.png") });
  } else {
    // GIF for the README: smaller, slower frame rate, one shared palette.
    const gif = path.join(out, `${name}.gif`);
    ffmpeg(["-i", mp4, "-vf",
            "fps=10,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle",
            gif]);
    console.log(`wrote ${gif}`);
  }
  await page.close();
}
await browser.close();
