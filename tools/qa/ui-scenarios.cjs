// Combat-board regression scenarios. Each one states its expectation up front, CHECKS ITS OWN
// PRECONDITIONS (a click that silently missed must not read as a pass) and drives only real
// clicks. Run against the build under test:  node tools/qa/ui-scenarios.cjs <baseUrl> <outDir>
const { chromium, devices } = require('playwright');
const BASE = process.argv[2] || 'http://localhost:5173/';
const OUT = process.argv[3] || require('os').tmpdir();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const rec = (id, title, pass, evidence) => { results.push({ id, title, pass, evidence }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${id.padEnd(8)} ${title}\n          ${evidence}`); };

async function boot(browser, view = 'desktop') {
  const opts = view === 'phone' ? { ...devices['iPhone SE'] } : view === 'iphone8' ? { ...devices['iPhone 8'] } : view === 'iphone13' ? { ...devices['iPhone 13'] } : view === 'pixel5' ? { ...devices['Pixel 5'] } : view === 'landscape' ? { ...devices['iPhone 13 landscape'] } : { viewport: { width: 1280, height: 860 } };
  const ctx = await browser.newContext(opts); const page = await ctx.newPage();
  await page.addInitScript(() => { localStorage.setItem('guided', '0'); localStorage.setItem('muted', '1'); localStorage.setItem('depth', '1'); });
  await page.goto(BASE, { waitUntil: 'networkidle' }); await page.waitForFunction(() => window.__game);
  await page.evaluate(() => window.__game.getState().startAI('emberwood', 'skyward')); await page.waitForSelector('.board'); await sleep(700);
  return { ctx, page };
}
async function setup(page, spec) {
  await page.evaluate((spec) => {
    const st = window.__game.getState(); const g = structuredClone(st.game); let n = 7000;
    const mk = (def, owner, over = {}) => ({ iid: 'z' + n++ + '_' + def, def, owner, tapped: false, summoningSick: false, damage: 0, buffP: 0, buffT: 0, blitz: false, ...over });
    const bf = (list, owner) => list.map((e) => (typeof e === 'string' ? mk(e, owner) : mk(e.def, owner, e)));
    g.players.A.battlefield = bf(spec.a, 'A'); g.players.B.battlefield = bf(spec.b, 'B');
    g.players.A.hand = bf(spec.hand || [], 'A'); g.players.B.hand = []; g.players.A.graveyard = []; g.players.B.graveyard = [];
    g.active = spec.active; g.phase = spec.phase; g.turn = 5; g.pending = null; g.winner = null; g.combat = null;
    if (spec.attackers) { const atk = g.players[spec.active].battlefield.filter((c) => spec.attackers.includes(c.def)); atk.forEach((c) => (c.tapped = true)); g.combat = { attackers: atk.map((c) => c.iid), blocks: {} }; }
    window.__game.setState({ game: g, error: null, charging: null });
  }, spec);
  await sleep(700);
}
const iid = (page, o, d) => page.evaluate(([o, d]) => window.__game.getState().game.players[o].battlefield.find((c) => c.def === d)?.iid, [o, d]);
const handIid = (page, d) => page.evaluate((d) => window.__game.getState().game.players.A.hand.find((c) => c.def === d)?.iid, d);
const err = (page) => page.evaluate(() => window.__game.getState().error);
const phase = (page) => page.evaluate(() => window.__game.getState().game.phase);
const banner = (page) => page.evaluate(() => document.querySelector('.announce')?.textContent || '');
const lbl = async (page) => { await sleep(750); return lbl0(page); };
const lbl0 = (page) => page.evaluate(() => ({ blocking: [...document.querySelectorAll('.player-zone.me .ready-box.block')].filter((e) => !e.classList.contains('pending')).length, pending: document.querySelectorAll('.player-zone.me .ready-box.pending').length, selected: document.querySelectorAll('.player-zone.me .card.selected').length }));
const click = async (page, sel, opt = {}) => { try { await page.locator(sel).first().click({ timeout: 4000, ...opt }); await sleep(260); return true; } catch (e) { return 'CLICK FAILED: ' + (String(e.message).split('\n').find((l) => /intercept/.test(l)) || 'timeout').trim(); } };
const E = (id) => `[data-iid="${id}"]`;
const ME = '.player-zone.me', OPP = '.player-zone.opp';

(async () => {
  const browser = await chromium.launch();

  // S1  single flying attacker, ground blocker: refused up front with a reason
  { const { ctx, page } = await boot(browser);
    await setup(page, { phase: 'combat_block', active: 'B', a: ['aether_well', 'aether_well', 'stoneback_cub'], b: ['sky_talon'], attackers: ['sky_talon'] });
    const cub = await iid(page, 'A', 'stoneback_cub'), talon = await iid(page, 'B', 'sky_talon');
    const c = await click(page, `${ME} ${E(cub)}`); const l1 = await lbl(page), b1 = await banner(page);
    const c2 = await click(page, `${OPP} ${E(talon)}`); const l2 = await lbl(page);
    await click(page, '.actions button:has-text("Confirm Blocks")');
    rec('S1', 'Ground creature vs a lone flyer is refused up front, with the reason', c === true && l1.selected === 0 && l1.pending === 0 && /can't block Sky Talon/.test(b1) && l2.blocking === 0 && !(await err(page)) && (await phase(page)) === 'end',
      `tap -> selected=${l1.selected} pending=${l1.pending}, banner "${b1}"; then tap flyer -> blocking=${l2.blocking}; Confirm -> error=${await err(page)}, phase ${await phase(page)}`);
    await ctx.close(); }

  // S1b flyer among several attackers: dimmed, refused, pending kept; a legal target still works
  { const { ctx, page } = await boot(browser);
    await setup(page, { phase: 'combat_block', active: 'B', a: ['aether_well', 'stoneback_cub'], b: ['sky_talon', 'dread_maw'], attackers: ['sky_talon', 'dread_maw'] });
    const cub = await iid(page, 'A', 'stoneback_cub'), talon = await iid(page, 'B', 'sky_talon'), maw = await iid(page, 'B', 'dread_maw');
    await click(page, `${ME} ${E(cub)}`);
    const dimmed = await page.evaluate(([t, m]) => ({ flyer: document.querySelector(`[data-iid="${t}"]`).classList.contains('dim'), ground: document.querySelector(`[data-iid="${m}"]`).classList.contains('dim') }), [talon, maw]);
    await click(page, `${OPP} ${E(talon)}`); const l1 = await lbl(page), b1 = await banner(page);
    await click(page, `${OPP} ${E(maw)}`); const l2 = await lbl(page);
    await click(page, '.actions button:has-text("Confirm Blocks")');
    rec('S1b', 'With several attackers the flyer is dimmed, refused, and a legal target still works', dimmed.flyer && !dimmed.ground && l1.pending === 1 && /only flyers/.test(b1) && l2.blocking === 1 && !(await err(page)),
      `dimmed flyer=${dimmed.flyer} ground=${dimmed.ground}; tap flyer -> pending=${l1.pending}, "${b1}"; tap maw -> blocking=${l2.blocking}; Confirm error=${await err(page)}`);
    await ctx.close(); }

  // S2  attacker removed after a block was planned
  { const { ctx, page } = await boot(browser);
    await setup(page, { phase: 'combat_block', active: 'B', a: ['aether_well', 'aether_well', 'stoneback_cub', 'granite_sentinel'], b: ['dread_maw', 'ember_sprite'], hand: ['take_counter'], attackers: ['dread_maw', 'ember_sprite'] });
    const cub = await iid(page, 'A', 'stoneback_cub'), maw = await iid(page, 'B', 'dread_maw'), tc = await handIid(page, 'take_counter');
    await click(page, `${ME} ${E(cub)}`); await click(page, `${OPP} ${E(maw)}`);
    const planned = await lbl(page);
    const k1 = await click(page, `.player-dock .hand ${E(tc)}`); const k2 = await click(page, `${OPP} ${E(maw)}`);
    await page.waitForFunction(() => !window.__game.getState().charging, null, { timeout: 6000 }); await sleep(500); // the instant now has a cast window
    const mawDead = await page.evaluate(() => !window.__game.getState().game.players.B.battlefield.some((c) => c.def === 'dread_maw'));
    const b1 = await banner(page); const after = await lbl(page);
    const attackersLeft = await page.evaluate(() => window.__game.getState().game.combat.attackers.length);
    const conf = await click(page, '.actions button:has-text("Confirm Blocks")'); await sleep(400);
    const pre = planned.blocking === 1 && k1 === true && k2 === true && mawDead;
    const resolved = await page.evaluate(() => !!window.__game.getState().game.lastCombat);
    rec('S2', 'A block planned against an attacker that then dies is dropped, and Confirm works', pre && after.blocking === 0 && /planned block was removed/.test(b1) && attackersLeft === 1 && conf === true && !(await err(page)) && resolved,
      `preconditions ${pre ? 'met' : 'NOT MET (' + [planned.blocking, k1, k2, mawDead] + ')'}; after the kill blocking=${after.blocking}, banner "${b1}", combat.attackers=${attackersLeft}; Confirm -> error=${await err(page)}, phase ${await phase(page)}`);
    await ctx.close(); }

  // S2c/S2d  pending can be cancelled; an assigned block can be removed on its own
  { const { ctx, page } = await boot(browser);
    await setup(page, { phase: 'combat_block', active: 'B', a: ['aether_well', 'stoneback_cub', 'granite_sentinel'], b: ['dread_maw', 'ember_sprite'], attackers: ['dread_maw', 'ember_sprite'] });
    const cub = await iid(page, 'A', 'stoneback_cub'), gs = await iid(page, 'A', 'granite_sentinel'), maw = await iid(page, 'B', 'dread_maw'), sp = await iid(page, 'B', 'ember_sprite');
    await click(page, `${ME} ${E(cub)}`); const p1 = await lbl(page);
    await click(page, `${ME} ${E(cub)}`); const p2 = await lbl(page);
    rec('S2c', 'Tapping a pending blocker again cancels it (as the hint promises)', p1.pending === 1 && p2.pending === 0 && p2.selected === 0, `first tap pending=${p1.pending}; second tap pending=${p2.pending} selected=${p2.selected}`);
    await click(page, `${ME} ${E(cub)}`); await click(page, `${OPP} ${E(maw)}`);
    await click(page, `${ME} ${E(gs)}`); await click(page, `${OPP} ${E(sp)}`);
    const both = await lbl(page);
    await click(page, `${ME} ${E(cub)}`); const one = await lbl(page);
    await click(page, '.actions button:has-text("Confirm Blocks")'); await sleep(400);
    const blocks = await page.evaluate(() => window.__game.getState().game.lastCombat?.blocks || {});
    rec('S2d', 'With several attackers one block can be removed without clearing the rest', both.blocking === 2 && one.blocking === 1 && Object.keys(blocks).length === 1 && Object.keys(blocks)[0] === gs && !(await err(page)),
      `two blocks -> ${both.blocking}; tap one -> ${one.blocking} remain; resolved blocks=${JSON.stringify(Object.values(blocks).length)} (the Sentinel's), error=${await err(page)}`);
    await ctx.close(); }

  // S11 one blocker per attacker
  { const { ctx, page } = await boot(browser);
    await setup(page, { phase: 'combat_block', active: 'B', a: ['aether_well', 'stoneback_cub', 'granite_sentinel'], b: ['dread_maw', 'ember_sprite'], attackers: ['dread_maw', 'ember_sprite'] });
    const cub = await iid(page, 'A', 'stoneback_cub'), gs = await iid(page, 'A', 'granite_sentinel'), maw = await iid(page, 'B', 'dread_maw');
    await click(page, `${ME} ${E(cub)}`); await click(page, `${OPP} ${E(maw)}`);
    await click(page, `${ME} ${E(gs)}`); await click(page, `${OPP} ${E(maw)}`); const l = await lbl(page), b1 = await banner(page);
    await click(page, '.actions button:has-text("Confirm Blocks")'); await sleep(300);
    rec('S11', 'A second blocker on the same attacker is refused (1:1), and Confirm still works', l.blocking === 1 && /already blocked/.test(b1) && !(await err(page)),
      `blocking=${l.blocking}, banner "${b1}", Confirm error=${await err(page)}`);
    await ctx.close(); }

  // S3 / S5 / S9 / S10 : behaviours that were already right must stay right
  { const { ctx, page } = await boot(browser);
    await setup(page, { phase: 'combat_attack', active: 'A', a: ['aether_well', 'stoneback_cub', 'swift_lancer'], b: ['granite_sentinel'] });
    const c1 = await iid(page, 'A', 'stoneback_cub'), c2 = await iid(page, 'A', 'swift_lancer');
    await click(page, `${ME} ${E(c1)}`); await click(page, `${ME} ${E(c2)}`);
    const two = await page.evaluate(() => document.querySelector('.actions button.primary')?.textContent);
    await click(page, `${ME} ${E(c1)}`);
    const one = await page.evaluate(() => document.querySelector('.actions button.primary')?.textContent);
    rec('S3', 'A selected attacker can be deselected', two === 'Attack (2)' && one === 'Attack (1)', `"${two}" -> "${one}"`);
    await setup(page, { phase: 'combat_block', active: 'B', a: ['aether_well', 'aether_well', 'stoneback_cub'], b: ['dread_maw'], hand: ['take_counter', 'cinderbolt'], attackers: ['dread_maw'] });
    const g1 = await page.evaluate(() => [...document.querySelectorAll('.player-dock .hand .card.green-glow')].map((e) => e.getAttribute('aria-label').split(' — ')[0]));
    rec('S5', 'Only castable instants glow in the block step', g1.length === 1 && g1[0] === 'Take Counter', `glowing=[${g1}]`);
    await setup(page, { phase: 'main1', active: 'A', a: ['aether_well', 'stoneback_cub', 'swift_lancer'], b: ['granite_sentinel'] });
    const bb = await page.locator('.actions button:has-text("Go to Combat")').first().boundingBox();
    await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); await sleep(70); await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); await sleep(500);
    rec('S9', 'Double-tapping "Go to Combat" does not skip the attack step', (await phase(page)) === 'combat_attack', `phase after: ${await phase(page)}`);
    await setup(page, { phase: 'main1', active: 'B', a: ['aether_well', 'stoneback_cub'], b: ['granite_sentinel'] });
    const r = await page.evaluate(() => { const s = window.__game.getState(); s.dispatch({ type: 'advance' }); const a = window.__game.getState(); return { phase: a.game.phase, error: a.error }; });
    rec('S10', "A human action during the AI's turn is dropped (mode ai)", r.phase === 'main1' && !r.error, `phase ${r.phase}, error ${r.error}`);
    await ctx.close(); }

  // S12 / S13  the hand and the Activity panel
  for (const n of [1, 3, 7, 9]) {
    const { ctx, page } = await boot(browser);
    await page.evaluate((n) => { const g = structuredClone(window.__game.getState().game); g.players.A.hand = Array.from({ length: n }, (_, i) => ({ iid: 'h' + i, def: ['take_counter', 'cinderbolt', 'soothe', 'stoneback_cub', 'ember_sprite', 'dread_maw', 'insight', 'aether_well', 'scorch'][i % 9], owner: 'A', tapped: false, summoningSick: false, damage: 0, buffP: 0, buffT: 0, blitz: false })); g.log = Array.from({ length: 60 }, (_, i) => 'entry ' + i); window.__game.setState({ game: g }); }, n);
    await sleep(900);
    const covered = await page.evaluate(() => [...document.querySelectorAll('.player-dock .hand .card[data-iid]')].filter((c) => { const b = c.getBoundingClientRect(); const t = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return !(t && t.closest('[data-iid]') === c); }).map((c) => c.getAttribute('aria-label').split(' — ')[0]));
    rec(`S12-${n}`, `Every card of a ${n}-card hand is clickable at its centre (1280x860, long log)`, covered.length === 0, covered.length ? `covered: ${covered}` : 'none covered');
    await ctx.close();
  }
  { const { ctx, page } = await boot(browser);
    await page.evaluate(() => { const g = structuredClone(window.__game.getState().game); let n = 9100; const mk = (d) => ({ iid: 'o' + n++, def: d, owner: 'B', tapped: false, summoningSick: false, damage: 0, buffP: 0, buffT: 0, blitz: false }); g.players.B.battlefield = Array.from({ length: 10 }, (_, i) => mk(['granite_sentinel', 'sky_talon', 'kunoichi', 'stoneback_cub'][i % 4])); g.log = Array.from({ length: 60 }, (_, i) => 'entry ' + i); window.__game.setState({ game: g }); });
    await sleep(900);
    const r = await page.evaluate(() => { const cards = [...document.querySelectorAll('.player-zone.opp .row.creatures .card[data-iid]')]; const bad = cards.filter((c) => { const b = c.getBoundingClientRect(); const t = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return !(t && t.closest('[data-iid]') === c); }).length; return { n: cards.length, bad, log: document.querySelector('.action-log').getBoundingClientRect().top }; });
    rec('S13', 'The relocated Activity panel does not cover the opponent\'s creatures (10 of them, 1280px)', r.bad === 0, `${r.bad}/${r.n} covered; panel top at ${Math.round(r.log)}px`);
    await ctx.close(); }

  // T  effective touch target = how far a tap still lands on the control (pseudo-elements and skew included)
  for (const view of ['phone', 'iphone8', 'iphone13', 'pixel5', 'landscape']) {
    const { ctx, page } = await boot(browser, view);
    await setup(page, { phase: 'combat_block', active: 'B', a: ['aether_well', 'aether_well', 'stoneback_cub', 'granite_sentinel'], b: ['dread_maw', 'ember_sprite', 'sky_talon'], hand: ['take_counter', 'cinderbolt', 'soothe', 'insight'], attackers: ['dread_maw', 'ember_sprite'] });
    // wait until the controls and the creature rows have stopped moving (springs, tilt, banners)
    { let last = '', stable = 0; for (let i = 0; i < 60 && stable < 6; i++) { const now = await page.evaluate(() => [...document.querySelectorAll('.actions button, .player-zone .row.creatures .card, .menu-btn, .zone-btn')].map((e) => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(Math.round).join(','); }).join('|')); stable = now === last ? stable + 1 : 0; last = now; await sleep(200); } }
    const rows = await page.evaluate(() => {
      const ext = (el) => { const r = el.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2; const hit = (x, y) => { if (y < 0 || y > innerHeight || x < 0 || x > innerWidth) return false; const t = document.elementFromPoint(x, y); return !!t && (t === el || el.contains(t)); };
        const run = (dx, dy) => { let k = 0; while (k < 80 && hit(cx + dx * (k + 1), cy + dy * (k + 1))) k++; return k; };
        return { w: run(1, 0) + run(-1, 0) + 1, h: run(0, 1) + run(0, -1) + 1, edge: r.top < 12 || r.bottom > innerHeight - 12 }; };
      const out = [];
      for (const [name, sel] of [['action button', '.actions button'], ['menu button', '.menu-btn'], ['zone button', '.zone-btn'], ['opp graveyard chip', '.player-zone.opp button.count-chip'], ['opp shield', '.player-zone.opp .shield-hit']]) {
        for (const el of document.querySelectorAll(sel)) { const e = ext(el); out.push({ name, w: e.w, h: e.h, edge: e.edge }); }
      }
      return out;
    });
    const legacy = view === 'phone'; // 320x568 (2016 iPhone SE): the layout physically lacks the room, so only the 24px floor is asserted
    const bar = (r) => (legacy ? 24 : r.name === 'opp graveyard chip' ? 32 : r.edge ? 24 : 44); // floor 24 (WCAG 2.2 AA); primary 44; edge-flush exempt from 44; info chip 32
    const small = rows.filter((r) => Math.min(r.w, r.h) < bar(r));
    rec(`T-${view}`, `Combat controls give a >=44px tap area; chip >=32px; edge-flush >=24px${view === 'phone' ? ' [320x568 legacy: floor 24px only]' : ''} (${view})`, small.length === 0, small.length ? 'under 44: ' + small.map((s) => `${s.name} ${s.w}x${s.h}`).join('; ') : rows.map((r) => `${r.name} ${r.w}x${r.h}${r.edge ? ' (edge)' : ''}`).filter((v, i, a) => a.indexOf(v) === i).join('; '));
    await page.screenshot({ path: `${OUT}/scn-tap-${view}.png` });
    await ctx.close();
  }

  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} scenarios pass`);
  require('fs').writeFileSync(`${OUT}/scenarios.json`, JSON.stringify(results, null, 1));
  await browser.close();
  process.exitCode = failed ? 1 : 0;
})();
