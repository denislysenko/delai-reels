import React, { useMemo } from "react";
import { AbsoluteFill, Img, OffthreadVideo, interpolate, staticFile, useCurrentFrame } from "remotion";
import { measureText } from "@remotion/layout-utils";
import { BRAND, FONT, SAFE } from "../brand";
import type { SfxName } from "./Sfx";
import {
  CASCADE,
  CLAMP,
  EASE,
  Panel,
  Reveal,
  TYPE,
  useExit,
  usePanelProgress,
  useReveal,
} from "./Panel";

/**
 * The overlay card. One chrome (Panel), one type scale (TYPE), one cascade, so every card in a
 * video matches; every beat is a row in the BEATS table in Composition.tsx instead of a bespoke
 * component.
 *
 * The accent colour goes on the counter when there is one, otherwise on the head line flagged by
 * `accent`. `pain` swaps it to the pain colour.
 */
export type Beat = {
  /** absolute frame the card enters on — 4 frames after the first word of its phrase */
  from: number;
  /** how long it lives, in frames */
  dur: number;
  /** compact stroke pictogram above the headline (or beside it, with artDelay) */
  art?: ArtName;
  /** frames after card entry before the pictogram draws. A delayed pictogram sits to the
   *  RIGHT of the headline (an empty slot above the head waiting for it reads as a hole). */
  artDelay?: number;
  /** a row of icons with one-word captions under the headline, each landing ON its word:
   *  `off` = the word's frame minus `from` (look it up in captions.json) */
  row?: RowItem[];
  /** numeral to the left of the headline, for steps */
  num?: string;
  /** 1-2 headline lines — each gets its own reveal mask */
  head?: string[];
  /** a rolling counter INSTEAD of a headline. Always paired with <Ticks> in Composition. */
  count?: { to: number; suffix?: string };
  /** index of the head line that carries the accent colour */
  accent?: number;
  /** supporting lines, cascaded in after the headline */
  lines?: string[];
  top?: number;
  /**
   * Trim the panel to this width instead of running the full title-safe span. A FIXED number,
   * not fit-content: a counter card would otherwise grow as the digits do (0 -> 20) and the
   * panel would visibly resize mid-count.
   */
  width?: number;
  /** the pain colour instead of the accent — for the «don't» card, if the user wants one */
  pain?: boolean;
  /** the closing card holds to the last frame and never exits */
  hold?: boolean;
  /** sound role fired 2 frames before the card enters (ui/Sfx.tsx); defaults to "card" */
  sfx?: SfxName;
};

const EXIT = 9; // frames the card takes to leave

// Panel content box: frame minus the title-safe margins minus the panel's own padding, minus
// the sideways bleed the Reveal mask adds so it only ever clips vertically.
const CONTENT_W = 1080 - SAFE.side * 2 - 56 * 2 - 14;

/**
 * ONE headline size for every card in the video, measured rather than guessed.
 *
 * Measured per LINE, not per word: a line wider than the panel would auto-wrap, and a wrapped
 * headline reads as a broken plate. The widest authored line across the whole beat sheet
 * decides the size, every card uses it, so the type scale stays uniform, nothing clips and
 * nothing wraps. Want bigger type? Break the line in the beat sheet, not here.
 */
export const useHeadScale = (beats: Beat[]) =>
  useMemo(() => {
    const widest = Math.max(
      ...beats.flatMap((b) =>
        (b.head ?? []).map(
          (line) =>
            measureText({
              text: line,
              fontFamily: FONT.text,
              fontWeight: String(TYPE.headline.fontWeight),
              fontSize: TYPE.headline.fontSize,
              letterSpacing: TYPE.headline.letterSpacing,
            }).width,
        ),
      ),
    );
    return Math.min(1, CONTENT_W / widest);
  }, [beats]);

/**
 * Pictograms, drawn in the same language as the type: the stroke arrives by a travelling dash
 * mask (never a fade), elements stagger like the text cascade, easing is the shared EASE.
 * After landing every one keeps acting out its process on a slow sine/linear loop — a static
 * glyph is half the job. Neutral (currentColor) on purpose: the card's one accent element
 * stays the flagged head line. Draw the boring, conventional pictogram — a clever one is a riddle.
 *
 * Two kinds: hand-drawn compact arts (CashArt…) and row glyphs `g*` (cx, t) => svg, drawn for a
 * 60px-tall column. Every glyph also works alone at sticker size through `soloArt`.
 */
type ArtProps = { delay?: number };
const STROKE = {
  stroke: "currentColor",
  strokeWidth: 7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  fill: "none",
};

const useDraw = (delay: number, duration = 22) => {
  const frame = useCurrentFrame();
  return interpolate(frame - delay, [0, duration], [0, 1], EASE);
};

const dash = (p: number) => ({
  pathLength: 100,
  strokeDasharray: 100,
  strokeDashoffset: 100 * (1 - p),
});

const drawAt = (frame: number, delay: number, duration = 22) =>
  interpolate(frame - delay, [0, duration], [0, 1], EASE);

type RowItem = {
  /** frames after the row's start when this icon lands — the word onset from captions.json */
  off: number;
  label: string;
  glyph: GlyphName;
};

/**
 * One row of icons with captions under them, for an enumeration. Each column lands ON its word
 * and then keeps acting out its own process in a slow loop.
 * 740px wide because the panel's content box is 752.
 */
const IconRow: React.FC<{ items: RowItem[]; delay: number }> = ({ items, delay }) => {
  const frame = useCurrentFrame();
  const span = 800 / items.length;
  // the caption has to fit its own column: at six columns 24px runs into the neighbour
  const labelSize = span < 150 ? 20 : 24;
  return (
    <svg width={740} height={120} viewBox="0 0 800 130">
      {items.map((it, i) => {
        const cx = span * (i + 0.5);
        const p = drawAt(frame, delay + it.off, 12);
        const t = Math.max(0, frame - (delay + it.off));
        return (
          <g key={it.label}>
            <g style={{ opacity: p, transform: `translateY(${(1 - p) * 10}px)` }}>
              {GLYPH[it.glyph](cx, t)}
            </g>
            <ColLabel x={cx} text={it.label} p={p} size={labelSize} />
          </g>
        );
      })}
    </svg>
  );
};

const CashArt: React.FC<ArtProps> = ({ delay = 0 }) => {
  const ring = useDraw(delay, 24);
  const sign = useDraw(delay + 10, 14);
  return (
    <svg width={116} height={100} viewBox="0 0 120 100">
      <circle cx={60} cy={50} r={40} {...STROKE} {...dash(ring)} />
      <text
        x={60}
        y={54}
        textAnchor="middle"
        dominantBaseline="central"
        fill="currentColor"
        stroke="none"
        style={{
          fontFamily: BRAND.text,
          fontWeight: 700,
          fontSize: 46,
          opacity: sign,
        }}
      >
        {BRAND.currency}
      </text>
    </svg>
  );
};

