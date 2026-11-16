import { CARDS } from '../cards/cards';

// Every animation timing the board's choreography depends on, in one place.
//
// These used to be split across BoardFx, Projectile and a spell-only module, with
// a "keep in sync" comment standing in for an import. The store reads the
// telegraph windows from here too, so a number changed in this file changes the
// delay and the visual together.

// ---- telegraphs (store-driven: the spell resolves when the window ends) ----

// Cinderbolt / Scorch / Pyroblast charge up at the caster BEFORE resolving, then
// fire a bolt that travels PROJECTILE_TRAVEL_MS before its impact.
export const CHARGE_SPELLS = new Set(['cinderbolt', 'scorch', 'pyroblast']);
export const CHARGE_MS = 2000;

// Smoke-telegraph spells: the target card releases smoke for SMOKE_MS, then the
// spell resolves (Grasp from the Grave -> debris fade, Withering Touch -> wither).
export const SMOKE_SPELLS = new Set(['grasp_from_grave', 'withering_touch']);
export const SMOKE_MS = 1500;

// Self-heal spells that glow the caster's avatar with green smoke (Soul Siphon also
// pulls green souls into the avatar). Their apply is delayed for the whole ritual.
export const HEAL_SPELLS = new Set(['soothe', 'soul_siphon']);
export const HEAL_MS: Record<string, number> = { soothe: 2000, soul_siphon: 3000 };

// Every OTHER sorcery/instant gets a short spotlight window too, and so do the creatures whose
// skill fires the moment they are cast: the card floats up, glows, and the effect waits for it.
export const CAST_MS = 1300;
export const SKILL_MS = 1300;
// Derived from the card data (`skill` on a creature = a skill that fires as it enters), not hand-kept.
export const SKILL_CREATURES: Record<string, string> = Object.fromEntries(
  Object.values(CARDS)
    .filter((d) => d.type === 'creature' && d.skill)
    .map((d) => [d.id, d.skill as string]),
);
// A creature's spell-trigger (Pyre Adept): its card is spotlighted for the charge-up plus a beat.
export const TRIGGER_SPOT_MS = 1000;

// ---- phase banner ----

export const PHASE_BANNER_MS = 1400; // how long the centred "ATTACK PHASE" banner holds
// After a phase or turn change the AI waits this much longer before its next move, so the banner can be
// read (vs AI and hotseat only; online play never delays an action).
export const PHASE_PAUSE_MS = 900;

// ---- projectiles ----

export const PROJECTILE_TRAVEL_MS = 340; // a fiery bolt, caster -> target
export const SHURIKEN_TRAVEL_MS = 210; // shurikens are quick

/** Flight time for a damage spell's projectile; impact feedback waits this long. */
export function travelMsFor(def: string): number {
  return def === 'shuriken_volley' ? SHURIKEN_TRAVEL_MS : PROJECTILE_TRAVEL_MS;
}

// A creature spell-trigger (Pyre Adept): a quick charge at the card, then a bolt.
export const TRIGGER_CHARGE_MS = 650;

// ---- combat (MTG Arena pacing: attackers strike one after another) ----

export const STRIKE_STAGGER_MS = 260; // gap between consecutive attacker strikes
export const LUNGE_MS = 360; // one attacker's out-and-back
export const IMPACT_MS = 150; // time into a lunge when the hit "lands" (~40%)

// ---- entrances ----

export const SLAM_DUST_MS = 140; // a summoned creature's slam reaches the table
