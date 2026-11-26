// Regenerates the Field Manual's annotated board screenshots: public/manual/board-wide.webp, board-narrow.webp and
// src/rulebook/boardShot.ts (the callout positions). Run it after the board layout changes, with the dev server up
// (`npm run dev`) and Playwright + Python's Pillow available:  node tools/qa/manual-shots.cjs
// It seeds a staged mid-game table (so the shot shows creatures, hand, lands, a graveyard) and measures where each numbered
// callout belongs from the live DOM, so the marks follow the layout and never need placing by hand.
const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const BASE = process.env.BASE || 'http://localhost:5173/';
const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'public', 'manual');

// The callouts: [selector, how to find the point (centre of the element), legend text]. Order = number.
const MARKS = [
  ['.player-zone.opp .playerbar', "Your opponent's life and mana. Yours is the same bar at the bottom."],
  ['.player-zone.opp .row.creatures', "Your opponent's creatures. Red is always the enemy."],
  ['.phase-steps', 'The phases of the turn. The lit one is the current phase.'],
  ['.center .actions', 'The action button: what you can do right now (Go to Combat, Attack, End Turn...).'],
  ['.player-zone.me .row.creatures', 'Your creatures. Tap one to attack or block; drag a ready one onto the enemy side to attack.'],
  ['.player-dock .hand', 'Your hand. Tap a card, or drag it onto the battlefield, to play it. The orb number is its mana cost.'],
  ['.zone-btn', 'Your graveyard. Tap it to see the cards, and to use Flashback or Unearth.'],
];

const VIEWS = {
  wide: { opts: { viewport: { width: 1280, height: 800 } }, file: 'board-wide' },
  narrow: { opts: { ...devices['iPhone 13'] }, file: 'board-narrow' },
};

async function stage(page) {
  await page.evaluate(() => window.__game.getState().startAI('emberwood', 'skyward'));
  await page.waitForSelector('.board');
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const st = window.__game.getState();
    const g = structuredClone(st.game);
    let n = 9000;
    const mk = (def, owner, over = {}) => ({ iid: 'm' + n++ + '_' + def, def, owner, tapped: false, summoningSick: false, damage: 0, buffP: 0, buffT: 0, blitz: false, ...over });
    g.players.A.battlefield = ['aether_well', 'aether_well', 'aether_well', 'aether_well', 'ashigaru', 'swift_lancer', 'kensei_duelist'].map((d) => mk(d, 'A'));
    g.players.B.battlefield = ['aether_well', 'aether_well', 'aether_well', 'granite_sentinel', 'sky_talon'].map((d) => mk(d, 'B'));
    g.players.A.hand = ['stoneback_cub', 'ronins_katana', 'iaijutsu_strike', 'aether_well'].map((d) => mk(d, 'A'));
    g.players.B.hand = ['windrush', 'sky_talon', 'granite_sentinel'].map((d) => mk(d, 'B'));
    g.players.A.graveyard = ['ember_sprite', 'scorch'].map((d) => mk(d, 'A'));
    g.players.A.life = 17; g.players.B.life = 14;
    g.active = 'A'; g.phase = 'main1'; g.turn = 5; g.pending = null; g.winner = null; g.combat = null;
    window.__game.setState({ game: g, error: null, charging: null });
  });
  await page.waitForFunction(() => !document.querySelector('.board.cards-locked') && !document.querySelector('.phase-banner'), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1200);
  // every looping animation stops, so the picture is the same each time
  await page.addStyleTag({ content: '*, *::before, *::after { animation-play-state: paused !important; transition: none !important; }' });
  await page.waitForTimeout(300);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const result = {};
  for (const [key, v] of Object.entries(VIEWS)) {
    const ctx = await browser.newContext({ ...v.opts, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.addInitScript(() => { localStorage.setItem('guided', '0'); localStorage.setItem('muted', '1'); });
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__game);
    await stage(page);
    const vp = page.viewportSize();
    const marks = [];
    for (let i = 0; i < MARKS.length; i++) {
      const [sel, label] = MARKS[i];
      const box = await page.evaluate((s) => {
        const e = document.querySelector(s);
        if (!e) return null;
        const r = e.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 60), w: r.width, h: r.height };
      }, sel);
      if (!box || box.w === 0) { console.warn(`[${key}] no box for ${sel}: callout ${i + 1} skipped`); continue; }
      marks.push({ n: i + 1, x: Math.round(box.x), y: Math.round(box.y), label });
    }
    const png = path.join(OUT, v.file + '.png');
    await page.screenshot({ path: png });
    const webp = path.join(OUT, v.file + '.webp');
    execFileSync('python3', ['-c', `from PIL import Image; im=Image.open(${JSON.stringify(png)}).convert('RGB'); im.save(${JSON.stringify(webp)}, 'WEBP', quality=72, method=6)`]);
    fs.unlinkSync(png);
    result[key] = { src: '/manual/' + v.file + '.webp', w: vp.width, h: vp.height, marks };
    console.log(key, vp.width + 'x' + vp.height, fs.statSync(webp).size + ' bytes', marks.length + ' callouts');
    await ctx.close();
  }
  await browser.close();
  const ts = `// GENERATED by tools/qa/manual-shots.cjs (run it with the dev server up). Do not edit by hand.
export interface ShotMark { n: number; x: number; y: number; label: string }
export interface Shot { src: string; w: number; h: number; marks: ShotMark[] }
export const BOARD_SHOTS: { wide: Shot; narrow: Shot } = ${JSON.stringify(result, null, 2)};
`;
  fs.writeFileSync(path.join(ROOT, 'src', 'rulebook', 'boardShot.ts'), ts);
})();
