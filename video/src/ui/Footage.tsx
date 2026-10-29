import React, { useMemo } from "react";
import { AbsoluteFill, Img, OffthreadVideo, getStaticFiles, interpolate, staticFile, useCurrentFrame } from "remotion";
import { BRAND, STYLE, rgba } from "../brand";

// Two different tools, deliberately not mixed:
//  - punch-in: a HARD jump in crop at the start of a beat. Reads as a cut.
//  - ambient push-in: a few % across the beat, linear, so the frame never freezes.
// The table is written at full strength; the user's style.motion.punch scales it: «strong» as
// written, «soft» half the zoom, «none» a static frame.
//
// Every `from` below must be a REAL splice in public/footage.mp4 — the frames `cut.py` prints
// («Footage.tsx splice frames»). A crop change on a splice turns a jump cut into a punch-in;
// a crop change mid-shot reads as a zoom, and a splice with no crop change reads as a glitch.
// Re-cut the footage → recompute this table. The rows below are the DEMO's.
const BEATS = [
  { from: 0, to: 155, start: 1.0, end: 1.03 }, // wide — the poster lives behind the head here
  { from: 155, to: 290, start: 1.16, end: 1.19 }, // punch — the poster leaves on this splice
  { from: 290, to: 405, start: 1.06, end: 1.09 }, // wide
  { from: 405, to: 540, start: 1.12, end: 1.15 }, // step
];

// style.grade: a hair more contrast and colour plus a vignette, or the footage as shot. Applied to
// the cutout too, so it matches the video it was lifted from.
const GRADE = STYLE.grade ? "contrast(1.05) saturate(1.06) brightness(0.97)" : undefined;
const PUNCH = ({ none: 0, soft: 0.5, strong: 1 } as Record<string, number>)[STYLE.motion.punch] ?? 1;
const CLAMP = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/**
 * `behind` renders BETWEEN the footage and a per-frame cutout of the person (public/cut/NNNN.png,
 * made by `scripts/matte.py` for the first `cutUntil` frames, at 1080x1920 = the same object-fit
 * mapping as the video). That is what puts the opening poster behind the head. Everything sits
 * inside one transformed wrapper, so the punch-in scales the poster with the wall.
 *
 * Until a take is cut (no public/footage.mp4) a placeholder stands in, so the demo renders.
 */
export const Footage: React.FC<{ behind?: React.ReactNode; cutUntil?: number }> = ({
  behind,
  cutUntil = 0,
}) => {
  const frame = useCurrentFrame();
  const files = useMemo(() => new Set(getStaticFiles().map((f) => f.name)), []);
  const beat = BEATS.find((b) => frame < b.to) ?? BEATS[BEATS.length - 1];
  const scale = 1 + (interpolate(frame, [beat.from, beat.to], [beat.start, beat.end], CLAMP) - 1) * PUNCH;
  const cut = `cut/${String(frame).padStart(4, "0")}.png`;
  const fit = {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    filter: GRADE,
  } as const;

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          // origin above centre keeps the eyeline steady while the crop tightens
          transform: `scale(${scale})`,
          transformOrigin: "50% 42%",
        }}
      >
        {files.has("footage.mp4") ? (
          // inline style, not a class: Remotion sets objectFit inline and that wins
          <OffthreadVideo src={staticFile("footage.mp4")} style={fit} />
        ) : (
          <Placeholder />
        )}
        {behind}
        {frame < cutUntil && files.has(cut) ? (
          <Img src={staticFile(cut)} style={{ position: "absolute", inset: 0, ...fit }} />
        ) : null}
      </AbsoluteFill>
      {STYLE.grade ? (
        // vignette: transparent over the face, pulling the bright walls down
        <AbsoluteFill
          style={{
            pointerEvents: "none",
            background:
              "radial-gradient(120% 85% at 50% 36%, rgba(0,0,0,0) 42%, rgba(0,0,0,0.13) 68%, rgba(0,0,0,0.34) 100%)",
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
};

/** Stands in for the take until `scripts/cut.py` writes public/footage.mp4. */
const Placeholder: React.FC = () => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(70% 45% at 50% 55%, ${rgba(BRAND.light, 0.14)} 0%, ${BRAND.dark} 100%)`,
      alignItems: "center",
    }}
  >
    {/* a head-and-shoulders silhouette, so the poster and the captions have something to sit around */}
    <svg width={760} height={1100} viewBox="0 0 760 1100" style={{ position: "absolute", top: 640 }}>
      <circle cx={380} cy={250} r={190} fill={rgba(BRAND.light, 0.16)} />
      <path d="M 40 1100 Q 40 560 380 560 Q 720 560 720 1100 Z" fill={rgba(BRAND.light, 0.16)} />
    </svg>
  </AbsoluteFill>
);
