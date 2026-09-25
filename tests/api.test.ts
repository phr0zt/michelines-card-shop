import { afterEach, describe, expect, it } from 'vitest';
import type { AiClient } from '../server/services/ai/client';
import { makeJpeg, makeTestApp, PASSWORD } from './helpers';
import request from 'supertest';

type TestApp = ReturnType<typeof makeTestApp>;
let t: TestApp | null = null;

afterEach(() => {
  t?.cleanup();
  t = null;
});

async function setup(ai: AiClient | null = null) {
  t = makeTestApp(ai);
  const agent = await t.login();
  return { app: t, agent };
}

async function createCard(agent: request.Agent, data: Record<string, unknown> = {}, withImages = true) {
  const req = agent.post('/api/cards').field('data', JSON.stringify({ player: 'Test Player', year: '1990-91', ...data }));
  if (withImages) {
    req.attach('front', await makeJpeg('#aa3333'), 'front.jpg').attach('back', await makeJpeg('#33aa33'), 'back.jpg');
  }
  const res = await req.expect(201);
  return res.body;
}

async function platformId(agent: request.Agent, name: string): Promise<number> {
  const res = await agent.get('/api/platforms').expect(200);
  const p = res.body.find((x: { name: string }) => x.name === name);
  if (!p) throw new Error(`no platform ${name}`);
  return p.id;
}

describe('auth', () => {
  it('protects the admin API and accepts the right password only', async () => {
    t = makeTestApp();
    await request(t.app).get('/api/cards').expect(401);
    await request(t.app).post('/api/auth/login').send({ password: 'nope' }).expect(401);
    const session = await request(t.app).get('/api/auth/session').expect(200);
    expect(session.body).toEqual({ authenticated: false, password_configured: true });
    const agent = request.agent(t.app);
    await agent.post('/api/auth/login').send({ password: PASSWORD }).expect(200);
    await agent.get('/api/cards').expect(200);
    await agent.post('/api/auth/logout').expect(200);
    await agent.get('/api/cards').expect(401);
  });

  it('health check and public endpoints need no login', async () => {
    t = makeTestApp();
    await request(t.app).get('/api/health').expect(200);
    await request(t.app).get('/api/public/store').expect(200);
    await request(t.app).get('/api/public/cards').expect(200);
  });
});

