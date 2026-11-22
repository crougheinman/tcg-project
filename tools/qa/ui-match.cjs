// Real-browser combat-board test. Plays full matches through the actual UI.
//   player A ("human")  : every decision comes from the shipped AI policy, but is EXECUTED by
//                         real clicks on the real board (hand cards, creatures, shields, buttons).
//   player B ("AI")     : the game's own scheduleAi.
// Every state transition is compared against an engine oracle (applyAction on the previous
// state), and a DOM auditor runs every 400ms checking the board/HUD against the state.
//
// usage: node tools/qa/ui-match.cjs --pairs a:b:idx,c:d:idx --out file.jsonl [--viewport desktop|phone] [--tag x]
//        (the idx is the seed index; see pairs.txt. Needs the dev server: npm run dev)
const { chromium, devices } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const PAIRS = arg('pairs', 'emberwood:skyward:0').split(',').map((p) => p.split(':'));
const OUT = arg('out', path.join(os.tmpdir(), 'ui-match.jsonl'));
const VIEW = arg('viewport', 'desktop');
const TAG = arg('tag', 'w');
const BASE = arg('base', 'http://localhost:5173/');
const SHOTS = arg('shots', os.tmpdir());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- in-page helpers (installed once per page) ----------
const INSTALL = async () => {
  const eng = await import('/src/engine/reducer.ts');
  const ai = await import('/src/ai/ai.ts');
  const rules = await import('/src/engine/rules.ts');
  const cards = await import('/src/cards/cards.ts');
  const store = window.__game;
  const TOKENS = new Set(['wolf_token', 'zombie_token']);
  const H = (window.__H = { trace: 0, expect: [], anomalies: {}, lastT: performance.now(), departed: {}, arrived: {}, seen: new Map(), humanTransitions: 0, aiTransitions: 0 });
  const note = (code, detail) => {
    const a = (H.anomalies[code] ||= { count: 0, first: detail, t: Math.round(performance.now()) });
    a.count++;
  };
  H.note = note;
  const diff = (x, y) => {
    const out = [];
    for (const pid of ['A', 'B']) {
      const p = x.players[pid], q = y.players[pid];
      if (p.life !== q.life) out.push(`${pid}.life ${p.life} vs ${q.life}`);
      for (const z of ['hand', 'library', 'battlefield', 'graveyard']) {
        const a = p[z].map((c) => c.iid + (c.tapped ? 'T' : '') + (c.damage ? 'd' + c.damage : '')).join();
        const b = q[z].map((c) => c.iid + (c.tapped ? 'T' : '') + (c.damage ? 'd' + c.damage : '')).join();
        if (a !== b) out.push(`${pid}.${z}`);
      }
    }
    if (x.phase !== y.phase) out.push(`phase ${x.phase} vs ${y.phase}`);
    if (x.active !== y.active) out.push(`active ${x.active} vs ${y.active}`);
    return out.slice(0, 5).join('; ') || 'log/other fields';
  };
  // ---- transition oracle ----
  let prev = store.getState().game;
  store.subscribe((s) => {
    const g = s.game;
    if (!g || g === prev) return;
    const before = prev; prev = g;
    H.trace++; H.lastT = performance.now();
    if (!before) return;
    // creature arrival / departure bookkeeping for the DOM auditor
    const ids = (st) => new Set([...st.players.A.battlefield, ...st.players.B.battlefield].filter(rules.isCreature).map((c) => c.iid));
    const b = ids(before), a = ids(g), now = performance.now();
    for (const i of b) if (!a.has(i)) H.departed[i] = now;
    for (const i of a) if (!b.has(i)) H.arrived[i] = now;
    if (before.seed !== g.seed) { H.expect = []; return; }
    const actorBefore = rules.actorOf(before);
    if (actorBefore === 'A') {
      H.humanTransitions++;
      const exp = H.expect.shift();
      if (!exp) { note('UNPLANNED_HUMAN_TRANSITION', `phase ${before.phase}: UI changed the game without the test asking (auto path?)`); return; }
      if (JSON.stringify(g) !== JSON.stringify(exp.state)) note('UI_ACTION_MISMATCH', `${exp.label} -> ${diff(g, exp.state)}`);
    } else H.aiTransitions++;
  });
  H.plan = () => {
    const g = store.getState().game;
    const action = ai.pickAction(g, 'A');
    return { action, phase: g.phase, turn: g.turn, pending: !!g.pending };
  };
  H.setExpect = (actions) => {
    let g = store.getState().game; H.expect = [];
    for (const a of actions) { g = eng.applyAction(g, a); H.expect.push({ label: a.type, state: g }); }
  };
  H.snap = () => {
    const s = store.getState(), g = s.game;
    return g ? { phase: g.phase, turn: g.turn, active: g.active, actor: rules.actorOf(g), winner: g.winner, pending: !!g.pending, charging: !!s.charging, error: s.error, expectLeft: H.expect.length, trace: H.trace, idle: performance.now() - H.lastT, lifeA: g.players.A.life, lifeB: g.players.B.life } : null;
  };
  // ---- DOM auditor with persistence thresholds (animations legitimately lag the state) ----
  const persistRaw = (key, bad, thr, detail) => {
    const now = performance.now();
    if (!bad) { H.seen.delete(key); return; }
    if (!H.seen.has(key)) H.seen.set(key, now);
    else if (now - H.seen.get(key) > thr && !H.anomalies[key]) note(key.split('|')[0], detail);
  };
  const num = (el) => { const m = el && /-?\d+/.exec(el.textContent.replace(/\s+/g, ' ')); return m ? +m[0] : NaN; };
  const q = (s) => document.querySelector(s);
  const qa = (s) => [...document.querySelectorAll(s)];
  H.ticks = 0;
  setInterval(() => { try { H.ticks++; audit(); } catch (e) { note('AUDIT_ERROR', String(e && e.message)); } }, 400);
  function audit() {
    const s = store.getState(), g = s.game;
    if (!g) return;
    const now = performance.now();
    // While a phase banner is pending or showing, the board DELIBERATELY draws the state from before the phase change
    // and locks its cards (Board.tsx `hold` / `cardsLocked`), for a banner (3 s) plus a gap: longer than the persistence
    // thresholds below. A mismatch between the DOM and the live state is expected then, so those checks only count when
    // the board is not held; a hold that never releases is caught separately (LOCK_STUCK).
    const held = !!(q('.board.cards-locked') || q('.phase-banner'));
    const persist = (key, bad, thr, detail) => persistRaw(key, bad && !held, thr, detail);
    for (const [side, pid] of [['me', 'A'], ['opp', 'B']]) {
      const P = g.players[pid];
      const dom = new Set(qa(`.player-zone.${side} .row.creatures [data-iid]`).map((e) => e.dataset.iid));
      const st = new Set(P.battlefield.filter(rules.isCreature).map((c) => c.iid));
      for (const id of dom) if (!st.has(id)) persist(`GHOST_CARD|${id}`, now - (H.departed[id] || 0) > 3200, 600, `${side}: card ${id} still on the board after it left the game state`);
      for (const id of st) persist(`MISSING_CARD|${id}`, !dom.has(id) && now - (H.arrived[id] || 0) > 1500, 800, `${side}: creature ${id} in state but not on the board`);
      const tappedDom = new Set(qa(`.player-zone.${side} .row.creatures .card.tapped`).map((e) => e.dataset.iid));
      for (const c of P.battlefield.filter(rules.isCreature)) persist(`TAPPED_DESYNC|${c.iid}`, dom.has(c.iid) && tappedDom.has(c.iid) !== c.tapped, 1400, `${side}: ${c.def} tapped=${c.tapped} but DOM says ${tappedDom.has(c.iid)}`);
      // HUD
      persist(`HUD_LIFE|${pid}`, num(q(`.player-zone.${side} .playerbar .life`)) !== P.life, 1800, `${side}: HUD life ${num(q(`.player-zone.${side} .playerbar .life`))} vs state ${P.life}`);
      const lands = P.battlefield.filter(rules.isLand), avail = lands.filter((c) => !c.tapped).length;
      const pips = qa(`.player-zone.${side} .playerbar .pip`);
      if (lands.length <= 10 && pips.length) persist(`HUD_MANA|${pid}`, qa(`.player-zone.${side} .playerbar .pip.full`).length !== avail || pips.length !== lands.length, 1800, `${side}: pips ${qa(`.player-zone.${side} .playerbar .pip.full`).length}/${pips.length} vs mana ${avail}/${lands.length}`);
      persist(`ACTING_RING|${pid}`, !!q(`.player-zone.${side} .playerbar.acting`) !== (!g.winner && rules.actorOf(g) === pid), 1500, `${side}: acting ring ${!!q(`.player-zone.${side} .playerbar.acting`)} but actor is ${rules.actorOf(g)}`);
    }
    const chips = qa('.player-zone.opp .counts .count-chip').map(num);
    if (chips.length === 3) persist('HUD_OPP_COUNTS|', chips[0] !== g.players.B.hand.length || chips[1] !== g.players.B.library.length || chips[2] !== g.players.B.graveyard.length, 1800, `opp chips ${chips} vs state ${g.players.B.hand.length},${g.players.B.library.length},${g.players.B.graveyard.length}`);
    const zb = [num(q('.zone-btn.left')), num(q('.zone-btn.right'))];
    persist('HUD_MY_ZONES|', zb[0] !== g.players.A.graveyard.length || zb[1] !== g.players.A.library.length, 1800, `my zone buttons ${zb} vs state ${g.players.A.graveyard.length},${g.players.A.library.length}`);
    const step = { main1: 'Main', combat_attack: 'Combat', combat_block: 'Combat', end: 'End' }[g.phase];
    persist('PHASEBAR|', (q('.pstep.on') || {}).textContent !== step, 1200, `phase bar shows ${(q('.pstep.on') || {}).textContent}, state ${g.phase}`);
    persist('PHASEBAR_OWNER|', !!q('.phasebar.you') !== (g.active === 'A'), 1200, `phase bar owner tint wrong for active=${g.active}`);
    // transient UI that must not linger
    const liveIds = new Set([...g.players.A.battlefield, ...g.players.B.battlefield].map((c) => c.iid));
    const myCombatInput = !g.winner && rules.actorOf(g) === 'A' && (g.phase === 'combat_attack' || g.phase === 'combat_block' || g.pending || s.charging);
    const liveSel = qa('.card.selected').filter((e) => liveIds.has(e.dataset.iid)).length;
    persist('STALE_SELECTION|', liveSel > 0 && !myCombatInput && !qa('.prompt').some((e) => /target/i.test(e.textContent)), 1800, `${liveSel} live card(s) still show selected in phase ${g.phase} (actor ${rules.actorOf(g)})`);
    // a card fading out after death keeps its frozen last render (incl. its tag) for 1.8s: not a live tag
    const atkTags = qa('.combat-tag.atk').filter((t) => liveIds.has(t.closest('.stack')?.querySelector('[data-iid]')?.dataset.iid)).length, wantTags = g.phase === 'combat_block' ? (g.combat?.attackers.length || 0) : 0;
    persist('ATK_TAGS|', atkTags !== wantTags, 1500, `${atkTags} ATK tags shown, expected ${wantTags} in ${g.phase}`);
    // how long has the board been continuously held? (the longest stretch is reported with the result)
    if (held) { if (!H.heldSince) H.heldSince = now; H.maxHeld = Math.max(H.maxHeld || 0, now - H.heldSince); } else H.heldSince = 0;
    persistRaw('LOCK_STUCK|', held, 12000, `the board stayed locked / held for 12s: phase ${g.phase}, active ${g.active}, turn ${g.turn}, banner "${(q('.phase-banner .pb-phase') || {}).textContent || 'none'}", charging ${!!s.charging}`);
    persistRaw('PREVIEW_STUCK|', !!q('.preview-overlay'), 3500, 'card preview stayed open with the pointer away from every card');
    persistRaw('CHARGING_STUCK|', !!s.charging, 5200, `store.charging still set (${s.charging && s.charging.def})`);
    persistRaw('ERROR_TOAST|', !!q('.toast:not(.net-stale)'), 0, `error toast on screen: ${(q('.toast:not(.net-stale)') || {}).textContent}`);
    if (s.error) note('STORE_ERROR', s.error);
    persistRaw('FX_LEAK|', qa('[class*="fx-"]').length > 0 && now - H.lastT > 9000, 0, `${qa('[class*="fx-"]').length} fx node(s) alive 9s after the last state change`);
    { const de = document.documentElement; const over = de.scrollWidth > de.clientWidth + 1; let det = 'page scrolls horizontally'; if (over) { const cw = de.clientWidth; const chain = (e) => { const o = []; for (let n = e; n && n !== document.body && o.length < 5; n = n.parentElement) { const cs = getComputedStyle(n); o.push(`${n.tagName}.${String(n.className).slice(0, 24)}(${cs.position}${cs.transform !== 'none' ? ',T' : ''}${cs.overflowX !== 'visible' ? ',ox=' + cs.overflowX : ''})`); } return o.join('<'); }; const els = [...document.querySelectorAll('body *')].map((e) => ({ e, r: e.getBoundingClientRect() })).filter((x) => x.r.width > 0 && x.r.right > cw - 0.5).sort((x, y) => y.r.right - x.r.right).slice(0, 5); det += ` sw=${de.scrollWidth} bodysw=${document.body.scrollWidth} cw=${cw} iw=${innerWidth} vv=${visualViewport && visualViewport.width} :: ` + els.map((x) => `[${x.r.right.toFixed(1)}] ${chain(x.e)}`).join(' || '); } persist('H_SCROLL|', over, 500, det); }
  }
  return true;
};

