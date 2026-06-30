import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useGame } from '../store/gameStore';
import { MAX_CHAT_LEN } from '../net/match';

// One-tap presets so mobile players never need the keyboard.
const EMOTES = ['GG', 'Nice!', 'Oops', 'Close one', 'Good luck', '👍', '😂', '🤔'];

// Chat input for PvP. A toggle opens a panel with quick-emote chips and a text
// field; both route through the store's sendChat (which echoes a local bubble and
// broadcasts to the opponent). Bottom-left — the Activity log owns bottom-right.
export function ChatDock() {
  const sendChat = useGame((s) => s.sendChat);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');

  function submit() {
    const t = text.trim();
    if (!t) return;
    sendChat(t);
    setText('');
  }

  return (
    <div className="chat-dock">
      <AnimatePresence>
        {open && (
          <motion.div
            className="chat-panel"
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 420, damping: 28 }}
          >
            <div className="chat-emotes">
              {EMOTES.map((e) => (
                <button key={e} className="chat-chip" onClick={() => sendChat(e)}>
                  {e}
                </button>
              ))}
            </div>
            <div className="chat-input-row">
              <input
                value={text}
                maxLength={MAX_CHAT_LEN}
                placeholder="Say something…"
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submit();
                }}
              />
              <button className="primary" onClick={submit}>
                Send
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <button
        className={'chat-toggle' + (open ? ' active' : '')}
        onClick={() => setOpen((o) => !o)}
        title="Chat"
        aria-label="Chat"
      >
        💬
      </button>
    </div>
  );
}
