#!/usr/bin/env node
/**
 * Renders every card in cards.html to a PNG in marketing/images/.
 *
 *   node marketing/images/src/render.mjs
 *
 * Needs Playwright with Chromium (`npm i -D playwright && npx playwright
 * install chromium`), and the Inter and JetBrains Mono fonts installed.
 * PNGs are written at 1x: the cards are already drawn at their final pixel
 * size (1600x900, 1080x1080, 1200x627).
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, "..");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1700, height: 1000 } });
await page.goto(pathToFileURL(path.join(here, "cards.html")).href);
await page.evaluate(() => document.fonts.ready);

const ids = await page.$$eval("section.card", (els) => els.map((e) => e.id));
for (const id of ids) {
  await page.locator(`#${id}`).screenshot({ path: path.join(out, `${id}.png`) });
  console.log(`wrote ${id}.png`);
}
await browser.close();
