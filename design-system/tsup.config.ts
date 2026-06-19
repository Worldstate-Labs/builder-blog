import { defineConfig } from "tsup";

// Builds the decoupled presentational components into a real library:
// dist/index.js (the runtime the claude.ai/design agent renders via design-sync)
// + dist/index.d.ts (the public API design-sync reads to discover components).
// react/react-dom stay external; everything else (lucide, the pure @/lib utils,
// the components themselves) is bundled. @/ is resolved via tsconfig paths.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  treeshake: true,
  external: ["react", "react-dom"],
  tsconfig: "tsconfig.json",
});
