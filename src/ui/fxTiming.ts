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
// Some skills are "ultimates": the caster's face cuts in as a band across the middle (CutIn), so their window
// is longer. Keyed by skill name; the value picks the art and colours.
export type CutInKind = 'blitz' | 'grave' | 'pyre' | 'whip' | 'flash' | 'rot' | 'charge' | 'thunder' | 'breath' | 'strike';
export const CUTINS: Record<string, CutInKind> = { 'Beast Blitz': 'blitz', 'Grave Call': 'grave', Whipflash: 'whip', Rot: 'rot' };
export const CUTIN_MS = 2400;
// Flash creatures that cut in when cast at instant speed (isFlashCast): Bulwark snapping the line shut. Keyed by card id.
export const FLASH_CUTINS: Record<string, CutInKind> = { bulwark: 'flash' };
// Creatures whose spell-trigger (not a cast-time skill) also cuts in. It fires on every sorcery, so the window is shorter.
export const TRIGGER_CUTINS: Record<string, CutInKind> = { pyre_adept: 'pyre' };
export const TRIGGER_CUTIN_MS = 1800;
// The Charge (Iron Shogun) waits for the block-step banner; if none ever clears it, it plays after this long anyway.
export const PARKED_CUE_FAILSAFE_MS = 8000;
/** How long a creature's cast-time skill holds the spotlight (and so delays its effect). */
export const skillMs = (skill: string): number => (CUTINS[skill] ? CUTIN_MS : SKILL_MS);
// Derived from the card data (`skill` on a creature = a skill that fires as it enters), not hand-kept.
export const SKILL_CREATURES: Record<string, string> = Object.fromEntries(
  Object.values(CARDS)
    .filter((d) => d.type === 'creature' && d.skill)
    .map((d) => [d.id, d.skill as string]),
);
// A creature's spell-trigger (Pyre Adept): its card is spotlighted for the charge-up plus a beat.
export const TRIGGER_SPOT_MS = 1000;

// The board releases a phase-banner hold / lock on its own if one lasts this long without letting go (useLockFailsafe).
// Chained banners legitimately hold it a long time: a turn change is ~10 s (End banner, gap, Main banner) and after the
// player's own attack the combat clash, the block / End / enemy-Main banners chain to 12-18 s (measured in 6 of 8 smoke
// matches; one 24 s hold was seen too). So this sits well above that: it is a last resort for a banner that never reports back.
export const LOCK_FAILSAFE_MS = 40000;

// ---- zone shows (ZoneFx): a card discarded by Rot, a card raised by Grave Call ----
export const DISCARD_FX_MS = 3000;
export const RAISE_FX_MS = 3400;

// ---- the Iaijutsu cinematic ----
// Iaijutsu Strike cast on Hana (the Kensei Duelist) blacks the screen out and plays a short film (IaijutsuCinematic):
// fade to black, the clip once through (it never loops), a held frame with falling petals and a title, one cut of light,
// then back to the table. The spell's effect waits for the whole thing (vs AI / hotseat); online play plays it alongside.
export const IAIJUTSU = { card: 'iaijutsu_strike', target: 'kensei_duelist' } as const;
export const IAIJUTSU_MS = 5000; // the whole sequence; every offset below is inside it
export const IAIJUTSU_CLIP_START_MS = 450; // the clip begins once the screen is dark
export const IAIJUTSU_CLIP_MS = 3000; // the clip's own length (30 frames at 10 fps)
export const IAIJUTSU_CLIP_URL = '/ui/iaijutsu.mp4';

// ---- phase banner ----

export const PHASE_BANNER_MS = 3000; // how long the centred "ATTACK PHASE" banner holds
// Consecutive banners never touch: the next one waits this long after the previous one has gone.
export const PHASE_GAP_MS = 1200;
// After a phase or turn change the AI waits this much longer before its next move, so each banner gets
// its own slot (banner + gap, less the AI's own ~600ms think time). vs AI and hotseat only; online play
// never delays an action.
export const PHASE_PAUSE_MS = PHASE_BANNER_MS + PHASE_GAP_MS - 600;

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

export const STRIKE_STAGGER_MS = 320; // gap between consecutive attacker strikes
export const WINDUP_MS = 300; // float up and rock back, building momentum, before the strike
export const LUNGE_MS = 360; // the strike itself: out and back
export const ATTACK_MS = WINDUP_MS + LUNGE_MS; // one attacker's whole move
export const IMPACT_MS = WINDUP_MS + 150; // time into the move when the hit "lands"

// ---- a creature killed in combat: strike lands -> cracks -> pulverized ----

export const DEATH_CRACK_MS = 300; // hairline cracks spread over the card
export const DEATH_DUST_MS = 200; // the card bursts into pieces that scatter and vanish

// ---- first strike (a first striker clashing with its blocker/attacker) ----

export const FS_SPOT_MS = 900; // "First Strike!" with the card floating
export const FS_SLASH_MS = 620; // blackout + three slashes
export const FS_INTRO_MS = FS_SPOT_MS + FS_SLASH_MS; // combat's strikes wait this long
// A first striker with a signature cut-in (Kensei Duelist: Hana's eyes snap open) holds the "First Strike!" spotlight
// longer, so the band has time to slide in and be read; combat's strikes wait for it. Keyed by card id.
export const FS_CUTINS: Record<string, CutInKind> = { kensei_duelist: 'strike' };
export const FS_CUTIN_SPOT_MS = 1700;
/** How long this first striker's "First Strike!" spotlight holds (longer when it carries a cut-in). */
export const fsSpotMs = (def: string): number => (FS_CUTINS[def] ? FS_CUTIN_SPOT_MS : FS_SPOT_MS);
/** The whole first-strike intro for this first striker: the spotlight, then the blackout and slashes. */
export const fsIntroMs = (def: string): number => fsSpotMs(def) + FS_SLASH_MS;
// ...and the phase banner that follows combat (the End phase) waits this long after the last strike lands.
export const COMBAT_BANNER_GAP_MS = 1300;

// ---- entrances ----

export const SLAM_DUST_MS = 140; // a summoned creature's slam reaches the table
