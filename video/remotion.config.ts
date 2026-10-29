/**
 * Applies to the Studio and the CLI only — the Node APIs (`npx remotion bundle`, renderMedia)
 * ignore this file. Debug the CSS pipeline with `npx remotion still MyComp /tmp/t.png --frame=N`.
 */
import { Config } from "@remotion/cli/config";
import { enableTailwind } from "@remotion/tailwind-v4";

// ponytail: webpack, not rspack — the Tailwind webpack loader is a silent no-op under rspack and
// every Tailwind class drops out of the render. Switch back if Remotion ships an rspack-native one.

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
Config.overrideWebpackConfig(enableTailwind);

// The OffthreadVideo frame cache defaults to a share of free memory, which over a few thousand
// frames of 1296x2304 footage grows until a worker tab is killed. Remotion then opens a
// replacement tab that never finishes its font load, and the render dies with a misleading
// `delayRender("brand fonts") timed out` — the fonts are fine, the tab was starved.
Config.setOffthreadVideoCacheSizeInBytes(512 * 1024 * 1024);
Config.setConcurrency(3);
