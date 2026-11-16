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

  // K1  reach: a reach creature can be tapped to block a flyer, and the engine accepts it
  { const { ctx, page } = await boot(browser);
    await setup(page, { phase: 'combat_block', active: 'B', a: ['aether_well', 'granite_sentinel'], b: ['sky_talon'], attackers: ['sky_talon'] });
    const sent = await iid(page, 'A', 'granite_sentinel');
    const c = await click(page, `${ME} ${E(sent)}`); const l1 = await lbl(page); const hint = await banner(page);
    const conf = await click(page, '.actions button:has-text("Confirm Blocks")'); await sleep(1600);
    const talonGone = await page.evaluate(() => !window.__game.getState().game.players.B.battlefield.some((c) => c.def === 'sky_talon'));
    rec('K1', 'A Reach creature can block a flyer through the UI', c === true && l1.blocking === 1 && !/can't block/.test(hint) && conf === true && talonGone && !(await err(page)),
      `tap -> blocking=${l1.blocking}, banner "${hint}"; Confirm -> flyer destroyed=${talonGone}, error=${await err(page)}`);
    await ctx.close(); }

  // K2  vigilance: a vigilant attacker attacks without tapping (the card stays upright)
  { const { ctx, page } = await boot(browser);
    await setup(page, { phase: 'combat_attack', active: 'A', a: ['aether_well', 'sky_talon'], b: [] });
    const talon = await iid(page, 'A', 'sky_talon');
    const k1 = await click(page, `${ME} ${E(talon)}`); const k2 = await click(page, '.actions button:has-text("Attack")'); await sleep(2400);
    const r = await page.evaluate((id) => { const g = window.__game.getState().game; const c = g.players.A.battlefield.find((x) => x.iid === id); const el = document.querySelector(`.player-zone.me [data-iid="${id}"]`); return { tapped: c?.tapped, domTapped: el?.classList.contains('tapped'), oppLife: g.players.B.life }; }, talon);
    rec('K2', 'A Vigilance attacker deals its damage and stays untapped', k1 === true && k2 === true && r.tapped === false && r.domTapped === false && r.oppLife === 18,
      `attack clicks ${k1}/${k2}; after combat tapped=${r.tapped} dom.tapped=${r.domTapped}; opponent life ${r.oppLife} (expect 18)`);
    await ctx.close(); }

  // K3  lifelink: the life gained in combat is shown (green +N at the avatar) and is real
  { const { ctx, page } = await boot(browser);
    await setup(page, { phase: 'combat_attack', active: 'A', a: ['aether_well', 'carrion_colossus'], b: [] });
    const col = await iid(page, 'A', 'carrion_colossus');
    await page.evaluate(() => { const st = window.__game.getState(); const g = structuredClone(st.game); g.players.A.life = 10; window.__game.setState({ game: g }); }); await sleep(300);
    const k1 = await click(page, `${ME} ${E(col)}`); const k2 = await click(page, '.actions button:has-text("Attack")');
    let floatText = null; for (let i = 0; i < 40 && !floatText; i++) { await sleep(100); floatText = await page.evaluate(() => [...document.querySelectorAll('.stat-float.up')].map((e) => e.textContent).find((t) => /^\+7$/.test(t.trim())) || null); }
    await sleep(800);
    const lives = await page.evaluate(() => ({ a: window.__game.getState().game.players.A.life, b: window.__game.getState().game.players.B.life }));
    rec('K3', 'Lifelink gains life in combat and shows a green +N float', k1 === true && k2 === true && lives.a === 17 && lives.b === 13 && floatText !== null,
      `clicks ${k1}/${k2}; life A ${lives.a} (expect 17), B ${lives.b} (expect 13); float "${floatText}"`);
    await ctx.close(); }

  // P1  a targeted enter effect (Whipflash) waits for a target, named after the creature's skill, then resolves
  { const { ctx, page } = await boot(browser);
    await setup(page, { phase: 'main1', active: 'A', a: ['aether_well', 'aether_well', 'aether_well'], b: ['stoneback_cub'], hand: ['thornwood_brute'] });
    const brute = await handIid(page, 'thornwood_brute'), cub = await iid(page, 'B', 'stoneback_cub');
    const k = await click(page, `.player-dock .hand ${E(brute)}`); await sleep(2000);
    const prompt = await page.evaluate(() => document.querySelector('.prompt')?.textContent || '');
    const pend = await page.evaluate(() => window.__game.getState().game.pending?.kind || null);
    const k2 = await click(page, `${OPP} ${E(cub)}`); await sleep(500);
    const after = await page.evaluate((id) => { const g = window.__game.getState().game; return { pending: g.pending, dmg: g.players.B.battlefield.find((c) => c.iid === id)?.damage, brute: g.players.A.battlefield.some((c) => c.def === 'thornwood_brute') }; }, cub);
    rec('P1', 'Thornwood Brute: cast, pick a target for Whipflash, damage lands', k === true && pend === 'enter' && /Whipflash/.test(prompt) && k2 === true && after.pending === null && after.dmg === 1 && after.brute,
      `cast ${k}; pending=${pend}, prompt "${prompt}"; target click ${k2}; after: pending=${after.pending}, damage on cub ${after.dmg}, brute on board ${after.brute}`);
    await ctx.close(); }

  // P2  flash: the defender casts a creature from hand in the block step and blocks with it at once
  { const { ctx, page } = await boot(browser);
    await setup(page, { phase: 'combat_block', active: 'B', a: ['aether_well', 'aether_well', 'aether_well'], b: ['dread_maw'], hand: ['bulwark'], attackers: ['dread_maw'] });
    const bul = await handIid(page, 'bulwark'), maw = await iid(page, 'B', 'dread_maw');
    const glow = await page.evaluate((id) => document.querySelector(`.player-dock .hand [data-iid="${id}"]`)?.classList.contains('green-glow'), bul);
    const hint = await page.evaluate(() => document.querySelector('.prompt-hint')?.textContent || '');
    const k = await click(page, `.player-dock .hand ${E(bul)}`); await sleep(700);
    const onBoard = await iid(page, 'A', 'bulwark');
    const k2 = onBoard ? await click(page, `${ME} ${E(onBoard)}`) : 'no bulwark on board'; await sleep(300);
    const l = await lbl(page);
    const conf = await click(page, '.actions button:has-text("Confirm Blocks")'); await sleep(1500);
    const r = await page.evaluate(() => { const g = window.__game.getState().game; return { life: g.players.A.life, bulwark: g.players.A.battlefield.some((c) => c.def === 'bulwark'), phase: g.phase }; });
    rec('P2', 'Flash: Bulwark is cast in the block step, blocks, and takes the hit', glow === true && /glowing card/.test(hint) && k === true && !!onBoard && k2 === true && l.blocking === 1 && conf === true && r.life === 20 && r.bulwark && r.phase !== 'combat_block',
      `hand glow=${glow}, hint "${hint}"; cast ${k}, on board ${!!onBoard}; tap ${k2}, blocking=${l.blocking}; confirm ${conf}; life ${r.life} (expect 20), bulwark alive ${r.bulwark}, phase ${r.phase}`);
    await ctx.close(); }

  // P3  prowess: casting a spell pumps the creature until end of turn (shown on the card)
  { const { ctx, page } = await boot(browser);
    await setup(page, { phase: 'main1', active: 'A', a: ['aether_well', 'aether_well', 'pyre_adept'], b: [], hand: ['insight'] });
    const adept = await iid(page, 'A', 'pyre_adept'), ins = await handIid(page, 'insight');
    const before = await page.evaluate((id) => { const c = window.__game.getState().game.players.A.battlefield.find((x) => x.iid === id); return [c.tempP ?? 0, c.tempT ?? 0]; }, adept);
    const k = await click(page, `.player-dock .hand ${E(ins)}`); await sleep(2200);
    const r = await page.evaluate((id) => { const c = window.__game.getState().game.players.A.battlefield.find((x) => x.iid === id); const el = document.querySelector(`.player-zone.me [data-iid="${id}"]`); return { temp: [c.tempP ?? 0, c.tempT ?? 0], crown: !!el?.closest('.stack')?.querySelector('.buff-crown') || !!el?.querySelector('.buff-crown') }; }, adept);
    rec('P3', 'Prowess: a cast spell gives Pyre Adept +1/+1 until end of turn, shown on the card', k === true && before.join() === '0,0' && r.temp.join() === '1,1' && r.crown,
      `before ${before}; cast ${k}; after temp ${r.temp}, buff mark on card ${r.crown}`);
    await ctx.close(); }

  // P4  last breath: a creature with a dies trigger floats up as it falls and its token appears
  { const { ctx, page } = await boot(browser);
    await setup(page, { phase: 'combat_block', active: 'B', a: ['aether_well', 'rotting_hulk'], b: ['dread_maw'], attackers: ['dread_maw'] });
    const hulk = await iid(page, 'A', 'rotting_hulk');
    await click(page, `${ME} ${E(hulk)}`); await sleep(300);
    const conf = await click(page, '.actions button:has-text("Confirm Blocks")');
    let spot = null; for (let i = 0; i < 30 && !spot; i++) { await sleep(100); spot = await page.evaluate(() => [...document.querySelectorAll('.cast-spot .cast-label')].map((e) => e.textContent).find((t) => /Last breath/.test(t)) || null); }
    await sleep(900);
    const r = await page.evaluate(() => { const g = window.__game.getState().game; return { hulk: g.players.A.battlefield.some((c) => c.def === 'rotting_hulk'), zombies: g.players.A.battlefield.filter((c) => c.def === 'zombie_token').length, gy: g.players.A.graveyard.map((c) => c.def) }; });
    rec('P4', 'Last breath: Rotting Hulk dies, its card floats up, a Zombie is raised', conf === true && spot !== null && !r.hulk && r.zombies === 1 && r.gy.includes('rotting_hulk') && !r.gy.includes('zombie_token'),
      `confirm ${conf}; spotlight "${spot}"; hulk alive ${r.hulk}, zombies ${r.zombies}, graveyard ${r.gy}`);
    await ctx.close(); }

  // U1-U3  board UX: phase banner (centred, right owner/colour), turn glow + cyan buttons, damage readout
  for (const view of ['desktop', 'phone', 'landscape']) {
    const { ctx, page } = await boot(browser, view);
    const bn = () => page.evaluate(() => { const b = document.querySelector('.phase-banner'); if (!b) return null; const r = b.getBoundingClientRect(); return { turn: b.querySelector('.pb-turn')?.textContent, phase: b.querySelector('.pb-phase')?.textContent, cls: b.className, dx: Math.abs(r.left + r.width / 2 - innerWidth / 2), dy: Math.abs(r.top + r.height / 2 - innerHeight / 2), fits: r.left >= 0 && r.right <= innerWidth, over: document.documentElement.scrollWidth > innerWidth + 1 }; });
    await setup(page, { phase: 'main1', active: 'A', a: ['aether_well', 'dread_maw', 'swift_lancer'], b: ['granite_sentinel'] }); await sleep(1800);
    await page.locator('.actions button', { hasText: 'Go to Combat' }).click(); await sleep(450);
    const mine = await bn();
    await sleep(1700); const gone = await bn();
    for (const id of await page.evaluate(() => [...document.querySelectorAll('.player-zone.me .row.creatures .card')].map((c) => c.dataset.iid))) await page.locator(`.player-zone.me [data-iid="${id}"]`).first().click({ position: { x: 10, y: 16 } }).catch(() => {});
    await sleep(400);
    const atkTally = await page.evaluate(() => document.querySelector('.tally')?.innerText.replace(/\s+/g, ' ').trim());
    const btn = await page.evaluate(() => getComputedStyle(document.querySelector('.actions button.primary')).backgroundColor);
    const glowMine = await page.evaluate(() => document.querySelector('.turn-glow')?.className);
    await setup(page, { phase: 'combat_block', active: 'B', a: ['aether_well', 'stoneback_cub', 'granite_sentinel'], b: ['dread_maw', 'swift_lancer'], attackers: ['dread_maw', 'swift_lancer'] }); await sleep(450);
    const theirs = await bn(); const glowTheirs = await page.evaluate(() => document.querySelector('.turn-glow')?.className);
    await sleep(1700);
    const sent = await iid(page, 'A', 'granite_sentinel'), maw = await iid(page, 'B', 'dread_maw');
    await click(page, `${ME} ${E(sent)}`); await click(page, `${OPP} ${E(maw)}`); await sleep(500);
    const blkTally = await page.evaluate(() => document.querySelector('.tally')?.innerText.replace(/\s+/g, ' ').trim());
    const centred = (b) => b && b.dx <= 2 && b.dy <= 2 && b.fits && !b.over;
    rec(`U1-${view}`, 'Phase banner: right owner, phase and colour, dead centre, gone after its time', !!mine && mine.turn === 'Your turn' && mine.phase === 'Attack phase' && /me/.test(mine.cls) && centred(mine) && gone === null && !!theirs && theirs.turn === "Enemy's turn" && theirs.phase === 'Block phase' && /foe/.test(theirs.cls) && centred(theirs),
      `mine ${JSON.stringify(mine)}; later ${JSON.stringify(gone)}; enemy ${JSON.stringify(theirs)}`);
    rec(`U2-${view}`, 'Board glows cyan on my turn, red on the enemy\'s; action buttons are cyan', /me/.test(glowMine || '') && /foe/.test(glowTheirs || '') && btn === 'rgb(34, 211, 238)', `glow ${glowMine} -> ${glowTheirs}; primary button ${btn}`);
    rec(`U3-${view}`, 'Damage readout: attack total, and incoming / blocked / you take once a block is planned', /7/.test(atkTally || '') && /13/.test(atkTally || '') && /7\D*5\D*2\D*20\D*18/.test(blkTally || ''), `attack "${atkTally}"; block "${blkTally}"`);
    await ctx.close();
  }

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
