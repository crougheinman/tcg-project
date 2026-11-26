// Two real browser tabs find each other, ready up and start an online match, through real clicks and the development-only
// local realtime (BroadcastChannel; no Supabase project needed). It checks the queue (live count), the ready room (each
// player sees the other's status), the 3 second countdown, that both tabs get the same seed and opposite seats, and that a
// real lockstep action (keeping the opening hand) reaches the other tab. Run it with the dev server up:
//   node tools/qa/online-match.cjs [--base http://localhost:5173] [--sizes desktop,phone,small,landscape]
// It exits non-zero on any failed check. (A phone's deck shelf is a carousel, so the phone sizes use the first deck in both tabs.)
const { chromium, devices } = require('playwright');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg('base', 'http://localhost:5173/');
const WANT = arg('sizes', 'desktop,phone,small,landscape').split(',');
const SIZES = {
  desktop: { viewport: { width: 1280, height: 800 } },
  phone: { ...devices['iPhone 13'] },
  small: { viewport: { width: 320, height: 568 }, hasTouch: true },
  landscape: { viewport: { width: 844, height: 390 }, hasTouch: true },
};

async function open(ctx) {
  const p = await ctx.newPage();
  p.__errors = [];
  p.on('pageerror', (e) => p.__errors.push(String(e)));
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => window.__game);
  return p;
}
async function toLobby(p, deck) {
  await p.getByRole('button', { name: /online pvp/i }).first().click();
  await p.waitForTimeout(400);
  await p.locator('.deck-card').filter({ hasText: deck }).first().evaluate((el) => el.click()); // off-screen in a carousel: click it directly
  await p.waitForTimeout(400);
}
const text = async (p, sel) => ((await p.locator(sel).count()) ? p.locator(sel).first().textContent() : null);

(async () => {
  const browser = await chromium.launch();
  let failed = 0;
  for (const name of WANT) {
    const ctx = await browser.newContext(SIZES[name]);
    ctx.setDefaultTimeout(10000);
    await ctx.addInitScript(() => { localStorage.setItem('rt', 'local'); localStorage.setItem('guided', '0'); localStorage.setItem('muted', '1'); });
    const checks = [];
    const check = (label, ok, detail) => { checks.push({ label, ok: !!ok, detail }); };
    try {
      const A = await open(ctx);
      const B = await open(ctx);
      await toLobby(A, /emberwood/i);
      await toLobby(B, name === 'desktop' ? /skyward/i : /emberwood/i);
      await A.getByRole('button', { name: /find a match/i }).click();
      await A.waitForTimeout(900);
      check('a lone searcher sees a count of one', /^1 player searching/.test((await text(A, '[data-testid=qm-count]')) || ''), await text(A, '[data-testid=qm-count]'));
      await B.getByRole('button', { name: /find a match/i }).click();
      await A.waitForSelector('text=Match found', { timeout: 8000 });
      await B.waitForSelector('text=Match found', { timeout: 8000 });
      check('both reach the ready room', true);
      check('both start not ready', (await A.getByTestId('seat-me').getAttribute('data-state')) === 'waiting' && (await B.getByTestId('seat-foe').getAttribute('data-state')) === 'waiting');
      await A.getByRole('button', { name: /^ready/i }).click();
      await B.waitForTimeout(700);
      check("B sees A's Ready", (await B.getByTestId('seat-foe').getAttribute('data-state')) === 'ready');
      check("A sees its own Ready", (await A.getByTestId('seat-me').getAttribute('data-state')) === 'ready');
      await B.getByRole('button', { name: /^ready/i }).click();
      await B.waitForTimeout(700);
      check('the countdown shows once both are ready', /starting in/i.test((await text(B, '[data-testid=qm-status]')) || ''), await text(B, '[data-testid=qm-status]'));
      await A.waitForSelector('.board', { timeout: 10000 });
      await B.waitForSelector('.board', { timeout: 10000 });
      const info = (p) => p.evaluate(() => { const s = window.__game.getState(); return { mode: s.mode, role: s.myId, seed: s.net && s.net.seed, deckA: s.net && s.net.deckA, deckB: s.net && s.net.deckB, deciding: s.game && s.game.mulligan && s.game.mulligan.deciding }; });
      const a = await info(A);
      const b = await info(B);
      check('both are in an online match', a.mode === 'pvp' && b.mode === 'pvp');
      check('same seed, same decks', a.seed === b.seed && a.deckA === b.deckA && a.deckB === b.deckB, JSON.stringify([a, b]));
      check('opposite seats', a.role !== b.role);
      const first = a.deciding === a.role ? A : B;
      const second = first === A ? B : A;
      await first.getByRole('button', { name: /keep hand/i }).click();
      await first.waitForTimeout(1500);
      const af = await info(first);
      const as = await info(second);
      check('a real action reaches the other tab (the decision passes on both)', af.deciding === as.deciding && af.deciding !== a.deciding, JSON.stringify([af.deciding, as.deciding]));
      check('no page errors', [...A.__errors, ...B.__errors].length === 0, JSON.stringify([...A.__errors, ...B.__errors].slice(0, 2)));
    } catch (e) {
      check('the run completed', false, String(e).split('\n')[0]);
    }
    const bad = checks.filter((c) => !c.ok);
    failed += bad.length;
    console.log(`${bad.length ? 'FAIL' : 'PASS'} ${name}: ${checks.length - bad.length}/${checks.length}`);
    for (const c of bad) console.log(`   x ${c.label}${c.detail ? ' -> ' + c.detail : ''}`);
    await ctx.close();
  }
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
