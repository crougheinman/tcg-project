import { useEffect, useState } from 'react';
import { useGame } from './store/gameStore';
import { MainMenu } from './ui/MainMenu';
import { Lobby } from './ui/Lobby';
import { Board } from './ui/Board';

export default function App() {
  const mode = useGame((s) => s.mode);
  const game = useGame((s) => s.game);
  const [showLobby, setShowLobby] = useState(false);

  useEffect(() => {
    if (mode === 'menu') setShowLobby(false);
  }, [mode]);

  if (mode !== 'menu' && game) return <Board />;
  if (showLobby) return <Lobby onBack={() => setShowLobby(false)} />;
  return <MainMenu onOnline={() => setShowLobby(true)} />;
}
