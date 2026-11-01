// Renders the app icons (original artwork) to PNG with the pre-installed Chromium.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('@playwright/test')); }
import { mkdirSync } from 'node:fs';
mkdirSync('public/icons', { recursive: true });
const svg = (maskable) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="bg" cx="50%" cy="40%" r="75%"><stop offset="0" stop-color="#5a1fb8"/><stop offset=".6" stop-color="#1e0846"/><stop offset="1" stop-color="#0b0420"/></radialGradient>
    <linearGradient id="st" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff6c9"/><stop offset=".5" stop-color="#ffd23f"/><stop offset="1" stop-color="#ff8a00"/></linearGradient>
    <linearGradient id="l0" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#29d3ff" stop-opacity="0"/><stop offset="1" stop-color="#29d3ff"/></linearGradient>
    <linearGradient id="l1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff3df0" stop-opacity="0"/><stop offset="1" stop-color="#ff3df0"/></linearGradient>
    <filter id="glow"><feGaussianBlur stdDeviation="10" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <rect width="512" height="512" rx="${maskable ? 0 : 112}" fill="url(#bg)"/>
  <g transform="translate(256 256) scale(${maskable ? 0.78 : 1}) translate(-256 -256)">
    <path d="M196 120 L120 440 M256 120 L256 440 M316 120 L392 440" stroke="rgba(255,255,255,.12)" stroke-width="6"/>
    <path d="M150 300 L120 440 L190 440 L206 300 Z" fill="url(#l0)" opacity=".55"/>
    <path d="M306 300 L322 440 L392 440 L362 300 Z" fill="url(#l1)" opacity=".55"/>
    <rect x="96" y="398" width="320" height="8" rx="4" fill="#fff" filter="url(#glow)"/>
    <path filter="url(#glow)" fill="url(#st)" stroke="#fff6c9" stroke-width="6" stroke-linejoin="round"
      d="M256 92 L292 170 L376 180 L314 238 L330 322 L256 280 L182 322 L198 238 L136 180 L220 170 Z"/>
  </g>
</svg>`;
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, mask] of [['icon-192', 192, false], ['icon-512', 512, false], ['icon-maskable-512', 512, true], ['apple-touch-icon', 180, true], ['favicon-64', 64, false]]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg(mask).replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: `public/icons/${name}.png`, omitBackground: !mask });
}
await browser.close();
console.log('icons written');
