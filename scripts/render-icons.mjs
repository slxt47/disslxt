// Renders the PWA icons from frontend/public/icons/icon.svg (run inside the Playwright image):
//   node scripts/render-icons.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

// Playwright is a dependency of the e2e package.
const { chromium } = createRequire(resolve('e2e/package.json'))('@playwright/test');

const svg = readFileSync('frontend/public/icons/icon.svg', 'utf8');
// Full-bleed variant: no rounded corners (iOS and Android mask the icon themselves) and the
// artwork shrunk into the 80 % safe zone of maskable icons.
const fullBleed = svg
  .replace('rx="112" ', '')
  .replace(
    /<path d="M168[\s\S]*<\/svg>/,
    (inner) =>
      `<g transform="translate(51.2 51.2) scale(0.8)">${inner.replace('</svg>', '')}</g></svg>`,
  );

const targets = [
  { file: 'icon-192.png', size: 192, src: svg },
  { file: 'icon-512.png', size: 512, src: svg },
  { file: 'maskable-512.png', size: 512, src: fullBleed },
  // iOS rounds the corners itself and needs no safe zone.
  { file: 'apple-touch-icon.png', size: 180, src: svg.replace('rx="112" ', '') },
  { file: 'favicon-32.png', size: 32, src: svg },
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const t of targets) {
  await page.setViewportSize({ width: t.size, height: t.size });
  const html = `<html><body style="margin:0;background:transparent">${t.src.replace('<svg ', `<svg width="${t.size}" height="${t.size}" `)}</body></html>`;
  await page.setContent(html);
  await page.screenshot({ path: `frontend/public/icons/${t.file}`, omitBackground: true });
}
await browser.close();