const DebtArt: React.FC<ArtProps> = ({ delay = 0 }) => {
  const p = [useDraw(delay), useDraw(delay + 7), useDraw(delay + 14)];
  const blocks = [
    { x: 26, y: 82 },
    { x: 42, y: 50 },
    { x: 32, y: 18 },
  ];
  return (
    <svg width={150} height={112} viewBox="0 0 160 120">
      {blocks.map((b, i) => (
        <g key={b.y} style={{ opacity: p[i], transform: `translateY(${(1 - p[i]) * 12}px)` }}>
          <rect x={b.x} y={b.y} width={94} height={24} rx={7} {...STROKE} />
        </g>
      ))}
    </svg>
  );
};

const TargetArt: React.FC<ArtProps> = ({ delay = 0 }) => {
  const ring = useDraw(delay, 26);
  const dot = useDraw(delay + 16, 12);
  return (
    <svg width={150} height={112} viewBox="0 0 160 120">
      <circle cx={80} cy={60} r={42} {...STROKE} {...dash(ring)} />
      <circle cx={80} cy={60} r={9} fill="currentColor" style={{ opacity: dot }} />
    </svg>
  );
};

const GapArt: React.FC<ArtProps> = ({ delay = 0 }) => {
  const left = useDraw(delay, 16);
  const right = useDraw(delay + 6, 16);
  const crack = useDraw(delay + 14, 18);
  return (
    <svg width={150} height={112} viewBox="0 0 160 120">
      <g style={{ opacity: left, transform: `translateX(${(1 - left) * 8}px)` }}>
        <rect x={14} y={32} width={52} height={56} rx={8} {...STROKE} />
      </g>
      <g style={{ opacity: right, transform: `translateX(${(1 - right) * -8}px)` }}>
        <rect x={94} y={32} width={52} height={56} rx={8} {...STROKE} />
      </g>
      <path d="M 82 18 L 73 45 L 87 62 L 75 86 L 81 102" {...STROKE} {...dash(crack)} />
    </svg>
  );
};

const ColLabel: React.FC<{ x: number; text: string; p: number; size?: number }> = ({
  x,
  text,
  p,
  size = 24,
}) => (
  <text
    x={x}
    y={118}
    textAnchor="middle"
    fill="currentColor"
    stroke="none"
    style={{
      fontFamily: BRAND.text,
      fontWeight: 600,
      fontSize: size,
      letterSpacing: "-0.01em",
      opacity: 0.85 * p,
    }}
  >
    {text}
  </text>
);

const THIN = { ...STROKE, strokeWidth: 5 };

const Face: React.FC<ArtProps & { down?: boolean }> = ({ delay = 0, down }) => {
  const ring = useDraw(delay, 18);
  const eyes = useDraw(delay + 10, 8);
  const mouth = useDraw(delay + 14, 14);
  return (
    <svg width={150} height={112} viewBox="0 0 160 120">
      <circle cx={80} cy={56} r={34} {...STROKE} {...dash(ring)} />
      <g style={{ opacity: eyes }}>
        <circle cx={67} cy={46} r={4.5} fill="currentColor" stroke="none" />
        <circle cx={93} cy={46} r={4.5} fill="currentColor" stroke="none" />
      </g>
      <path
        d={down ? "M 64 76 Q 80 62 96 76" : "M 64 66 Q 80 82 96 66"}
        {...STROKE}
        {...dash(mouth)}
      />
    </svg>
  );
};

const SmileArt: React.FC<ArtProps> = (p) => <Face {...p} />;

const FrownArt: React.FC<ArtProps> = (p) => <Face {...p} down />;

const SparkArt: React.FC<ArtProps> = ({ delay = 0 }) => {
  const frame = useCurrentFrame();
  const draw = useDraw(delay, 20);
  const small = useDraw(delay + 10, 12);
  const t = Math.max(0, frame - delay);
  const pulse = 1 + 0.05 * Math.sin((t / 70) * Math.PI * 2);
  return (
    <svg width={150} height={112} viewBox="0 0 160 120">
      <g transform={`translate(74 62) scale(${pulse}) translate(-74 -62)`}>
        <path
          d="M 74 20 Q 78 54 108 62 Q 78 70 74 104 Q 70 70 40 62 Q 70 54 74 20 Z"
          {...STROKE}
          {...dash(draw)}
        />
      </g>
      <path
        d="M 124 24 Q 126 38 138 40 Q 126 42 124 56 Q 122 42 110 40 Q 122 38 124 24 Z"
        {...STROKE}
        strokeWidth={5}
        style={{ opacity: small }}
      />
    </svg>
  );
};

const BuildingArt: React.FC<ArtProps> = ({ delay = 0 }) => {
  const frame = useCurrentFrame();
  const box = useDraw(delay, 20);
  const t = Math.max(0, frame - delay);
  const win = (k: number) =>
    box * (0.35 + 0.65 * Math.max(0, Math.sin((t / 80) * Math.PI * 2 + k * 1.5)));
  return (
    <svg width={150} height={112} viewBox="0 0 160 120">
      {/* the tower */}
      <path d="M 50 104 V 30 H 110 V 104" {...STROKE} {...dash(box)} />
      {/* roof cap, so it can't read as a phone */}
      <path d="M 44 30 H 116" {...STROKE} {...dash(box)} />
      <path d="M 80 30 V 18" {...STROKE} {...dash(box)} />
      {/* ground line */}
      <path d="M 36 104 H 124" {...STROKE} {...dash(box)} />
      {[0, 1, 2].map((row) =>
        [0, 1].map((col) => (
          <rect
            key={`${row}-${col}`}
            x={62 + col * 22}
            y={42 + row * 20}
            width={14}
            height={13}
            rx={2}
            fill="currentColor"
            stroke="none"
            style={{ opacity: win(row * 2 + col) }}
          />
        )),
      )}
    </svg>
  );
};

const GearArt: React.FC<ArtProps> = ({ delay = 0 }) => {
  const frame = useCurrentFrame();
  const draw = useDraw(delay, 20);
  const t = Math.max(0, frame - delay);
  const teeth = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
    const a = (i / 8) * Math.PI * 2;
    const w = 0.13; // half-width of a tooth, in radians
    const p = (r: number, ang: number) =>
      `${80 + Math.cos(ang) * r} ${60 + Math.sin(ang) * r}`;
    return `M ${p(25, a - w)} L ${p(37, a - w * 0.62)} L ${p(37, a + w * 0.62)} L ${p(25, a + w)}`;
  });
  return (
    <svg width={150} height={112} viewBox="0 0 160 120">
      <g transform={`rotate(${(t / 150) * 45} 80 60)`}>
        <circle cx={80} cy={60} r={25} {...STROKE} {...dash(draw)} />
        {teeth.map((d, i) => (
          <path key={i} d={d} {...STROKE} {...dash(draw)} />
        ))}
      </g>
      <circle cx={80} cy={60} r={9} {...STROKE} strokeWidth={5} style={{ opacity: draw }} />
    </svg>
  );
};