describe('cards', () => {
  it('creates a card with photos, a SKU and thumbnails on disk', async () => {
    const { agent } = await setup();
    const card = await createCard(agent);
    expect(card.sku).toBe('MC-00001');
    expect(card.status).toBe('draft');
    expect(card.images).toHaveLength(2);
    expect(card.front_image.urls.sm).toMatch(/^\/media\/[a-f0-9]{2}\/[a-f0-9]{32}_sm\.jpg$/);
    const img = await agent.get(card.front_image.urls.md).expect(200);
    expect(img.headers['content-type']).toContain('image/jpeg');
    expect(card.activity[0].message).toContain('added');
  });

  it('points out likely duplicates', async () => {
    const { agent } = await setup();
    const fields = { player: 'Connor McDavid', year: '2015-16', set_name: 'Upper Deck Series 1', card_number: '201' };
    const a = await createCard(agent, fields, false);
    const b = await createCard(agent, { ...fields, player: 'connor mcdavid' }, false);
    await createCard(agent, { ...fields, parallel: 'Exclusives' }, false);
    const detail = (await agent.get(`/api/cards/${b.id}`).expect(200)).body;
    expect(detail.possible_duplicates.map((d: { id: number }) => d.id)).toEqual([a.id]);
  });

  it('rejects files that are not images', async () => {
    const { agent } = await setup();
    const res = await agent
      .post('/api/cards')
      .attach('front', Buffer.from('definitely not a jpeg'), 'x.jpg')
      .expect(400);
    expect(res.body.error).toMatch(/Could not read that photo/);
    const list = await agent.get('/api/cards').expect(200);
    expect(list.body.total).toBe(0);
  });

  it('searches with shorthand and filters', async () => {
    const { agent } = await setup();
    await createCard(agent, { player: 'Wayne Gretzky', year: '1979-80', brand: 'O-Pee-Chee', card_number: '18', is_rookie: true, location_binder: 'Binder 1' }, false);
    await createCard(agent, { player: 'Mario Lemieux', year: '1985-86', brand: 'Topps', category: 'Hockey' }, false);
    await createCard(agent, { player: 'Ken Griffey Jr.', year: '1989', brand: 'Upper Deck', category: 'Baseball' }, false);

    const q = async (qs: string) => (await agent.get(`/api/cards?${qs}`).expect(200)).body;
    expect((await q('q=gretzky opc rc')).total).toBe(1);
    expect((await q('q=ud griffey')).total).toBe(1);
    expect((await q('category=Hockey')).total).toBe(2);
    expect((await q('binder=binder 1')).total).toBe(1);
    expect((await q('q=nobody')).total).toBe(0);
    const facets = (await agent.get('/api/cards/facets').expect(200)).body;
    expect(facets.binders).toEqual([{ name: 'Binder 1', count: 1 }]);
  });

  it('updates fields, validates input and refuses manual "sold"', async () => {
    const { agent } = await setup();
    const card = await createCard(agent, {}, false);
    const res = await agent
      .patch(`/api/cards/${card.id}`)
      .send({ status: 'in_stock', asking_price_cents: 2500, location_binder: 'Blue binder' })
      .expect(200);
    expect(res.body.status).toBe('in_stock');
    expect(res.body.asking_price_cents).toBe(2500);
    await agent.patch(`/api/cards/${card.id}`).send({ status: 'sold' }).expect(400);
    await agent.patch(`/api/cards/${card.id}`).send({ asking_price_cents: -5 }).expect(400);
    await agent.patch(`/api/cards/${card.id}`).send({ not_a_field: 1 }).expect(400);
  });

  it('swaps and rotates photos', async () => {
    const { agent } = await setup();
    const card = await createCard(agent);
    const frontId = card.front_image.id;
    const swapped = (await agent.post(`/api/cards/${card.id}/images/swap`).expect(200)).body;
    expect(swapped.back_image.id).toBe(frontId);
    const rotated = (await agent.post(`/api/cards/${card.id}/images/${frontId}/rotate`).send({ degrees: 90 }).expect(200)).body;
    const img = rotated.images.find((i: { id: number }) => i.id === frontId);
    expect(img.width).toBe(840);
    expect(img.height).toBe(600);
  });
});

