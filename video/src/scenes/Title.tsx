import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { measureText } from "@remotion/layout-utils";
import { BRAND, FONT, STYLE } from "../brand";
import { CASCADE, CLAMP, EASE, Reveal, useReveal } from "../ui/Panel";

export type TitleLine = { text: string; accent?: boolean };

// the poster runs the lines to ~6% margins, wider than title-safe — the poster only
const MAX_W = 1080 - 64 * 2;

/**
 * The opening poster: an optional small kicker line, then big lines that each fill the width,
 * sitting BEHIND the speaker (Footage renders it under the person cutout). Case and kicker come
 * from the profile (style.poster). Lines reveal by mask one cascade step apart and leave by the
 * same mask before `out` — put `out` ON the first splice, so the punch-in covers the exit. Every
 * line auto-fits the width via measureText, capped at `cap` px so the block ends at the hairline
 * and the last line stays readable — never hand-tune a size.
 */
export const Title: React.FC<{ kicker?: string; lines: TitleLine[]; top: number; out: number; cap?: number }> = ({
  kicker,
  lines,
  top,
  out,
  cap = 215,
}) => {
  const frame = useCurrentFrame();
  const exit = interpolate(frame, [out - 12, out], [1, 0], EASE);
  const drift = 1 + frame * 0.00012;
  const kickerIn = useReveal(0, 14);
  return (
    <div
      style={{
        position: "absolute",
        left: 64,
        right: 64,
        top,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        transform: `scale(${drift})`,
        transformOrigin: "50% 40%",
      }}
    >
      {kicker && STYLE.poster.kicker ? (
        <Reveal progress={Math.min(kickerIn, exit)}>
          <div style={{ ...KICKER, marginBottom: 24 }}>{kicker}</div>
        </Reveal>
      ) : null}
      {lines.map((l, i) => (
        <TitleRow key={l.text} line={l} delay={(i + 1) * CASCADE * 2} exit={exit} cap={cap} />
      ))}
    </div>
  );
};

export const KICKER: React.CSSProperties = {
  fontFamily: BRAND.text,
  fontWeight: 600,
  fontSize: 42,
  letterSpacing: "-0.01em",
  color: BRAND.light,
  textShadow: "0 4px 24px rgba(0,0,0,0.4)",
};

/** the poster line as the profile wants it cased */
export const posterText = (t: string) => (STYLE.poster.case === "upper" ? t.toUpperCase() : t);

/** px size that makes `text` fill the poster width, capped at `cap` */
export const posterSize = (text: string, cap: number) => {
  const w = measureText({
    text,
    fontFamily: FONT.poster,
    fontWeight: String(FONT.posterWeight),
    fontSize: cap,
    letterSpacing: "0em",
  }).width;
  return w > MAX_W ? Math.floor((cap * MAX_W) / w) : cap;
};

const TitleRow: React.FC<{ line: TitleLine; delay: number; exit: number; cap: number }> = ({
  line,
  delay,
  exit,
  cap,
}) => {
  const enter = useReveal(delay, 18);
  const text = posterText(line.text);
  return (
    <Reveal progress={Math.min(enter, exit)}>
      <div
        style={{
          fontFamily: BRAND.poster,
          fontWeight: FONT.posterWeight,
          fontSize: posterSize(text, cap),
          lineHeight: 0.92,
          color: line.accent ? BRAND.accent : BRAND.light,
          whiteSpace: "nowrap",
          // exits sink back down behind the mask edge, the mirror of the entry
          transform: `translateY(${interpolate(exit, [0, 1], [30, 0], CLAMP)}%)`,
          textShadow: "0 8px 40px rgba(0,0,0,0.35)",
        }}
      >
        {text}
      </div>
    </Reveal>
  );
};

export default Title;
