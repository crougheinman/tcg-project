// AI-vs-AI win rates for every deck against every other, seats alternating.
// Run:  N=80 npx vite-node tools/qa/winrate.ts   (N games per ordered pairing; margin ~ +/-4 points at N=80, so use N>=40 for anything you act on)
import { createInitialState } from '../../src/engine/state';
import { applyAction } from '../../src/engine/reducer';
import { pickAction } from '../../src/ai/ai';
import { actorOf } from '../../src/engine/rules';
import { DECK_LIST } from '../../src/cards/decks';
const N = Number(process.env.N ?? 60);
const rows: Record<string, { w: number; g: number }> = {};
let pairNo = 0;
for (const D of DECK_LIST) for (const O of DECK_LIST) {
  if (D.id === O.id) continue;
  pairNo++;
  for (let seed = 1; seed <= N; seed++) {
    const asA = seed % 2 === 0; // alternate seats
    // each pairing gets its OWN seed stream: sharing seeds 1..N across all pairings makes a few lucky
    // seeds swing every deck the same way (at N=6, seat A won 75% of even seeds and 30% of odd ones)
    let g = createInitialState(seed * 7919 + pairNo * 104729, (asA ? D : O).cards, (asA ? O : D).cards);
    let steps = 0;
    while (!g.winner && steps++ < 2000) g = applyAction(g, pickAction(g, actorOf(g)));
    const me = asA ? 'A' : 'B';
    const k = D.id + ' vs ' + O.id; rows[k] = rows[k] ?? { w: 0, g: 0 };
    rows[k].g++; if (g.winner === me) rows[k].w++;
  }
}
const by: Record<string, { w: number; g: number }> = {};
for (const [k, v] of Object.entries(rows)) { const d = k.split(' vs ')[0]; by[d] = by[d] ?? { w: 0, g: 0 }; by[d].w += v.w; by[d].g += v.g; }
console.log(Object.entries(by).map(([d, v]) => `${d.padEnd(12)} ${(100 * v.w / v.g).toFixed(1)}%`).join('\n'));
const wb = Object.entries(rows).filter(([k]) => k.startsWith('wildblitz')).map(([k, v]) => `${k.replace('wildblitz vs ', '').padEnd(12)} ${(100 * v.w / v.g).toFixed(0)}%`).join('  ');
console.log('wildblitz per opponent:', wb);