// ---------- one match ----------
async function playMatch(browser, A, B, idx) {
  const seed = 1000 + idx * 31 + (VIEW === 'phone' ? 5 : 0);
  const ctxOpts = VIEW === 'phone' ? { ...devices['iPhone 13'] } : { viewport: { width: 1280, height: 860 } };
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const consoleErrs = new Map(), res = { match: `${A} v ${B}`, A, B, viewport: VIEW, seed };
  const addErr = (k) => consoleErrs.set(k, (consoleErrs.get(k) || 0) + 1);
  page.on('pageerror', (e) => addErr('pageerror: ' + e.message.slice(0, 160)));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') addErr(m.type() + ': ' + m.text().slice(0, 160)); });
  page.on('requestfailed', (r) => addErr('requestfailed: ' + r.url().slice(0, 100)));
  await page.addInitScript((sd) => {
    // seeded Math.random: same seed => same shuffle, so any finding is reproducible
    let a = sd >>> 0; Math.random = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    localStorage.setItem('guided', '0'); localStorage.setItem('muted', '1'); localStorage.setItem('depth', '1');
  }, seed);
  const t0 = Date.now();
  const stats = { human: {}, gestureFailures: [], fallbacks: 0, maxIdle: 0 };
  const bump = (k) => (stats.human[k] = (stats.human[k] || 0) + 1);
  try {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__game, null, { timeout: 15000 });
    await page.evaluate(([a, b]) => window.__game.getState().startAI(a, b), [A, B]);
    await page.waitForSelector('.board', { timeout: 15000 });
    await page.evaluate(INSTALL);
    await page.evaluate(() => window.__H.note);
    await sleep(800);
    if (process.env.CANARY) {
      // Sabotage the DOM behind React's back and require the auditor to notice each one.
      await page.evaluate(() => {
        const st = window.__game.getState(); const g = structuredClone(st.game); let n = 5000;
        const mk = (def, owner) => ({ iid: 'k' + n++, def, owner, tapped: false, summoningSick: false, damage: 0, buffP: 0, buffT: 0, blitz: false });
        g.players.A.battlefield = [mk('aether_well', 'A'), mk('stoneback_cub', 'A'), mk('swift_lancer', 'A')];
        g.players.B.battlefield = [mk('granite_sentinel', 'B')];
        window.__game.setState({ game: g });
      });
      await sleep(2800);
      await page.evaluate(() => {
        const mine = [...document.querySelectorAll('.player-zone.me .row.creatures .card[data-iid]')];
        mine[0].classList.add('tapped');                                                   // TAPPED_DESYNC
        mine[1].closest('.stack').remove();                                                // MISSING_CARD
        document.querySelector('.player-zone.me .playerbar .life').textContent = '♥ 99';   // HUD_LIFE
        document.querySelector('.player-zone.opp .counts .count-chip').lastChild.textContent = ' 77'; // HUD_OPP_COUNTS
        document.querySelector('.pstep.on').classList.remove('on');                        // PHASEBAR
        document.querySelector('.player-zone.me .row.creatures .card[data-iid]')?.classList.add('selected'); // STALE_SELECTION
        const d = document.createElement('div'); d.className = 'preview-overlay'; document.body.appendChild(d); // PREVIEW_STUCK
        const t = document.createElement('div'); t.className = 'toast'; t.textContent = 'x'; document.body.appendChild(t); // ERROR_TOAST
        const f = document.createElement('div'); f.className = 'fx-ember'; document.body.appendChild(f);    // FX_LEAK (needs 9s idle)
      });
      await sleep(11000);
      const got = await page.evaluate(() => Object.keys(window.__H.anomalies).sort());
      const want = ['ERROR_TOAST', 'FX_LEAK', 'HUD_LIFE', 'HUD_OPP_COUNTS', 'MISSING_CARD', 'PHASEBAR', 'PREVIEW_STUCK', 'STALE_SELECTION', 'TAPPED_DESYNC'];
      console.log('canary: caught', got.length, 'of', want.length, '->', want.filter((w) => !got.includes(w)).length ? 'MISSED: ' + want.filter((w) => !got.includes(w)).join(',') : 'every sabotage detected', '| audit errors:', got.includes('AUDIT_ERROR'));
      await browser.close(); process.exit(0);
    }

    const park = () => page.mouse.move(2, 2);
    const cardLoc = (iid, scope) => page.locator(`${scope} [data-iid="${iid}"]`).first();
    // A creature that can attack bobs forever (atkbob / atknudge) and the End Turn button pulses; Playwright will not click
    // an element that is "not stable". A person can click a moving card, so freeze the target's infinite animations just for
    // the click (actionability still checks it is visible and not covered) and let them run again afterwards.
    const freeze = (loc) => loc.evaluate((el) => {
      const host = el.closest('.stack') || el;
      const paused = [...host.getAnimations({ subtree: true }), ...el.getAnimations({ subtree: true })].filter((a) => a.effect && a.effect.getComputedTiming().iterations === Infinity && a.playState === 'running');
      paused.forEach((a) => a.pause());
      window.__H_paused = paused;
    }).catch(() => {});
    const thaw = (page_) => page_.evaluate(() => { (window.__H_paused || []).forEach((a) => { try { a.play(); } catch (e) { /* element is gone */ } }); window.__H_paused = []; }).catch(() => {});
    const clickEl = async (loc, what) => {
      try {
        // phone: cards fan over each other, so tap the visible left strip (like a thumb would)
        await freeze(loc);
        await loc.click({ timeout: 6000, ...(VIEW === 'phone' ? { position: { x: 10, y: 16 } } : {}) });
        await thaw(page);
        return true;
      } catch (e) {
        await thaw(page);
        const msg = String(e.message).split('\n').filter((l) => /intercepts|not visible|outside|timeout/i.test(l)).slice(0, 2).join(' | ');
        let diag = '';
        try {
          diag = await page.evaluate(() => {
            const st = window.__game.getState();
            const hand = [...document.querySelectorAll('.player-zone.me .hand .card')].map((c) => { const r = c.getBoundingClientRect(); const e = document.elementFromPoint(r.left + 10, r.top + 16); return `${st.game.players.A.hand.find((x) => x.iid === c.dataset.iid)?.def}[${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}w ${c.className.replace(/card |card-/g, '').slice(0, 40)}]->${e?.closest('.card')?.dataset.iid === c.dataset.iid ? 'ok' : 'COVERED:' + (e?.closest('.card')?.dataset.iid || e?.className || e?.tagName)}`; });
            return ` || DIAG phase=${st.game.phase} actor=${st.game.active} charging=${st.charging?.kind} spots=${st.spotlights.length} pending=${!!st.game.pending} stage=${document.querySelector('.cast-spot') ? 'spot-visible' : 'none'} hand=${hand.join(' ; ')}`;
          });
          await page.screenshot({ path: `${SHOTS}/gf-${A}-${B}-${Date.now()}.png` });
        } catch (e2) { diag = ' || DIAG failed ' + e2.message.slice(0, 80); }
        stats.gestureFailures.push(`${what}: ${msg.replace(/\u001b\[[0-9;]*m/g, "").slice(0, 400)}${diag}`);
        return false;
      }
    };
    const btn = (re) => page.locator('.actions button', { hasText: re }).first();
    const hasBtn = async (re) => (await btn(re).count()) > 0 && (await btn(re).isVisible().catch(() => false));
    const snapOf = () => page.evaluate(() => window.__H.snap());
    const fallback = async (action) => { stats.fallbacks++; await page.evaluate((a) => window.__game.getState().dispatch(a), action); };

    let lastTrace = -1, lastTraceAt = Date.now(), steps = 0;
    while (Date.now() - t0 < 9 * 60 * 1000) {
      const s = await snapOf();
      if (!s) break;
      stats.maxIdle = Math.max(stats.maxIdle, s.idle);
      if (s.winner) break;
      if (s.trace !== lastTrace) { lastTrace = s.trace; lastTraceAt = Date.now(); }
      if (Date.now() - lastTraceAt > 25000) { res.stuck = `no state change for 25s in ${s.phase}, actor ${s.actor}, charging=${s.charging}, expectLeft=${s.expectLeft}, error=${s.error}`; await page.screenshot({ path: `${SHOTS}/stuck-${A}-${B}-${VIEW}.png` }).catch(() => {}); break; }
      if (s.actor !== 'A' || s.charging || s.expectLeft > 0) { await sleep(120); continue; }
      // The board ignores clicks while a phase banner is pending or showing (cards-locked): a real player waits for it too.
      if (await page.evaluate(() => !!(document.querySelector('.board.cards-locked') || document.querySelector('.phase-banner')))) { await sleep(100); continue; }

      const { action } = await page.evaluate(() => window.__H.plan());
      steps++;
      const scopeHand = '.player-dock .hand', scopeMe = '.player-zone.me .row.creatures', scopeOpp = '.player-zone.opp .row.creatures';
      let ok = true, expected = [action];
      const targetScope = async (t) => (t.kind === 'player' ? `[data-player="${t.player}"]` : null);
      const clickTarget = async (t) => {
        if (t.kind === 'player') return clickEl(page.locator(`[data-player="${t.player}"]`).first(), `face ${t.player}`);
        const mine = await page.locator(`${scopeMe} [data-iid="${t.iid}"]`).count();
        return clickEl(cardLoc(t.iid, mine ? scopeMe : scopeOpp), `target ${t.iid}`);
      };

      switch (action.type) {
        case 'playLand': case 'castCreature':
          bump(action.type); await page.evaluate((a) => window.__H.setExpect([a]), action);
          ok = await clickEl(cardLoc(action.iid, scopeHand), action.type); break;
        case 'keepHand':
          bump('keepHand'); await page.evaluate((a) => window.__H.setExpect([a]), action);
          ok = await clickEl(btn(/Keep hand/), 'Keep hand'); break;
        case 'mulligan':
          bump('mulligan'); await page.evaluate((a) => window.__H.setExpect([a]), action);
          ok = await clickEl(btn(/^Mulligan/), 'Mulligan'); break;
        case 'resolveTrigger':
          bump('enterTrigger'); await page.evaluate((a) => window.__H.setExpect([a]), action);
          ok = await clickTarget({ kind: 'creature', iid: action.target }); break;
        case 'castSorcery': {
          const card = await page.evaluate((iid) => { const g = window.__game.getState().game; return g.players.A.hand.find((c) => c.iid === iid)?.def; }, action.iid);
          bump('cast:' + card); await page.evaluate((a) => window.__H.setExpect([a]), action);
          ok = await clickEl(cardLoc(action.iid, scopeHand), 'spell ' + card);
          if (ok && action.target) { await sleep(120); ok = await clickTarget(action.target); }
          break;
        }
        case 'advance': {
          if (s.phase === 'main1') {
            if (await hasBtn(/Go to Combat/)) { bump('goToCombat'); await page.evaluate((a) => window.__H.setExpect([a]), action); ok = await clickEl(btn(/Go to Combat/), 'Go to Combat'); }
            else { bump('endTurn(3x)'); expected = [action, action, action]; await page.evaluate((a) => window.__H.setExpect([a, a, a]), action); ok = await clickEl(btn(/End Turn/), 'End Turn'); }
          } else { bump('endTurn'); await page.evaluate((a) => window.__H.setExpect([a]), action); ok = await clickEl(btn(/End Turn/), 'End Turn'); }
          break;
        }
        case 'declareAttackers': {
          if (action.attackers.length === 0) { bump('autoSkipCombat'); await page.evaluate((a) => window.__H.setExpect([{ type: 'advance' }]), action); ok = true; break; }
          bump('attack'); await page.evaluate((a) => window.__H.setExpect([a]), action);
          for (const iid of action.attackers) { if (!(await clickEl(cardLoc(iid, scopeMe), 'select attacker'))) ok = false; }
          // the UI must show what was picked before the player commits
          const shown = await page.evaluate(() => { const live = new Set([...window.__game.getState().game.players.A.battlefield, ...window.__game.getState().game.players.B.battlefield].map((c) => c.iid)); const own = (e) => live.has(e.closest('.stack')?.querySelector('[data-iid]')?.dataset.iid || e.dataset.iid); return ({ sel: [...document.querySelectorAll('.player-zone.me .card.selected')].filter(own).length, swords: [...document.querySelectorAll('.player-zone.me .attack-sword:not(.block)')].filter(own).length, label: [...document.querySelectorAll('.actions button')].map((b) => b.textContent).join('|') }); });
          if (shown.sel !== action.attackers.length || shown.swords !== action.attackers.length) await page.evaluate((m) => window.__H.note('SELECTION_FEEDBACK', m), `attackers picked ${action.attackers.length}, UI shows selected=${shown.sel} swords=${shown.swords}`);
          if (!shown.label.includes(`Attack (${action.attackers.length})`)) await page.evaluate((m) => window.__H.note('ATTACK_BUTTON_COUNT', m), `button label "${shown.label}" for ${action.attackers.length} attackers`);
          if (ok) ok = await clickEl(btn(/Attack \(/), 'Attack');
          break;
        }
        case 'declareBlockers': {
          const pairs = Object.entries(action.blocks);
          await page.evaluate((a) => window.__H.setExpect([a]), action);
          if (pairs.length === 0) {
            bump('noBlock');
            if (await hasBtn(/No Blocks/)) ok = await clickEl(btn(/No Blocks/), 'No Blocks');
            else if (await hasBtn(/Let it through/)) ok = await clickEl(btn(/Let it through/), 'Let it through');
            // else: UI auto-resolves "no blockers" by itself
            break;
          }
          bump('block');
          const nAtk = await page.evaluate(() => window.__game.getState().game.combat.attackers.length);
          for (const [blk, atk] of pairs) {
            if (!(await clickEl(cardLoc(blk, scopeMe), 'select blocker'))) { ok = false; continue; }
            if (nAtk > 1) { await sleep(80); if (!(await clickEl(cardLoc(atk, scopeOpp), 'pick attacker to block'))) ok = false; }
          }
          const shown = await page.evaluate(() => { const live = new Set([...window.__game.getState().game.players.A.battlefield, ...window.__game.getState().game.players.B.battlefield].map((c) => c.iid)); const own = (e) => live.has(e.closest('.stack')?.querySelector('[data-iid]')?.dataset.iid || e.dataset.iid); return ({ sel: [...document.querySelectorAll('.player-zone.me .card.selected')].filter(own).length, blk: [...document.querySelectorAll('.player-zone.me .attack-sword.block')].filter(own).length, tags: [...document.querySelectorAll('.combat-tag.blk')].filter(own).length }); });
          if (shown.sel !== pairs.length || shown.blk !== pairs.length) await page.evaluate((m) => window.__H.note('SELECTION_FEEDBACK', m), `blocks assigned ${pairs.length}, UI shows selected=${shown.sel} shields=${shown.blk}`);
          if (shown.tags !== pairs.length) await page.evaluate((m) => window.__H.note('BLOCKED_TAGS', m), `${pairs.length} blocks assigned but ${shown.tags} "blocked" tags on attackers`);
          if (ok) ok = await clickEl(btn(/Confirm Blocks/), 'Confirm Blocks');
          break;
        }
      }
      await park();
      if (!ok) { await fallback(action); }
      // wait for the planned transitions to land (spells telegraph for up to 3s)
      const until = Date.now() + 9000;
      while (Date.now() < until) {
        const t = await snapOf();
        if (!t || t.winner || t.expectLeft === 0) break;
        if (t.error) break;
        await sleep(80);
      }
      const after = await snapOf();
      if (after && after.expectLeft > 0 && !after.winner) {
        await page.evaluate((m) => window.__H.note('GESTURE_NO_EFFECT', m), `${action.type} in ${s.phase}: gesture produced no state change (error=${after.error})`);
        await page.evaluate(() => (window.__H.expect = []));
        if (!(after.error)) await fallback(action); else await page.evaluate(() => window.__game.getState().clearError());
      }
      if (steps > 900) { res.stuck = 'exceeded 900 human decisions'; break; }
    }

    // ---- result screen ----
    const fin = await page.evaluate(() => { const s = window.__game.getState(), g = s.game; return { winner: g.winner, turn: g.turn, lifeA: g.players.A.life, lifeB: g.players.B.life, libA: g.players.A.library.length, libB: g.players.B.library.length, decked: g.log.some((l) => /decks out/.test(l)) }; });
    res.maxHeldMs = Math.round(await page.evaluate(() => window.__H.maxHeld || 0)); // longest continuous board hold (phase banners)
    res.winner = fin.winner; res.turns = fin.turn; res.lifeA = fin.lifeA; res.lifeB = fin.lifeB;
    res.reason = fin.winner ? (fin.decked ? 'deck-out' : 'life') : 'unfinished';
    if (fin.winner) {
      await sleep(3500);
      const r = await page.evaluate(() => {
        const g = window.__game.getState().game;
        const title = document.querySelector('.result-title')?.textContent?.trim() || null;
        const rows = [...document.querySelectorAll('.stat-row')].map((r) => [r.querySelector('.stat-label')?.textContent.trim(), r.querySelector('.stat-you')?.textContent.trim(), r.querySelector('.stat-opp')?.textContent.trim()]);
        const TOK = new Set(['wolf_token', 'zombie_token']);
        const T = {};
        import('/src/cards/cards.ts').then(() => {});
        return { title, rows, hasPlayAgain: !!document.querySelector('.result button'), g: { A: { grave: g.players.A.graveyard.map((c) => c.def), bf: g.players.A.battlefield.map((c) => c.def) }, B: { grave: g.players.B.graveyard.map((c) => c.def), bf: g.players.B.battlefield.map((c) => c.def) } } };
      });
      res.resultTitle = r.title;
      const want = fin.winner === 'A' ? 'Victory!' : fin.winner === 'B' ? 'Defeat' : 'Draw';
      if (r.title !== want) await page.evaluate((m) => window.__H.note('RESULT_TITLE', m), `winner ${fin.winner} but screen says "${r.title}"`);
      res.resultRows = r.rows;
      res.graves = r.g;
      await page.screenshot({ path: `${SHOTS}/result-${A}-${B}-${VIEW}.png` }).catch(() => {});
    }
    const an = await page.evaluate(() => ({ anomalies: window.__H.anomalies, human: window.__H.humanTransitions, ai: window.__H.aiTransitions, ticks: window.__H.ticks }));
    res.auditTicks = an.ticks;
    res.anomalies = an.anomalies; res.humanTransitions = an.human; res.aiTransitions = an.ai;
    if (Object.keys(an.anomalies).length) await page.screenshot({ path: `${SHOTS}/anomaly-${A}-${B}-${VIEW}.png` }).catch(() => {});
  } catch (e) {
    res.crash = String(e.message).slice(0, 300);
    await page.screenshot({ path: `${SHOTS}/crash-${A}-${B}-${VIEW}.png` }).catch(() => {});
  }
  res.human = stats.human; res.gestureFailures = stats.gestureFailures.slice(0, 6); res.gestureFailureCount = stats.gestureFailures.length;
  res.fallbacks = stats.fallbacks; res.console = Object.fromEntries(consoleErrs); res.seconds = Math.round((Date.now() - t0) / 1000);
  await ctx.close();
  return res;
}

(async () => {
  const browser = await chromium.launch();
  let i = 0;
  for (const [A, B, IDX] of PAIRS) {
    const r = await playMatch(browser, A, B, Number(IDX));
    fs.appendFileSync(OUT, JSON.stringify(r) + '\n');
    const an = Object.keys(r.anomalies || {});
    console.log(`[${TAG}] ${r.match.padEnd(26)} ${String(r.winner).padEnd(5)} T${String(r.turns).padEnd(3)} ${String(r.seconds).padStart(3)}s  anomalies=${an.length}${an.length ? ' ' + an.join(',') : ''}${r.stuck ? ' STUCK' : ''}${r.crash ? ' CRASH' : ''}${r.gestureFailureCount ? ' gestureFails=' + r.gestureFailureCount : ''}`);
  }
  await browser.close();
})();
