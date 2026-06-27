import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/index.css';

// No StrictMode: it double-invokes effects in dev, which would open the PvP
// realtime channel twice.
createRoot(document.getElementById('root')!).render(<App />);
