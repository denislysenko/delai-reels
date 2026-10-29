import React, { useMemo } from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { measureText } from "@remotion/layout-utils";
import { BRAND, FONT, PACE, SAFE, STYLE, rgba } from "../brand";
import captions from "../../public/captions.json";
import { Reveal } from "../ui/Panel";

/*
 * The LOOK is the user's (harness.config.json → style.captions, chosen in the setup interview):
 *   layout    «cycle» = phrases move upper-left → upper-right → lower rail; «rail» = always the
 *             lower rail; «center» = the middle of the frame
 *   case      «lower» / «asis» / «upper»
 *   size      [body, payload] px — payload is an em:2 word, used when highlight has «size»
 *   weight    font weight
 *   highlight «color» (accent:1 words in the accent colour) / «size» (em:2 words bigger) /
 *             «both» / «none»
 *   box       a plate behind each line instead of a shadow
 * What stays fixed is the MECHANICS: one size for the whole video, measured wrapping, a mask per
 * line, short function words never ending a line.
 */
const C = STYLE.captions;
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

const FPS = 30;
const MAX_WORDS = 4;

// em: 2 = payload word, 1 = normal, 0 = filler. Assigned per word in captions.json by meaning,
// not by length — a length heuristic shouts on every long word and the emphasis stops reading.
type Raw = { w: string; s: number; e: number; em: 0 | 1 | 2; accent?: number };
type Word = Raw & { ends: boolean; i: number };
// No punctuation on screen. `ends` keeps the sentence boundary the stripped punctuation used to
// mark, so grouping still breaks on it.
const clean = (w: string) => w.replace(/[.,!?…:;»«"]/g, "");
// acronyms keep their case in lowercase captions — a lowercase «ai» reads as a typo
const keepCase = (w: string) => /^[A-ZА-ЯЁ]{2,}/.test(w) || w === "I";
const cased = (w: string) =>
  C.case === "upper" ? w.toUpperCase() : C.case === "lower" && !keepCase(w) ? w.toLowerCase() : w;
const words: Word[] = (captions as Raw[]).map((w, i) => ({
  ...w,
  i,
  ends: /[.!?…]$/.test(w.w),
  w: cased(clean(w.w)),
}));

const BIG = C.highlight === "size" || C.highlight === "both";
const COLOR = C.highlight === "color" || C.highlight === "both";
// One uniform size for the body; only an em:2 word grows (if the user wants size emphasis).
// Filler is never shrunk — mixed-down sizes read as noise.
const SIZE = [C.size[0], C.size[0], BIG ? C.size[1] : C.size[0]] as const;

// measureText needs the bare family name — hand it a stack with quotes/fallbacks and it
// silently measures the fallback face, which is narrower, and every line overflows the frame.
const MEASURE_FONT = FONT.text;
const WEIGHT = String(C.weight);
// ~1.5 spaces at the body size, plus the glyphs' own side bearings
const GAP = Math.round(C.size[0] * 0.32);
const MAX_W = 1080 - SAFE.side * 2 - (C.box ? C.size[0] * 0.7 : 0); // title-safe 10%, minus the plate's padding
const MAX_LINES = 3;

const widthOf = (word: Word, scale: number) =>
  measureText({
    text: word.w,
    fontFamily: MEASURE_FONT,
    fontWeight: WEIGHT,
    fontSize: SIZE[word.em] * scale,
    letterSpacing: "-0.02em",
  }).width;

// Greedy wrap at a given scale; null when it doesn't fit the box.
const wrap = (group: Word[], scale: number) => {
  const lines: Word[][] = [[]];
  let lineW = 0;
  for (const word of group) {
    const w = widthOf(word, scale);
    if (w > MAX_W) return null;
    const next = lines[lines.length - 1].length === 0 ? w : lineW + GAP * scale + w;
    if (next > MAX_W) {
      // a short function word never ends a line («…пишем в / блог» reads wrong): it goes
      // down with the word it belongs to
      const cur = lines[lines.length - 1];
      const tail = cur[cur.length - 1];
      if (cur.length > 1 && tail.em === 0 && tail.w.length <= 2) {
        cur.pop();
        lines.push([tail, word]);
        lineW = widthOf(tail, scale) + GAP * scale + w;
      } else {
        lines.push([word]);
        lineW = w;
      }
    } else {
      lines[lines.length - 1].push(word);
      lineW = next;
    }
  }
  return lines.length > MAX_LINES ? null : lines;
};

// Stepped in hundredths rather than by repeated subtraction: `scale -= 0.04` accumulates float
// error, and the value that comes out (0.48000000000000015) is not the one that was measured.
const STEPS = 4; // hundredths per step
const FLOOR = 30; // hundredths — low enough that no real phrase reaches it

const fit = (group: Word[]) => {
  for (let s = 100; s >= FLOOR; s -= STEPS) {
    const scale = s / 100;
    const lines = wrap(group, scale);
    if (lines) return { lines, scale };
  }
  return { lines: null, scale: FLOOR / 100 };
};

// Groups of up to MAX_WORDS, cut early at sentence-ending punctuation.
const groups: Word[][] = [];
const groupOfWord: number[] = [];
const short = (w: Word) => w.em === 0 && w.w.length <= 2;
words.forEach((word, i) => {
  let g = groups[groups.length - 1];
  // a short function word («а», «с», «и») never closes a group — it opens the next one with
  // the word it belongs to, otherwise it dangles at the end of a line
  if (!g || g.length >= MAX_WORDS || (g.length === MAX_WORDS - 1 && short(word))) {
    g = [];
    groups.push(g);
  }
  g.push(word);
  groupOfWord[i] = groups.length - 1;
  if (word.ends && g.length >= 2) {
    groups.push([]);
  }
});
if (groups[groups.length - 1].length === 0) {
  groups.pop();
}

/**
 * Where a phrase lands. «cycle»: upper-left, upper-right, lower rail by group index — the upper
 * zones sit on the wall above the head (~740 in a typical framing); while a card, a sticker or the
 * poster is up it owns the upper half, so the phrase drops to the rail. «rail»: always low.
 * «center»: the middle of the frame, always.
 */
type Zone = "upL" | "upR" | "low" | "mid";
const CYCLE: Zone[] = ["upL", "upR", "low"];
const UP_TOP = 270;
// the lower rail hangs from the platform band: a block grows UPWARD from SAFE.bottom, so a
// one-line phrase sits as low as possible and a three-line one never enters the band
const LOW_BOTTOM = 1920 - SAFE.bottom + 12;
const OUT = Math.round(6 * PACE); // frames the old phrase takes to sink away while the next one rises
const RISE = Math.round(10 * PACE); // frames one word takes to rise into its line
const STEP = Math.max(1, Math.round(2 * PACE)); // frames between words of a phrase

const Captions: React.FC<{
  /** frames before which nothing is shown (the poster carries the hook) */
  from?: number;
  /** [from, to) windows in which the upper half is taken (cards, stickers, the poster) */
  busy?: [number, number][];
  /** frame by which the last phrase must be gone */
  until?: number;
}> = ({ from = 0, busy = [], until = Infinity }) => {
  const frame = useCurrentFrame();

  // ONE scale for the whole video — the tightest group decides it. Scaling each group on its
  // own makes the type size jump from phrase to phrase.
  // Computed on first render (fonts are loaded by then; at module scope they are not).
  const scale = useMemo(() => Math.min(...groups.map((g) => fit(g).scale)), []);

  if (frame < from) {
    return <AbsoluteFill className="bg-transparent" />;
  }

  // Last word that has started. Between words this keeps the group on screen.
  let current = -1;
  for (let i = 0; i < words.length; i++) {
    if (frame >= words[i].s * FPS) {
      current = i;
    }
  }
  if (current === -1) {
    return <AbsoluteFill className="bg-transparent" />;
  }

  const gi = groupOfWord[current];
  // The previous phrase is still sinking away for the first OUT frames of this one.
  const curStart = groups[gi][0].s * FPS;
  const showPrev = gi > 0 && frame < curStart + OUT && groups[gi - 1][0].s * FPS >= from;

  return (
    <AbsoluteFill className="bg-transparent">
      {showPrev ? <Phrase gi={gi - 1} current={-1} scale={scale} busy={busy} until={until} /> : null}
      <Phrase gi={gi} current={current} scale={scale} busy={busy} until={until} />
    </AbsoluteFill>
  );
};

const zoneOf = (gi: number, start: number, end: number, busy: [number, number][]): Zone => {
  if (C.layout === "center") return "mid";
  if (C.layout !== "cycle") return "low";
  const zone = CYCLE[gi % CYCLE.length];
  if (zone === "low") return zone;
  return busy.some(([a, b]) => start < b && end > a) ? "low" : zone;
};

const PLACE: Record<Zone, React.CSSProperties> = {
  upL: { top: UP_TOP, alignItems: "flex-start", transformOrigin: "0% 0%" },
  upR: { top: UP_TOP, alignItems: "flex-end", transformOrigin: "100% 0%" },
  low: { bottom: LOW_BOTTOM, alignItems: "center", transformOrigin: "50% 100%" },
  mid: { top: 0, bottom: 0, justifyContent: "center", alignItems: "center", transformOrigin: "50% 50%" },
};

const Phrase: React.FC<{
  gi: number;
  current: number;
  scale: number;
  busy: [number, number][];
  until: number;
}> = ({ gi, current, scale, busy, until }) => {
  const frame = useCurrentFrame();
  const group = groups[gi];
  const groupStart = group[0].s * FPS;
  // the phrase ends when the next one begins; the last one when its last word is spoken
  const next = groups[gi + 1];
  // whisper's last-word end can run past the footage, so the closing phrase leaves on `until`
  const groupEnd = next ? next[0].s * FPS : Math.min(group[group.length - 1].e * FPS + 6, until);
  const zone = zoneOf(gi, groupStart, groupEnd, busy);

  // One word per line if the measurement ever fails — a stack of short lines is ugly, a phrase
  // running off both edges of the frame is broken. With the floor above this is unreachable.
  const lines = wrap(group, scale) ?? group.map((w) => [w]);

  // The entry lives on the words (the mask cascade below), never on the container — animating
  // both double-fades the phrase.
  const ease = { ...clamp, easing: Easing.out(Easing.cubic) };
  const out = interpolate(frame, [groupEnd, groupEnd + OUT], [1, 0], ease);
  // a slow linear drift so a phrase that has landed doesn't freeze
  const drift = 1 + ((frame - groupStart) * 0.00016) / PACE;

  return (
    <div
      className="absolute flex flex-col"
      style={{
        left: SAFE.side,
        right: SAFE.side,
        ...PLACE[zone],
        gap: (C.box ? 10 : 6) * scale,
        transform: `scale(${drift})`,
      }}
    >
      {lines.map((line, li) => {
        // The mask is per LINE, not per word: a per-word mask box carries its own em padding, so
        // words of two sizes in one row would no longer share a baseline. Inside the line the
        // words are plain inline-blocks on one baseline; each rises behind the line's edge on its
        // own cascade step. Never a CSS `filter` on the line — it rasterises the text and any
        // transform inside it comes out resampled (blurry).
        const big = Math.max(...line.map((w) => SIZE[w.em])) * scale;
        return (
          <div key={li}>
            <Reveal progress={out} pad={C.box ? 0.5 : 0.9} size={big}>
              <div
                style={{
                  whiteSpace: "nowrap",
                  lineHeight: 1.15,
                  fontSize: big,
                  ...(C.box
                    ? {
                        backgroundColor: rgba(BRAND.dark, 0.78),
                        padding: "0.08em 0.35em 0.14em",
                        borderRadius: "0.28em",
                      }
                    : null),
                }}
              >
                {line.map((word, wi) => {
                  const active = word.i === current;
                  // each word arrives a cascade step after the previous one, so the phrase lands
                  // as a sequence instead of a single block
                  const delay = (word.i - group[0].i) * STEP;
                  const wordIn = interpolate(frame - groupStart - delay, [0, RISE], [0, 1], ease);
                  return (
                    <span
                      key={`${word.s}-${word.w}`}
                      className="tracking-[-0.02em]"
                      style={{
                        display: "inline-block",
                        verticalAlign: "baseline",
                        fontFamily: BRAND.text,
                        color: COLOR && word.accent ? BRAND.accent : BRAND.light,
                        fontWeight: WEIGHT,
                        fontSize: SIZE[word.em] * scale,
                        marginRight: wi < line.length - 1 ? GAP * scale : 0,
                        // 130%: the mask bleeds below the line, so 100% would still show the top
                        transform: `translateY(${(1 - wordIn) * 130}%)`,
                        // the spoken word gets full opacity, the rest 0.92 — no scale: a pop eats
                        // the gaps either side and the spacing looks uneven
                        opacity: interpolate(wordIn, [0, 0.35], [0, 1], clamp) * (active ? 1 : 0.92),
                        textShadow: C.box
                          ? undefined
                          : "0 6px 22px rgba(0,0,0,0.55), 0 1px 3px rgba(0,0,0,0.35)",
                      }}
                    >
                      {word.w}
                    </span>
                  );
                })}
              </div>
            </Reveal>
          </div>
        );
      })}
    </div>
  );
};

export default Captions;