const LockArt: React.FC<ArtProps> = ({ delay = 0 }) => {
  const frame = useCurrentFrame();
  const body = useDraw(delay, 18);
  const t = Math.max(0, frame - delay);
  const open = (t % 90) < 24 ? 1 - ((t % 90) / 24) : 0; // shackle lifts, then clicks down
  return (
    <svg width={150} height={130} viewBox="0 0 160 140">
      <rect x={40} y={62} width={80} height={62} rx={12} {...STROKE} {...dash(body)} />
      <path
        d={`M 58 62 V ${44 - open * 10} Q 58 ${20 - open * 10} 80 ${20 - open * 10} Q 102 ${20 - open * 10} 102 ${44 - open * 10} V 62`}
        {...STROKE}
        {...dash(body)}
      />
      <circle cx={80} cy={92} r={7} fill="currentColor" stroke="none" style={{ opacity: body }} />
    </svg>
  );
};

const HoursArt: React.FC<ArtProps> = ({ delay = 0 }) => {
  const frame = useCurrentFrame();
  const glass = useDraw(delay, 22);
  const t = Math.max(0, frame - delay);
  const run = (t % 110) / 110; // 0 -> 1 over one turn of the glass
  return (
    <svg width={150} height={130} viewBox="0 0 160 140">
      <line x1={44} y1={14} x2={116} y2={14} {...STROKE} {...dash(glass)} />
      <line x1={44} y1={126} x2={116} y2={126} {...STROKE} {...dash(glass)} />
      <path d="M 52 14 L 52 46 L 80 70 L 108 46 L 108 14" {...STROKE} {...dash(glass)} />
      <path d="M 52 126 L 52 94 L 80 70 L 108 94 L 108 126" {...STROKE} {...dash(glass)} />
      {/* the sand: the top body empties as the bottom fills */}
      <g style={{ opacity: glass }}>
        <path
          d={`M ${52 + run * 26} ${20 + run * 24} L ${108 - run * 26} ${20 + run * 24} L 80 70 Z`}
          fill="currentColor"
          stroke="none"
        />
        <path
          d={`M ${80 - run * 26} ${120} L ${80 + run * 26} 120 L 80 ${120 - run * 26} Z`}
          fill="currentColor"
          stroke="none"
        />
        <line x1={80} y1={72} x2={80} y2={112} {...THIN} style={{ opacity: run > 0.05 && run < 0.95 ? 0.8 : 0 }} />
      </g>
    </svg>
  );
};

const AskArt: React.FC<ArtProps> = ({ delay = 0 }) => {
  const frame = useCurrentFrame();
  const bubble = useDraw(delay, 20);
  const t = Math.max(0, frame - delay);
  const cyc = t % 66;
  const dot = (k: number) => Math.max(0, Math.min(1, (cyc - 6 - k * 9) / 5)) * (cyc > 56 ? 0 : 1);
  return (
    <svg width={170} height={120} viewBox="0 0 180 120">
      <path
        d="M 22 16 H 158 Q 172 16 172 30 V 76 Q 172 90 158 90 H 76 L 46 112 V 90 H 22 Q 8 90 8 76 V 30 Q 8 16 22 16 Z"
        {...STROKE}
        {...dash(bubble)}
      />
      <circle cx={56} cy={53} r={8} fill="currentColor" stroke="none" style={{ opacity: dot(0) }} />
      <circle cx={90} cy={53} r={8} fill="currentColor" stroke="none" style={{ opacity: dot(1) }} />
      <circle cx={124} cy={53} r={8} fill="currentColor" stroke="none" style={{ opacity: dot(2) }} />
    </svg>
  );
};

const CheckArt: React.FC<ArtProps> = ({ delay = 0 }) => {
  const ring = useDraw(delay, 18);
  const tick = useDraw(delay + 10, 14);
  return (
    <svg width={150} height={112} viewBox="0 0 160 120">
      <circle cx={80} cy={60} r={38} {...STROKE} {...dash(ring)} />
      <path d="M 60 60 L 74 74 L 102 44" {...STROKE} {...dash(tick)} />
    </svg>
  );
};

const BillArt: React.FC<ArtProps> = ({ delay = 0 }) => {
  const frame = useCurrentFrame();
  const page = useDraw(delay, 20);
  const t = Math.max(0, frame - delay);
  const scan = (t % 70) / 70; // the checking line runs down the invoice
  return (
    <svg width={150} height={112} viewBox="0 0 160 120">
      <path d="M 50 14 H 110 V 100 L 100 92 L 90 100 L 80 92 L 70 100 L 60 92 L 50 100 Z" {...STROKE} {...dash(page)} />
      <line x1={62} y1={38} x2={98} y2={38} {...THIN} style={{ opacity: page * 0.9 }} />
      <line x1={62} y1={54} x2={90} y2={54} {...THIN} style={{ opacity: page * 0.9 }} />
      <line
        x1={58}
        y1={30 + scan * 44}
        x2={102}
        y2={30 + scan * 44}
        {...THIN}
        style={{ opacity: page * (1 - Math.abs(scan - 0.5) * 1.2) }}
      />
    </svg>
  );
};

const SendArt: React.FC<ArtProps> = ({ delay = 0 }) => {
  const frame = useCurrentFrame();
  const draw = useDraw(delay, 20);
  const t = Math.max(0, frame - delay);
  // a takeoff that RETURNS: 0 -> 1 -> 0 over the cycle, so the plane is never caught
  // half-gone — it may be the sticker that holds the last frame.
  const fly = (1 - Math.cos((t / 75) * Math.PI * 2)) / 2;
  return (
    <svg width={150} height={112} viewBox="0 0 160 120">
      <g
        style={{
          transform: `translate(${fly * 16}px, ${fly * -12}px)`,
          opacity: 1 - fly * 0.25,
        }}
      >
        <path d="M 128 22 L 34 62 L 72 74 Z" {...STROKE} {...dash(draw)} />
        <path d="M 128 22 L 72 74 L 78 104 L 96 82" {...STROKE} {...dash(draw)} />
      </g>
    </svg>
  );
};

const gCart = (cx: number, t: number) => (
  <>
    <path d={`M ${cx - 27} 12 H ${cx - 18} L ${cx - 9} 42 H ${cx + 17} L ${cx + 26} 21 H ${cx - 14}`} {...THIN} />
    <circle cx={cx - 5} cy={51} r={4} fill="currentColor" stroke="none" style={{ opacity: t % 52 < 26 ? 1 : 0.35 }} />
    <circle cx={cx + 13} cy={51} r={4} fill="currentColor" stroke="none" style={{ opacity: t % 52 < 26 ? 0.35 : 1 }} />
  </>
);

