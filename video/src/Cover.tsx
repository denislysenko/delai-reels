import { AbsoluteFill, Img, getStaticFiles, staticFile } from "remotion";
import { measureText } from "@remotion/layout-utils";
import { BRAND, FONT, SAFE } from "./brand";

/**
 * The cover / preview: the real footage frame as backdrop, a dark scrim up top so the title
 * reads on a bright wall, the person as a sticker cutout (scripts/cover-sticker.py) slightly
 * overscale so it pops off its own background, and a lowercase title with one accent line.
 * `npx remotion still Cover ../edits/N/cover.png --timeout=120000`
 */
export type CoverLine = {
  text: string;
  em?: boolean; // punch size
  accent?: boolean; // the one accent
};

export const Cover: React.FC<{ lines: CoverLine[]; img: string; bg: string }> = ({ lines, img, bg }) => {
  const files = new Set(getStaticFiles().map((f) => f.name));
  const maxW = 1080 - SAFE.side * 2;
  return (
    <AbsoluteFill style={{ background: BRAND.dark }}>
      {files.has(bg) ? <Img src={staticFile(bg)} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : null}
      <AbsoluteFill
        style={{
          background: `linear-gradient(180deg, ${BRAND.dark}E6 0%, ${BRAND.dark}99 38%, transparent 62%)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: SAFE.side,
          right: SAFE.side,
          top: 250,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          fontFamily: BRAND.text,
          fontWeight: 700,
          lineHeight: 1.04,
          letterSpacing: "-0.03em",
        }}
      >
        {lines.map((l, i) => {
          // fit each line to the safe width — never hand-tune a size to dodge overflow
          const want = l.em ? 168 : 84;
          const w = measureText({
            text: l.text,
            fontFamily: FONT.text,
            fontWeight: "700",
            fontSize: want,
            letterSpacing: "-0.03em",
          }).width;
          return (
            <div
              key={i}
              style={{
                fontSize: w > maxW ? Math.floor((want * maxW) / w) : want,
                color: l.accent ? BRAND.accent : BRAND.light,
                textShadow: "0 6px 40px rgba(0,0,0,0.55)",
                whiteSpace: "nowrap",
              }}
            >
              {l.text}
            </div>
          );
        })}
      </div>
      {files.has(img) ? (
        <Img
          src={staticFile(img)}
          style={{
            position: "absolute",
            bottom: -46,
            left: "50%",
            transform: "translateX(-50%)",
            width: 1160,
            filter: "drop-shadow(0 24px 60px rgba(0,0,0,0.55))",
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
};
