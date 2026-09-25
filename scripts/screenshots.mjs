// Dev helper: log in and screenshot pages.  node scripts/screenshots.mjs /admin /admin/cards/1 ...
// Env: BASE_URL (default http://localhost:3001), PASSWORD (default demo), OUT_DIR, MOBILE=1, THEME=dark
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const base = process.env.BASE_URL ?? 'http://localhost:3001';
const out = process.env.OUT_DIR ?? 'screenshots';
const mobile = process.env.MOBILE === '1';
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const context = await browser.newContext({
  viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
  deviceScaleFactor: mobile ? 2 : 1,
  colorScheme: process.env.THEME === 'dark' ? 'dark' : 'light',
});
const page = await context.newPage();
const problems = [];
page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

const paths = process.argv.slice(2);
if (paths.some((p) => p.startsWith('/admin'))) {
  await page.goto(`${base}/admin/login`);
  await page.fill('#password', process.env.PASSWORD ?? 'demo');
  await page.click('button[type=submit]');
  await page.waitForURL(/\/admin(\/|$|\?)/);
}
for (const p of paths) {
  await page.goto(`${base}${p}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(600);
  const name = `${mobile ? 'm_' : ''}${process.env.THEME === 'dark' ? 'dark_' : ''}${p.replace(/[/?=&]+/g, '_').replace(/^_|_$/g, '') || 'home'}.png`;
  await page.screenshot({ path: path.join(out, name), fullPage: true });
  console.log('saved', name);
}
if (problems.length) console.log(problems.join('\n'));
await browser.close();
