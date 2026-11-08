// Shared FX geometry helpers. Kept out of ImpactFx.tsx so that file exports only
// components — a module mixing components with other exports breaks Vite's fast
// refresh (react-refresh/only-export-components).

/** Inline sizing for a centered circle (framer owns transform, so center by margin). */
export const circle = (d: number) => ({ width: d, height: d, marginLeft: -d / 2, marginTop: -d / 2 });