describe('listings, sales and status', () => {
  it('tracks where a card is posted, and flags other listings when it sells', async () => {
    const { agent } = await setup();
    const card = await createCard(agent, { asking_price_cents: 5000, status: 'in_stock', cost_cents: 1000 }, false);
    const ebay = await platformId(agent, 'eBay');
    const kijiji = await platformId(agent, 'Kijiji');

    let detail = (await agent.post(`/api/cards/${card.id}/listings`).send({ platform_id: ebay, url: 'ebay.ca/itm/123' }).expect(201)).body;
    expect(detail.status).toBe('listed');
    expect(detail.listings[0].price_cents).toBe(5000);
    expect(detail.listings[0].url).toBe('https://ebay.ca/itm/123');
    detail = (await agent.post(`/api/cards/${card.id}/listings`).send({ platform_id: kijiji, price_cents: 4500 }).expect(201)).body;
    expect(detail.listed_platform_ids.sort()).toEqual([ebay, kijiji].sort());

    await agent.post(`/api/cards/${card.id}/listings`).send({ platform_id: ebay, url: 'javascript:alert(1)' }).expect(400);

    const sold = (
      await agent
        .post(`/api/cards/${card.id}/sales`)
        .send({ platform_id: kijiji, sale_price_cents: 4500, buyer_name: 'Sam' })
        .expect(201)
    ).body;
    expect(sold.card.status).toBe('sold');
    expect(sold.sale.fees_cents).toBe(0);
    expect(sold.sale.cost_basis_cents).toBe(1000);
    expect(sold.sale.net_cents).toBe(3500);
    expect(sold.still_listed).toHaveLength(1);
    expect(sold.still_listed[0].platform_id).toBe(ebay);
    const kijijiListing = sold.card.listings.find((l: { platform_id: number }) => l.platform_id === kijiji);
    expect(kijijiListing.status).toBe('sold');

    const dash = (await agent.get('/api/dashboard').expect(200)).body;
    expect(dash.attention.sold_still_listed).toHaveLength(1);

    await agent.post('/api/listings/end').send({ ids: [sold.still_listed[0].id] }).expect(200);
    const after = (await agent.get('/api/dashboard').expect(200)).body;
    expect(after.attention.sold_still_listed).toHaveLength(0);

    // can't sell twice, can't delete a card with sales
    await agent.post(`/api/cards/${card.id}/sales`).send({ sale_price_cents: 100 }).expect(400);
    await agent.delete(`/api/cards/${card.id}`).expect(409);

    // deleting the sale puts the card back
    await agent.delete(`/api/sales/${sold.sale.id}`).expect(204);
    const back = (await agent.get(`/api/cards/${card.id}`).expect(200)).body;
    expect(back.status).toBe('in_stock');
    expect(back.quantity_sold).toBe(0);
  });

  it('estimates eBay fees and handles quantities', async () => {
    const { agent } = await setup();
    const card = await createCard(agent, { quantity: 3, status: 'in_stock', cost_cents: 200 }, false);
    const ebay = await platformId(agent, 'eBay');
    const first = (
      await agent
        .post(`/api/cards/${card.id}/sales`)
        .send({ platform_id: ebay, quantity: 2, sale_price_cents: 2000, shipping_charged_cents: 300 })
        .expect(201)
    ).body;
    expect(first.sale.fees_cents).toBe(Math.round(2300 * 0.1325) + 40);
    expect(first.sale.cost_basis_cents).toBe(400);
    expect(first.card.status).toBe('in_stock');
    expect(first.card.quantity_sold).toBe(2);
    await agent.post(`/api/cards/${card.id}/sales`).send({ quantity: 2, sale_price_cents: 100 }).expect(400);
    const second = (await agent.post(`/api/cards/${card.id}/sales`).send({ sale_price_cents: 900 }).expect(201)).body;
    expect(second.card.status).toBe('sold');
  });

  it('keeps manual statuses like keeper and pending', async () => {
    const { agent } = await setup();
    const card = await createCard(agent, { status: 'in_stock' }, false);
    const ebay = await platformId(agent, 'eBay');
    await agent.patch(`/api/cards/${card.id}`).send({ status: 'pending' }).expect(200);
    const listed = (await agent.post(`/api/cards/${card.id}/listings`).send({ platform_id: ebay }).expect(201)).body;
    expect(listed.status).toBe('pending');
  });
});

describe('inquiries', () => {
  it('records inquiries and lists follow-ups', async () => {
    const { agent } = await setup();
    const card = await createCard(agent, { status: 'in_stock' }, false);
    const fb = await platformId(agent, 'Facebook Marketplace');
    const detail = (
      await agent
        .post(`/api/cards/${card.id}/inquiries`)
        .send({ platform_id: fb, name: 'Jo', contact: 'jo@example.com', offer_cents: 3000, follow_up_on: '2020-01-01' })
        .expect(201)
    ).body;
    expect(detail.inquiries).toHaveLength(1);
    expect(detail.open_inquiry_count).toBe(1);
    const due = (await agent.get('/api/inquiries?due=1').expect(200)).body;
    expect(due.total).toBe(1);
    expect(due.inquiries[0].card.sku).toBe(card.sku);
    await agent.patch(`/api/inquiries/${detail.inquiries[0].id}`).send({ status: 'declined' }).expect(200);
    const open = (await agent.get('/api/inquiries').expect(200)).body;
    expect(open.total).toBe(0);
  });
});

