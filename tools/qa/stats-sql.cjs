// Runs the match_stats migration in a real Postgres 16 (PGlite, in WASM) and checks who can do what: the public can insert a valid row
// and nothing else, bad rows are refused by the CHECK limits, a repeated match_key is a duplicate (23505), the owner can read, and the
// balance views work. Run it after changing supabase/migrations/*match_stats*.sql:
//   npm i --no-save @electric-sql/pglite && node tools/qa/stats-sql.cjs      (exits non-zero if any check fails)
// It needs no Supabase project and no network; it stands in for one by creating the same roles (anon, authenticated, service_role).
const { PGlite } = require(process.env.PGLITE || '@electric-sql/pglite');
const fs = require('fs');
const path = require('path');
const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '20261126000000_match_stats.sql'), 'utf8');
const base = () => ({ match_key: 'k' + Math.random(), schema_version: 1, game_version: '1.0.2', content_hash: 'abc', env: 'production', automated: false, mode: 'ai', human_a: true, human_b: false, deck_a: 'emberwood', deck_b: 'skyward', custom_a: null, custom_b: null, first_player: 'A', winner: 'A', end_reason: 'life', turns: 12, duration_s: 300, mulligans_a: 0, mulligans_b: 1, life_a: 7, life_b: 0, stats: { A: { cast: { ashigaru: 2 }, seen: { ashigaru: 2, swift_lancer: 1 } }, B: { cast: {}, seen: { sky_talon: 1 } }, life_curve: [[20, 20], [7, 0]] } });
(async () => {
  const db = new PGlite();
  await db.exec("create role anon nologin; create role authenticated nologin; create role service_role nologin;");
  await db.exec("grant usage on schema public to anon, authenticated; alter default privileges in schema public grant all on tables to anon, authenticated;");
  await db.exec(sql);
  await db.exec(sql); // second run must be harmless
  console.log('migration ran twice OK');
  const cols = Object.keys(base());
  const ins = async (row, role = 'anon') => { await db.exec(`set role ${role}`); try { await db.query(`insert into public.match_stats (${cols.join(',')}) values (${cols.map((_, i) => '$' + (i + 1)).join(',')})`, cols.map((c) => (row[c] !== null && typeof row[c] === 'object' ? JSON.stringify(row[c]) : row[c]))); return 'ok'; } catch (e) { return e.code + ' ' + e.message.slice(0, 60); } finally { await db.exec('reset role'); } };
  const t = async (name, p, want) => { const got = await p; const pass = want === 'ok' ? got === 'ok' : got.startsWith(want); console.log((pass ? 'PASS ' : 'FAIL ') + name + '  -> ' + got); if (!pass) process.exitCode = 1; };
  await t('anon inserts a valid row', ins(base()), 'ok');
  await t('authenticated inserts a valid row', ins(base(), 'authenticated'), 'ok');
  const dup = base(); await ins(dup); await t('same match_key twice is a duplicate (23505)', ins(dup), '23505');
  await t('bad mode', ins({ ...base(), mode: 'cheat' }), '23514');
  await t('bad winner', ins({ ...base(), winner: 'C' }), '23514');
  await t('turns 0', ins({ ...base(), turns: 0 }), '23514');
  await t('turns 501', ins({ ...base(), turns: 501 }), '23514');
  await t('mulligans 4', ins({ ...base(), mulligans_a: 4 }), '23514');
  await t('duration too long', ins({ ...base(), duration_s: 90000 }), '23514');
  await t('stats not an object', ins({ ...base(), stats: [1, 2] }), '23514');
  await t('custom deck too long', ins({ ...base(), custom_a: Array(61).fill('x') }), '23514');
  await t('huge stats blob', ins({ ...base(), stats: { x: 'y'.repeat(40000) } }), '23514');
  await t('empty match_key', ins({ ...base(), match_key: '' }), '23514');
  await t('null duration allowed', ins({ ...base(), duration_s: null }), 'ok');
  await t('draw allowed', ins({ ...base(), winner: 'draw', end_reason: 'draw' }), 'ok');
  // privileges
  const as = async (role, q) => { await db.exec(`set role ${role}`); try { const r = await db.query(q); return 'ok rows=' + r.rows.length; } catch (e) { return e.code + ' ' + e.message.slice(0, 50); } finally { await db.exec('reset role'); } };
  await t('anon cannot select', as('anon', 'select * from public.match_stats'), '42501');
  await t('anon cannot select even one column', as('anon', 'select winner from public.match_stats'), '42501');
  await t('anon cannot update', as('anon', "update public.match_stats set winner='B'"), '42501');
  await t('anon cannot delete', as('anon', 'delete from public.match_stats'), '42501');
  await t('anon cannot read the views', as('anon', 'select * from public.balance_deck_winrates'), '42501');
  await t('authenticated cannot select', as('authenticated', 'select * from public.match_stats'), '42501');
  await t('anon cannot set id', as('anon', "insert into public.match_stats (id, match_key, schema_version, game_version, content_hash, env, mode, human_a, human_b, deck_a, deck_b, first_player, winner, end_reason, turns, mulligans_a, mulligans_b, life_a, life_b, stats) values (gen_random_uuid(), 'z', 1,'v','h','production','ai',true,false,'a','b','A','A','life',3,0,0,1,0,'{}')"), '42501');
  await t('anon cannot backdate created_at', as('anon', "insert into public.match_stats (created_at, match_key, schema_version, game_version, content_hash, env, mode, human_a, human_b, deck_a, deck_b, first_player, winner, end_reason, turns, mulligans_a, mulligans_b, life_a, life_b, stats) values ('2001-01-01', 'z2', 1,'v','h','production','ai',true,false,'a','b','A','A','life',3,0,0,1,0,'{}')"), '42501');
  // the owner can read, and the views work
  const total = await db.query('select count(*)::int n from public.match_stats'); console.log('rows stored:', total.rows[0].n);
  const dw = await db.query('select deck, games, wins, win_pct from public.balance_deck_winrates order by deck'); console.log('deck winrates', JSON.stringify(dw.rows));
  const fp = await db.query('select * from public.balance_first_player'); console.log('first player', JSON.stringify(fp.rows));
  const cw = await db.query('select card, games_seen, win_pct_when_seen, games_cast, win_pct_when_cast from public.balance_card_winrates order by card limit 4'); console.log('card winrates', JSON.stringify(cw.rows));
})().catch((e) => { console.error('ERR', e); process.exit(1); });
