// End-to-end smoke test through the real UI: starts the server on a temp data
// folder, drives Chromium through the main workflows, and fails on any error.
//
//   npm run build && npm run test:e2e
//
// Needs a Chromium: set CHROME_PATH, or it uses the Playwright build in /opt/pw-browsers.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'card-shop-e2e-'));
const port = 3100 + Math.floor(Math.random() * 800);
const base = `http://localhost:${port}`;
const password = 'e2e-password';

if (!fs.existsSync(path.join(root, 'dist/web/index.html'))) {
  console.error('Build the web app first: npm run build');
  process.exit(1);
}

async function photo(name, color, label) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700"><rect width="100%" height="100%" fill="${color}"/><text x="250" y="350" text-anchor="middle" font-size="40" font-family="sans-serif" fill="#fff">${label}</text></svg>`;
  const file = path.join(dataDir, name);
  await sharp(Buffer.from(svg)).jpeg().toFile(file);
  return file;
}

const server = spawn(process.execPath, [path.join(root, 'node_modules/tsx/dist/cli.mjs'), path.join(root, 'server/index.ts')], {
  cwd: dataDir,
  env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, ADMIN_PASSWORD: password, WEB_DIR: path.join(root, 'dist/web'), ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));

let browser;
const problems = [];
const step = (msg) => console.log(`  • ${msg}`);