describe('storefront', () => {
  it('only shows public cards and never leaks private fields', async () => {
    const { agent, app } = await setup();
    const card = await createCard(
      agent,
      {
        status: 'in_stock',
        is_public: true,
        asking_price_cents: 1500,
        cost_cents: 111,
        notes: 'SECRET NOTE',
        location_binder: 'SECRET BINDER',
        floor_price_cents: 999,
      },
      true,
    );
    await createCard(agent, { status: 'in_stock', is_public: false, player: 'Hidden Guy' }, false);
    await createCard(agent, { status: 'draft', is_public: true, player: 'Draft Guy' }, false);

    const list = (await request(app.app).get('/api/public/cards').expect(200)).body;
    expect(list.total).toBe(1);
    const raw = JSON.stringify(list);
    for (const secret of ['SECRET NOTE', 'SECRET BINDER', '"cost_cents"', 'floor_price', '"id"']) {
      expect(raw).not.toContain(secret);
    }
    expect(list.cards[0].price_cents).toBe(1500);
    expect(list.cards[0].images).toHaveLength(2);

    const one = (await request(app.app).get(`/api/public/cards/${card.sku}`).expect(200)).body;
    expect(one.player).toBe('Test Player');

    await request(app.app)
      .post(`/api/public/cards/${card.sku}/inquiries`)
      .send({ name: 'Buyer', contact: 'buyer@example.com', message: 'Still available?', offer: 12 })
      .expect(201);
    const inquiries = (await agent.get('/api/inquiries').expect(200)).body;
    expect(inquiries.total).toBe(1);
    expect(inquiries.inquiries[0].source).toBe('storefront');
    expect(inquiries.inquiries[0].offer_cents).toBe(1200);

    // honeypot submissions are accepted but dropped
    await request(app.app)
      .post(`/api/public/cards/${card.sku}/inquiries`)
      .send({ name: 'Bot', contact: 'bot@example.com', website: 'http://spam' })
      .expect(201);
    expect((await agent.get('/api/inquiries').expect(200)).body.total).toBe(1);

    await agent.patch('/api/settings').send({ storefront_show_prices: false }).expect(200);
    expect((await request(app.app).get(`/api/public/cards/${card.sku}`).expect(200)).body.price_cents).toBeNull();
    await agent.patch('/api/settings').send({ storefront_enabled: false }).expect(200);
    await request(app.app).get('/api/public/cards').expect(404);
  });
});

describe('purchases', () => {
  it('allocates a lot cost across its cards', async () => {
    const { agent } = await setup();
    const a = await createCard(agent, {}, false);
    const b = await createCard(agent, {}, false);
    const c = await createCard(agent, { quantity: 2 }, false);
    const purchase = (await agent.post('/api/purchases').send({ total_cost_cents: 10000, source: 'Garage sale', purchased_on: '2025-05-01' }).expect(201)).body;
    await agent.post(`/api/purchases/${purchase.id}/cards`).send({ card_ids: [a.id, b.id, c.id] }).expect(200);
    const preview = (await agent.post(`/api/purchases/${purchase.id}/allocate`).send({ method: 'even' }).expect(200)).body;
    expect(preview.allocations).toEqual([
      { card_id: a.id, cost_cents: 2500 },
      { card_id: b.id, cost_cents: 2500 },
      { card_id: c.id, cost_cents: 2500 },
    ]);
    await agent.post(`/api/purchases/${purchase.id}/allocate`).send({ method: 'even', apply: true }).expect(200);
    const after = (await agent.get(`/api/purchases/${purchase.id}`).expect(200)).body;
    expect(after.card_count).toBe(3);
    expect(after.allocated_cents).toBe(10000);
    const cardB = (await agent.get(`/api/cards/${b.id}`).expect(200)).body;
    expect(cardB.cost_cents).toBe(2500);
    expect(cardB.acquired_from).toBe('Garage sale');
    expect(cardB.acquired_date).toBe('2025-05-01');
  });
});

