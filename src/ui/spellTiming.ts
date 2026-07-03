// Shared timing for the heavy burn spells so the store (charge delay) and the
// board fx (blast/destroy) agree. Cinderbolt / Scorch / Pyroblast telegraph with
// a charge-up at the caster BEFORE the spell actually resolves, then fire a bolt
// that travels PROJECTILE_TRAVEL_MS before its impact (burst + creature destroy).
export const CHARGE_SPELLS = new Set(['cinderbolt', 'scorch', 'pyroblast']);
export const CHARGE_MS = 2000;
export const PROJECTILE_TRAVEL_MS = 340; // keep in sync with Projectile.tsx TRAVEL_MS

// Smoke-telegraph spells: the target card releases smoke for SMOKE_MS, then the
// spell resolves (Grasp from the Grave -> debris fade, Withering Touch -> wither).
// Their apply is delayed so the target lingers while the smoke plays.
export const SMOKE_SPELLS = new Set(['grasp_from_grave', 'withering_touch']);
export const SMOKE_MS = 1500;

// Self-heal spells that glow the caster's avatar with green smoke (Soul Siphon also
// pulls green souls into the avatar). Their apply is delayed for the whole ritual.
export const HEAL_SPELLS = new Set(['soothe', 'soul_siphon']);
export const HEAL_MS: Record<string, number> = { soothe: 2000, soul_siphon: 3000 };