try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) break;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  const front = await photo('front.jpg', '#b03030', 'FRONT');
  const back = await photo('back.jpg', '#305030', 'BACK');
  const batch = await Promise.all([1, 2, 3, 4].map((n) => photo(`IMG_000${n}.jpg`, n % 2 ? '#224488' : '#886622', `B${n}`)));

  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  context.setDefaultTimeout(15000);
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  // A 401 is expected once: the deliberate wrong-password attempt.
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('status of 401') && problems.push(`console: ${m.text()}`));
  const toast = (text) => page.getByText(text, { exact: false }).first().waitFor();

  console.log('Admin workflow');
  await page.goto(`${base}/admin`);
  await page.waitForURL(/\/admin\/login/);
  await page.fill('#password', 'wrong');
  await page.click('button[type=submit]');
  await toast('Wrong password');
  await page.fill('#password', password);
  await page.click('button[type=submit]');
  await page.waitForURL(`${base}/admin`);
  step('logged in');

  await page.goto(`${base}/admin/cards/new`);
  const pickers = page.locator('input[type=file]:not([capture])');
  await pickers.nth(0).setInputFiles(front);
  await pickers.nth(1).setInputFiles(back);
  await page.getByRole('button', { name: 'Add card' }).click();
  await page.waitForURL(/\/admin\/cards\/\d+$/);
  const cardUrl = page.url();
  step('added a card from front/back photos');

  await page.getByLabel('Player / character').fill('E2E Skater');
  await page.getByLabel('Year / season').fill('2001-02');
  await page.getByLabel('Brand').fill('Upper Deck');
  await page.locator('#details').getByRole('button', { name: 'Save' }).click();
  await toast('Card details saved');
  await page.getByRole('heading', { level: 1, name: /E2E Skater/ }).waitFor();
  step('edited details');

  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await toast('Approved');
  await page.getByLabel('Asking price').fill('25');
  await page.locator('#value').getByRole('button', { name: 'Save' }).click();
  await toast('Prices saved');
  step('approved and priced');

  await page.getByLabel('Posted on eBay').check();
  await toast('Marked as posted on eBay');
  await page.getByLabel('Posted on Kijiji').check();
  await toast('Marked as posted on Kijiji');
  await page.getByText('Listed for sale').first().waitFor();
  step('posted on eBay and Kijiji');

  await page.getByRole('button', { name: 'Add inquiry' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Buyer Bob');
  await page.getByLabel('Offer (optional)').fill('22');
  await page.getByRole('button', { name: 'Save inquiry' }).click();
  await toast('Inquiry saved');
  step('logged an inquiry');

  await page.getByRole('button', { name: 'Sold to them' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Sold on').selectOption({ label: 'Kijiji (listed here)' });
  await dialog.getByText('Mark as taken down from eBay').waitFor();
  await dialog.getByRole('button', { name: 'Record sale' }).click();
  await toast('Sale recorded');
  await page.getByText('Sold', { exact: true }).first().waitFor();
  const ebayChecked = await page.getByLabel('Posted on eBay').isChecked();
  if (ebayChecked) throw new Error('eBay listing should have been taken down after the Kijiji sale');
  step('sold on Kijiji; eBay posting taken down automatically');

  await page.goto(`${base}/admin`);
  await page.getByRole('heading', { name: 'Dashboard' }).waitFor();
  if (await page.getByText('Sold, but still posted').count()) throw new Error('Dashboard still flags a posted sold card');
  await page.getByText('Profit in this period').waitFor();
  step('dashboard reflects the sale');

  await page.goto(`${base}/admin/cards/new`);
  await page.getByRole('button', { name: 'Add card' }).waitFor();
  await page.locator('input[type=file]:not([capture])').nth(0).setInputFiles(front);
  await page.getByRole('button', { name: 'Add card' }).click();
  await page.waitForURL(/\/admin\/cards\/\d+$/);
  await page.getByLabel('Player / character').fill('Shop Card');
  await page.locator('#details').getByRole('button', { name: 'Save' }).click();
  await toast('Card details saved');
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await toast('Approved');
  await page.getByRole('switch').first().click();
  await toast('Now showing on your website');
  const shopSku = (await page.locator('nav[aria-label=Breadcrumb] span.font-mono').textContent())?.trim();
  step(`second card ${shopSku} shown on the website`);

  console.log('Storefront');
  const shopper = await browser.newContext();
  const shop = await shopper.newPage();
  shop.on('pageerror', (e) => problems.push(`shop pageerror: ${e.message}`));
  await shop.goto(base);
  await shop.getByText('Shop Card').first().click();
  await shop.waitForURL(/\/card\//);
  await shop.getByLabel('Your name').fill('Web Visitor');
  await shop.getByLabel('Email or phone').fill('visitor@example.com');
  await shop.getByRole('button', { name: 'Send message' }).click();
  await shop.getByText('Message sent').waitFor();
  const soldVisible = await (await fetch(`${base}/api/public/cards?q=e2e`)).json();
  if (soldVisible.total !== 0) throw new Error('A sold card is visible in the shop');
  await shopper.close();
  step('visitor sent an inquiry; sold card hidden from shop');

  await page.goto(`${base}/admin/inquiries`);
  await page.getByText('Web Visitor').waitFor();
  await page.getByText('website', { exact: true }).first().waitFor();
  step('website inquiry landed in the admin');

  console.log('Batch upload');
  await page.goto(`${base}/admin/cards/new`);
  await page.getByRole('tab', { name: 'Many cards' }).click();
  await page.getByLabel('Binder / box').fill('Test binder');
  await page.getByLabel('Start page').fill('3');
  await page.locator('input[type=file][multiple]').setInputFiles(batch);
  await page.getByRole('button', { name: 'Upload 2 cards' }).click();
  await page.getByText('All 2 cards uploaded').waitFor();
  await page.getByRole('link', { name: 'Review them' }).click();
  await page.getByRole('heading', { name: 'Review new cards' }).waitFor();
  const rows = await page.locator('main li').count();
  if (rows !== 2) throw new Error(`expected 2 cards to review, saw ${rows}`);
  step('uploaded 4 photos as 2 cards (front+back) into Test binder p3');

  await page.goto(`${base}/admin/cards?q=${encodeURIComponent('test binder')}&status=all`);
  await page.getByText('1–2 of 2').waitFor();
  await page.goto(`${base}/admin/cards?q=skater&status=all`);
  await page.getByText('1–1 of 1').waitFor();
  step('search finds cards by binder and player');

  await page.goto(`${base}/admin/reports`);
  await page.getByRole('heading', { name: 'Profit & loss' }).waitFor();
  await page.goto(cardUrl.replace(/\/admin\/cards\/(\d+)$/, '/admin/print?ids=$1&mode=sheet'));
  await page.getByText('Where it’s posted').waitFor();
  step('reports and printable index card render');

  if (problems.length) throw new Error(`Browser errors:\n${problems.join('\n')}`);
  console.log('\nE2E smoke test passed ✔');
} catch (err) {
  console.error('\nE2E smoke test FAILED:', err instanceof Error ? err.message : err);
  if (problems.length) console.error(problems.join('\n'));
  console.error('--- server log ---\n' + serverLog.slice(-3000));
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
