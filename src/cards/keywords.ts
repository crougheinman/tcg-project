import type { Keyword } from '../engine/types';

// Player-facing name and rule text for every keyword, in one place: the Rulebook, the
// card gallery and the tests all read this, so a rule cannot be documented twice and
// drift. The behaviour itself lives in the engine (`rules.ts` / `reducer.ts`).
export const KEYWORD_INFO: Record<Keyword, { label: string; rule: string }> = {
  haste: { label: 'Haste', rule: 'can attack the turn it enters play.' },
  flying: { label: 'Flying', rule: 'can only be blocked by creatures with Flying or Reach.' },
  defender: { label: 'Defender', rule: 'cannot attack.' },
  reach: { label: 'Reach', rule: 'can block creatures with Flying.' },
  vigilance: { label: 'Vigilance', rule: 'attacking does not tap it, so it can still block next turn.' },
  firstStrike: { label: 'First strike', rule: 'deals combat damage before creatures without it, so it can kill a blocker or attacker before taking damage.' },
  doubleStrike: { label: 'Double strike', rule: 'deals combat damage twice: in the first-strike step and again in the regular step.' },
  trample: { label: 'Trample', rule: 'damage beyond what is needed to destroy its blocker is dealt to the player.' },
  deathtouch: { label: 'Deathtouch', rule: 'any damage it deals to a creature destroys that creature.' },
  lifelink: { label: 'Lifelink', rule: 'damage it deals also gains its controller that much life.' },
  flash: { label: 'Flash', rule: 'can be cast at instant speed: in your main phase, in the attack step, or as a surprise blocker while you are defending.' },
  prowess: { label: 'Prowess', rule: 'gets +1/+1 until end of turn each time its controller casts a spell.' },
  skulk: { label: 'Skulk', rule: 'cannot be blocked by creatures with greater power.' },
  bushido: { label: 'Bushido', rule: 'gets +1/+1 until end of turn when it blocks or becomes blocked.' },
  battleCry: { label: 'Battle cry', rule: 'when it attacks, each other attacking creature gets +1/+0 until end of turn.' },
  exalted: { label: 'Exalted', rule: 'when a creature you control attacks alone, it gets +1/+1 until end of turn for each creature you control with Exalted.' },
  undying: { label: 'Undying', rule: 'when it dies without a +1/+1 counter, it returns to the battlefield with one (only once).' },
  hexproof: { label: 'Hexproof', rule: 'your opponents\' spells and abilities cannot target it (yours can).' },
  indestructible: { label: 'Indestructible', rule: 'lethal damage and destroy effects do not kill it. Only losing all its toughness does.' },
};

export const keywordLabel = (k: Keyword): string => KEYWORD_INFO[k].label;
