import React, { useMemo } from "react";
import { Audio, Sequence, getStaticFiles, staticFile } from "remotion";
import { STYLE } from "../brand";

// Sounds are the user's: none ship with the project. With style.sfx on, the setup interview has the
// user generate them (ElevenLabs, in their chosen character) or drop their own files into
// public/sfx/ — named by ROLE, so the composition doesn't care what they sound like:
//   card.mp3  a card or the poster arrives        count.mp3  one tick of a rolling number
//   end.mp3   the closing element                 (any other name works too — add its level here)
// Levels are relative to voice = 1.0. No ducking: everything simply sits under the voice.
export const SFX: Record<string, number> = {
  card: 0.11,
  count: 0.09,
  end: 0.13,
};

export type SfxName = string;

// Trim on the whole SFX bus — adjust here, not per cue, so the balance between sounds is kept.
const GAIN = 0.7;

const useHas = () => useMemo(() => new Set(getStaticFiles().map((f) => f.name)), []);

/**
 * A rolling count needs to SOUND like it is counting. Ticks are spaced in VALUE space, not in
 * time: the counter eases out, so inverting that curve makes the ticks dense at the start and
 * thin out as the number settles — the way a real mechanical counter behaves. Evenly spaced
 * ticks against an eased number read as two unrelated things happening at once.
 */
export const Ticks: React.FC<{
  from: number;
  to: number;
  count?: number;
  ease?: (t: number) => number;
}> = ({ from, to, count = 22, ease = (t) => 1 - Math.pow(1 - t, 3) }) => {
  const frames: number[] = [];
  for (let i = 1; i <= count; i++) {
    const value = i / count; // where the counter is, 0..1
    // invert the ease to find WHEN the counter reaches that value
    let lo = 0;
    let hi = 1;
    for (let k = 0; k < 24; k++) {
      const mid = (lo + hi) / 2;
      if (ease(mid) < value) lo = mid;
      else hi = mid;
    }
    frames.push(Math.round(from + (to - from) * lo));
  }
  // the last tick lands on the final number; drop duplicates from rounding
  return (
    <>
      {[...new Set(frames)].map((f, i) => (
        <Cue key={f} name="count" at={f} volume={(SFX.count ?? 0.09) * (i === 0 ? 1.3 : 1)} />
      ))}
    </>
  );
};

// One cue = one sound placed on a motion hit. `at` is an absolute frame on the composition
// timeline; place it 1-2 frames BEFORE the visual peak or the sound reads as late. Silent when
// the user switched sound off or the file isn't there.
export const Cue: React.FC<{ name: SfxName; at: number; volume?: number }> = ({ name, at, volume }) => {
  const has = useHas();
  if (!STYLE.sfx || !has.has(`sfx/${name}.mp3`)) return null;
  return (
    <Sequence from={at} durationInFrames={90} layout="none">
      {/* eslint-disable-next-line @remotion/volume-callback -- a cue is one fixed level, no ramp */}
      <Audio src={staticFile(`sfx/${name}.mp3`)} volume={(volume ?? SFX[name] ?? 0.12) * GAIN} />
    </Sequence>
  );
};