const gMega = (cx: number, t: number) => {
  const on = (k: number) => (t % 54 > k * 14 ? 1 : 0.2);
  return (
    <>
      <path d={`M ${cx - 26} 22 H ${cx - 12} L ${cx + 6} 8 V 50 L ${cx - 12} 36 H ${cx - 26} Z`} {...THIN} />
      <path d={`M ${cx + 16} 20 Q ${cx + 22} 29 ${cx + 16} 38`} {...THIN} style={{ opacity: on(0) }} />
      <path d={`M ${cx + 25} 13 Q ${cx + 35} 29 ${cx + 25} 45`} {...THIN} style={{ opacity: on(1) }} />
    </>
  );
};

const gCoin = (cx: number, t: number) => (
  <>
    <circle cx={cx} cy={30} r={21} {...THIN} />
    <text
      x={cx}
      y={31}
      textAnchor="middle"
      dominantBaseline="central"
      fill="currentColor"
      stroke="none"
      style={{ fontFamily: BRAND.text, fontWeight: 700, fontSize: 24, opacity: t % 60 < 30 ? 1 : 0.55 }}
    >
      {BRAND.currency}
    </text>
  </>
);

const gGear = (cx: number, t: number) => {
  const teeth = [0, 1, 2, 3, 4, 5].map((i) => {
    const a = (i / 6) * Math.PI * 2;
    const w = 0.16;
    const p = (r: number, ang: number) => `${cx + Math.cos(ang) * r} ${30 + Math.sin(ang) * r}`;
    return `M ${p(15, a - w)} L ${p(23, a - w * 0.6)} L ${p(23, a + w * 0.6)} L ${p(15, a + w)}`;
  });
  return (
    <g transform={`rotate(${(t / 160) * 60} ${cx} 30)`}>
      <circle cx={cx} cy={30} r={15} {...THIN} />
      {teeth.map((d, i) => (
        <path key={i} d={d} {...THIN} />
      ))}
    </g>
  );
};

const gPerson = (cx: number, t: number) => (
  <>
    <circle cx={cx} cy={17} r={11} {...THIN} />
    <path d={`M ${cx - 20} 52 Q ${cx} 32 ${cx + 20} 52`} {...THIN} />
    <circle cx={cx + 19} cy={8} r={3.5} fill="currentColor" stroke="none" style={{ opacity: t % 64 < 32 ? 1 : 0.2 }} />
  </>
);

const gScreen = (cx: number, t: number) => (
  <>
    <rect x={cx - 24} y={8} width={48} height={34} rx={5} {...THIN} />
    <line x1={cx - 8} y1={42} x2={cx - 8} y2={50} {...THIN} />
    <line x1={cx - 16} y1={50} x2={cx + 16} y2={50} {...THIN} />
    <line x1={cx - 15} y1={20} x2={cx + 5} y2={20} {...THIN} style={{ opacity: t % 46 < 23 ? 1 : 0.25 }} />
    <line x1={cx - 15} y1={30} x2={cx + 13} y2={30} {...THIN} style={{ opacity: t % 46 < 23 ? 0.25 : 1 }} />
  </>
);

const gClock = (cx: number, t: number) => (
  <>
    <circle cx={cx} cy={30} r={21} {...THIN} />
    <line x1={cx} y1={30} x2={cx} y2={17} {...THIN} />
    <line
      x1={cx}
      y1={30}
      x2={cx + Math.sin((t / 84) * Math.PI * 2) * 15}
      y2={30 - Math.cos((t / 84) * Math.PI * 2) * 15}
      {...THIN}
    />
  </>
);

const gDb = (cx: number, t: number) => (
  <>
    <ellipse cx={cx} cy={14} rx={20} ry={7} {...THIN} />
    <path d={`M ${cx - 20} 14 V 44 Q ${cx} 54 ${cx + 20} 44 V 14`} {...THIN} />
    <ellipse
      cx={cx}
      cy={29}
      rx={20}
      ry={7}
      {...THIN}
      style={{ opacity: 0.35 + 0.65 * Math.abs(Math.sin((t / 64) * Math.PI)) }}
    />
  </>
);

const gRings = (cx: number, t: number) => (
  <g transform={`rotate(${(t / 210) * 360} ${cx} 30)`}>
    <circle cx={cx - 10} cy={30} r={14} {...THIN} />
    <circle cx={cx + 10} cy={30} r={14} {...THIN} />
  </g>
);

const gShield = (cx: number, t: number) => (
  <>
    <path
      d={`M ${cx} 6 L ${cx + 19} 14 V 31 Q ${cx + 19} 47 ${cx} 56 Q ${cx - 19} 47 ${cx - 19} 31 V 14 Z`}
      {...THIN}
    />
    <circle
      cx={cx}
      cy={30}
      r={5}
      fill="currentColor"
      stroke="none"
      style={{ opacity: 0.4 + 0.6 * Math.abs(Math.sin((t / 50) * Math.PI)) }}
    />
  </>
);

const gBolt = (cx: number, t: number) => (
  <path
    d={`M ${cx + 8} 6 L ${cx - 16} 33 H ${cx - 1} L ${cx - 8} 56 L ${cx + 16} 28 H ${cx + 1} Z`}
    {...THIN}
    style={{ opacity: t % 46 < 8 ? 0.4 : 1 }}
  />
);

const gLayers = (cx: number, t: number) => {
  const shift = 4 * Math.sin((t / 72) * Math.PI * 2);
  return (
    <>
      <rect x={cx - 24} y={42} width={48} height={12} rx={4} {...THIN} />
      <rect x={cx - 24 + shift} y={26} width={48} height={12} rx={4} {...THIN} />
      <rect x={cx - 24 - shift} y={10} width={48} height={12} rx={4} {...THIN} />
    </>
  );
};

const gRack = (cx: number, t: number) => (
  <>
    {[0, 1, 2].map((k) => (
      <g key={k}>
        <rect x={cx - 24} y={6 + k * 17} width={48} height={13} rx={4} {...THIN} />
        <circle
          cx={cx - 15}
          cy={12.5 + k * 17}
          r={3}
          fill="currentColor"
          stroke="none"
          style={{ opacity: Math.floor(t / 20) % 3 === k ? 1 : 0.25 }}
        />
      </g>
    ))}
  </>
);