describe('analytics and exports', () => {
  it('computes profit and loss', async () => {
    const { agent } = await setup();
    const ebay = await platformId(agent, 'eBay');
    const c1 = await createCard(agent, { status: 'in_stock', cost_cents: 500 }, false);
    const c2 = await createCard(agent, { status: 'in_stock', cost_cents: 1000 }, false);
    await agent
      .post(`/api/cards/${c1.id}/sales`)
      .send({ platform_id: ebay, sale_price_cents: 10000, shipping_charged_cents: 500, shipping_cost_cents: 300, fees_cents: 1400, sold_on: '2025-03-05' })
      .expect(201);
    await agent
      .post(`/api/cards/${c2.id}/sales`)
      .send({ sale_price_cents: 2000, sold_on: '2025-04-10', fees_cents: 0 })
      .expect(201);
    const report = (await agent.get('/api/reports/pnl?from=2025-01-01&to=2025-06-30&group=month').expect(200)).body;
    expect(report.rows.map((r: { period: string }) => r.period)).toEqual(['2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06']);
    expect(report.totals.gross_cents).toBe(12500);
    expect(report.totals.net_cents).toBe(10000 + 500 - 300 - 1400 - 500 + 2000 - 1000);
    const march = report.rows.find((r: { period: string }) => r.period === '2025-03');
    expect(march.fees_cents).toBe(1400);
    const ebayStats = report.by_platform.find((p: { name: string }) => p.name === 'eBay');
    expect(ebayStats.sales).toBe(1);
    const other = report.by_platform.find((p: { platform_id: number | null }) => p.platform_id === null);
    expect(other.sales).toBe(1);

    const dash = (await agent.get('/api/dashboard?from=2025-01-01&to=2025-06-30').expect(200)).body;
    expect(dash.overview.sales.count).toBe(2);
    expect(dash.overview.sales.margin_pct).toBeCloseTo((9300 / 12500) * 100, 0);
    expect(dash.timeseries).toHaveLength(6);

    const csv = await agent.get('/api/export/sales.csv').expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain('Net profit');
    const backup = await agent.get('/api/export/backup.sqlite').buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    expect((backup.body as Buffer).subarray(0, 15).toString()).toBe('SQLite format 3');
  });
});

