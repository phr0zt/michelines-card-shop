# Micheline's Card Shop

Inventory, cross-listing tracker and online shop for hockey, baseball and other trading cards kept in binders.

Photograph the front and back of a card. The AI reads it, fills in the details, looks up what it sells for, and creates an **index card** for it. That index card tracks where the card lives (binder, page, slot), every place it's posted (eBay, Kijiji, Facebook, Whatnot…) and at what price, who asked about it, and what it sold for. A dashboard shows profit, sales by platform and anything that needs attention.

## What it does

| | |
|---|---|
| **Add cards from photos** | One card at a time (phone camera works) or a whole binder at once: drop in all the photos, and it pairs fronts with backs and numbers the binder pages and slots for you. |
| **AI identification** | Claude reads each card — player, year/season, brand, set, insert, card #, parallel, serial numbering, rookie/auto/relic, grading slab and cert #, and a condition estimate — and writes a listing title and description. You review and approve. |
| **Market value** | Claude searches recent *sold* prices (eBay sold listings, PriceCharting/SportsCardsPro, 130point, COMC, Beckett and others), then reports a low/typical/high range with the comparable sales and links it used, plus a suggested list price and a quick-sale price. One-click links let you check eBay sold, SportsCardsPro, Beckett, TCGplayer or a PSA cert yourself. Value history is kept, so you can see a card's price move. |
| **Where it's posted** | A checklist of every platform on each card: tick it when you post, add the link, price and group. When it sells on one site, the app asks you to take it down everywhere else — and the dashboard flags any sold card still posted somewhere. |
| **Inquiries & offers** | Record who asked, where, their offer and a follow-up date. Messages from your website land here automatically. "Sold to them" turns an inquiry into a sale. |
| **Sales & profit** | Each sale records price, shipping, platform fees (estimated automatically from each platform's fee settings), postage, supplies and what the card cost you, so profit is exact. Track what still needs to ship. |
| **Purchases** | Record lots you bought ("2 binders, $150") and spread the cost across the cards evenly or by value. Each lot shows what it has earned back. |
| **Dashboard & reports** | Profit, sales, fees, sell-through, days to sell, inventory value over time, best platforms, categories, most valuable cards and price movers. Monthly profit & loss for your books, CSV exports and a full database backup. |
| **Online shop** | A public page at `/` listing the cards you choose, with photos (front and back), prices and an "ask about this card / make an offer" form. |
| **Printing** | Full-page printable index cards, and sleeve labels with a QR code that opens the card (30 per sheet, like Avery 5160). |
| **Search** | Search by anything, including hobby shorthand: `gretzky opc 79 rc`, `young guns`, `psa 10`, `binder 3`, `MC-00042`. Filter by status, category, binder, "posted on" or "not yet posted on" a platform, graded, rookies and more. |

## Everyday workflow

1. **Add cards** → photograph front and back (or batch-upload a binder page by page).
2. **Review** → check what the AI filled in, fix anything, click *Approve & next*.
3. **Price** → the AI's market research suggests an asking price and a floor price.
4. **Post** → copy the ready-made eBay / Kijiji / Facebook / Instagram text, post it, tick the platform and paste the link.
5. **Inquiries** → log messages and offers; set follow-up dates.
6. **Sold** → *Mark as sold*, confirm the fees and postage, and take the card down from the other sites.
7. **Dashboard** → see profit and what needs attention.

## Run it on your computer

Needs [Node.js 22](https://nodejs.org) or newer.

```bash
npm install
cp .env.example .env        # then edit .env: set ADMIN_PASSWORD and ANTHROPIC_API_KEY
npm run dev                 # server on :3001, app on http://localhost:5173
```

Open <http://localhost:5173/admin> and sign in with your `ADMIN_PASSWORD`. The shop is at <http://localhost:5173/>.

**Try it with sample data first:**

```bash
npm run demo                                   # creates ./demo-data with 13 sample cards
DATA_DIR=./demo-data npm run dev
```

## Put it online (Railway)

The repo includes a `Dockerfile`, so any host that runs Docker works. On [Railway](https://railway.com):

1. **New project → Deploy from GitHub repo** → pick this repository. Railway finds the Dockerfile.
2. **Add a volume** to the service with mount path **`/data`**. This is where the database and photos are stored. Without a volume, everything is lost when the app redeploys.
3. **Variables:**
   - `ADMIN_PASSWORD` — a strong password for `/admin` (required)
   - `ANTHROPIC_API_KEY` — from <https://console.anthropic.com> (needed for the AI features)
4. **Settings → Networking → Generate domain** (or add your own domain).
5. Optional: set the health check path to `/api/health`.

Then open `https://your-domain/admin`, sign in, and go to **Settings** to set your shop name, contact info, pickup area and platform fees.

Other hosts: build the image (`docker build -t card-shop .`), run it with a persistent volume on `/data` and the two variables above, and put it behind HTTPS.

### Environment variables

| Variable | Required | What it does |
|---|---|---|
| `ADMIN_PASSWORD` | yes | Password for the admin area. Changing it signs everyone out. |
| `ANTHROPIC_API_KEY` | for AI | Turns on card identification and price research. |
| `DATA_DIR` | no | Where the database and photos live. Default: the attached Railway volume if there is one, otherwise `/data` in Docker or `./data` locally. |
| `PORT` | no | HTTP port (default 3001). |
| `SESSION_SECRET` | no | Signs login cookies. Generated and saved in `DATA_DIR` if not set. |
| `ANTHROPIC_MODEL` | no | Overrides the model chosen in Settings. |

## About the AI

- **Model:** Claude Opus 5 by default (most accurate at reading small print, parallels and serial numbers). Claude Sonnet 5 is a cheaper option in **Settings → AI assistant**. You can also turn automatic price research off to save money on bulk commons and research individual cards with one click later.
- **Cost:** you pay Anthropic directly for usage. Very roughly, identifying a card costs around 10¢ and researching its value 20–40¢ with Opus 5 (web searches are about 1¢ each, and search results make up most of the cost). **Settings** shows your estimated AI spend for the month.
- **Web search** must be enabled for your Anthropic organization (Claude Console → settings) for price research to work.
- **Market values are estimates.** Beckett, Card Ladder and similar services don't offer a public API, so the research uses what is publicly searchable (mostly eBay sold data). Every estimate shows its comparable sales and links, and you can add your own price checks.
- Photos are sent to Anthropic's API for analysis. Nothing is shared publicly unless you show a card on your shop.
- AI work runs in the background from a queue, two cards at a time, so you can keep working or close the page. Failed jobs can be retried from the **Review** page.

## Data, backups and privacy

- Everything is stored in one SQLite database file plus a folder of photos inside `DATA_DIR`.
- **Reports → Download your data** gives CSV files (cards, sales, inquiries, purchases) and a complete database backup. Keep a backup somewhere safe from time to time.
- The public shop only shows cards you mark "Show on our website" that are in stock. Costs, floor prices, notes, binder locations and buyer details never leave the admin area.

## Development

```bash
npm run dev          # API (tsx watch) + Vite dev server with hot reload
npm test             # unit + API tests (Vitest)
npm run typecheck    # TypeScript, server and web
npm run build        # production build → dist/
npm start            # run the production build
npm run test:e2e     # browser smoke test of the main workflows (needs `npm run build` and Chromium; set CHROME_PATH)
```

```
server/            Express API, SQLite (better-sqlite3), image processing (sharp)
  services/ai/     Claude card identification, price research, background job queue
shared/            Types, constants, money and listing-text helpers used by both sides
web/src/           React admin app (/admin) and public shop (/)
tests/             Vitest unit/API tests; e2e/ Playwright smoke test
scripts/           Demo data seeder, screenshot helper
```

Stack: Node 22, TypeScript, Express 5, better-sqlite3, sharp, `@anthropic-ai/sdk`, React 19, React Router, TanStack Query, Tailwind CSS 4, Recharts.

## Ideas for later

- Push listings to eBay or Shopify automatically instead of copy-paste
- CSV import of an existing spreadsheet inventory
- Photograph a whole 9-pocket binder page and split it into cards
- Consignment tracking (cards sold for someone else, with their share)
- Separate logins for each person helping in the shop