const gPlay = (cx: number, t: number) => (
  <>
    <circle cx={cx} cy={30} r={21} {...THIN} />
    <path d={`M ${cx - 7} 19 L ${cx + 12} 30 L ${cx - 7} 41 Z`} {...THIN} />
    <circle
      cx={cx}
      cy={30}
      r={21 + (t % 60) * 0.25}
      {...THIN}
      style={{ opacity: Math.max(0, 0.5 - (t % 60) / 120) }}
    />
  </>
);

const gCalendar = (cx: number, t: number) => (
  <>
    <rect x={cx - 22} y={10} width={44} height={42} rx={5} {...THIN} />
    <line x1={cx - 22} y1={23} x2={cx + 22} y2={23} {...THIN} />
    <rect
      x={cx - 15 + (Math.floor(t / 28) % 3) * 12}
      y={31}
      width={9}
      height={9}
      fill="currentColor"
      stroke="none"
    />
  </>
);

const gUnlock = (cx: number, t: number) => {
  const lift = ((t % 84) < 30 ? (t % 84) / 30 : 1) * 8;
  return (
    <>
      <rect x={cx - 18} y={28} width={36} height={28} rx={6} {...THIN} />
      <path d={`M ${cx - 10} 28 V ${18 - lift} Q ${cx - 10} ${6 - lift} ${cx + 2} ${6 - lift} Q ${cx + 14} ${6 - lift} ${cx + 14} ${18 - lift}`} {...THIN} />
    </>
  );
};

const gMap = (cx: number, t: number) => (
  <>
    <path d={`M ${cx - 24} 48 Q ${cx - 6} 48 ${cx - 6} 32 Q ${cx - 6} 16 ${cx + 14} 16`} {...THIN} strokeDasharray="5 7" />
    <circle cx={cx - 24} cy={48} r={4} fill="currentColor" stroke="none" />
    <path d={`M ${cx + 14} 16 V 4 M ${cx + 14} 4 H ${cx + 30} L ${cx + 24} 11 L ${cx + 30} 18 H ${cx + 14}`} {...THIN} />
    <circle
      cx={cx - 24 + (((t % 90) / 90) * 38)}
      cy={48 - Math.min(32, ((t % 90) / 90) * 40)}
      r={3.5}
      fill="currentColor"
      stroke="none"
      style={{ opacity: 1 - (t % 90) / 90 }}
    />
  </>
);

const gCube = (cx: number, t: number) => (
  <g transform={`translate(0 ${1.5 * Math.sin((t / 90) * Math.PI * 2)})`}>
    <path d={`M ${cx} 6 L ${cx + 22} 19 V 43 L ${cx} 56 L ${cx - 22} 43 V 19 Z`} {...THIN} />
    <path d={`M ${cx - 22} 19 L ${cx} 32 L ${cx + 22} 19`} {...THIN} />
    <path d={`M ${cx} 32 V 56`} {...THIN} />
  </g>
);

const gChip = (cx: number, t: number) => {
  const cells = [0, 1, 2, 3, 4, 5];
  const filled = Math.floor((t % 96) / 14);
  return (
    <>
      <rect x={cx - 20} y={12} width={40} height={38} rx={5} {...THIN} />
      {[0, 1, 2].map((k) => (
        <g key={k}>
          <line x1={cx - 27} y1={20 + k * 11} x2={cx - 20} y2={20 + k * 11} {...THIN} />
          <line x1={cx + 20} y1={20 + k * 11} x2={cx + 27} y2={20 + k * 11} {...THIN} />
        </g>
      ))}
      {cells.map((k) => (
        <rect
          key={k}
          x={cx - 14 + (k % 3) * 10}
          y={19 + Math.floor(k / 3) * 13}
          width={7}
          height={9}
          fill="currentColor"
          stroke="none"
          style={{ opacity: k < filled ? 0.95 : 0.18 }}
        />
      ))}
    </>
  );
};

const gDoc = (cx: number, t: number) => (
  <>
    <rect x={cx - 17} y={8} width={34} height={46} rx={5} {...THIN} />
    <line x1={cx - 9} y1={20} x2={cx + 9} y2={20} {...THIN} />
    <line x1={cx - 9} y1={30} x2={cx + 9} y2={30} {...THIN} style={{ opacity: t % 58 < 29 ? 1 : 0.3 }} />
    <line x1={cx - 9} y1={40} x2={cx + 3} y2={40} {...THIN} style={{ opacity: t % 58 < 29 ? 0.3 : 1 }} />
  </>
);

const gBubble = (cx: number, t: number) => (
  <>
    <path
      d={`M ${cx - 26} 10 H ${cx + 4} Q ${cx + 12} 10 ${cx + 12} 18 V 30 Q ${cx + 12} 38 ${cx + 4} 38 H ${cx - 14} L ${cx - 24} 46 V 38 H ${cx - 26} Q ${cx - 34} 38 ${cx - 34} 30 V 18 Q ${cx - 34} 10 ${cx - 26} 10 Z`}
      {...THIN}
    />
    <path
      d={`M ${cx - 2} 28 H ${cx + 26} Q ${cx + 34} 28 ${cx + 34} 36 V 46 Q ${cx + 34} 54 ${cx + 26} 54 H ${cx + 4} L ${cx - 4} 60 V 54 H ${cx - 2} Q ${cx - 10} 54 ${cx - 10} 46 V 36 Q ${cx - 10} 28 ${cx - 2} 28 Z`}
      {...THIN}
      style={{ opacity: t % 74 < 37 ? 1 : 0.4 }}
    />
  </>
);

const gBracket = (cx: number, t: number) => {
  const w = 16 + 12 * ((t % 84) / 84);
  return (
    <>
      <path d={`M ${cx - w} 12 H ${cx - w - 8} V 48 H ${cx - w}`} {...THIN} />
      <path d={`M ${cx + w} 12 H ${cx + w + 8} V 48 H ${cx + w}`} {...THIN} />
      <line x1={cx - w + 4} y1={30} x2={cx + w - 4} y2={30} {...THIN} strokeDasharray="4 6" />
    </>
  );
};

const gPeople = (cx: number, t: number) => {
  const live = Math.floor(t / 26) % 3;
  return (
    <>
      {[-24, 0, 24].map((dx, i) => (
        <g key={dx} style={{ opacity: i === live ? 1 : 0.4 }}>
          <circle cx={cx + dx} cy={20} r={8} {...THIN} />
          <path d={`M ${cx + dx - 13} 46 Q ${cx + dx} 32 ${cx + dx + 13} 46`} {...THIN} />
        </g>
      ))}
    </>
  );
};

const gBar = (cx: number, t: number) => {
  const fill = Math.min(1, (t % 100) / 70);
  return (
    <>
      <rect x={cx - 15} y={8} width={30} height={48} rx={5} {...THIN} />
      <rect
        x={cx - 15}
        y={56 - 48 * fill}
        width={30}
        height={Math.max(2, 48 * fill)}
        rx={5}
        fill="currentColor"
        stroke="none"
        fillOpacity={0.35}
      />
    </>
  );
};

