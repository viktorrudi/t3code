import { defineConfig } from "vite-plus";
export default defineConfig({
  pack: {
    entry: ["main.ts"],
    outDir: "../../../../.t3/watch-gateway",
    format: "esm",
    platform: "node",
    target: "node24",
    deps: { alwaysBundle: [/.*/] },
  },
});
