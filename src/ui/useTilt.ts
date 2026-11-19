import { useEffect, type RefObject } from 'react';

// 3D tilt for the codex detail card. Pointer position (mouse, pen, or a finger drag) or the phone's
// gyroscope sets a target in [-1, 1] on both axes; a rAF loop eases toward it and writes CSS vars on the
// element (no React re-renders): --rx/--ry (degrees), --px/--py (-1..1, for parallax) and --gx/--gy
// (percent, for the glare). Skipped entirely under prefers-reduced-motion.

const MAX_DEG = 14;
const GYRO_RANGE = 22; // degrees of phone tilt that reach the full effect
const clamp = (n: number) => Math.max(-1, Math.min(1, n));

type OrientationCtor = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> };

// iOS only fires deviceorientation after a permission prompt that must start inside a user gesture,
// so the gallery calls this from the tap that opens the card. Elsewhere it resolves true at once.
export async function requestGyro(): Promise<boolean> {
  if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) return false;
  const ctor = window.DeviceOrientationEvent as OrientationCtor;
  if (typeof ctor.requestPermission !== 'function') return true;
  try {
    return (await ctor.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

export function useTilt(active: boolean, ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    const target = { x: 0, y: 0 };
    const cur = { x: 0, y: 0 };
    let raf = 0;
    let gyroSeen = false;
    let base: { b: number; g: number } | null = null;

    const paint = () => {
      cur.x += (target.x - cur.x) * 0.14;
      cur.y += (target.y - cur.y) * 0.14;
      const settled = Math.abs(target.x - cur.x) < 0.001 && Math.abs(target.y - cur.y) < 0.001;
      if (settled) {
        cur.x = target.x;
        cur.y = target.y;
      }
      el.style.setProperty('--rx', `${(-cur.y * MAX_DEG).toFixed(2)}deg`);
      el.style.setProperty('--ry', `${(cur.x * MAX_DEG).toFixed(2)}deg`);
      el.style.setProperty('--px', cur.x.toFixed(3));
      el.style.setProperty('--py', cur.y.toFixed(3));
      el.style.setProperty('--gx', `${(50 + cur.x * 45).toFixed(1)}%`);
      el.style.setProperty('--gy', `${(50 + cur.y * 45).toFixed(1)}%`);
      raf = settled ? 0 : requestAnimationFrame(paint);
    };
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(paint);
    };

    const onPointer = (e: PointerEvent) => {
      if (gyroSeen && e.pointerType === 'touch') return; // the phone's tilt owns touch devices
      const r = el.getBoundingClientRect();
      target.x = clamp((e.clientX - (r.left + r.width / 2)) / (r.width * 1.1));
      target.y = clamp((e.clientY - (r.top + r.height / 2)) / (r.height * 1.1));
      kick();
    };
    const onRest = (e: PointerEvent) => {
      if (gyroSeen && e.pointerType === 'touch') return;
      target.x = target.y = 0;
      kick();
    };
    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.beta == null || e.gamma == null) return;
      gyroSeen = true;
      base ??= { b: e.beta, g: e.gamma }; // however the phone is held when the card opens is "flat"
      target.x = clamp((e.gamma - base.g) / GYRO_RANGE);
      target.y = clamp((e.beta - base.b) / GYRO_RANGE);
      kick();
    };

    window.addEventListener('pointermove', onPointer);
    window.addEventListener('pointerup', onRest);
    window.addEventListener('pointercancel', onRest);
    document.addEventListener('pointerleave', onRest);
    window.addEventListener('deviceorientation', onOrient);
    return () => {
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('pointerup', onRest);
      window.removeEventListener('pointercancel', onRest);
      document.removeEventListener('pointerleave', onRest);
      window.removeEventListener('deviceorientation', onOrient);
      cancelAnimationFrame(raf);
    };
  }, [active, ref]);
}