const gSpeed = (cx: number, t: number) => {
  const a = -140 + 100 * ((1 - Math.cos((t / 72) * Math.PI * 2)) / 2);
  return (
    <>
      <path d={`M ${cx - 24} 44 A 24 24 0 1 1 ${cx + 24} 44`} {...THIN} />
      <line
        x1={cx}
        y1={44}
        x2={cx + Math.cos((a * Math.PI) / 180) * 20}
        y2={44 + Math.sin((a * Math.PI) / 180) * 20}
        {...THIN}
      />
      <circle cx={cx} cy={44} r={4} fill="currentColor" stroke="none" />
    </>
  );
};

const gQueue = (cx: number, t: number) => {
  const n = 1 + Math.floor((t % 100) / 22);
  return (
    <>
      <line x1={cx - 30} y1={54} x2={cx + 30} y2={54} {...THIN} />
      {[0, 1, 2, 3].map((k) => (
        <rect
          key={k}
          x={cx - 16}
          y={42 - k * 12}
          width={32}
          height={9}
          rx={3}
          {...THIN}
          style={{ opacity: k < n ? 1 : 0 }}
        />
      ))}
      <path
        d={`M ${cx + 26} ${8 + ((t % 34) / 34) * 12} V ${16 + ((t % 34) / 34) * 12}`}
        {...THIN}
      />
      <path d={`M ${cx + 21} ${12 + ((t % 34) / 34) * 12} L ${cx + 26} ${18 + ((t % 34) / 34) * 12} L ${cx + 31} ${12 + ((t % 34) / 34) * 12}`} {...THIN} />
    </>
  );
};

const gCalc = (cx: number, t: number) => {
  const key = Math.floor(t / 11) % 6;
  return (
    <>
      <rect x={cx - 20} y={6} width={40} height={50} rx={6} {...THIN} />
      <rect x={cx - 14} y={11} width={28} height={10} rx={3} {...THIN} />
      {[0, 1, 2, 3, 4, 5].map((k) => (
        <rect
          key={k}
          x={cx - 14 + (k % 3) * 10}
          y={26 + Math.floor(k / 3) * 12}
          width={7}
          height={8}
          rx={2}
          fill="currentColor"
          stroke="none"
          style={{ opacity: k === key ? 1 : 0.3 }}
        />
      ))}
    </>
  );
};

const soloArt = (glyph: (cx: number, t: number) => React.ReactNode): React.FC<ArtProps> =>
  function SoloArt({ delay = 0 }) {
    const frame = useCurrentFrame();
    const p = drawAt(frame, delay, 18);
    const t = Math.max(0, frame - delay);
    return (
      <svg width={150} height={112} viewBox="0 0 160 120">
        <g transform="translate(80 60) scale(1.75) translate(-80 -30)" style={{ opacity: p }}>
          {glyph(80, t)}
        </g>
      </svg>
    );
  };

const gLens = (cx: number, t: number) => (
  <g transform={`translate(${4 * Math.sin((t / 78) * Math.PI * 2)} ${3 * Math.cos((t / 78) * Math.PI * 2)})`}>
    <circle cx={cx - 4} cy={24} r={17} {...THIN} />
    <line x1={cx + 9} y1={37} x2={cx + 22} y2={50} {...THIN} />
  </g>
);

const gLoop = (cx: number, t: number) => (
  <g transform={`rotate(${(t / 60) * 360} ${cx} 30)`}>
    <path d={`M ${cx} 10 A 20 20 0 1 1 ${cx - 20} 30`} {...THIN} />
    <path d={`M ${cx - 9} 3 L ${cx + 1} 10 L ${cx - 9} 17`} {...THIN} />
  </g>
);

const gHand = (cx: number, t: number) => {
  const tap = (t % 40) < 12 ? 5 : 0;
  return (
    <>
      <line x1={cx - 26} y1={50} x2={cx + 26} y2={50} {...THIN} />
      <g transform={`translate(0 ${tap})`}>
        <path d={`M ${cx - 14} 34 V 14 Q ${cx - 14} 6 ${cx - 7} 6 Q ${cx} 6 ${cx} 14 V 30`} {...THIN} />
        <path d={`M ${cx} 26 Q ${cx + 8} 24 ${cx + 10} 32 L ${cx + 12} 42 Q ${cx + 12} 46 ${cx + 6} 46 H ${cx - 8} Q ${cx - 14} 46 ${cx - 14} 40 V 34`} {...THIN} />
      </g>
    </>
  );
};

const gChart = (cx: number, t: number) => {
  const grow = 4 * Math.abs(Math.sin((t / 70) * Math.PI));
  return (
    <>
      <line x1={cx - 26} y1={52} x2={cx + 26} y2={52} {...THIN} />
      <rect x={cx - 22} y={38} width={12} height={14} {...THIN} />
      <rect x={cx - 6} y={28} width={12} height={24} {...THIN} />
      <rect x={cx + 10} y={16 - grow} width={12} height={36 + grow} {...THIN} />
    </>
  );
};

const gChampion = (cx: number, t: number) => (
  <>
    <circle cx={cx} cy={24} r={11} {...THIN} />
    <path d={`M ${cx - 20} 52 Q ${cx} 36 ${cx + 20} 52`} {...THIN} />
    <path
      d={`M ${cx} 0 L ${cx + 3.5} 7 L ${cx + 11} 8 L ${cx + 5.5} 13 L ${cx + 7} 20 L ${cx} 16.5 L ${cx - 7} 20 L ${cx - 5.5} 13 L ${cx - 11} 8 L ${cx - 3.5} 7 Z`}
      {...THIN}
      style={{ opacity: 0.45 + 0.55 * Math.abs(Math.sin((t / 56) * Math.PI)) }}
    />
  </>
);

/** Row glyphs by name — what a `row` item or a solo art refers to. */
const GLYPH = {
  cart: gCart,
  mega: gMega,
  coin: gCoin,
  cog: gGear,
  person: gPerson,
  screen: gScreen,
  clock: gClock,
  db: gDb,
  rings: gRings,
  shield: gShield,
  bolt: gBolt,
  layers: gLayers,
  rack: gRack,
  play: gPlay,
  calendar: gCalendar,
  unlock: gUnlock,
  map: gMap,
  cube: gCube,
  chip: gChip,
  doc: gDoc,
  bubble: gBubble,
  bracket: gBracket,
  users: gPeople,
  bar: gBar,
  speed: gSpeed,
  queue: gQueue,
  calc: gCalc,
  lens: gLens,
  loop: gLoop,
  hand: gHand,
  chart: gChart,
  star: gChampion,
} as const;

export type GlyphName = keyof typeof GLYPH;

