// The browser SMOKE BATCH: 8 real matches (4 desktop, 4 phone), every deck played twice, 4 at a time.
// Use it after a small change. A full 56-match pass is `node tools/qa/ui-match.cjs` over pairs.txt and is
// reserved for engine-rule changes (see tools/qa/README.md).
//
//   npm run dev                       # in another terminal (the matches play against the dev server)
//   node tools/qa/smoke.cjs           # [--base http://localhost:5173/] [--quick] [--out DIR]
//
// --quick runs just 2 matches (1 desktop, 1 phone): a self-check that the tooling works, NOT a smoke test.
// Exit code: 0 clean, 1 anomalies/crash/stuck/failed gestures, 2 dev server not reachable.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const flag = (k) => process.argv.includes('--' + k);
const BASE = arg('base', 'http://localhost:5173/');
const OUT = arg('out', fs.mkdtempSync(path.join(os.tmpdir(), 'qa-smoke-')));
const QUICK = flag('quick');

// Every deck appears exactly twice across the 8 matches.
const DESKTOP = [['wildblitz', 'wildwood'], ['gravetide', 'emberwood'], ['wildblitz', 'gravetide'], ['wildwood', 'emberwood']];
const PHONE = [['skyward', 'pyromancer'], ['ironblossom', 'stonewall'], ['skyward', 'stonewall'], ['pyromancer', 'ironblossom']];

const idx = fs.readFileSync(path.join(__dirname, 'pairs.txt'), 'utf8').split('\n').filter(Boolean);
const withSeed = ([a, b]) => {
  const line = idx.find((l) => l.startsWith(`${a}:${b}:`));
  if (!line) throw new Error(`pair ${a}:${b} is not in pairs.txt`);
  return line;
};

// 4 workers: two per viewport, two matches each.
const jobs = QUICK
  ? [{ view: 'desktop', pairs: [DESKTOP[0]] }, { view: 'phone', pairs: [PHONE[0]] }]
  : [
      { view: 'desktop', pairs: DESKTOP.slice(0, 2) }, { view: 'desktop', pairs: DESKTOP.slice(2) },
      { view: 'phone', pairs: PHONE.slice(0, 2) }, { view: 'phone', pairs: PHONE.slice(2) },
    ];

(async () => {
  try { await fetch(BASE); } catch {
    console.error(`Cannot reach ${BASE}. Start the dev server first:  npm run dev`);
    process.exit(2);
  }
  fs.mkdirSync(OUT, { recursive: true });
  console.log(`smoke batch${QUICK ? ' (quick self-check)' : ''} -> ${OUT}`);
  const started = Date.now();
  await Promise.all(jobs.map((j, i) => new Promise((resolve) => {
    const child = spawn(process.execPath, [
      path.join(__dirname, 'ui-match.cjs'), '--base', BASE, '--viewport', j.view, '--tag', `s${i}`,
      '--pairs', j.pairs.map(withSeed).join(','), '--out', path.join(OUT, `w${i}.jsonl`), '--shots', OUT,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d) => process.stdout.write(d));
    child.stderr.on('data', (d) => process.stderr.write(d));
    child.on('close', resolve);
  })));

  const rows = [];
  for (let i = 0; i < jobs.length; i++) {
    const f = path.join(OUT, `w${i}.jsonl`);
    if (fs.existsSync(f)) for (const l of fs.readFileSync(f, 'utf8').split('\n').filter(Boolean)) rows.push(JSON.parse(l));
  }
  const bad = rows.filter((r) => Object.keys(r.anomalies || {}).length || r.crash || r.stuck || r.gestureFailureCount || r.reason === 'unfinished');
  const expected = jobs.reduce((n, j) => n + j.pairs.length, 0);
  console.log(`\n${rows.length}/${expected} matches finished in ${Math.round((Date.now() - started) / 1000)}s, ${bad.length} with problems`);
  for (const r of bad) {
    console.log(` - ${r.match} (${r.viewport}): ${JSON.stringify(r.anomalies)}${r.crash ? ' CRASH ' + String(r.crash).split('\n')[0] : ''}${r.stuck ? ' STUCK ' + r.stuck : ''}${r.gestureFailureCount ? ' gestureFailures=' + r.gestureFailureCount : ''}`);
  }
  process.exit(bad.length || rows.length < expected ? 1 : 0);
})();
