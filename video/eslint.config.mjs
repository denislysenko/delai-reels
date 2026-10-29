import { config } from "@remotion/eslint-config-flat";

// exFAT drive: macOS writes AppleDouble "._*" files next to every file — keep them out of lint
export default [{ ignores: ["**/._*"] }, ...config];
