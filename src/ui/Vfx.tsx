import { useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import type { Points } from 'three';

// three.js particle-burst overlay. A transparent, click-through, full-window
// canvas. Board pushes bursts (screen-pixel coords); each spawns a short-lived
// 3D particle explosion. UI itself stays DOM — this is pure flourish on top.

export interface Burst {
  id: number;
  x: number; // screen px
  y: number; // screen px
  color: string;
  n?: number; // particle count
}

const LIFE = 0.75; // seconds

function BurstFx({ burst, onDone }: { burst: Burst; onDone: (id: number) => void }) {
  const ref = useRef<Points>(null);
  const { size } = useThree();
  const age = useRef(0);

  const { positions, velocities, count } = useMemo(() => {
    const count = burst.n ?? 26;
    const positions = new Float32Array(count * 3);
    const velocities: [number, number][] = [];
    const wx = burst.x - size.width / 2; // screen px -> centered world units
    const wy = size.height / 2 - burst.y;
    for (let i = 0; i < count; i++) {
      positions[i * 3] = wx;
      positions[i * 3 + 1] = wy;
      positions[i * 3 + 2] = 0;
      const a = Math.random() * Math.PI * 2;
      const sp = 70 + Math.random() * 220;
      velocities.push([Math.cos(a) * sp, Math.sin(a) * sp]);
    }
    return { positions, velocities, count };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame((_, delta) => {
    const pts = ref.current;
    if (!pts) return;
    age.current += delta;
    const t = age.current;
    const arr = (pts.geometry.attributes.position as { array: Float32Array }).array;
    for (let i = 0; i < count; i++) {
      arr[i * 3] += velocities[i][0] * delta;
      arr[i * 3 + 1] += velocities[i][1] * delta - 90 * delta; // gravity arc
    }
    pts.geometry.attributes.position.needsUpdate = true;
    const mat = pts.material as unknown as { opacity: number; size: number };
    const k = Math.max(0, 1 - t / LIFE);
    mat.opacity = k;
    mat.size = 2 + 6 * k;
    if (t >= LIFE) onDone(burst.id);
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        color={burst.color}
        size={7}
        transparent
        opacity={1}
        sizeAttenuation={false}
        depthWrite={false}
      />
    </points>
  );
}

function Scene({ bursts, onDone }: { bursts: Burst[]; onDone: (id: number) => void }) {
  return (
    <>
      {bursts.map((b) => (
        <BurstFx key={b.id} burst={b} onDone={onDone} />
      ))}
    </>
  );
}

export function VfxCanvas({ bursts, onDone }: { bursts: Burst[]; onDone: (id: number) => void }) {
  return (
    <Canvas
      orthographic
      camera={{ position: [0, 0, 100], zoom: 1, near: 0.1, far: 1000 }}
      gl={{ alpha: true, antialias: true }}
      style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 50 }}
    >
      <Scene bursts={bursts} onDone={onDone} />
    </Canvas>
  );
}
