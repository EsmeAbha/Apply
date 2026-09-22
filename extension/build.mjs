import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });
const common = { bundle: true, minify: true, target: "chrome114", logLevel: "info", define: { "process.env.NODE_ENV": '"production"' } };
await build({ ...common, entryPoints: { popup: "src/popup.tsx", options: "src/options.tsx" }, outdir: "dist", format: "iife", jsx: "automatic" });
await build({ ...common, entryPoints: { background: "src/background.ts" }, outdir: "dist", format: "esm" });
// Content script is injected on demand; it must be a classic script.
await build({ ...common, entryPoints: { formAssist: "src/formAssist.ts" }, outdir: "dist", format: "iife" });
cpSync("public", "dist", { recursive: true });
cpSync("manifest.json", "dist/manifest.json");
console.log("Extension built → extension/dist (load it via chrome://extensions → Load unpacked)");
