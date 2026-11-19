import { useEffect, useRef } from 'react';
import { IAIJUTSU_CLIP_START_MS, IAIJUTSU_CLIP_URL, IAIJUTSU_MS } from './fxTiming';

/**
 * Iaijutsu Strike cast on Hana: the screen goes black like the opening of an old Japanese film and a short clip
 * plays ONCE (a <video> with no loop, which holds its last frame, rather than a looping GIF). Around it: film grain,
 * scratches and a slow flicker, a slow push-in, a vertical title, falling petals, and one white cut of light before
 * the table comes back. The whole sequence is `--iai-ms` (IAIJUTSU_MS) long, so it ends exactly when the spotlight
 * window closes; every keyframe in index.css (.iai*) is a share of that one duration.
 * Purely visual and click-through, hidden from assistive tech; online it plays alongside the action.
 */
export function IaijutsuCinematic() {
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    // begin once the screen is dark; the clip is 3 s, so it finishes well before the title and the cut
    const t = window.setTimeout(() => {
      v.currentTime = 0;
      void v.play().catch(() => {}); // blocked or unsupported: the poster frame simply stays on screen
    }, IAIJUTSU_CLIP_START_MS);
    return () => {
      window.clearTimeout(t);
      v.pause();
    };
  }, []);

  return (
    <div className="iai" aria-hidden data-cinematic="iaijutsu" style={{ ['--iai-ms' as string]: `${IAIJUTSU_MS}ms` }}>
      <div className="iai-shade" />
      <div className="iai-frame">
        <video
          ref={video}
          className="iai-video"
          muted
          playsInline
          preload="auto"
          poster="/ui/iaijutsu-poster.webp"
          disablePictureInPicture
        >
          <source src={IAIJUTSU_CLIP_URL} type="video/mp4" />
        </video>
        <div className="iai-grain" />
        <div className="iai-scratches" />
      </div>
      <div className="iai-petals">
        {Array.from({ length: 14 }, (_, i) => (
          <i key={i} style={{ ['--i' as string]: i }} />
        ))}
      </div>
      <div className="iai-title">
        <span className="iai-kanji">
          <b>居</b>
          <b>合</b>
        </span>
        <span className="iai-cap">Iaijutsu Strike</span>
      </div>
      <div className="iai-bars" />
      <div className="iai-vignette" />
      <div className="iai-cut" />
    </div>
  );
}
