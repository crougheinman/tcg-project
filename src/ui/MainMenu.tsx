import { useGame } from '../store/gameStore';
import { hasSupabase } from '../net/supabase';
import { Rulebook } from './Rulebook';

export function MainMenu({ onOnline }: { onOnline: () => void }) {
  const startAI = useGame((s) => s.startAI);
  const startHotseat = useGame((s) => s.startHotseat);

  return (
    <div className="menu">
      <h1 className="logo">ARCANUM</h1>
      <p className="tagline">a tiny trading card game</p>
      <div className="menu-buttons">
        <button onClick={startAI}>Play vs AI</button>
        <button onClick={startHotseat}>Hotseat (2 players, 1 device)</button>
        <button onClick={onOnline} disabled={!hasSupabase}>
          Online PvP{!hasSupabase ? ' (set Supabase keys)' : ''}
        </button>
        <Rulebook />
      </div>
      {!hasSupabase && (
        <p className="hint">
          Online needs a free Supabase project. Copy <code>.env.local.example</code> to{' '}
          <code>.env.local</code> and add your URL + anon key.
        </p>
      )}
    </div>
  );
}
