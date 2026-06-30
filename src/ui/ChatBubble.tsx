import { motion } from 'framer-motion';

// A transient speech bubble shown over a player's avatar. `self` places it above
// the avatar (tail pointing down); otherwise below (tail pointing up). The parent
// owns AnimatePresence and keys this by message id so a new message re-animates.
export function ChatBubble({ text, self }: { text: string; self?: boolean }) {
  return (
    <motion.div
      className={'chat-bubble' + (self ? ' self' : ' opp')}
      // x stays -50% throughout (pairs with CSS left:50% for centering); only
      // scale/opacity/y animate, so framer's transform never breaks centering.
      initial={{ opacity: 0, scale: 0.7, x: '-50%', y: self ? 8 : -8 }}
      animate={{ opacity: 1, scale: 1, x: '-50%', y: 0 }}
      exit={{ opacity: 0, scale: 0.85, x: '-50%' }}
      transition={{ type: 'spring', stiffness: 460, damping: 26 }}
    >
      {text}
    </motion.div>
  );
}
