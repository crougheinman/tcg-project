/** Has the person asked the OS for reduced motion? Safe where matchMedia is missing (tests, old webviews). */
export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    return false;
  }
}