describe('AI jobs', () => {
  function fakeClient() {
    const calls = { parse: 0, create: 0 };
    const client = {
      beta: {
        messages: {
          parse: async () => {
            calls.parse++;
            return {
              model: 'claude-opus-5',
              stop_reason: 'end_turn',
              content: [],
              usage: { input_tokens: 5000, output_tokens: 800, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
              parsed_output: {
                is_trading_card: true,
                category: 'Hockey',
                player: 'Connor McDavid',
                team: 'Edmonton Oilers',
                year: '2015-16',
                brand: 'Upper Deck',
                set_name: 'Upper Deck Series 1',
                subset: 'Young Guns',
                card_number: '#201',
                parallel: '',
                serial_number: '',
                is_rookie: true,
                is_autograph: false,
                is_memorabilia: false,
                is_graded: false,
                grading_company: '',
                grade: '',
                cert_number: '',
                condition: 'Near Mint',
                condition_notes: 'Slightly off-centre left to right.',
                title: '2015-16 Upper Deck Young Guns Connor McDavid #201 RC',
                description: 'Rookie card of Connor McDavid.',
                search_query: '2015-16 Upper Deck Young Guns McDavid 201',
                notable: 'Key modern rookie card',
                uncertainties: '',
                confidence: 'high',
              },
            };
          },
          create: async () => {
            calls.create++;
            if (calls.create === 1) {
              return {
                model: 'claude-opus-5',
                stop_reason: 'pause_turn',
                usage: { input_tokens: 3000, output_tokens: 200, server_tool_use: { web_search_requests: 2 } },
                content: [
                  { type: 'server_tool_use', id: 'srv_1', name: 'web_search', input: { query: 'mcdavid young guns sold' } },
                  {
                    type: 'web_search_tool_result',
                    tool_use_id: 'srv_1',
                    content: [
                      { type: 'web_search_result', url: 'https://www.ebay.com/itm/1', title: 'McDavid YG sold', page_age: null, encrypted_content: 'x' },
                    ],
                  },
                ],
              };
            }
            return {
              model: 'claude-opus-5',
              stop_reason: 'tool_use',
              usage: { input_tokens: 6000, output_tokens: 900, server_tool_use: { web_search_requests: 1 } },
              content: [
                {
                  type: 'tool_use',
                  id: 'toolu_1',
                  name: 'report_market_value',
                  input: {
                    found_data: true,
                    currency: 'CAD',
                    low: 250,
                    typical: 320,
                    high: 400,
                    suggested_list_price: 349.99,
                    quick_sale_price: 275,
                    confidence: 'medium',
                    summary: 'Raw copies sell for about US$230.',
                    advice: 'Consider grading.',
                    comps: [
                      { title: 'McDavid YG raw', price: 230, currency: 'USD', date: '2025-08-01', venue: 'eBay', url: 'https://www.ebay.com/itm/1', grade: 'Raw', sold: true },
                      { title: 'bad url', price: 1, currency: 'usd', date: '', venue: 'x', url: 'javascript:alert(1)', grade: '', sold: false },
                    ],
                  },
                },
              ],
            };
          },
        },
      },
    };
    return { client: client as unknown as AiClient, calls };
  }

  it('identifies a card from photos, then researches its value', async () => {
    const { client, calls } = fakeClient();
    const { agent, app } = await setup(client);
    const res = await agent
      .post('/api/cards')
      .field('data', JSON.stringify({}))
      .field('identify', '1')
      .attach('front', await makeJpeg(), 'f.jpg')
      .attach('back', await makeJpeg('#222222'), 'b.jpg')
      .expect(201);
    await app.ctx.jobs.whenIdle();
    expect(calls.parse).toBe(1);
    expect(calls.create).toBe(2);
    const card = (await agent.get(`/api/cards/${res.body.id}`).expect(200)).body;
    expect(card.player).toBe('Connor McDavid');
    expect(card.card_number).toBe('201');
    expect(card.is_rookie).toBe(true);
    expect(card.ai_confidence).toBeCloseTo(0.9);
    expect(card.market_value_cents).toBe(32000);
    expect(card.asking_price_cents).toBe(34999);
    expect(card.floor_price_cents).toBe(27500);
    expect(card.price_checks[0].comps).toHaveLength(2);
    expect(card.price_checks[0].comps[1].url).toBe('');
    expect(card.price_checks[0].sources[0].url).toBe('https://www.ebay.com/itm/1');
    expect(card.jobs.every((j: { status: string }) => j.status === 'done')).toBe(true);
    const status = (await agent.get('/api/ai/status').expect(200)).body;
    expect(status.configured).toBe(true);
    expect(status.month_jobs).toBe(2);
    expect(status.month_cost_usd).toBeGreaterThan(0);
  });

  it('never overwrites what a person typed on a reviewed card', async () => {
    const { client } = fakeClient();
    const { agent, app } = await setup(client);
    const card = await createCard(agent, { status: 'in_stock', player: 'Typed By Hand' });
    await agent.post(`/api/cards/${card.id}/identify`).send({ then_price: false }).expect(202);
    await app.ctx.jobs.whenIdle();
    const after = (await agent.get(`/api/cards/${card.id}`).expect(200)).body;
    expect(after.player).toBe('Typed By Hand');
    expect(after.subset).toBe('Young Guns');
  });

  it('reports failures without crashing', async () => {
    const client = {
      beta: {
        messages: {
          parse: async () => {
            throw new Error('boom');
          },
          create: async () => {
            throw new Error('boom');
          },
        },
      },
    } as unknown as AiClient;
    const { agent, app } = await setup(client);
    const card = await createCard(agent);
    await agent.post(`/api/cards/${card.id}/identify`).send({}).expect(202);
    await app.ctx.jobs.whenIdle();
    const after = (await agent.get(`/api/cards/${card.id}`).expect(200)).body;
    expect(after.jobs[0].status).toBe('error');
    expect(after.jobs[0].error).toBe('boom');
  });

  it('explains when AI is not configured', async () => {
    const { agent } = await setup(null);
    const card = await createCard(agent);
    const res = await agent.post(`/api/cards/${card.id}/identify`).send({}).expect(400);
    expect(res.body.error).toMatch(/ANTHROPIC_API_KEY/);
  });
});
