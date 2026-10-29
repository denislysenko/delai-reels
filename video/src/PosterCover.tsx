import React from "react";
import { AbsoluteFill, Img, getStaticFiles, staticFile } from "remotion";
import { BRAND, FONT, STYLE } from "./brand";
import { KICKER, posterSize, posterText, type TitleLine } from "./scenes/Title";

/**
 * The opening poster as a COVER: a real frame from the take as the backdrop, the kicker and the
 * lines BEHIND the person (the frame's cutout on top) — every line fills the width up to `cap`,
 * and the block ends where the hair begins.
 * Static twin of scenes/Title.tsx (that one animates off useCurrentFrame; a Still is frame 0).
 * `npx remotion still PosterCover ../edits/N/cover.png --timeout=120000`
 */
export const PosterCover: React.FC<{
  bg: string;
  cutout: string;
  kicker?: string;
  lines: TitleLine[];
  top: number;
  cap: number;
  /** push the frame in from the top edge so the head sits lower and the lines get room */
  zoom?: number;
}> = ({ bg, cutout, kicker, lines, top, cap, zoom = 1 }) => {
  const files = new Set(getStaticFiles().map((f) => f.name));
  const frame = {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    filter: "contrast(1.05) saturate(1.06) brightness(0.97)",
    transform: `scale(${zoom})`,
    transformOrigin: "50% 0%",
  } as const;
  return (
    <AbsoluteFill style={{ background: BRAND.dark }}>
      {files.has(bg) ? <Img src={staticFile(bg)} style={frame} /> : null}
      <div
        style={{
          position: "absolute",
          left: 64,
          right: 64,
          top,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        {kicker && STYLE.poster.kicker ? <div style={{ ...KICKER, fontSize: 46, marginBottom: 24 }}>{kicker}</div> : null}
        {lines.map((l) => {
          const text = posterText(l.text);
          return (
            <div
              key={l.text}
              style={{
                fontFamily: BRAND.poster,
                fontWeight: FONT.posterWeight,
                fontSize: posterSize(text, cap),
                lineHeight: 0.92,
                color: l.accent ? BRAND.accent : BRAND.light,
                whiteSpace: "nowrap",
                textShadow: "0 8px 40px rgba(0,0,0,0.35)",
              }}
            >
              {text}
            </div>
          );
        })}
      </div>
      {files.has(cutout) ? <Img src={staticFile(cutout)} style={{ position: "absolute", inset: 0, ...frame }} /> : null}
      <AbsoluteFill
        style={{
          pointerEvents: "none",
          background:
            "radial-gradient(120% 85% at 50% 36%, rgba(0,0,0,0) 42%, rgba(0,0,0,0.13) 68%, rgba(0,0,0,0.34) 100%)",
        }}
      />
    </AbsoluteFill>
  );
};