const SOLO = Object.fromEntries(
  Object.entries(GLYPH).map(([name, glyph]) => [name, soloArt(glyph)]),
) as Record<GlyphName, React.FC<ArtProps>>;

/** Every compact pictogram: the hand-drawn ones plus every glyph on its own. */
const ART = {
  ...SOLO,
  cash: CashArt,
  debt: DebtArt,
  target: TargetArt,
  gap: GapArt,
  smile: SmileArt,
  frown: FrownArt,
  spark: SparkArt,
  building: BuildingArt,
  gear: GearArt,
  lock: LockArt,
  hours: HoursArt,
  ask: AskArt,
  check: CheckArt,
  bill: BillArt,
  send: SendArt,
};

export type ArtName = keyof typeof ART;
export const ART_NAMES = Object.keys(ART) as ArtName[];

/**
 * A real image pinned into the frame — same sticker chrome as `Float`, but the content is a
 * picture instead of a drawing. Used when the speaker describes something concrete: the
 * picture lands where the gesture points, so the gesture has something to land on.
 *
 * Position is in composition coordinates and must be checked against the CROP that
 * `Footage.tsx` applies at those frames — the punch-in moves the wall under the sticker.
 */
export const Photo: React.FC<{
  dur: number;
  src: string;
  x: number;
  y: number;
  w: number;
  tilt?: number;
}> = ({ dur, src, x, y, w, tilt = 3 }) => {
  const frame = useCurrentFrame();
  const enter = interpolate(frame, [0, 12], [0, 1], EASE);
  const exit = interpolate(frame, [dur - 10, dur], [1, 0], EASE);
  const bob = 4 * Math.sin((frame / 96) * Math.PI * 2);
  const pop = interpolate(enter, [0, 1], [0.92, 1], CLAMP);
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        opacity: enter * exit,
        transform: `translateY(${(1 - enter) * 12 + bob}px) scale(${pop}) rotate(${tilt}deg)`,
        transformOrigin: "50% 50%",
        filter: "drop-shadow(0 12px 30px rgba(0,0,0,0.45))",
        padding: 14,
        borderRadius: 26,
        backgroundColor: BRAND.light,
      }}
    >
      <Img src={staticFile(src)} style={{ width: w, display: "block", borderRadius: 12 }} />
    </div>
  );
};

/**
 * A clip pinned into the frame — `Photo`'s chrome with moving content: a screen recording of the
 * tool being described, or a generated b-roll shot (Higgsfield). Deliberately small and off to
 * one side: it is evidence under the line, not the subject of the frame.
 *
 * Pre-trim and MUTE the source at encode time: the clip has to be at least as long as its
 * Sequence, or `OffthreadVideo` freezes on its last frame, and the composition's own audio is
 * the only sound in the mix. It drifts like a card — a rectangle that lands and then sits
 * perfectly still is the static-insert defect even when its contents move.
 */
export const Clip: React.FC<{
  dur: number;
  src: string;
  x: number;
  y: number;
  w: number;
  tilt?: number;
  /** the clip that carries the tail never leaves */
  hold?: boolean;
}> = ({ dur, src, x, y, w, tilt = 3, hold }) => {
  const frame = useCurrentFrame();
  const enter = interpolate(frame, [0, 14], [0, 1], EASE);
  const exit = hold ? 1 : interpolate(frame, [dur - 10, dur], [1, 0], EASE);
  const bob = 4 * Math.sin((frame / 96) * Math.PI * 2);
  const drift = 1 + frame * 0.00016;
  const pop = interpolate(enter, [0, 1], [0.92, 1], CLAMP);
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        opacity: enter * exit,
        transform: `translateY(${(1 - enter) * 14 + bob}px) scale(${pop * drift}) rotate(${tilt}deg)`,
        transformOrigin: "50% 50%",
        filter: "drop-shadow(0 14px 34px rgba(0,0,0,0.5))",
        padding: 12,
        borderRadius: 24,
        backgroundColor: BRAND.light,
        lineHeight: 0,
      }}
    >
      <div style={{ width: w, borderRadius: 12, overflow: "hidden" }}>
        {/* inline, not a class: Remotion sets objectFit inline and that wins */}
        <OffthreadVideo src={staticFile(src)} muted style={{ width: w, height: "auto", display: "block" }} />
      </div>
    </div>
  );
};

/**
 * A word slapped onto the frame as a sticker — for a repeated word that should PILE UP: one
 * lands on each utterance and they all stay until the same frame, so the pile clears in one move.
 */
export const Tag: React.FC<{
  dur: number;
  text: string;
  x: number;
  y: number;
  tilt?: number;
  scale?: number;
}> = ({ dur, text, x, y, tilt = -4, scale = 1 }) => {
  const frame = useCurrentFrame();
  const enter = interpolate(frame, [0, 9], [0, 1], EASE);
  const exit = interpolate(frame, [dur - 10, dur], [1, 0], EASE);
  const pop = interpolate(enter, [0, 1], [0.86, 1], CLAMP);
  const bob = 3 * Math.sin((frame / 90) * Math.PI * 2);
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        opacity: enter * exit,
        transform: `translateY(${bob}px) scale(${scale * pop}) rotate(${tilt}deg)`,
        transformOrigin: "50% 50%",
        filter: "drop-shadow(0 10px 26px rgba(0,0,0,0.45))",
        padding: "14px 30px 18px",
        borderRadius: 28,
        backgroundColor: BRAND.light,
        color: BRAND.dark,
        fontFamily: BRAND.text,
        fontWeight: 700,
        fontSize: 62,
        lineHeight: 1,
        letterSpacing: "-0.03em",
      }}
    >
      {text}
    </div>
  );
};

/**
 * A STICKER over the footage, in the gaps BETWEEN cards (only if the user wants stickers —
 * style.stickers). Light chip, dark glyph — the inverse of the card, so it reads as a sticker
 * stuck onto the video rather than a small card. It arrives with a small scale-up, sits at a
 * fixed tilt and bobs slowly.
 *
 * Always labelled: a bare glyph over footage can be hard to read; one word inside the chip makes
 * the drawing unambiguous.
 */
