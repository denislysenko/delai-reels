import config from "../../harness.config.json";

// Everything about the LOOK comes from harness.config.json, which the setup interview fills from
// the user's own answers and references. Nothing here is a house style: until the interview has
// run, the demo renders in neutral greys and the system font. Never hardcode a hex or a family
// name in a component — read it from here.

const or = (v: string, fallback: string) => (v ? v : fallback);

/** Bare family names (measureText silently measures the fallback when handed a CSS stack). */
export const FONT = {
  text: or(config.fonts.text, "sans-serif"),
  poster: or(config.fonts.poster, or(config.fonts.text, "sans-serif")),
  posterWeight: config.fonts.posterWeight,
};

const stack = (family: string) => (family === "sans-serif" ? "sans-serif" : `"${family}", sans-serif`);

export const BRAND = {
  dark: or(config.colors.dark, "#141414"), // card tint, scrims, sticker glyphs
  light: or(config.colors.light, "#FFFFFF"), // text
  accent: or(config.colors.accent, "#BDBDBD"), // the accent element
  pain: or(config.colors.pain, "#8A8A8A"), // the «don't» card, if the user wants one
  text: stack(FONT.text), // captions, cards, labels
  poster: stack(FONT.poster), // the opening poster
  currency: or(config.currency, "$"),
} as const;

/** The user's choices for captions, cards, stickers, poster, motion, grade and sound. */
export const STYLE = config.style;

/** Animation timing multiplier: «calm» stretches every entry and cascade, «snappy» tightens it. */
export const PACE = ({ calm: 1.35, normal: 1, snappy: 0.7 } as Record<string, number>)[STYLE.motion.pace] ?? 1;

/** "#141414", 0.46 → "rgba(20, 20, 20, 0.46)" — tints derive from the palette, not from a literal. */
export const rgba = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

// Platform + title safety, in px on the 1080x1920 canvas (technical, not taste).
export const SAFE = {
  top: 154, // top 8% = platform UI
  bottom: 1632, // bottom 15% = platform UI
  side: 108, // title-safe 10% — also covers Instagram's ~9% side crop on tall phones
} as const;