export const Float: React.FC<{
  dur: number;
  art: ArtName;
  label: string;
  x: number;
  y: number;
  tilt?: number;
  /** the sticker that carries the tail never leaves — a video that empties its last second
   *  ends on dead footage */
  hold?: boolean;
}> = ({ dur, art, label, x, y, tilt = -3, hold }) => {
  const frame = useCurrentFrame();
  const Pictogram = ART[art];
  const enter = interpolate(frame, [0, 12], [0, 1], EASE);
  const exit = hold ? 1 : interpolate(frame, [dur - 10, dur], [1, 0], EASE);
  const labelIn = interpolate(frame, [10, 22], [0, 1], EASE);
  const bob = 4 * Math.sin((frame / 96) * Math.PI * 2);
  const pop = interpolate(enter, [0, 1], [0.92, 1], CLAMP);
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        opacity: enter * exit,
        // 1.35x: at native size the sticker is lost against bright footage
        transform: `translateY(${(1 - enter) * 12 + bob}px) scale(${1.35 * pop}) rotate(${tilt}deg)`,
        transformOrigin: "0 0",
        filter: "drop-shadow(0 10px 26px rgba(0,0,0,0.45))",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 2,
        padding: "18px 20px 14px",
        borderRadius: 34,
        backgroundColor: BRAND.light,
        // the glyph inherits this: dark on light, the card inverted
        color: BRAND.dark,
      }}
    >
      <Pictogram delay={0} />
      <div
        style={{
          ...TYPE.label,
          color: BRAND.dark,
          fontSize: 28,
          opacity: labelIn,
          transform: `translateY(${(1 - labelIn) * 6}px)`,
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </div>
    </div>
  );
};

const Line: React.FC<{ text: string; delay: number; scale: number; accent?: string }> = ({
  text,
  delay,
  scale,
  accent,
}) => (
  <Reveal progress={useReveal(delay)}>
    <div
      style={{
        ...TYPE.headline,
        fontSize: TYPE.headline.fontSize * scale,
        color: accent ?? TYPE.headline.color,
      }}
    >
      {text}
    </div>
  </Reveal>
);

const Sub: React.FC<{ text: string; delay: number }> = ({ text, delay }) => (
  <Reveal progress={useReveal(delay)}>
    <div style={TYPE.sub}>{text}</div>
  </Reveal>
);

// Thin space every three digits. Hand-rolled rather than toLocaleString: the render must be
// byte-identical on every seek, and locale data is not something to bet a frame on.
const group = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

/**
 * The counter runs almost the whole card rather than landing early and sitting there — a number
 * that stops moving with 3s left on screen is the static-insert defect. The ease matches
 * <Ticks>' default, which is what lets the ticks crowd at the start and thin out with the digits.
 */
const Counter: React.FC<{ to: number; suffix?: string; scale: number; hue: string }> = ({
  to,
  suffix,
  scale,
  hue,
}) => {
  const frame = useCurrentFrame();
  const value = Math.round(interpolate(frame, [6, 76], [0, to], EASE));
  return (
    // The unit sits ON the baseline of the digits, inside the same reveal: «20%» is one
    // figure, not a number with a caption under it. Same hue for the same reason.
    <Reveal progress={useReveal(0)}>
      <div
        style={{
          ...TYPE.headline,
          // 1.6x the headline: the figure IS the card, nothing competes with it
          fontSize: TYPE.headline.fontSize * scale * 1.6,
          color: hue,
          fontVariantNumeric: "tabular-nums",
          display: "flex",
          alignItems: "baseline",
        }}
      >
        {group(value)}
        {suffix ? (
          <span
            style={{
              fontSize: TYPE.headline.fontSize * scale * 1.6 * 0.62,
              marginLeft: TYPE.headline.fontSize * scale * 0.12,
            }}
          >
            {suffix}
          </span>
        ) : null}
      </div>
    </Reveal>
  );
};

export const Card: React.FC<Beat & { scale: number }> = ({
  dur,
  art,
  artDelay,
  row,
  num,
  head,
  count,
  accent,
  lines,
  top = 300,
  width,
  pain,
  hold,
  scale,
}) => {
  const Pictogram = art ? ART[art] : null;
  // a delayed pictogram is an insert, not the first cascade element — the text doesn't wait
  const artLeads = Boolean(art) && artDelay == null;
  const exitStart = hold ? 99999 : dur - EXIT;
  const progress = usePanelProgress(exitStart, exitStart + EXIT);
  const exit = useExit(exitStart, exitStart + EXIT);
  const numReveal = useReveal(0);
  const hue = pain ? BRAND.pain : BRAND.accent;
  const headSlots = (head?.length ?? 0) + (num ? 1 : 0) + (artLeads ? 1 : 0) + (count ? 1 : 0);

  return (
    <AbsoluteFill style={{ backgroundColor: "transparent" }}>
      <div
        style={{
          position: "absolute",
          top,
          left: SAFE.side,
          ...(width == null ? { right: SAFE.side } : { width }),
        }}
      >
        <Panel progress={progress}>
          <div
            style={{
              position: "relative",
              // the tone every pictogram inherits (they draw in currentColor)
              color: BRAND.light,
              opacity: exit,
              transform: `translateY(${(1 - exit) * -18}px)`,
            }}
          >
            {Pictogram && artDelay == null ? (
              <div style={{ marginBottom: 20, opacity: 0.95 }}>
                <Pictogram />
              </div>
            ) : null}

            {num ? (
              // light, not accent: the card has ONE accent element and it is the head line
              <Reveal progress={numReveal}>
                <div
                  style={{
                    ...TYPE.headline,
                    fontSize: TYPE.headline.fontSize * scale,
                    color: BRAND.light,
                    marginBottom: 12,
                  }}
                >
                  {num}
                </div>
              </Reveal>
            ) : null}

            {count ? <Counter to={count.to} suffix={count.suffix} scale={scale} hue={hue} /> : null}

            {/* A delayed pictogram rides ON the headline's line, not under it: the drawing is
                part of the phrase, and stacking it below reads as a second, unrelated row. It
                occupies its space from frame 0 — the panel is sized from the start, so nothing
                jumps when the strokes begin. */}
            <div style={artDelay != null ? { display: "flex", alignItems: "center", gap: 28 } : undefined}>
              <div>
                {(head ?? []).map((text, i) => (
                  <Line
                    key={text}
                    text={text}
                    scale={scale}
                    delay={(i + (num ? 1 : 0) + (artLeads ? 1 : 0)) * CASCADE}
                    accent={!num && accent === i ? hue : undefined}
                  />
                ))}
              </div>

              {Pictogram && artDelay != null ? (
                <div style={{ opacity: 0.95 }}>
                  <Pictogram delay={artDelay} />
                </div>
              ) : null}
            </div>

            {/* a row fills the panel's whole content width — it can only live on its own line */}
            {row?.length ? (
              <div style={{ marginTop: 28 }}>
                <IconRow items={row} delay={0} />
              </div>
            ) : null}

            {lines?.length ? (
              <div style={{ marginTop: 32, display: "flex", flexDirection: "column", gap: 16 }}>
                {lines.map((text, i) => (
                  // a counter is ONE cascade slot: its unit rides inline with the digits
                  <Sub key={text} text={text} delay={(headSlots + i) * CASCADE} />
                ))}
              </div>
            ) : null}
          </div>
        </Panel>
      </div>
    </AbsoluteFill>
  );
};

export default Card;
